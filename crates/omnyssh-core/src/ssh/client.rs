//! SSH connection management.
//!
//! Connections delegated to the system SSH binary.
//! Also provides russh-based client for live metrics.

use serde::{Deserialize, Deserializer, Serialize};

use crate::ssh::tunnel::LocalForward;

/// Indicates where a host entry originated.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum HostSource {
    /// Imported from `~/.ssh/config` at startup.
    SshConfig,
    /// Added manually through the TUI form.
    #[default]
    Manual,
}

/// How a host is watched on the dashboard.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MonitorMode {
    /// A live SSH session with shell metrics — the default.
    #[default]
    Ssh,
    /// A plain TCP connect, with no login. For devices that answer SSH but have
    /// no POSIX shell to collect metrics from, such as network appliances.
    // The wire and the TUI form spell this differently; accept both, because a
    // rejected value fails the whole file and takes every manual host with it.
    #[serde(alias = "tcp", alias = "tcpPort")]
    TcpPort,
}

impl MonitorMode {
    /// Lets the default stay out of `hosts.toml` entirely.
    fn is_ssh(&self) -> bool {
        matches!(self, Self::Ssh)
    }
}

/// A single host entry used for SSH connections.
///
/// Populated either from `~/.ssh/config` (via the parser) or from
/// `~/.config/omnyssh/hosts.toml` (manual entries added through the TUI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    /// Display name / alias (e.g. `"web-prod-1"`).
    pub name: String,
    /// Hostname or IP address to connect to.
    pub hostname: String,
    /// SSH user. Defaults to `"root"` when not specified.
    #[serde(default = "default_user")]
    pub user: String,
    /// SSH port. Defaults to `22` when not specified.
    #[serde(default = "default_port")]
    pub port: u16,
    /// Path to the private key file (e.g. `~/.ssh/id_ed25519`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
    /// Offer only the identity file's key (the default keys without one), even
    /// from the agent: `IdentitiesOnly yes`. An agent holding many keys would
    /// otherwise use up the server's `MaxAuthTries` first.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub identities_only: bool,
    /// Password for password-based authentication (not recommended, used for initial setup).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// ProxyJump host alias (for bastion / jump-host setups).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_jump: Option<String>,
    /// Organisational tags (e.g. `["production", "web"]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Free-text notes about this host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// Where this entry came from.
    #[serde(default)]
    pub source: HostSource,
    /// Original host name from `~/.ssh/config` if this host was renamed.
    /// Used to prevent duplicate entries when a SSH-config host is renamed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_ssh_host: Option<String>,
    /// How this host is watched.
    #[serde(default, skip_serializing_if = "MonitorMode::is_ssh")]
    pub monitoring: MonitorMode,
    /// Port for the reachability probe. Falls back to `port` when unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_port: Option<u16>,
    /// Local port forwards (`ssh -L`) carried by this host's tunnel.
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "readable_forwards"
    )]
    pub local_forwards: Vec<LocalForward>,
    /// Start the tunnel when OmnySSH starts.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub tunnel_autostart: bool,
    /// Lend the local SSH agent to this host's terminals (`ssh -A`). Anyone with
    /// root on the host can use it while a terminal is open, so it is opt-in.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub forward_agent: bool,

    // -----------------------------------------------------------------------
    // Auto SSH Key Setup metadata
    // -----------------------------------------------------------------------
    /// Date when SSH key was configured by OmnySSH (ISO 8601 format).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_setup_date: Option<String>,
    /// Whether password authentication has been disabled on the server.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_auth_disabled: Option<bool>,
}

/// Reads the forwards one by one, dropping an unreadable rule with a warning:
/// failing it would fail the whole file, and every manual host with it.
fn readable_forwards<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<LocalForward>, D::Error> {
    Ok(Vec::<String>::deserialize(d)?
        .into_iter()
        .filter_map(|spec| {
            spec.parse()
                .map_err(|e| tracing::warn!(error = %e, "port forward skipped"))
                .ok()
        })
        .collect())
}

fn default_user() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .unwrap_or_else(|_| String::from("root"))
}

fn default_port() -> u16 {
    22
}

impl Default for Host {
    fn default() -> Self {
        Self {
            name: String::new(),
            hostname: String::new(),
            user: default_user(),
            port: default_port(),
            identity_file: None,
            identities_only: false,
            password: None,
            proxy_jump: None,
            tags: Vec::new(),
            notes: None,
            source: HostSource::default(),
            original_ssh_host: None,
            monitoring: MonitorMode::default(),
            monitor_port: None,
            local_forwards: Vec::new(),
            tunnel_autostart: false,
            forward_agent: false,
            key_setup_date: None,
            password_auth_disabled: None,
        }
    }
}

/// Runtime connection status for a host. Never serialised to disk.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum ConnectionStatus {
    /// No connection attempt has been made yet.
    #[default]
    Unknown,
    /// A connection attempt is currently in progress.
    Connecting,
    /// The host is connected.
    Connected,
    /// The last connection attempt failed with the given message.
    Failed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An existing `hosts.toml` predates the monitoring fields, and writing one
    /// back must not add them — the file has to stay byte-identical for a host
    /// nobody changed.
    #[test]
    fn the_monitoring_default_round_trips_without_touching_the_file() {
        let host: Host = toml::from_str("name = \"web\"\nhostname = \"10.0.0.1\"\n")
            .expect("a host without the monitoring fields still parses");
        assert_eq!(host.monitoring, MonitorMode::Ssh);
        assert_eq!(host.monitor_port, None);

        let written = toml::to_string(&host).expect("serialize");
        assert!(!written.contains("monitoring"), "{written}");
        assert!(!written.contains("monitor_port"), "{written}");
    }

    /// The wire and the TUI form spell the mode differently, so a hand-edited
    /// file is likely to carry either — and a rejected value fails the whole
    /// file, taking every manual host with it.
    #[test]
    fn the_other_spellings_of_the_mode_are_accepted() {
        for spelling in ["tcp_port", "tcp", "tcpPort"] {
            let host: Host = toml::from_str(&format!(
                "name = \"fw\"\nhostname = \"10.0.0.9\"\nmonitoring = \"{spelling}\"\n"
            ))
            .unwrap_or_else(|e| panic!("'{spelling}' should parse: {e}"));
            assert_eq!(host.monitoring, MonitorMode::TcpPort);
        }
    }

    /// A hand-edited typo costs only the rule it is in, not the file.
    #[test]
    fn an_unreadable_forward_is_skipped_not_fatal() {
        let host: Host = toml::from_str(
            "name = \"nas\"\nhostname = \"10.0.0.5\"\n\
             local_forwards = [\"9443:localhost:9443\", \"94430:localhost\"]\n",
        )
        .expect("a bad rule must not fail the host");
        let specs: Vec<String> = host
            .local_forwards
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(specs, ["9443:localhost:9443"]);
    }

    #[test]
    fn a_reachability_host_persists_its_mode_and_probe_port() {
        let host = Host {
            name: String::from("fw"),
            hostname: String::from("10.0.0.9"),
            monitoring: MonitorMode::TcpPort,
            monitor_port: Some(8443),
            ..Host::default()
        };

        let written = toml::to_string(&host).expect("serialize");
        let read: Host = toml::from_str(&written).expect("deserialize");

        assert_eq!(read.monitoring, MonitorMode::TcpPort);
        assert_eq!(read.monitor_port, Some(8443));
    }
}
