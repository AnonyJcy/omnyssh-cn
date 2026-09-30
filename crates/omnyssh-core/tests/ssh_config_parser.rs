//! Integration tests for `Include` handling in the SSH config parser.
//!
//! The parsing rules themselves are covered by the unit tests next to the
//! implementation. These need a real directory tree on disk, so they live here.

use std::fs;
use std::path::Path;

use omnyssh_core::config::ssh_config::load_from_file;

/// The layout from the field report: a top-level config plus a `conf.d` split.
fn write_fixture(root: &Path) -> std::path::PathBuf {
    let ssh = root.join(".ssh");
    let conf_d = ssh.join("conf.d");
    fs::create_dir_all(&conf_d).expect("create fixture tree");

    fs::write(
        conf_d.join("10-vps.conf"),
        "Host vps\n    HostName 1.2.3.4\n    User root\n",
    )
    .expect("write 10-vps.conf");
    fs::write(
        conf_d.join("20-work-test.conf"),
        "Host work-test\n    HostName 10.0.0.2\n",
    )
    .expect("write 20-work-test.conf");
    fs::write(
        conf_d.join("30-work-stage.conf"),
        "Host work-stage\n    HostName 10.0.0.3\n",
    )
    .expect("write 30-work-stage.conf");

    ssh.join("config")
}

/// Writes `body`, then the direct host every case shares, and parses the result.
/// The fixture tree must already exist.
fn hosts_for(root: &Path, body: &str) -> Vec<String> {
    let config = root.join(".ssh").join("config");
    fs::write(
        &config,
        format!("{body}\n\nHost local-direct\n    HostName 127.0.0.1\n"),
    )
    .expect("write config");

    load_from_file(&config)
        .expect("parse config")
        .into_iter()
        .map(|h| h.name)
        .collect()
}

#[test]
fn relative_include_resolves_against_the_config_directory() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let names = hosts_for(tmp.path(), "Include conf.d/*.conf");

    assert_eq!(names, ["vps", "work-test", "work-stage", "local-direct"]);
}

/// The defect this file exists for: a relative `Include` used to be read from
/// the directory the app happened to be launched in, so a GUI started from
/// Finder (working directory `/`) found none of the included hosts.
#[test]
fn a_relative_include_ignores_the_process_working_directory() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());

    // A decoy tree that a working-directory lookup would find instead.
    let decoy = tempfile::tempdir().expect("tempdir");
    fs::create_dir_all(decoy.path().join("conf.d")).expect("create decoy tree");
    fs::write(
        decoy.path().join("conf.d").join("99-decoy.conf"),
        "Host decoy
    HostName 6.6.6.6
",
    )
    .expect("write decoy");

    // Restore on the way out even if the parse panics: the working directory is
    // process-global and the decoy is deleted when this test ends.
    struct RestoreCwd(std::path::PathBuf);
    impl Drop for RestoreCwd {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.0);
        }
    }
    let guard = RestoreCwd(std::env::current_dir().expect("read working directory"));
    std::env::set_current_dir(decoy.path()).expect("enter decoy directory");
    let names = hosts_for(tmp.path(), "Include conf.d/*.conf");
    drop(guard);

    assert_eq!(names, ["vps", "work-test", "work-stage", "local-direct"]);
}

#[test]
fn absolute_and_glob7_include_patterns_resolve() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let conf_d = tmp.path().join(".ssh").join("conf.d");

    let cases = [
        format!("Include {}/*.conf", conf_d.display()),
        "Include conf.d/?0-*.conf".to_string(),
        "Include conf.d/[123]0-*.conf".to_string(),
        "Include con*/*.conf".to_string(),
    ];
    for body in cases {
        let names = hosts_for(tmp.path(), &body);
        assert_eq!(
            names,
            ["vps", "work-test", "work-stage", "local-direct"],
            "pattern did not match: {body}"
        );
    }
}

/// A home directory containing a glob metacharacter must not be treated as a
/// pattern: the base is a real path, only the `Include` value is a pattern.
#[test]
fn a_base_directory_containing_glob_metacharacters_still_resolves() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let awkward = tmp.path().join("us[er]");
    fs::create_dir_all(&awkward).expect("create awkward base");
    write_fixture(&awkward);

    let names = hosts_for(&awkward, "Include conf.d/*.conf");

    assert_eq!(names, ["vps", "work-test", "work-stage", "local-direct"]);
}

#[test]
fn a_second_wildcard_in_one_filename_matches() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let names = hosts_for(tmp.path(), "Include conf.d/*-work-*.conf");

    assert_eq!(names, ["work-test", "work-stage", "local-direct"]);
}

#[test]
fn several_pathnames_on_one_include_line_are_all_read() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let names = hosts_for(
        tmp.path(),
        "Include conf.d/10-vps.conf conf.d/20-work-test.conf",
    );

    assert_eq!(names, ["vps", "work-test", "local-direct"]);
}

#[test]
fn a_quoted_pathname_keeps_its_spaces() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    fs::write(
        tmp.path()
            .join(".ssh")
            .join("conf.d")
            .join("with space.conf"),
        "Host spaced\n    HostName 10.0.0.4\n",
    )
    .expect("write fixture");

    let names = hosts_for(tmp.path(), "Include \"conf.d/with space.conf\"");

    assert_eq!(names, ["spaced", "local-direct"]);
}

#[test]
fn an_include_inside_a_host_block_keeps_the_enclosing_host() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let config = tmp.path().join(".ssh").join("config");
    fs::write(
        &config,
        "Host gate\n    Include conf.d/10-vps.conf\n    HostName 10.0.0.9\n    User ops\n",
    )
    .expect("write config");

    let hosts = load_from_file(&config).expect("parse config");
    let gate = hosts
        .iter()
        .find(|h| h.name == "gate")
        .expect("enclosing host survives the Include");

    assert_eq!(gate.hostname, "10.0.0.9");
    assert_eq!(gate.user, "ops");
    assert!(hosts.iter().any(|h| h.name == "vps"));
}

#[test]
fn an_include_that_matches_nothing_is_a_no_op() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());

    for body in ["Include conf.d/nope*.conf", "Include conf.d/absent.conf"] {
        assert_eq!(hosts_for(tmp.path(), body), ["local-direct"]);
    }
}

#[test]
fn a_directory_matching_the_pattern_is_skipped() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    fs::create_dir_all(tmp.path().join(".ssh").join("conf.d").join("40-dir.conf"))
        .expect("create decoy directory");

    let names = hosts_for(tmp.path(), "Include conf.d/*.conf");

    assert_eq!(names, ["vps", "work-test", "work-stage", "local-direct"]);
}

#[test]
fn a_nested_relative_include_resolves_against_the_same_base() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let conf_d = tmp.path().join(".ssh").join("conf.d");
    fs::write(
        conf_d.join("10-vps.conf"),
        "Host vps\n    HostName 1.2.3.4\nInclude conf.d/40-deep.conf\n",
    )
    .expect("write 10-vps.conf");
    fs::write(
        conf_d.join("40-deep.conf"),
        "Host deep\n    HostName 10.0.0.5\n",
    )
    .expect("write 40-deep.conf");

    let names = hosts_for(tmp.path(), "Include conf.d/10-vps.conf");

    assert_eq!(names, ["vps", "deep", "local-direct"]);
}

#[test]
fn an_include_cycle_terminates() {
    let tmp = tempfile::tempdir().expect("tempdir");
    write_fixture(tmp.path());
    let conf_d = tmp.path().join(".ssh").join("conf.d");
    fs::write(
        conf_d.join("a.conf"),
        "Host a\n    HostName 10.0.0.6\nInclude conf.d/b.conf\n",
    )
    .expect("write a.conf");
    fs::write(
        conf_d.join("b.conf"),
        "Host b\n    HostName 10.0.0.7\nInclude conf.d/a.conf\n",
    )
    .expect("write b.conf");

    let names = hosts_for(tmp.path(), "Include conf.d/a.conf");

    assert_eq!(names, ["a", "b", "local-direct"]);
}

/// ssh(1) reads an included file in place, so a general `ForwardAgent no` ahead of
/// the `Include` still wins over a `yes` in a host the file brings in — and one in
/// the included file wins over a host after it.
#[test]
fn a_general_forward_agent_no_reaches_across_include() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let ssh = tmp.path().join(".ssh");
    fs::create_dir_all(&ssh).expect("create .ssh");
    fs::write(ssh.join("hosts.conf"), "Host web\n    ForwardAgent yes\n").expect("write");
    fs::write(ssh.join("defaults.conf"), "Host *\n    ForwardAgent no\n").expect("write");

    let config = ssh.join("config");
    fs::write(&config, "ForwardAgent no\nInclude hosts.conf\n").expect("write config");
    let hosts = load_from_file(&config).expect("parse config");
    assert!(
        !hosts[0].forward_agent,
        "the global no was lost across Include"
    );

    fs::write(
        &config,
        "Include defaults.conf\nHost db\n    ForwardAgent yes\n",
    )
    .expect("write config");
    let hosts = load_from_file(&config).expect("parse config");
    assert!(!hosts[0].forward_agent, "the included no was lost");
}
