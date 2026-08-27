//! Auto SSH key-setup command (tech-gui.md §4.2). `start_key_setup` mirrors the TUI's
//! orchestration (crates/omnyssh `ConfirmKeySetup`): connect a password session, drive
//! `setup_key_for_host`, and report progress + the terminal outcome as
//! `CoreEvent::KeySetup*` on the shared engine channel — the bridge maps those to
//! `key-setup-*` IPC events (§3.4). On success it writes the generated key back onto the
//! manual host in `hosts.toml`, the same completion write the TUI performs, so a
//! `reload_hosts` afterwards refreshes `hasKey`/`passwordAuthDisabled` on the card.

use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

use omnyssh_core::config::{load_hosts, save_hosts};
use omnyssh_core::event::CoreEvent;
use omnyssh_core::ssh::client::Host;
use omnyssh_core::ssh::key_setup::{setup_key_for_host, KeySetupState, KeySetupStep, KeyType};
use omnyssh_core::ssh::session::SshSession;

use crate::error::CommandError;
use crate::state::GuiState;

/// Start auto key-setup for `host_name` (tech-gui.md §4.2). Fire-and-forget: the flow
/// runs on a background task and reports via `key-setup-*` events, mirroring the core's
/// own model. Resolving the full host record (secrets included) stays backend-side
/// (§3.4). One run at a time: an unknown host or a run already in flight is the
/// synchronous error, so two runs never race a `hosts.toml` write.
#[tauri::command]
#[specta::specta]
pub fn start_key_setup(
    app: AppHandle,
    state: State<'_, GuiState>,
    host_name: String,
) -> Result<(), CommandError> {
    let host = state.host_by_name(&host_name).ok_or_else(|| CommandError {
        message: format!("unknown host '{host_name}'"),
    })?;
    state
        .try_begin_key_setup(&host_name)
        .map_err(|message| CommandError { message })?;
    tauri::async_runtime::spawn(run_key_setup(app, host, state.engine_sender()));
    Ok(())
}

/// Releases the single key-setup slot on drop, so it frees on every exit of the spawned
/// task — a normal outcome or a panic in the core connect/setup path — and never wedges
/// all future key-setups (§4.2).
struct KeySetupSlot(AppHandle);

impl Drop for KeySetupSlot {
    fn drop(&mut self) {
        self.0.state::<GuiState>().end_key_setup();
    }
}

/// The background flow: forward each step as `KeySetupProgress`, connect with the
/// password, run `setup_key_for_host`, then map the final state to exactly one terminal
/// event (`KeySetupComplete` / `KeySetupRollback` / `KeySetupFailed`).
async fn run_key_setup(app: AppHandle, host: Host, engine_tx: mpsc::Sender<CoreEvent>) {
    // Frees the slot on any return path, including an unwind (see `KeySetupSlot`).
    let _slot = KeySetupSlot(app);

    // Drain the core's per-step channel onto the shared engine channel, tagging each
    // step with the host name (the core's `Sender<KeySetupStep>` carries no host).
    let (progress_tx, mut progress_rx) = mpsc::channel::<KeySetupStep>(8);
    let step_tx = engine_tx.clone();
    let step_host = host.name.clone();
    tokio::spawn(async move {
        while let Some(step) = progress_rx.recv().await {
            let _ = step_tx
                .send(CoreEvent::KeySetupProgress(step_host.clone(), step))
                .await;
        }
    });

    let session = match SshSession::connect(&host).await {
        Ok(session) => session,
        Err(e) => {
            let _ = engine_tx
                .send(CoreEvent::KeySetupFailed(
                    host.name.clone(),
                    format!("Connection failed: {e}"),
                ))
                .await;
            return;
        }
    };

    let outcome = setup_key_for_host(&host, &session, KeyType::Ed25519, Some(progress_tx)).await;
    session.disconnect().await;

    match outcome {
        // Both Success and PartialSuccess mean the key is generated, copied, and
        // verified — the card should show `hasKey`. Only full Success disabled password
        // auth (PartialSuccess is "key works, no sudo"), so only it marks that + clears
        // the stored password. Persist BEFORE emitting so the frontend's reload sees it.
        Ok(result)
            if matches!(
                result.state,
                KeySetupState::Success | KeySetupState::PartialSuccess
            ) =>
        {
            let disabled = matches!(result.state, KeySetupState::Success);
            persist_key(&host.name, &result.key_path.to_string_lossy(), disabled).await;
            let _ = engine_tx
                .send(CoreEvent::KeySetupComplete(
                    host.name.clone(),
                    result.key_path,
                ))
                .await;
        }
        // The two arms below are the correct mapping for a rolled-back / non-terminal
        // `Ok`, kept symmetric with the `KeySetupRollback` event the bridge must map
        // (§3.4) and mirroring the TUI reference. They are currently unreachable: the
        // stable core's `setup_key_for_host` returns `Err` on every rollback/failure path
        // and discards the `RolledBack` state (§12), so a rolled-back setup surfaces via
        // the `Err` arm as `KeySetupFailed` with the core's message. Distinguishing
        // rollback from failure would need the core to surface that outcome — out of scope
        // for this slice, not an edit we are authorised to make (§3.6).
        Ok(result) if result.state == KeySetupState::RolledBack => {
            let reason = result
                .error_message
                .unwrap_or_else(|| "Rolled back.".to_string());
            let _ = engine_tx
                .send(CoreEvent::KeySetupRollback(host.name.clone(), reason))
                .await;
        }
        Ok(result) => {
            let reason = result
                .error_message
                .unwrap_or_else(|| "Key setup failed.".to_string());
            let _ = engine_tx
                .send(CoreEvent::KeySetupFailed(host.name.clone(), reason))
                .await;
        }
        Err(e) => {
            let _ = engine_tx
                .send(CoreEvent::KeySetupFailed(
                    host.name.clone(),
                    format!("{e:#}"),
                ))
                .await;
        }
    }
}

/// Write the generated key onto the manual host in `hosts.toml`, mirroring the TUI's
/// completion write: set `identity_file` + `key_setup_date`, and — only when password
/// auth was actually disabled — mark `password_auth_disabled` and drop the stored
/// password (key auth supersedes it). Only manual hosts live in `hosts.toml`, so an
/// SSH-config name is a no-op. Best-effort: the completion event fires regardless, and
/// this is awaited so a following `reload_hosts` observes the write (no read/write race).
async fn persist_key(host_name: &str, key_path: &str, password_disabled: bool) {
    let name = host_name.to_string();
    let key_path = key_path.to_string();
    let _ = tauri::async_runtime::spawn_blocking(move || -> Option<()> {
        let mut hosts = load_hosts().ok()?;
        let host = hosts.iter_mut().find(|h| h.name == name)?;
        host.identity_file = Some(key_path);
        host.key_setup_date = Some(chrono::Utc::now().to_rfc3339());
        if password_disabled {
            host.password_auth_disabled = Some(true);
            host.password = None;
        }
        save_hosts(&hosts).ok()
    })
    .await;
}

/// Restore password authentication for `host_name`.
///
/// Connects to the host using existing authentication, modifies SSH configuration
/// to set `PasswordAuthentication yes` and `UsePAM yes` (compatible with both
/// sshd_config and sshd_config.d/*.conf), verifies syntax with `sshd -t`, and reloads sshd.
/// Keeps existing SSH keys and authorized_keys intact.
#[tauri::command]
#[specta::specta]
pub async fn restore_password_auth(
    state: State<'_, GuiState>,
    host_name: String,
) -> Result<(), CommandError> {
    let host = state.host_by_name(&host_name).ok_or_else(|| CommandError {
        message: format!("unknown host '{host_name}'"),
    })?;

    let session = SshSession::connect(&host).await.map_err(|e| CommandError {
        message: format!("Connection failed: {e}"),
    })?;

    let outcome =
        omnyssh_core::ssh::key_setup::restore_password_auth_for_host(&host, &session).await;
    session.disconnect().await;

    outcome.map_err(|e| CommandError {
        message: format!("{e:#}"),
    })?;

    persist_password_restored(&host.name).await;
    Ok(())
}

async fn persist_password_restored(host_name: &str) {
    let name = host_name.to_string();
    let _ = tauri::async_runtime::spawn_blocking(move || -> Option<()> {
        let mut hosts = load_hosts().ok()?;
        let host = hosts.iter_mut().find(|h| h.name == name)?;
        host.password_auth_disabled = Some(false);
        save_hosts(&hosts).ok()
    })
    .await;
}
