use tauri::{AppHandle, State};
use tauri_specta::Event;

use omnyssh_core::config::{load_hosts, save_hosts};
use omnyssh_core::ssh::client::{Host, HostSource};

use crate::dto::{check_forwards, HostDto, HostInputDto};
use crate::error::CommandError;
use crate::events;
use crate::state::GuiState;

/// Return the cached host list (populated at startup / on reload, tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub fn list_hosts(state: State<'_, GuiState>) -> Result<Vec<HostDto>, CommandError> {
    Ok(state.host_dtos())
}

/// Trigger an immediate metric poll of every host (tech-gui.md §4.2). Used by the
/// settings-driven refresh cadence (§4.3); a no-op before the pollers start.
#[tauri::command]
#[specta::specta]
pub fn refresh_metrics(state: State<'_, GuiState>) -> Result<(), CommandError> {
    state.refresh_metrics();
    Ok(())
}

/// Reload hosts from the shared config, refresh the cache, restart the pollers,
/// bring running tunnels in line with the edit, and broadcast the new list via
/// `hosts-loaded` followed by every live tunnel's status (tech-gui.md §4.2). Also
/// the startup entry point: the frontend calls it once its event bridge is up,
/// which is when tunnels autostart.
#[tauri::command]
#[specta::specta]
pub async fn reload_hosts(app: AppHandle, state: State<'_, GuiState>) -> Result<(), CommandError> {
    // Kick the one-shot startup update check first: the frontend calls `reload_hosts` only
    // after its event bridge is listening (so `update-available` isn't dropped, §3.4), and
    // doing it before the fallible load means a malformed config can't also suppress the
    // update banner for the session.
    if state.claim_update_check() {
        tauri::async_runtime::spawn(crate::commands::update::startup_update_check(
            state.engine_sender(),
        ));
    }
    // Parsing hosts.toml + ~/.ssh/config is blocking I/O — keep it off the async
    // worker so in-flight commands and the event bridge don't stall.
    let hosts = tauri::async_runtime::spawn_blocking(omnyssh_core::config::load_all_hosts)
        .await
        .map_err(|e| CommandError {
            message: format!("host load task failed: {e}"),
        })?
        .map_err(|e| CommandError {
            message: e.to_string(),
        })?;
    state.set_hosts(hosts);
    state.restart_pollers();
    state.sync_tunnels();
    state.autostart_tunnels();
    let _ = events::HostsLoaded(state.host_dtos()).emit(&app);
    state.replay_tunnel_statuses(|host_name, status| {
        let _ = events::TunnelStatusChanged {
            host_name: host_name.to_string(),
            status: status.clone(),
        }
        .emit(&app);
    });
    Ok(())
}

/// Add or edit a host and persist to `hosts.toml` (tech-gui.md §4.2, Stage 4.1).
/// Upserts by name. Editing an SSH-config import adopts it: the saved copy is a manual
/// entry that `merge_hosts` then prefers over the parsed one, so `~/.ssh/config` itself
/// is still never written. The frontend calls `reload_hosts` afterwards to refresh the
/// merged cache + restart the pollers. Secrets stay backend-side (§3.4): the payload's
/// password/identity never left the backend.
#[tauri::command]
#[specta::specta]
pub async fn save_host(
    input: HostInputDto,
    state: State<'_, GuiState>,
) -> Result<(), CommandError> {
    check_forwards(&input.local_forwards).map_err(|message| CommandError { message })?;
    // The parsed import is the only record of its bastion and key path, and neither
    // crosses the boundary (§3.4), so read them off the cache before the write moves
    // to a blocking task.
    let imported = state
        .host_by_name(&input.name)
        .filter(|h| h.source == HostSource::SshConfig);
    persist(move |hosts| upsert(hosts, input, imported)).await
}

/// Delete a manual host by name and persist (tech-gui.md §4.2, Stage 4.1). Only manual
/// entries live in `hosts.toml`, so an SSH-config name — or a missing one — is a no-op
/// success: the desired end state (absent) already holds.
#[tauri::command]
#[specta::specta]
pub async fn delete_host(name: String) -> Result<(), CommandError> {
    persist(move |hosts| remove(hosts, &name)).await
}

/// Upsert `input` into the manual host list by name. A new name appends; an existing
/// name is an in-place edit that **preserves every field the edit form cannot observe**
/// — password, identity file, and proxy jump (the outbound `HostDto` omits all three,
/// §3.4, so the form leaves them blank on edit), plus key-setup metadata, the
/// SSH-config rename origin, `IdentitiesOnly`, and a monitoring mode the payload
/// left out. Editing e.g. notes therefore never drops a stored secret or a recorded
/// key setup. A provided secret still overwrites the old one.
fn upsert(hosts: &mut Vec<Host>, input: HostInputDto, imported: Option<Host>) {
    // An omitted monitoring mode means "unchanged", not "back to SSH" — losing it
    // would silently start logging in to a device chosen for reachability only.
    let monitoring_given = input.monitoring.is_some();
    let mut host = Host::from(input);
    match hosts.iter().position(|h| h.name == host.name) {
        Some(i) => {
            let existing = &hosts[i];
            if !monitoring_given {
                host.monitoring = existing.monitoring;
                host.monitor_port = existing.monitor_port;
            }
            host.password = host.password.or_else(|| existing.password.clone());
            host.identity_file = host
                .identity_file
                .or_else(|| existing.identity_file.clone());
            host.proxy_jump = host.proxy_jump.or_else(|| existing.proxy_jump.clone());
            host.identities_only = existing.identities_only;
            host.key_setup_date = existing.key_setup_date.clone();
            host.password_auth_disabled = existing.password_auth_disabled;
            host.original_ssh_host = existing.original_ssh_host.clone();
            hosts[i] = host;
        }
        None => {
            // A brand-new host, or the first save of an SSH-config import — only the
            // import has anything to salvage. The form never saw its `ProxyJump` or
            // identity file, and a copy without the bastion would dial the target
            // address direct, which is exactly the hazard fixed in 1.1.1.
            if let Some(imported) = imported {
                host.proxy_jump = host.proxy_jump.or(imported.proxy_jump);
                host.identity_file = host.identity_file.or(imported.identity_file);
                host.identities_only = imported.identities_only;
                // Which `~/.ssh/config` entry this copy stands in for. Inert while the
                // names match — `merge_hosts` already drops the import on the name — but
                // it is what keeps the import hidden once the copy is renamed in the TUI,
                // and what another host's `ProxyJump` alias resolves through. The TUI
                // records the same thing when it adopts (app/host.rs).
                host.original_ssh_host = Some(host.name.clone());
            }
            hosts.push(host);
        }
    }
}

/// Drop the host named `name` from the manual list. A missing name is a no-op — the
/// desired end state (absent) already holds (tech-gui.md §4.2).
fn remove(hosts: &mut Vec<Host>, name: &str) {
    hosts.retain(|h| h.name != name);
}

/// Load the manual host list, apply `mutate`, and write it back off the async worker
/// (parsing + atomic write are blocking I/O). `save_hosts` re-filters to manual, so
/// SSH-config imports are never persisted (tech-gui.md §4.2).
async fn persist(mutate: impl FnOnce(&mut Vec<Host>) + Send + 'static) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut hosts = load_hosts()?;
        mutate(&mut hosts);
        save_hosts(&hosts)
    })
    .await
    .map_err(|e| CommandError {
        message: format!("host save task failed: {e}"),
    })?
    .map_err(|e| CommandError {
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::MonitorModeDto;
    use omnyssh_core::ssh::client::{HostSource, MonitorMode};

    fn input(name: &str) -> HostInputDto {
        HostInputDto {
            name: name.to_string(),
            hostname: "example.com".to_string(),
            user: "root".to_string(),
            port: 22,
            identity_file: None,
            password: None,
            proxy_jump: None,
            tags: vec![],
            notes: None,
            monitoring: None,
            monitor_port: None,
            local_forwards: vec![],
            tunnel_autostart: false,
            forward_agent: false,
        }
    }

    #[test]
    fn upsert_appends_a_new_manual_host() {
        let mut hosts = vec![];
        upsert(&mut hosts, input("web"), None);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "web");
        assert_eq!(hosts[0].source, HostSource::Manual);
    }

    #[test]
    fn upsert_replaces_editable_fields_in_place() {
        let mut hosts = vec![Host {
            name: "web".to_string(),
            hostname: "old.example.com".to_string(),
            notes: Some("old".to_string()),
            source: HostSource::Manual,
            ..Host::default()
        }];
        let mut edit = input("web");
        edit.hostname = "new.example.com".to_string();
        edit.notes = Some("new".to_string());
        upsert(&mut hosts, edit, None);
        assert_eq!(hosts.len(), 1, "edit is in-place, not an append");
        assert_eq!(hosts[0].hostname, "new.example.com");
        assert_eq!(hosts[0].notes.as_deref(), Some("new"));
    }

    #[test]
    fn upsert_preserves_secrets_and_metadata_the_form_cannot_see() {
        // The edit form is seeded from `HostDto`, which omits password/identity/proxy
        // (§3.4); a blank submission must not wipe them, nor the key-setup metadata.
        let mut hosts = vec![Host {
            name: "web".to_string(),
            password: Some("keep-me".to_string()),
            identity_file: Some("/keys/id".to_string()),
            proxy_jump: Some("bastion".to_string()),
            identities_only: true,
            key_setup_date: Some("2026-01-01".to_string()),
            password_auth_disabled: Some(true),
            original_ssh_host: Some("web-old".to_string()),
            source: HostSource::Manual,
            ..Host::default()
        }];
        upsert(&mut hosts, input("web"), None);
        let h = &hosts[0];
        assert!(h.identities_only);
        assert_eq!(h.password.as_deref(), Some("keep-me"));
        assert_eq!(h.identity_file.as_deref(), Some("/keys/id"));
        assert_eq!(h.proxy_jump.as_deref(), Some("bastion"));
        assert_eq!(h.key_setup_date.as_deref(), Some("2026-01-01"));
        assert_eq!(h.password_auth_disabled, Some(true));
        assert_eq!(h.original_ssh_host.as_deref(), Some("web-old"));
    }

    #[test]
    fn adopting_an_ssh_config_host_keeps_its_bastion_and_key() {
        // Editing an import writes a manual copy. `HostDto` carries neither `proxyJump`
        // nor the identity path (§3.4), so the form submits both blank — dropping them
        // would leave the copy dialling the target address direct.
        let imported = Host {
            name: "internal".to_string(),
            hostname: "10.0.0.9".to_string(),
            proxy_jump: Some("public-proxy".to_string()),
            identity_file: Some("/keys/id_ed25519".to_string()),
            identities_only: true,
            source: HostSource::SshConfig,
            ..Host::default()
        };
        let mut hosts = vec![];
        let mut edit = input("internal");
        edit.notes = Some("adopted".to_string());
        upsert(&mut hosts, edit, Some(imported));

        assert_eq!(hosts.len(), 1);
        let h = &hosts[0];
        assert!(
            h.identities_only,
            "the copy would offer every agent key again"
        );
        assert_eq!(
            h.source,
            HostSource::Manual,
            "the copy is what hosts.toml holds"
        );
        assert_eq!(h.proxy_jump.as_deref(), Some("public-proxy"));
        assert_eq!(h.identity_file.as_deref(), Some("/keys/id_ed25519"));
        assert_eq!(h.notes.as_deref(), Some("adopted"));
        assert_eq!(
            h.original_ssh_host.as_deref(),
            Some("internal"),
            "the copy records which import it shadows, so a later rename still hides it"
        );
    }

    #[test]
    fn an_explicit_identity_wins_over_the_imported_one() {
        let imported = Host {
            name: "internal".to_string(),
            identity_file: Some("/keys/from-ssh-config".to_string()),
            source: HostSource::SshConfig,
            ..Host::default()
        };
        let mut hosts = vec![];
        let mut edit = input("internal");
        edit.identity_file = Some("/keys/typed-by-hand".to_string());
        upsert(&mut hosts, edit, Some(imported));
        assert_eq!(
            hosts[0].identity_file.as_deref(),
            Some("/keys/typed-by-hand")
        );
    }

    #[test]
    fn upsert_keeps_a_monitoring_mode_the_payload_left_out() {
        let mut hosts = vec![Host {
            name: "fw".to_string(),
            monitoring: MonitorMode::TcpPort,
            monitor_port: Some(8443),
            source: HostSource::Manual,
            ..Host::default()
        }];

        upsert(&mut hosts, input("fw"), None);

        // Silently reverting to SSH would start logging in to a device the user
        // deliberately put on a reachability probe.
        assert_eq!(hosts[0].monitoring, MonitorMode::TcpPort);
        assert_eq!(hosts[0].monitor_port, Some(8443));
    }

    #[test]
    fn upsert_applies_a_monitoring_mode_the_payload_carries() {
        let mut hosts = vec![Host {
            name: "fw".to_string(),
            monitoring: MonitorMode::TcpPort,
            monitor_port: Some(8443),
            source: HostSource::Manual,
            ..Host::default()
        }];

        let mut back_to_ssh = input("fw");
        back_to_ssh.monitoring = Some(MonitorModeDto::Ssh);
        upsert(&mut hosts, back_to_ssh, None);

        assert_eq!(hosts[0].monitoring, MonitorMode::Ssh);
    }

    #[test]
    fn upsert_overwrites_a_secret_when_a_new_one_is_provided() {
        let mut hosts = vec![Host {
            name: "web".to_string(),
            password: Some("old".to_string()),
            source: HostSource::Manual,
            ..Host::default()
        }];
        let mut edit = input("web");
        edit.password = Some("rotated".to_string());
        upsert(&mut hosts, edit, None);
        assert_eq!(hosts[0].password.as_deref(), Some("rotated"));
    }

    #[test]
    fn remove_drops_only_the_named_host() {
        let mut hosts = vec![
            Host {
                name: "a".to_string(),
                ..Host::default()
            },
            Host {
                name: "b".to_string(),
                ..Host::default()
            },
        ];
        remove(&mut hosts, "a");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "b");
    }

    #[test]
    fn remove_is_a_no_op_for_a_missing_name() {
        // An SSH-config name (absent from hosts.toml) or an already-gone one changes
        // nothing — the desired end state already holds (tech-gui.md §4.2).
        let mut hosts = vec![Host {
            name: "a".to_string(),
            ..Host::default()
        }];
        remove(&mut hosts, "ghost");
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "a");
    }

    #[test]
    fn upsert_takes_forwards_and_autostart_from_the_form() {
        // Both are on the form, so an edit replaces them outright — clearing the list
        // must clear it, not fall back to the stored rules.
        let mut hosts = vec![Host {
            name: "nas".to_string(),
            local_forwards: vec!["9443:localhost:9443".parse().expect("rule")],
            tunnel_autostart: true,
            ..Host::default()
        }];
        upsert(&mut hosts, input("nas"), None);
        assert!(hosts[0].local_forwards.is_empty());
        assert!(!hosts[0].tunnel_autostart);
    }

    #[test]
    fn upsert_takes_agent_forwarding_from_the_form() {
        // On the form, so switching it off must switch it off.
        let mut hosts = vec![Host {
            name: "lab".to_string(),
            forward_agent: true,
            ..Host::default()
        }];
        upsert(&mut hosts, input("lab"), None);
        assert!(!hosts[0].forward_agent);

        let mut on = input("lab");
        on.forward_agent = true;
        upsert(&mut hosts, on, None);
        assert!(hosts[0].forward_agent);
    }
}
