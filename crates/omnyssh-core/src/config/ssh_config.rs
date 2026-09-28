//! Parser for `~/.ssh/config`.
//!
//! Supported directives: `Host`, `HostName`, `User`, `Port`,
//! `IdentityFile`, `IdentitiesOnly`, `ProxyJump`, `LocalForward`, `ForwardAgent`,
//! `Include`.
//! Wildcard `Host` and `Match` blocks are skipped, except that a `ForwardAgent no`
//! there, or in the global section, keeps the agent from every host after it.
//!
//! The original file is **never modified**.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::ssh::client::{Host, HostSource};
use crate::ssh::tunnel::LocalForward;

/// Parses the text of an SSH config file and returns all non-wildcard hosts.
///
/// `Host *` entries are silently skipped.
/// `Include` recursion is limited to 3 levels to prevent cycles; relative
/// patterns resolve against `~/.ssh`, as `ssh_config(5)` specifies for a user
/// configuration.
pub fn parse_ssh_config(content: &str) -> Vec<Host> {
    let mut visited: HashSet<PathBuf> = HashSet::new();
    parse_content(
        content,
        default_include_base().as_deref(),
        0,
        &mut visited,
        &mut false,
    )
}

/// Loads and parses an SSH config file from disk.
///
/// # Errors
/// Returns an error if the file cannot be read.
pub fn load_from_file(path: &Path) -> anyhow::Result<Vec<Host>> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("Failed to read {}: {}", path.display(), e))?;
    let base = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map_or_else(default_include_base, |p| Some(p.to_path_buf()));
    let mut visited: HashSet<PathBuf> = HashSet::new();
    Ok(parse_content(
        &content,
        base.as_deref(),
        0,
        &mut visited,
        &mut false,
    ))
}

/// `~/.ssh` — where `ssh_config(5)` resolves a relative `Include` in a user
/// configuration. Never the process working directory.
fn default_include_base() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh"))
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// `agent_barred` is set by a `ForwardAgent no` in a place this parser does not
/// read hosts from — the global section, a wildcard `Host`, a `Match` — which ssh(1)
/// may take first for any host after it. Shared with the files an `Include` pulls in,
/// which ssh(1) reads in place.
fn parse_content(
    content: &str,
    base: Option<&Path>,
    depth: usize,
    visited: &mut HashSet<PathBuf>,
    agent_barred: &mut bool,
) -> Vec<Host> {
    if depth > 3 {
        return Vec::new();
    }

    let mut hosts: Vec<Host> = Vec::new();
    let mut current: Option<Host> = None;
    // Hosts pulled in by an Include that sat inside a Host block. Appended once
    // the enclosing host is flushed, so the list keeps the config's own order.
    let mut deferred: Vec<Host> = Vec::new();
    // True when we are inside a wildcard `Host *` block (skip directives).
    let mut in_wildcard = false;
    // ForwardAgent is first-wins, as in ssh(1): a later `yes` in the same block
    // must not turn on what an earlier `no` kept off.
    let mut agent_seen = false;
    // So is IdentitiesOnly.
    let mut identities_seen = false;

    for raw_line in content.lines() {
        let line = strip_comment(raw_line).trim().to_string();
        if line.is_empty() {
            continue;
        }

        let Some((keyword, value)) = split_kv(&line) else {
            continue;
        };

        match keyword.to_lowercase().as_str() {
            "host" => {
                // Flush previous host before starting a new block.
                if let Some(h) = current.take() {
                    hosts.push(h);
                }
                hosts.append(&mut deferred);
                agent_seen = false;
                identities_seen = false;
                in_wildcard = value.contains('*') || value.contains('?');
                if !in_wildcard {
                    let h = Host {
                        name: value.to_string(),
                        source: HostSource::SshConfig,
                        ..Host::default()
                    };
                    current = Some(h);
                } else {
                    current = None;
                }
            }
            "hostname" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    h.hostname = value.to_string();
                }
            }
            "user" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    h.user = value.to_string();
                }
            }
            "port" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    if let Ok(p) = value.parse::<u16>() {
                        h.port = p;
                    }
                }
            }
            "identityfile" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    h.identity_file = Some(expand_tilde(value));
                }
            }
            "identitiesonly" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    if !identities_seen {
                        identities_seen = true;
                        match value.to_ascii_lowercase().as_str() {
                            "yes" | "true" => h.identities_only = true,
                            "no" | "false" => {}
                            _ => tracing::warn!(host = %h.name, value, "IdentitiesOnly skipped"),
                        }
                    }
                }
            }
            "proxyjump" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    h.proxy_jump = Some(value.to_string());
                }
            }
            "localforward" if !in_wildcard => {
                if let Some(ref mut h) = current {
                    match parse_local_forward(value) {
                        Ok(forward) => h.local_forwards.push(forward),
                        Err(e) => {
                            tracing::warn!(host = %h.name, error = %e, "LocalForward skipped")
                        }
                    }
                }
            }
            // Lending the agent is never read from outside a host's own block, but a
            // `no` there still counts: which host it covers is not worked out here,
            // so it covers every host after it. A socket path or `$VAR` names another
            // agent, and lending the default one instead is not what was asked.
            "forwardagent" => {
                let answer = value.to_ascii_lowercase();
                let off = matches!(answer.as_str(), "no" | "false");
                match current {
                    Some(ref mut h) if !agent_seen => {
                        agent_seen = true;
                        match answer.as_str() {
                            "yes" | "true" => h.forward_agent = !*agent_barred,
                            "no" | "false" => h.forward_agent = false,
                            _ => tracing::warn!(host = %h.name, value, "ForwardAgent skipped"),
                        }
                    }
                    None if off => *agent_barred = true,
                    _ => {}
                }
            }
            // A Match block's directives apply by condition, not to the host
            // above it; skip them like a wildcard block — a `LocalForward` there
            // must not open a port for a host that never asked for it.
            "match" => {
                if let Some(h) = current.take() {
                    hosts.push(h);
                }
                hosts.append(&mut deferred);
                in_wildcard = true;
            }
            // An Include may sit inside a Host block; the enclosing host keeps
            // collecting directives after it.
            "include" => {
                let sink = if current.is_some() {
                    &mut deferred
                } else {
                    &mut hosts
                };
                for pattern in split_include_patterns(value) {
                    let Some(resolved) = resolve_include(&pattern, base) else {
                        tracing::warn!(pattern, "relative Include with no home directory");
                        continue;
                    };
                    let matched = expand_include_glob(&resolved);
                    if matched.is_empty() {
                        tracing::warn!(pattern = resolved, "Include matched no files");
                    }
                    for path in matched {
                        // Canonicalise to catch cycles (symlinks, etc.).
                        let canonical = path.canonicalize().unwrap_or_else(|e| {
                            tracing::warn!(
                                path = %path.display(),
                                error = %e,
                                "canonicalize failed; symlink-cycle detection disabled for this path"
                            );
                            path.clone()
                        });
                        if !visited.insert(canonical) {
                            continue; // already visited — break cycle
                        }
                        match std::fs::read_to_string(&path) {
                            Ok(sub) => sink.extend(parse_content(
                                &sub,
                                base,
                                depth + 1,
                                visited,
                                agent_barred,
                            )),
                            Err(e) => {
                                tracing::warn!(path = %path.display(), error = %e, "Include file unreadable")
                            }
                        }
                    }
                }
            }
            _ => {} // Unknown directive — silently ignore.
        }
    }

    // Flush the last pending host, then anything its Include pulled in.
    if let Some(h) = current.take() {
        hosts.push(h);
    }
    hosts.append(&mut deferred);

    // Fallback: if HostName was never set, use the alias as the address.
    for h in &mut hosts {
        if h.hostname.is_empty() {
            h.hostname = h.name.clone();
        }
    }

    hosts
}

/// Parses a `LocalForward` value: `[bind_address:]port host:hostport`, the two
/// arguments `ssh_config(5)` takes, joined into the `ssh -L` notation.
fn parse_local_forward(value: &str) -> Result<LocalForward, String> {
    match value.split_whitespace().collect::<Vec<_>>().as_slice() {
        [listen, target] => format!("{listen}:{target}").parse(),
        _ => Err(format!(
            "expected '[bind_address:]port host:hostport', got '{value}'"
        )),
    }
}

/// Removes everything from the first `#` onwards (inline comments).
fn strip_comment(line: &str) -> &str {
    match line.find('#') {
        Some(pos) => &line[..pos],
        None => line,
    }
}

/// Splits `"Keyword Value"` or `"Keyword=Value"` into `("Keyword", "Value")`.
fn split_kv(line: &str) -> Option<(&str, &str)> {
    // Split on the first whitespace or '='.
    let idx = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let keyword = line[..idx].trim();
    let value = line[idx + 1..].trim_start_matches('=').trim();
    if keyword.is_empty() || value.is_empty() {
        None
    } else {
        Some((keyword, value))
    }
}

/// Expands a leading `~/` to the user's home directory.
fn expand_tilde(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    if s == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.to_string_lossy().into_owned();
        }
    }
    s.to_string()
}

/// Splits an `Include` value into its pathnames.
///
/// `ssh_config(5)` allows several pathnames on one line, and a path containing
/// spaces may be double-quoted.
fn split_include_patterns(value: &str) -> Vec<String> {
    let mut patterns = Vec::new();
    let mut current = String::new();
    let mut quoted = false;

    for c in value.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    patterns.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        patterns.push(current);
    }
    patterns
}

/// Anchors an `Include` pattern: absolute and `~/` patterns stand alone, a
/// relative one resolves against `base` — never the process working directory.
///
/// `None` when the pattern is relative and there is no base to anchor it to;
/// dropping the include is the only honest option, since resolving it would
/// silently read the process working directory.
fn resolve_include(pattern: &str, base: Option<&Path>) -> Option<String> {
    let expanded = expand_tilde(pattern);
    if Path::new(&expanded).is_absolute() {
        return Some(expanded);
    }
    // The base is a real path, not a pattern: escape it so a home directory
    // containing `[` or `*` cannot swallow the include.
    let base = glob::Pattern::escape(base?.to_str()?);
    Some(format!("{}/{}", base.trim_end_matches('/'), expanded))
}

/// Resolves an Include pattern to the files it matches, in a stable order.
///
/// Full glob(7) syntax, as `ssh_config(5)` specifies. Directories that match
/// are skipped.
fn expand_include_glob(pattern: &str) -> Vec<PathBuf> {
    match glob::glob(pattern) {
        // `glob` yields matches in sorted order, so the host list is stable.
        Ok(paths) => paths.flatten().filter(|p| p.is_file()).collect(),
        Err(e) => {
            tracing::warn!(pattern, error = %e, "invalid Include pattern");
            Vec::new()
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_input() {
        assert!(parse_ssh_config("").is_empty());
        assert!(parse_ssh_config("   \n  \n").is_empty());
    }

    #[test]
    fn test_comments_only() {
        let cfg = "# This is a comment\n# Another comment\n";
        assert!(parse_ssh_config(cfg).is_empty());
    }

    #[test]
    fn test_minimal_config() {
        let cfg = "\
Host myserver
    HostName 192.168.1.100
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "myserver");
        assert_eq!(hosts[0].hostname, "192.168.1.100");
        // default_user() falls back to $USER / $LOGNAME / "root"
        let expected_user = std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .unwrap_or_else(|_| String::from("root"));
        assert_eq!(hosts[0].user, expected_user);
        assert_eq!(hosts[0].port, 22); // default
    }

    #[test]
    fn test_hostname_fallback_to_name() {
        // If HostName is omitted, hostname should equal the alias.
        let cfg = "\
Host myalias
    User admin
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname, "myalias");
    }

    #[test]
    fn test_full_config_all_fields() {
        let cfg = "\
Host web-prod-1
    HostName 192.168.1.10
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_ed25519
    ProxyJump bastion
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        let h = &hosts[0];
        assert_eq!(h.name, "web-prod-1");
        assert_eq!(h.hostname, "192.168.1.10");
        assert_eq!(h.user, "deploy");
        assert_eq!(h.port, 2222);
        assert!(h
            .identity_file
            .as_deref()
            .unwrap_or("")
            .contains("id_ed25519"));
        assert_eq!(h.proxy_jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn test_multiple_hosts() {
        let cfg = "\
Host web
    HostName 10.0.0.1
    User ubuntu

Host db
    HostName 10.0.0.2
    User postgres
    Port 5432
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].name, "web");
        assert_eq!(hosts[1].name, "db");
        assert_eq!(hosts[1].port, 5432);
    }

    #[test]
    fn test_wildcard_host_ignored() {
        let cfg = "\
Host *
    User ubuntu
    ServerAliveInterval 60

Host realhost
    HostName 10.0.0.1
";
        let hosts = parse_ssh_config(cfg);
        // Only the non-wildcard host should be imported.
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "realhost");
        // The wildcard User should NOT leak into realhost.
        // (We don't apply wildcard defaults — per plan, just skip them.)
    }

    #[test]
    fn test_proxy_jump() {
        let cfg = "\
Host bastion
    HostName jump.example.com
    User ops

Host internal
    HostName 192.168.100.50
    User admin
    ProxyJump bastion
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 2);
        let internal = hosts.iter().find(|h| h.name == "internal").unwrap();
        assert_eq!(internal.proxy_jump.as_deref(), Some("bastion"));
    }

    #[test]
    fn test_nonstandard_port() {
        let cfg = "Host custom\n    HostName 1.2.3.4\n    Port 22022\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts[0].port, 22022);
    }

    #[test]
    fn test_case_insensitive_keywords() {
        // OpenSSH config is case-insensitive for keywords.
        let cfg = "\
host server1
    hostname 10.0.0.1
    user admin
    port 2222
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname, "10.0.0.1");
        assert_eq!(hosts[0].user, "admin");
        assert_eq!(hosts[0].port, 2222);
    }

    #[test]
    fn test_inline_comment() {
        let cfg = "Host srv # this is a comment\n    HostName 1.2.3.4\n";
        let hosts = parse_ssh_config(cfg);
        // "srv # this is a comment" — name should be trimmed
        // Note: our strip_comment removes '#' and after, so name = "srv"
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].name, "srv");
    }

    #[test]
    fn test_source_is_ssh_config() {
        let cfg = "Host test\n    HostName 1.2.3.4\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts[0].source, crate::ssh::client::HostSource::SshConfig);
    }

    #[test]
    fn test_local_forwards() {
        let cfg = "\
Host nas
    HostName 10.0.0.5
    LocalForward 9443 127.0.0.1:9443
    LocalForward localhost:5432 db.internal:5432
    LocalForward [::1]:8080 [fe80::1]:80
";
        let hosts = parse_ssh_config(cfg);
        let specs: Vec<String> = hosts[0]
            .local_forwards
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(
            specs,
            [
                "9443:127.0.0.1:9443",
                "localhost:5432:db.internal:5432",
                "[::1]:8080:[fe80::1]:80",
            ]
        );
    }

    #[test]
    fn test_unusable_local_forward_skipped() {
        // A Unix-socket forward, a missing target and a bad port are dropped
        // one by one; the host and its good forward survive.
        let cfg = "\
Host nas
    LocalForward /tmp/local.sock /run/remote.sock
    LocalForward 9443
    LocalForward 99999 localhost:80
    LocalForward 3000 localhost:3000
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].local_forwards.len(), 1);
        assert_eq!(
            hosts[0].local_forwards[0].to_string(),
            "3000:localhost:3000"
        );
    }

    #[test]
    fn test_match_block_not_attached_to_previous_host() {
        let cfg = "\
Host web
    HostName 10.0.0.1

Match host db*
    User postgres
    LocalForward 0.0.0.0:3306 db:3306

Host api
    HostName 10.0.0.2
";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 2);
        assert!(hosts[0].local_forwards.is_empty());
        assert_ne!(hosts[0].user, "postgres");
        assert_eq!(hosts[1].name, "api");
        assert_eq!(hosts[1].hostname, "10.0.0.2");
    }

    #[test]
    fn test_wildcard_local_forward_ignored() {
        let cfg = "\
Host *
    LocalForward 8080 localhost:80

Host web
    HostName 10.0.0.1
";
        let hosts = parse_ssh_config(cfg);
        assert!(hosts[0].local_forwards.is_empty());
    }

    #[test]
    fn test_forward_agent() {
        let cfg = "\
Host bastion
    ForwardAgent yes
Host lab
    ForwardAgent True
Host web
    ForwardAgent no
Host plain
    HostName 10.0.0.1
";
        let hosts = parse_ssh_config(cfg);
        let forwarding: Vec<bool> = hosts.iter().map(|h| h.forward_agent).collect();
        assert_eq!(forwarding, [true, true, false, false]);
    }

    #[test]
    fn test_forward_agent_first_value_wins() {
        let cfg = "\
Host web
    ForwardAgent no
    ForwardAgent yes
Host db
    ForwardAgent yes
";
        let hosts = parse_ssh_config(cfg);
        assert!(
            !hosts[0].forward_agent,
            "a later yes overrode an earlier no"
        );
        assert!(hosts[1].forward_agent, "the next block starts afresh");
    }

    #[test]
    fn test_identities_only_first_value_wins() {
        let cfg = "\
Host app01
    IdentityFile ~/.ssh/app01-admin.pub
    IdentitiesOnly yes
    IdentitiesOnly no
Host db
    IdentitiesOnly no
    IdentitiesOnly yes
Host *
    IdentitiesOnly yes
Host web
    HostName 10.0.0.1
";
        let hosts = parse_ssh_config(cfg);
        let only: Vec<bool> = hosts.iter().map(|h| h.identities_only).collect();
        assert_eq!(only, [true, false, false]);
    }

    #[test]
    fn test_forward_agent_to_another_socket_skipped() {
        // A path or `$VAR` names a different agent; lending the default one
        // instead would hand out keys the config never meant to.
        let cfg = "\
Host a
    ForwardAgent /run/user/1000/other.sock
Host b
    ForwardAgent $OTHER_SOCK
";
        let hosts = parse_ssh_config(cfg);
        assert!(hosts.iter().all(|h| !h.forward_agent));
    }

    #[test]
    fn test_wildcard_forward_agent_ignored() {
        let cfg = "\
Host *
    ForwardAgent yes

Host web
    HostName 10.0.0.1
";
        let hosts = parse_ssh_config(cfg);
        assert!(!hosts[0].forward_agent);
    }

    #[test]
    fn test_an_earlier_general_no_keeps_the_agent_home() {
        // ssh(1) takes the first value that applies, so a `no` in the global
        // section, a wildcard block or a Match block ahead of a host wins over
        // the host's own `yes`.
        for general in [
            "ForwardAgent no\n",
            "Host *\n    ForwardAgent no\n",
            "Host *.internal\n    ForwardAgent no\n",
            "Match all\n    ForwardAgent no\n",
        ] {
            let cfg = format!("{general}Host web\n    ForwardAgent yes\n");
            let hosts = parse_ssh_config(&cfg);
            assert!(!hosts[0].forward_agent, "{general:?} did not win");
        }
    }

    #[test]
    fn test_a_later_general_no_leaves_an_earlier_yes() {
        let cfg = "\
Host web
    ForwardAgent yes

Host *
    ForwardAgent no
";
        let hosts = parse_ssh_config(cfg);
        assert!(hosts[0].forward_agent);
    }

    #[test]
    fn test_equals_separator() {
        // Some configs use '=' instead of space.
        let cfg = "Host=myhost\n    HostName=10.0.0.1\n    User=admin\n";
        let hosts = parse_ssh_config(cfg);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].hostname, "10.0.0.1");
        assert_eq!(hosts[0].user, "admin");
    }
}
