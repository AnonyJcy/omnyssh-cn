//! Application configuration modules.
//!
//! - [`app_config`]  — main `~/.config/omnyssh/config.toml`
//! - [`ssh_config`]  — parser for `~/.ssh/config`
//! - [`snippets`]    — `~/.config/omnyssh/snippets.toml`
//!
//! Top-level functions in this module handle loading and persisting the
//! host list (`hosts.toml`).

pub mod app_config;
pub mod snippets;
pub mod ssh_config;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::ssh::client::{Host, HostSource};
use crate::utils::platform;

// ---------------------------------------------------------------------------
// hosts.toml I/O
// ---------------------------------------------------------------------------

/// TOML container for the hosts list.
#[derive(Debug, Default, Serialize, Deserialize)]
struct HostsFile {
    #[serde(default)]
    hosts: Vec<Host>,
}

/// Loads manually-added hosts from `~/.config/omnyssh/hosts.toml`.
///
/// Returns an empty `Vec` if the file does not exist yet.
///
/// # Errors
/// Returns an error if the file exists but cannot be read or parsed.
pub fn load_hosts() -> anyhow::Result<Vec<Host>> {
    let path = platform::hosts_config_path().context("Cannot determine hosts config path")?;

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;

    let file: HostsFile =
        toml::from_str(&content).with_context(|| format!("Failed to parse {}", path.display()))?;

    Ok(file.hosts)
}

/// Persists the manually-added hosts (source == `Manual`) to
/// `~/.config/omnyssh/hosts.toml`.
///
/// SSH-config-derived hosts are intentionally **not** written — they are
/// re-imported from `~/.ssh/config` on every startup.
///
/// # Errors
/// Returns an error if the directory cannot be created or the file cannot
/// be written.
pub fn save_hosts(hosts: &[Host]) -> anyhow::Result<()> {
    let dir = platform::app_config_dir().context("Cannot determine app config directory")?;

    std::fs::create_dir_all(&dir)
        .with_context(|| format!("Failed to create directory {}", dir.display()))?;

    let path = dir.join("hosts.toml");

    let manual: Vec<Host> = hosts
        .iter()
        .filter(|h| h.source == HostSource::Manual)
        .cloned()
        .collect();

    let file = HostsFile { hosts: manual };
    let content = toml::to_string_pretty(&file).context("Failed to serialise hosts")?;

    // Write to a temp file and rename for atomic replacement (avoids a corrupt
    // hosts.toml if the process is interrupted mid-write).
    let tmp_path = path.with_extension("toml.tmp");
    std::fs::write(&tmp_path, content)
        .with_context(|| format!("Failed to write {}", tmp_path.display()))?;
    if let Err(e) = std::fs::rename(&tmp_path, &path) {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(e).with_context(|| {
            format!(
                "Failed to rename {} to {}",
                tmp_path.display(),
                path.display()
            )
        });
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&path, perms);
    }

    Ok(())
}

/// Loads all hosts: manually-added (`hosts.toml`) merged with hosts
/// imported from `~/.ssh/config`.
///
/// Manual entries take priority over SSH-config entries with the same name.
/// SSH-config entries are appended after all manual ones.
///
/// # Errors
/// Returns an error if `hosts.toml` exists but is unreadable/malformed.
/// A missing or unreadable `~/.ssh/config` is silently ignored.
pub fn load_all_hosts() -> anyhow::Result<Vec<Host>> {
    // 1. Manual hosts (from hosts.toml).
    let manual = load_hosts()?;

    // 2. Hosts from ~/.ssh/config.
    let mut ssh_hosts: Vec<Host> = Vec::new();
    if let Some(ssh_path) = platform::ssh_config_path() {
        if ssh_path.exists() {
            match ssh_config::load_from_file(&ssh_path) {
                Ok(h) => ssh_hosts = h,
                Err(e) => tracing::warn!("SSH config parse error: {}", e),
            }
        }
    }

    // 3. Merge: manual names take priority.
    Ok(merge_hosts(manual, ssh_hosts))
}

/// Merges manually-added hosts with hosts imported from `~/.ssh/config`.
///
/// Manual entries come first and take priority: an SSH-config host is dropped
/// when a manual host already uses its name, or when a manual host records it
/// as a renamed original (via `original_ssh_host`). Such a copy still takes
/// `IdentitiesOnly` from the entry it stands in for: neither editor has a field
/// for it, so a snapshot would be frozen for good.
pub(crate) fn merge_hosts(manual: Vec<Host>, ssh_hosts: Vec<Host>) -> Vec<Host> {
    let manual_names: std::collections::HashSet<String> =
        manual.iter().map(|h| h.name.clone()).collect();

    // Original SSH-config names of hosts that have since been renamed.
    let renamed_ssh_hosts: std::collections::HashSet<String> = manual
        .iter()
        .filter_map(|h| h.original_ssh_host.clone())
        .collect();

    let mut all = manual;
    for copy in &mut all {
        let source = copy.original_ssh_host.as_deref().unwrap_or(&copy.name);
        if let Some(import) = ssh_hosts.iter().find(|h| h.name == source) {
            copy.identities_only = import.identities_only;
        }
    }
    for h in ssh_hosts {
        if !manual_names.contains(&h.name) && !renamed_ssh_hosts.contains(&h.name) {
            all.push(h);
        }
    }
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(name: &str, source: HostSource) -> Host {
        Host {
            name: name.to_string(),
            source,
            ..Host::default()
        }
    }

    /// A manual host renamed from an SSH-config entry named `original`.
    fn renamed(name: &str, original: &str) -> Host {
        Host {
            name: name.to_string(),
            source: HostSource::Manual,
            original_ssh_host: Some(original.to_string()),
            ..Host::default()
        }
    }

    fn names(hosts: &[Host]) -> Vec<&str> {
        hosts.iter().map(|h| h.name.as_str()).collect()
    }

    // --- merge_hosts (P0.3) -----------------------------------------------

    #[test]
    fn merge_empty_both() {
        assert!(merge_hosts(vec![], vec![]).is_empty());
    }

    #[test]
    fn merge_manual_only() {
        let out = merge_hosts(vec![host("a", HostSource::Manual)], vec![]);
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn merge_ssh_only() {
        let out = merge_hosts(vec![], vec![host("a", HostSource::SshConfig)]);
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn merge_manual_listed_before_ssh() {
        let out = merge_hosts(
            vec![host("m", HostSource::Manual)],
            vec![host("s", HostSource::SshConfig)],
        );
        assert_eq!(names(&out), ["m", "s"]);
    }

    #[test]
    fn merge_name_collision_manual_wins() {
        let out = merge_hosts(
            vec![host("web", HostSource::Manual)],
            vec![host("web", HostSource::SshConfig)],
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].source, HostSource::Manual);
    }

    #[test]
    fn merge_renamed_ssh_host_excluded() {
        let out = merge_hosts(
            vec![renamed("new", "old")],
            vec![host("old", HostSource::SshConfig)],
        );
        assert_eq!(names(&out), ["new"]);
    }

    #[test]
    fn merge_renamed_and_collision_combined() {
        // Manual "a" was renamed from ssh "b"; ssh has both "a" and "b".
        let out = merge_hosts(
            vec![renamed("a", "b")],
            vec![
                host("a", HostSource::SshConfig),
                host("b", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a"]);
    }

    #[test]
    fn a_copy_follows_identities_only_in_the_ssh_config() {
        let mut only = host("app01", HostSource::SshConfig);
        only.identities_only = true;
        let mut pinned = renamed("renamed", "db");
        pinned.identities_only = true;
        let out = merge_hosts(
            vec![host("app01", HostSource::Manual), pinned],
            vec![only, host("db", HostSource::SshConfig)],
        );
        assert!(out[0].identities_only, "the line added to ~/.ssh/config");
        assert!(
            !out[1].identities_only,
            "the line removed from ~/.ssh/config"
        );
    }

    #[test]
    fn merge_multiple_ssh_distinct_names_kept() {
        let out = merge_hosts(
            vec![],
            vec![
                host("a", HostSource::SshConfig),
                host("b", HostSource::SshConfig),
                host("c", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a", "b", "c"]);
    }

    #[test]
    fn merge_rename_keeps_unrelated_ssh_host() {
        let out = merge_hosts(
            vec![renamed("a", "b")],
            vec![
                host("b", HostSource::SshConfig),
                host("c", HostSource::SshConfig),
            ],
        );
        assert_eq!(names(&out), ["a", "c"]);
    }

    // --- HostsFile serialization (P0.4) -----------------------------------

    #[test]
    fn hostsfile_roundtrip_preserves_fields() {
        let mut h = host("web", HostSource::Manual);
        h.hostname = "10.0.0.1".to_string();
        h.user = "deploy".to_string();
        h.port = 2222;
        h.tags = vec!["prod".to_string()];
        let toml_str = toml::to_string_pretty(&HostsFile { hosts: vec![h] }).unwrap();
        let parsed: HostsFile = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.hosts.len(), 1);
        let g = &parsed.hosts[0];
        assert_eq!(g.name, "web");
        assert_eq!(g.hostname, "10.0.0.1");
        assert_eq!(g.user, "deploy");
        assert_eq!(g.port, 2222);
        assert_eq!(g.tags, vec!["prod"]);
    }

    #[test]
    fn hostsfile_save_filter_keeps_only_manual() {
        // Replicates the `source == Manual` filter applied by save_hosts.
        let hosts = [
            host("m", HostSource::Manual),
            host("s", HostSource::SshConfig),
        ];
        let manual: Vec<Host> = hosts
            .iter()
            .filter(|h| h.source == HostSource::Manual)
            .cloned()
            .collect();
        assert_eq!(names(&manual), ["m"]);
    }

    #[test]
    fn hostsfile_empty_input_parses_to_empty() {
        let parsed: HostsFile = toml::from_str("").unwrap();
        assert!(parsed.hosts.is_empty());
    }

    #[test]
    fn hostsfile_omits_none_optional_fields() {
        let toml_str = toml::to_string_pretty(&HostsFile {
            hosts: vec![host("a", HostSource::Manual)],
        })
        .unwrap();
        assert!(!toml_str.contains("identity_file"));
        assert!(!toml_str.contains("password"));
    }

    #[test]
    fn hostsfile_password_survives_roundtrip() {
        // Confirms passwords are persisted in plaintext.
        let mut h = host("a", HostSource::Manual);
        h.password = Some("secret".to_string());
        let toml_str = toml::to_string_pretty(&HostsFile { hosts: vec![h] }).unwrap();
        let parsed: HostsFile = toml::from_str(&toml_str).unwrap();
        assert_eq!(parsed.hosts[0].password.as_deref(), Some("secret"));
    }
}
