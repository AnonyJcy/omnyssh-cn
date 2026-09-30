//! Host key verification against `known_hosts`, as ssh(1) does it.
//!
//! Keys live in `~/.ssh/known_hosts` on every platform, shared with OpenSSH.
//! Up to 1.1.3 the Windows build kept them in `%USERPROFILE%\ssh\known_hosts`
//! (no dot, russh-keys' own choice there); keys pinned in that file are still
//! honoured, but it is never written again.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use russh::keys::known_hosts::{known_host_keys_path, learn_known_hosts_path};
use russh::keys::{Algorithm, EcdsaCurve, HashAlg, PublicKey};

/// What `known_hosts` says about the key a server offered.
pub(crate) enum Verdict {
    /// A saved key matches.
    Known,
    /// No key of this type is saved for the host.
    Unknown,
    /// A saved key of the same type differs.
    Changed(PathBuf),
    /// The file could not be read or parsed, or there is no home to find it in.
    Unreadable(PathBuf, russh::keys::Error),
}

/// `~/.ssh/known_hosts`, the file new keys are saved to.
pub(crate) fn path() -> Option<PathBuf> {
    home().map(|home| home.join(".ssh").join("known_hosts"))
}

// `USERPROFILE` first on Windows, as russh-keys resolves its own file.
fn home() -> Option<PathBuf> {
    std::env::home_dir()
}

#[cfg(windows)]
fn legacy_path() -> Option<PathBuf> {
    home().map(|home| home.join("ssh").join("known_hosts"))
}

#[cfg(not(windows))]
fn legacy_path() -> Option<PathBuf> {
    None
}

/// The files to consult, in order.
fn files() -> Vec<PathBuf> {
    path().into_iter().chain(legacy_path()).collect()
}

/// Checks `key`, offered by `host:port`, against the saved keys.
pub(crate) fn check(host: &str, port: u16, key: &PublicKey) -> Verdict {
    check_in(&files(), host, port, key)
}

/// The first file holding a key of the offered type decides. Any matching line
/// is enough, as in ssh(1): a stale line next to the right one refuses nothing.
/// A file that cannot be opened counts as empty, as in ssh(1).
fn check_in(files: &[PathBuf], host: &str, port: u16, key: &PublicKey) -> Verdict {
    // No home: nothing to check against, and nowhere a key could be pinned.
    if files.is_empty() {
        return Verdict::Unreadable(
            PathBuf::from("~/.ssh/known_hosts"),
            russh::keys::Error::NoHomeDir,
        );
    }
    for file in files {
        let saved = match saved_keys(file, host, port) {
            Ok(saved) => saved,
            Err(e) => return Verdict::Unreadable(file.clone(), e),
        };
        if saved.iter().any(|k| k.key_data() == key.key_data()) {
            return Verdict::Known;
        }
        if saved.iter().any(|k| same_type(k, key)) {
            return Verdict::Changed(file.clone());
        }
    }
    Verdict::Unknown
}

/// The keys `file` holds for `host:port`. ssh(1) writes names in lower case and
/// matches them regardless of case, so a mixed-case name is looked up both ways.
fn saved_keys(file: &Path, host: &str, port: u16) -> Result<Vec<PublicKey>, russh::keys::Error> {
    let lower = host.to_ascii_lowercase();
    let mut names = vec![host];
    if lower != host {
        names.push(&lower);
    }
    let mut keys = Vec::new();
    for name in names {
        keys.extend(
            known_host_keys_path(name, port, file)?
                .into_iter()
                .map(|(_, key)| key),
        );
    }
    Ok(keys)
}

/// Saves a key first seen on this connection (trust on first use).
pub(crate) fn learn(host: &str, port: u16, key: &PublicKey) -> Result<(), russh::keys::Error> {
    let path = path().ok_or(russh::keys::Error::NoHomeDir)?;
    learn_known_hosts_path(host, port, key, path)
}

/// The host key algorithms asked for when nothing is pinned: russh 0.46's list,
/// which OmnySSH shipped with, then P-384, last so that no server that worked
/// shows another key; some devices have no other (Cisco RoomOS set to ECDSA).
/// Never `ssh-rsa` (SHA-1).
const KEY_ORDER: &[Algorithm] = &[
    Algorithm::Ed25519,
    Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP256,
    },
    Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP521,
    },
    Algorithm::Rsa {
        hash: Some(HashAlg::Sha256),
    },
    Algorithm::Rsa {
        hash: Some(HashAlg::Sha512),
    },
    Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP384,
    },
];

/// Host key algorithms for `host:port`, those of the keys saved for it first,
/// as ssh(1) orders them: a server with several keys then shows the pinned one
/// rather than one of another type that would be taken as new.
pub(crate) fn preferred(host: &str, port: u16) -> Cow<'static, [Algorithm]> {
    preferred_in(&files(), host, port)
}

fn preferred_in(files: &[PathBuf], host: &str, port: u16) -> Cow<'static, [Algorithm]> {
    let Some(saved) = files
        .iter()
        .filter_map(|file| saved_keys(file, host, port).ok())
        .find(|saved| !saved.is_empty())
    else {
        return Cow::Borrowed(KEY_ORDER);
    };
    let (mut order, rest): (Vec<Algorithm>, Vec<Algorithm>) = KEY_ORDER
        .iter()
        .cloned()
        .partition(|algo| saved.iter().any(|k| signs_with(k, algo)));
    order.extend(rest);
    Cow::Owned(order)
}

/// Types compare by key: an RSA key is one type whatever hash it signs with.
fn same_type(a: &PublicKey, b: &PublicKey) -> bool {
    a.algorithm() == b.algorithm()
}

fn signs_with(key: &PublicKey, algo: &Algorithm) -> bool {
    match algo {
        Algorithm::Rsa { .. } => key.algorithm().is_rsa(),
        _ => key.algorithm() == *algo,
    }
}

/// The host as a refusal names it.
fn who(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("{host} port {port}")
    }
}

/// Shown when a saved key no longer matches. The first ':' closes the headline,
/// so a frontend that cuts there (the TUI status bar) keeps just that.
pub(crate) fn changed_message(host: &str, port: u16, file: &Path, fingerprint: &str) -> String {
    // `ssh-keygen -R` wants `[host]:port` off port 22; quoted, or zsh takes it
    // for a glob.
    let target = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    format!(
        "Host key of {who} has changed: it does not match the key saved in {file}. \
         If the server was reinstalled, check on the server that its key is {fingerprint}, \
         then remove the old one with ssh-keygen -R \"{target}\" -f \"{file}\". \
         Otherwise someone may be intercepting the connection.",
        who = who(host, port),
        file = file.display(),
    )
}

/// Shown when a `known_hosts` file cannot be used: the connection is refused
/// rather than let an unchecked key in.
pub(crate) fn unreadable_message(
    host: &str,
    port: u16,
    file: &Path,
    error: &russh::keys::Error,
) -> String {
    format!(
        "Host key of {} could not be checked: {} is unreadable ({error})",
        who(host, port),
        file.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::ssh_key::private::RsaKeypair;
    use russh::keys::PrivateKey;
    use std::io::Write;

    fn ed25519() -> PublicKey {
        let mut rng = russh::keys::key::safe_rng();
        PrivateKey::random(&mut rng, Algorithm::Ed25519)
            .expect("ed25519 key")
            .public_key()
            .clone()
    }

    fn write(file: &Path, lines: &[String]) {
        let mut f = std::fs::File::create(file).expect("create");
        for line in lines {
            writeln!(f, "{line}").expect("write");
        }
    }

    fn line(host: &str, key: &PublicKey) -> String {
        format!("{host} {}", key.to_openssh().expect("openssh line"))
    }

    #[test]
    fn a_saved_key_is_known_and_a_different_one_changed() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        let (server, other) = (ed25519(), ed25519());
        write(&file, &[line("10.0.0.5", &server)]);
        let files = [file.clone()];

        assert!(matches!(
            check_in(&files, "10.0.0.5", 22, &server),
            Verdict::Known
        ));
        match check_in(&files, "10.0.0.5", 22, &other) {
            Verdict::Changed(path) => assert_eq!(path, file),
            _ => panic!("expected a changed key"),
        }
        assert!(matches!(
            check_in(&files, "10.0.0.6", 22, &other),
            Verdict::Unknown
        ));
    }

    #[test]
    fn a_stale_line_next_to_the_right_one_is_no_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        let (old, new) = (ed25519(), ed25519());
        write(&file, &[line("vm", &old), line("vm", &new)]);
        assert!(matches!(check_in(&[file], "vm", 22, &new), Verdict::Known));
    }

    #[test]
    fn the_first_file_with_the_offered_type_decides() {
        let dir = tempfile::tempdir().unwrap();
        let (primary, legacy) = (dir.path().join("a"), dir.path().join("b"));
        let (server, stale) = (ed25519(), ed25519());
        let files = [primary.clone(), legacy.clone()];

        // The legacy pin still refuses a key nobody saved elsewhere...
        write(&legacy, &[line("vm", &stale)]);
        match check_in(&files, "vm", 22, &server) {
            Verdict::Changed(path) => assert_eq!(path, legacy),
            _ => panic!("expected the legacy pin to refuse"),
        }
        // ...until the key is saved in the primary file, which is read first.
        write(&primary, &[line("vm", &server)]);
        assert!(matches!(
            check_in(&files, "vm", 22, &server),
            Verdict::Known
        ));
        // A stale primary pin is never overruled by the legacy file.
        write(&primary, &[line("vm", &stale)]);
        write(&legacy, &[line("vm", &server)]);
        match check_in(&files, "vm", 22, &server) {
            Verdict::Changed(path) => assert_eq!(path, primary),
            _ => panic!("expected the primary pin to refuse"),
        }
    }

    #[test]
    fn no_home_refuses_rather_than_trust_anything() {
        assert!(matches!(
            check_in(&[], "vm", 22, &ed25519()),
            Verdict::Unreadable(..)
        ));
    }

    #[test]
    fn a_mixed_case_name_finds_the_pin_ssh_wrote_in_lower_case() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        let (server, other) = (ed25519(), ed25519());
        write(&file, &[line("build.corp.lan", &server)]);
        let files = [file.clone()];
        assert!(matches!(
            check_in(&files, "Build.Corp.lan", 22, &server),
            Verdict::Known
        ));
        assert!(matches!(
            check_in(&files, "Build.Corp.lan", 22, &other),
            Verdict::Changed(_)
        ));
    }

    #[test]
    fn saved_types_are_preferred() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        write(&file, &[]);
        let files = [file.clone()];
        assert_eq!(preferred_in(&files, "vm", 22), KEY_ORDER);

        // ssh(1) before 8.5 pinned ECDSA, which then has to come before Ed25519.
        let ecdsa = russh::keys::parse_public_key_base64(
            "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBAdX7uLfmKNNWdDCmvSEIf+RcVQX7pM+\
             X+JsRGPG88ZBnYMJCOypWfiNliHIPyo8fNivzpE4a6ZynYc8KHiEz+4=",
        )
        .expect("ecdsa key");
        write(&file, &[line("vm", &ecdsa)]);
        let order = preferred_in(&files, "vm", 22);
        let p256 = Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP256,
        };
        assert_eq!(order.first(), Some(&p256));
        assert_eq!(order.len(), KEY_ORDER.len());
    }

    #[test]
    fn a_p384_pin_is_asked_for() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        let p384 = russh::keys::parse_public_key_base64(
            "AAAAE2VjZHNhLXNoYTItbmlzdHAzODQAAAAIbmlzdHAzODQAAABhBPsWebQPfTKmztyvWSqgE1HXWtAJwl6Y\
             YUx43JswHMefMvUBiOAnCS20o697vnbFr6WtNWGsTt48NyDfBtwezmZ4wyhOqDnd7kJL8MUsWd3S7E4xe5RBd\
             U39kfoUDZ2WOQ==",
        )
        .expect("p384 key");
        write(&file, &[line("vm", &p384)]);
        let order = preferred_in(&[file], "vm", 22);
        let p384 = Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP384,
        };
        assert_eq!(order.first(), Some(&p384));
        assert_eq!(order.len(), KEY_ORDER.len());
    }

    #[test]
    fn nothing_pinned_asks_for_p384_last_and_no_sha1() {
        let p384 = Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP384,
        };
        assert_eq!(KEY_ORDER.last(), Some(&p384));
        assert!(!KEY_ORDER.contains(&Algorithm::Rsa { hash: None }));
    }

    #[test]
    fn an_rsa_pin_holds_whatever_hash_was_negotiated() {
        let rsa = || {
            let mut rng = russh::keys::key::safe_rng();
            let pair = RsaKeypair::random(&mut rng, 2048).expect("rsa key");
            PrivateKey::from(pair).public_key().clone()
        };
        let pinned = rsa();
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("known_hosts");
        write(&file, &[line("vm", &pinned)]);
        let files = [file.clone()];
        assert!(matches!(
            check_in(&files, "vm", 22, &pinned),
            Verdict::Known
        ));
        // Another RSA key is a changed one, not a new type to trust.
        match check_in(&files, "vm", 22, &rsa()) {
            Verdict::Changed(path) => assert_eq!(path, file),
            _ => panic!("an RSA key under another hash name slipped past the pin"),
        }
    }

    #[test]
    fn the_refusal_names_the_file_and_the_remedy() {
        let file = Path::new("/home/me/.ssh/known_hosts");
        let message = changed_message("10.0.0.5", 2222, file, "SHA256:abc");
        // The TUI status bar keeps what comes before the first ':'.
        assert_eq!(
            message.split(':').next(),
            Some("Host key of 10.0.0.5 port 2222 has changed")
        );
        assert!(message.contains("SHA256:abc"));
        assert!(
            message.contains("ssh-keygen -R \"[10.0.0.5]:2222\" -f \"/home/me/.ssh/known_hosts\"")
        );
    }

    /// The old file, where russh-keys pinned keys on Windows, is still read.
    #[cfg(windows)]
    #[test]
    fn the_legacy_file_is_still_read() {
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("USERPROFILE", home.path());
        let key = ed25519();
        let legacy = legacy_path().expect("legacy path");
        assert_eq!(legacy, home.path().join("ssh").join("known_hosts"));
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        write(&legacy, &[line("vm", &key)]);
        assert_eq!(path(), Some(home.path().join(".ssh").join("known_hosts")));
        assert!(matches!(check("vm", 22, &key), Verdict::Known));
    }
}
