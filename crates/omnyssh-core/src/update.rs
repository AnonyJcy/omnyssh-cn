//! In-app update checker.
//!
//! This is the fork's last release. It queries the GitHub Releases API of KoraSSH,
//! the project it continues as, and can only point there: what is newer is a
//! different app with its own binary, bundle identifier and config directory, so
//! there is nothing here that could replace this executable in place.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use flate2::read::GzDecoder;
use semver::Version;
use sha2::{Digest, Sha256};
use tar::Archive;

/// The repository this fork continues as. Its releases are KoraSSH's.
const REPO: &str = "AnonyJcy/korassh";
/// No path from this build to a KoraSSH one: the names, the identifier and the
/// config directory all differ, so the updater never replaces the executable.
const SELF_UPDATE_AVAILABLE: bool = false;
/// Timeout applied to every network request the updater makes.
const HTTP_TIMEOUT: Duration = Duration::from_secs(8);
/// Target triple this binary was built for (provided by `build.rs`).
const BUILD_TARGET: &str = env!("BUILD_TARGET");

// ---------------------------------------------------------------------------
// Install method
// ---------------------------------------------------------------------------

/// How the running binary was installed. Determines whether an in-app
/// self-update is possible.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallMethod {
    /// `install.sh` or a manually placed binary — eligible for self-update.
    Manual,
    Homebrew,
    Cargo,
    Nix,
}

impl InstallMethod {
    /// Detects the install method of the currently running executable.
    pub fn detect() -> Self {
        match std::env::current_exe() {
            Ok(path) => Self::from_path(&path),
            Err(_) => Self::Manual,
        }
    }

    /// Classifies an executable path by well-known install locations.
    fn from_path(path: &Path) -> Self {
        let p = path.to_string_lossy();
        if p.contains("/nix/store/") {
            Self::Nix
        } else if p.contains("/Cellar/") || p.contains("/homebrew/") {
            Self::Homebrew
        } else if p.contains("/.cargo/") {
            Self::Cargo
        } else {
            Self::Manual
        }
    }

    /// Command the user runs to upgrade through this install method.
    /// `None` means the app is able to perform the update itself — or, as here,
    /// that no command leads on from this build: KoraSSH is not published under
    /// this fork's package names.
    pub fn upgrade_command(self) -> Option<&'static str> {
        match self {
            Self::Manual | Self::Homebrew | Self::Cargo | Self::Nix => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Update info
// ---------------------------------------------------------------------------

/// A newer release discovered by [`check`].
#[derive(Debug, Clone)]
pub struct UpdateInfo {
    /// Version this binary reports (without a leading `v`).
    pub current: String,
    /// Latest released version (without a leading `v`).
    pub latest: String,
    /// Git tag of the latest release (e.g. `v1.0.2`).
    pub tag: String,
    /// How this binary was installed.
    pub method: InstallMethod,
    /// Whether the app can download and install this update itself.
    pub can_self_update: bool,
}

impl UpdateInfo {
    /// URL of the release page, shown when the app cannot self-update.
    pub fn release_url(&self) -> String {
        format!("https://github.com/{REPO}/releases/tag/{}", self.tag)
    }
}

// ---------------------------------------------------------------------------
// Version check
// ---------------------------------------------------------------------------

/// Queries GitHub for the latest release. Returns `Some` only when a strictly
/// newer version exists. Any network or parse error yields `None`, so a failed
/// check never disrupts startup.
pub async fn check() -> Option<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION");
    let tag = fetch_latest_tag().await.ok()?;
    let latest = tag.trim_start_matches('v').to_string();

    if !is_newer(&latest, current) {
        return None;
    }

    let method = InstallMethod::detect();
    Some(UpdateInfo {
        current: current.to_string(),
        latest,
        tag,
        method,
        can_self_update: SELF_UPDATE_AVAILABLE
            && method == InstallMethod::Manual
            && cfg!(any(target_os = "linux", target_os = "macos"))
            && binary_is_replaceable(),
    })
}

/// Returns `true` when `latest` is a strictly greater semver than `current`.
/// An unparseable version yields `false` — never nag on bad data.
fn is_newer(latest: &str, current: &str) -> bool {
    match (Version::parse(latest), Version::parse(current)) {
        (Ok(l), Ok(c)) => l > c,
        _ => false,
    }
}

/// Minimal subset of the GitHub release JSON payload.
#[derive(serde::Deserialize)]
struct GithubRelease {
    tag_name: String,
}

/// Fetches the `tag_name` of the latest (non-prerelease) GitHub release.
async fn fetch_latest_tag() -> Result<String> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let release: GithubRelease = http_client()?
        .get(&url)
        .send()
        .await
        .context("release request failed")?
        .error_for_status()
        .context("release request returned an error status")?
        .json()
        .await
        .context("failed to decode release JSON")?;
    Ok(release.tag_name)
}

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------

/// Downloads the release archive for [`BUILD_TARGET`], verifies its SHA-256
/// against the release `SHA256SUMS`, and replaces the running executable.
///
/// Only valid when [`UpdateInfo::can_self_update`] is `true`.
pub async fn perform_update(info: &UpdateInfo) -> Result<()> {
    if !SELF_UPDATE_AVAILABLE {
        anyhow::bail!(
            "this is the last release of this fork: it does not update itself. \
             KoraSSH is downloaded from {}",
            info.release_url()
        );
    }
    let archive_name = format!("omny-{BUILD_TARGET}.tar.gz");
    let base = format!("https://github.com/{REPO}/releases/download/{}", info.tag);
    let client = http_client()?;

    let archive = download_bytes(&client, &format!("{base}/{archive_name}"))
        .await
        .context("failed to download release archive")?;
    let sums = download_text(&client, &format!("{base}/SHA256SUMS"))
        .await
        .context("failed to download SHA256SUMS")?;

    verify_checksum(&archive, &sums, &archive_name)?;

    let binary = extract_binary(&archive).context("failed to extract binary from archive")?;
    install_binary(&binary).context("failed to replace the running executable")?;
    Ok(())
}

/// Builds the shared HTTP client. GitHub requires a `User-Agent` header.
fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("omnyssh/", env!("CARGO_PKG_VERSION")))
        .timeout(HTTP_TIMEOUT)
        .build()
        .context("failed to build HTTP client")
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let bytes = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    Ok(bytes.to_vec())
}

async fn download_text(client: &reqwest::Client, url: &str) -> Result<String> {
    let text = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(text)
}

/// Verifies `archive` bytes against the `SHA256SUMS` entry for `archive_name`.
fn verify_checksum(archive: &[u8], sums: &str, archive_name: &str) -> Result<()> {
    let expected = sums
        .lines()
        .find_map(|line| {
            let (hash, name) = line.split_once("  ")?;
            (name.trim() == archive_name).then(|| hash.trim().to_lowercase())
        })
        .with_context(|| format!("no checksum entry for {archive_name}"))?;

    let mut hasher = Sha256::new();
    hasher.update(archive);
    let actual = format!("{:x}", hasher.finalize());

    if actual != expected {
        anyhow::bail!("checksum mismatch: expected {expected}, got {actual}");
    }
    Ok(())
}

/// Extracts the `omny` binary from a gzip-compressed tar archive.
fn extract_binary(archive: &[u8]) -> Result<Vec<u8>> {
    let mut tar = Archive::new(GzDecoder::new(archive));
    for entry in tar.entries().context("invalid tar archive")? {
        let mut entry = entry.context("invalid tar entry")?;
        let is_binary = entry
            .path()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_os_string()))
            .is_some_and(|n| n == "omny");
        if is_binary {
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .context("failed to read binary")?;
            return Ok(buf);
        }
    }
    anyhow::bail!("archive does not contain the omny binary")
}

/// Writes `binary` to a temp file next to the current executable and
/// atomically swaps it in.
fn install_binary(binary: &[u8]) -> Result<()> {
    let exe = std::env::current_exe().context("cannot locate current executable")?;
    let dir = exe.parent().context("executable has no parent directory")?;
    let tmp = dir.join(format!(".omny-update-{}", std::process::id()));

    std::fs::write(&tmp, binary).with_context(|| format!("failed to write {}", tmp.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
            .context("failed to mark binary executable")?;
    }

    let result = self_replace::self_replace(&tmp).context("self-replace failed");
    let _ = std::fs::remove_file(&tmp);
    result
}

/// Checks whether the running executable's directory is writable by creating
/// and removing a probe file. `self_replace` writes the replacement there
/// before swapping it in, so a writable directory is required.
fn binary_is_replaceable() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(dir) = exe.parent() else {
        return false;
    };
    let probe = dir.join(format!(".omny-update-probe-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn detects_install_method_from_path() {
        let cases = [
            ("/home/u/.cargo/bin/omny", InstallMethod::Cargo),
            (
                "/opt/homebrew/Cellar/omnyssh/1.0.1/bin/omny",
                InstallMethod::Homebrew,
            ),
            ("/usr/local/homebrew/bin/omny", InstallMethod::Homebrew),
            ("/nix/store/abc-omnyssh-1.0.1/bin/omny", InstallMethod::Nix),
            ("/usr/local/bin/omny", InstallMethod::Manual),
            ("/home/u/bin/omny", InstallMethod::Manual),
        ];
        for (path, expected) in cases {
            assert_eq!(
                InstallMethod::from_path(&PathBuf::from(path)),
                expected,
                "{path}"
            );
        }
    }

    #[test]
    fn no_install_method_has_an_upgrade_command() {
        // Nothing replaces this fork in place: KoraSSH is not published under its names.
        for method in [
            InstallMethod::Manual,
            InstallMethod::Homebrew,
            InstallMethod::Cargo,
            InstallMethod::Nix,
        ] {
            assert!(method.upgrade_command().is_none());
        }
    }

    #[test]
    fn release_urls_lead_to_korassh() {
        let info = UpdateInfo {
            current: "1.1.11".into(),
            latest: "2.0.0".into(),
            tag: "v2.0.0".into(),
            method: InstallMethod::Manual,
            can_self_update: false,
        };
        assert_eq!(
            info.release_url(),
            "https://github.com/AnonyJcy/korassh/releases/tag/v2.0.0"
        );
    }

    /// The whole point of this build: KoraSSH's first release is newer than it, so the
    /// check does point users there. Bumping this fork to 2.0.0 or beyond would silence it.
    #[test]
    fn korasshs_first_release_is_newer_than_this_build() {
        assert!(is_newer("2.0.0", env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn is_newer_compares_semver() {
        assert!(is_newer("1.0.2", "1.0.1"));
        assert!(is_newer("1.1.0", "1.0.9"));
        assert!(is_newer("2.0.0", "1.9.9"));
        assert!(!is_newer("1.0.1", "1.0.1"));
        assert!(!is_newer("1.0.0", "1.0.1"));
        // Unparseable versions never trigger an update prompt.
        assert!(!is_newer("not-a-version", "1.0.1"));
        assert!(!is_newer("1.0.2", "garbage"));
    }

    /// Builds a gzip-compressed tar archive containing the given files.
    fn make_targz(files: &[(&str, &[u8])]) -> Vec<u8> {
        use flate2::write::GzEncoder;
        use flate2::Compression;

        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        for (name, data) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, name, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn extracts_omny_binary_from_archive() {
        let archive = make_targz(&[("omny", b"fake-binary-bytes")]);
        let binary = extract_binary(&archive).expect("extract");
        assert_eq!(binary, b"fake-binary-bytes");
    }

    #[test]
    fn extract_fails_when_binary_absent() {
        let archive = make_targz(&[("readme.txt", b"hello")]);
        assert!(extract_binary(&archive).is_err());
    }

    #[test]
    fn checksum_verification() {
        let archive = b"release archive contents";
        let mut hasher = Sha256::new();
        hasher.update(archive);
        let digest = format!("{:x}", hasher.finalize());

        let sums = format!("{digest}  omny-x86_64-apple-darwin.tar.gz\nffff  omny-other.tar.gz\n");
        assert!(verify_checksum(archive, &sums, "omny-x86_64-apple-darwin.tar.gz").is_ok());

        // Wrong contents fail.
        assert!(verify_checksum(b"tampered", &sums, "omny-x86_64-apple-darwin.tar.gz").is_err());
        // Missing entry fails.
        assert!(verify_checksum(archive, &sums, "omny-missing.tar.gz").is_err());
    }
}
