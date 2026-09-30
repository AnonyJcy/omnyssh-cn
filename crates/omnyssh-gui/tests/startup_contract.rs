//! Launch-time contract of the desktop app. These are link-time or native-window
//! settings that no runtime assertion can reach from a test binary (`cargo test`
//! always builds with `debug_assertions`), so they are guarded at their source.

use std::path::Path;

const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");
const MAIN_RS: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs"));

/// Without this attribute the binary links as a console app and Windows opens a
/// terminal next to the window for the whole session.
#[test]
fn release_builds_link_as_a_windows_gui_binary() {
    assert!(
        MAIN_RS.contains(r#"#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]"#),
        "src/main.rs no longer declares the windows_subsystem attribute — release \
         builds would open a console window alongside the app on Windows"
    );
}

/// The window is revealed only once the page is up, so the launch never shows the
/// webview's blank base colour. The background is what the fallback reveal paints
/// when the frontend is slow, so it has to match the app's own dark surface.
#[test]
fn the_window_starts_hidden_on_the_dark_background() {
    let config: serde_json::Value =
        serde_json::from_str(&read(Path::new(MANIFEST_DIR).join("tauri.conf.json")))
            .expect("tauri.conf.json is valid JSON");
    let window = &config["app"]["windows"][0];

    assert_eq!(
        window["visible"],
        serde_json::json!(false),
        "the main window must be created hidden and revealed on page load"
    );
    assert_eq!(
        window["backgroundColor"].as_str().map(str::to_lowercase),
        Some(dark_background_token()),
        "the native window background drifted from the dark --bg token"
    );
}

/// The other half of `visible: false`: drop either reveal and the app becomes a
/// running process with no window and no way to reach it.
#[test]
fn a_hidden_window_is_always_revealed() {
    assert!(
        MAIN_RS.contains(".on_page_load("),
        "the page-load reveal is gone — the window would stay hidden until the fallback"
    );
    assert!(
        MAIN_RS.contains("REVEAL_FALLBACK"),
        "the fallback reveal is gone — a frontend that never loads would leave no window"
    );
}

/// The reveal doubles as the signal that the page loaded, and the render retry reads
/// it. Drop this one store and every Linux launch looks like a failed one, so the app
/// would restart itself into software rendering every single time — with every other
/// test still green.
#[test]
fn a_loaded_page_is_recorded_for_the_render_retry() {
    assert!(
        MAIN_RS.contains("PAGE_LOADED.store("),
        "the page-load flag is no longer set — the app would restart itself on every \
         Linux launch"
    );
}

/// A debug build waits on the dev server, so a slow one starting must never look like
/// a broken renderer and re-exec the app out from under a contributor.
#[test]
fn the_render_retry_is_a_release_only_behaviour() {
    assert!(
        MAIN_RS.contains(r#"#[cfg(all(target_os = "linux", not(debug_assertions)))]"#),
        "the render retry is no longer gated to release builds — `tauri dev` would \
         restart itself whenever the dev server is slow"
    );
}

/// The retry re-execs the app, so the one thing standing between it and an endless
/// restart loop is the child inheriting the marker the parent tested for. The two are
/// three lines apart and nothing else connects them: rename the string in `cmd.env`
/// alone and the loop is silent, unbounded, and only reproducible on Linux.
#[test]
fn the_render_retry_marks_the_child_it_starts() {
    assert!(
        MAIN_RS.contains(".env(RETRY_MARKER, \"1\")"),
        "the render retry no longer marks its child with RETRY_MARKER — the restart \
         would repeat for as long as the page fails to load"
    );
    assert!(
        MAIN_RS.contains("std::env::var_os(RETRY_MARKER)"),
        "the render retry no longer reads RETRY_MARKER — a marked child would restart \
         itself again"
    );
}

/// A second launch has to exit before anything else starts, and only the first plugin
/// runs before all the others. Moved down the list, the second copy would open the
/// settings store and the updater — and, with the tray, a second icon — before quitting.
#[test]
fn the_single_instance_plugin_is_registered_first() {
    let first = MAIN_RS.find(".plugin(").expect("main.rs registers plugins");
    assert!(
        MAIN_RS[first..].starts_with(".plugin(tauri_plugin_single_instance::init("),
        "tauri_plugin_single_instance is no longer the first plugin registered"
    );
}

/// The window hides into the tray only; `prevent_exit` would also swallow the tray's
/// own Quit, leaving an app with no window that cannot be closed.
#[test]
fn nothing_prevents_the_app_from_exiting() {
    let tray = read(Path::new(MANIFEST_DIR).join("src/tray.rs"));
    assert!(
        !MAIN_RS.contains("prevent_exit(") && !tray.contains("prevent_exit("),
        "prevent_exit would block the tray's Quit"
    );
}

/// Window geometry is restored by a plugin whose default flag set includes `VISIBLE`,
/// which it applies from `on_window_ready` — before the page exists. Fall back to those
/// defaults and every launch shows the window over a blank webview again, undoing the
/// reveal. `WINDOW_STATE_FLAGS` carries a compile-time guard of its own; this catches
/// the other half, a call site that stops using it.
#[test]
fn window_state_restores_geometry_but_never_visibility() {
    assert!(
        MAIN_RS.contains(".with_state_flags(WINDOW_STATE_FLAGS)"),
        "the window-state plugin no longer takes its flags from WINDOW_STATE_FLAGS — \
         the default set includes VISIBLE and would reveal the window before it painted"
    );
}

/// The rpm bundler writes `Requires:` from this list and nothing else — it never scans
/// the binary — so an empty list ships a package that installs onto a system with no
/// webview and then dies at launch. Sonames, not package names: the package providing
/// them is called something different on every RPM distro.
#[test]
fn the_rpm_declares_the_libraries_it_links() {
    let config: serde_json::Value =
        serde_json::from_str(&read(Path::new(MANIFEST_DIR).join("tauri.conf.json")))
            .expect("tauri.conf.json is valid JSON");
    let depends = config["bundle"]["linux"]["rpm"]["depends"]
        .as_array()
        .expect("the rpm bundle declares its runtime dependencies");

    for lib in [
        "libwebkit2gtk-4.1.so.0()(64bit)",
        "libjavascriptcoregtk-4.1.so.0()(64bit)",
        "libgtk-3.so.0()(64bit)",
    ] {
        assert!(
            depends.iter().any(|d| d == lib),
            "the rpm no longer requires {lib} — dnf would install a build that cannot start"
        );
    }
}

/// `--bg` of the dark theme — the single source of truth for the app's backdrop.
fn dark_background_token() -> String {
    let css = read(Path::new(MANIFEST_DIR).join("ui/src/app.css"));
    let block = css
        .split_once(":root[data-theme='dark']")
        .expect("app.css declares a dark theme block")
        .1;
    block[..block.find('}').expect("the dark theme block is closed")]
        .split_once("--bg:")
        .expect("the dark theme block declares --bg")
        .1
        .split(';')
        .next()
        .expect("--bg is terminated")
        .trim()
        .to_lowercase()
}

fn read(path: impl AsRef<Path>) -> String {
    let path = path.as_ref();
    std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
}
