//! Auto SSH key-setup command (tech-gui.md §4.2). `start_key_setup` mirrors the TUI's
//! orchestration (crates/omnyssh `ConfirmKeySetup`): connect a password session, drive
//! `setup_key_for_host_detailed`, and report progress + the terminal outcome as
//! `CoreEvent::KeySetup*` on the shared engine channel — the bridge maps those to
//! `key-setup-*` IPC events (§3.4). Once the key works it writes it back onto the
//! manual host in `hosts.toml`, the same completion write the TUI performs, so a
//! `reload_hosts` afterwards refreshes `hasKey`/`passwordAuthDisabled` on the card. A
//! failure that may have left password login off saves the tested key alone.

use std::path::Path;

use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

use omnyssh_core::config::{load_hosts, save_hosts};
use omnyssh_core::event::CoreEvent;
use omnyssh_core::ssh::client::Host;
use omnyssh_core::ssh::key_setup::{
    setup_key_for_host_detailed, KeySetupResult, KeySetupState, KeySetupStep, KeyType,
};
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
/// password, run `setup_key_for_host_detailed`, then map the final state to exactly one
/// terminal event (`KeySetupComplete` / `KeySetupPartial` / `KeySetupRollback` /
/// `KeySetupFailed` / `KeySetupFailedUnsafe`).
async fn run_key_setup(app: AppHandle, host: Host, engine_tx: mpsc::Sender<CoreEvent>) {
    // Frees the slot on any return path, including an unwind (see `KeySetupSlot`).
    let _slot = KeySetupSlot(app);

    // Drain the core's per-step channel onto the shared engine channel, tagging each
    // step with the host name (the core's `Sender<KeySetupStep>` carries no host).
    let (progress_tx, mut progress_rx) = mpsc::channel::<KeySetupStep>(8);
    let step_tx = engine_tx.clone();
    let step_host = host.name.clone();
    let drainer = tokio::spawn(async move {
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

    let result =
        setup_key_for_host_detailed(&host, &session, KeyType::Ed25519, Some(progress_tx)).await;
    session.disconnect().await;
    // The core dropped its sender; wait out the queued steps so none lands after
    // the outcome.
    let _ = drainer.await;

    // Persist BEFORE emitting so the frontend's reload sees it.
    if let Some(write) = key_write(&result) {
        persist_key(&host.name, &result.key_path, write).await;
    }
    let _ = engine_tx.send(outcome_event(host.name, result)).await;
}

/// What a finished run writes onto the manual host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyWrite {
    /// The key works: identity, setup date and the password-login state.
    Setup { password_disabled: bool },
    /// A failed run that may have turned password login off: only the tested key, so
    /// the next connect can still get in. Password and setup state stay as they were.
    IdentityOnly,
}

fn key_write(result: &KeySetupResult) -> Option<KeyWrite> {
    match result.state {
        KeySetupState::Success => Some(KeyWrite::Setup {
            password_disabled: true,
        }),
        KeySetupState::PartialSuccess => Some(KeyWrite::Setup {
            password_disabled: false,
        }),
        KeySetupState::RolledBack => None,
        // The core only reports may-be-off after the key passed its verify step.
        _ if result.password_may_be_off && !result.key_path.as_os_str().is_empty() => {
            Some(KeyWrite::IdentityOnly)
        }
        _ => None,
    }
}

/// The one terminal event for a finished run.
fn outcome_event(host_name: String, result: KeySetupResult) -> CoreEvent {
    let error = result
        .error_message
        .unwrap_or_else(|| "Key setup failed.".to_string());
    match result.state {
        KeySetupState::Success => CoreEvent::KeySetupComplete(host_name, result.key_path),
        KeySetupState::PartialSuccess => CoreEvent::KeySetupPartial(host_name, result.key_path),
        KeySetupState::RolledBack => CoreEvent::KeySetupRollback(host_name, error),
        _ if result.password_may_be_off => CoreEvent::KeySetupFailedUnsafe(host_name, error),
        _ => CoreEvent::KeySetupFailed(host_name, error),
    }
}

/// Write the generated key onto the manual host in `hosts.toml`. `Setup` mirrors the
/// TUI's completion write: set `identity_file` + `key_setup_date` and record whether
/// password auth was disabled; only when it was, drop the stored password (key auth
/// supersedes it, and the server would refuse it anyway). `IdentityOnly` sets just
/// `identity_file`. Only manual hosts live in `hosts.toml`, so an SSH-config name is a
/// no-op. Best-effort: the outcome event fires regardless, and this is awaited so a
/// following `reload_hosts` observes the write (no read/write race).
async fn persist_key(host_name: &str, key_path: &Path, write: KeyWrite) {
    let name = host_name.to_string();
    let key_path = key_path.to_string_lossy().to_string();
    let _ = tauri::async_runtime::spawn_blocking(move || -> Option<()> {
        let mut hosts = load_hosts().ok()?;
        let host = hosts.iter_mut().find(|h| h.name == name)?;
        host.identity_file = Some(key_path);
        if let KeyWrite::Setup { password_disabled } = write {
            host.key_setup_date = Some(chrono::Utc::now().to_rfc3339());
            host.password_auth_disabled = Some(password_disabled);
            if password_disabled {
                host.password = None;
            }
        }
        save_hosts(&hosts).ok()
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn result(state: KeySetupState, password_may_be_off: bool) -> KeySetupResult {
        KeySetupResult {
            key_path: PathBuf::from("/k/omnyssh_web_ed25519"),
            state,
            error_message: Some("boom".to_string()),
            password_may_be_off,
        }
    }

    #[test]
    fn each_outcome_maps_to_its_terminal_event() {
        let ev = |state, off| outcome_event("web".to_string(), result(state, off));
        assert!(matches!(
            ev(KeySetupState::Success, false),
            CoreEvent::KeySetupComplete(h, p) if h == "web" && p.ends_with("omnyssh_web_ed25519")
        ));
        assert!(matches!(
            ev(KeySetupState::PartialSuccess, false),
            CoreEvent::KeySetupPartial(h, _) if h == "web"
        ));
        assert!(matches!(
            ev(KeySetupState::RolledBack, false),
            CoreEvent::KeySetupRollback(_, r) if r == "boom"
        ));
        assert!(matches!(
            ev(KeySetupState::FailedSafe, false),
            CoreEvent::KeySetupFailed(_, e) if e == "boom"
        ));
        // A failed rollback, or a disable step that never answered.
        assert!(matches!(
            ev(KeySetupState::NeedsRollback, true),
            CoreEvent::KeySetupFailedUnsafe(_, e) if e == "boom"
        ));
        assert!(matches!(
            ev(KeySetupState::FailedSafe, true),
            CoreEvent::KeySetupFailedUnsafe(..)
        ));
    }

    #[test]
    fn each_outcome_writes_what_it_proved() {
        let write = |state, off| key_write(&result(state, off));
        assert_eq!(
            write(KeySetupState::Success, false),
            Some(KeyWrite::Setup {
                password_disabled: true
            })
        );
        assert_eq!(
            write(KeySetupState::PartialSuccess, false),
            Some(KeyWrite::Setup {
                password_disabled: false
            })
        );
        // May be off: save the tested key so "Open terminal" can use it, nothing else.
        assert_eq!(
            write(KeySetupState::NeedsRollback, true),
            Some(KeyWrite::IdentityOnly)
        );
        assert_eq!(
            write(KeySetupState::FailedSafe, true),
            Some(KeyWrite::IdentityOnly)
        );
        assert_eq!(write(KeySetupState::FailedSafe, false), None);
        assert_eq!(write(KeySetupState::RolledBack, false), None);

        // No key made: nothing to save.
        let mut keyless = result(KeySetupState::FailedSafe, true);
        keyless.key_path = PathBuf::new();
        assert_eq!(key_write(&keyless), None);
    }
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
