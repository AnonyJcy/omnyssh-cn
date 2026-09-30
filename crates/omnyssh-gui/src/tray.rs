//! The system tray: an opt-in place to keep OmnySSH — every terminal, file browser
//! and tunnel in it — running with no window on screen. Off until the user turns it
//! on, and the window only ever hides into an icon that exists: on a desktop without
//! a tray it would have nowhere to come back from.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use crate::dto::TraySupportDto;

const TRAY_ID: &str = "main";
const SHOW_ID: &str = "tray-show";
const QUIT_ID: &str = "tray-quit";

/// What closing and minimizing the window do, and whether the icon is up.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Behavior {
    minimize: bool,
    close: bool,
    /// The icon exists and is shown.
    live: bool,
}

impl Behavior {
    const OFF: Self = Self {
        minimize: false,
        close: false,
        live: false,
    };

    fn closes_to_tray(self) -> bool {
        self.live && self.close
    }

    fn minimizes_to_tray(self) -> bool {
        self.live && self.minimize
    }
}

// Read on every window event, so it lives where the event handler can reach it
// without the app's managed state.
static BEHAVIOR: Mutex<Behavior> = Mutex::new(Behavior::OFF);

/// Set by whichever reveals the window first at startup — not `is_visible()`, which
/// takes a window hidden in the tray for one never shown. Until then there is nothing
/// to bring back: the window is still coming up over a blank webview.
pub static REVEALED: AtomicBool = AtomicBool::new(false);

/// Whether the window was minimized at the last resize. It hides only on the way
/// down, so a restore that lands while the window manager still calls it minimized
/// does not send it straight back.
static MINIMIZED: AtomicBool = AtomicBool::new(false);

fn behavior() -> Behavior {
    *BEHAVIOR.lock().unwrap_or_else(PoisonError::into_inner)
}

fn set_behavior(behavior: Behavior) {
    *BEHAVIOR.lock().unwrap_or_else(PoisonError::into_inner) = behavior;
}

/// Applies the user's choice as far as this desktop allows, and says how far that is.
/// Whatever it cannot do, the window keeps doing as before.
///
/// Main thread only: that is where the icon is built, shown and hidden.
pub fn apply(
    app: &AppHandle,
    minimize: bool,
    close: bool,
    hosts: TrayHosts,
) -> Result<TraySupportDto, String> {
    let support = support(app, hosts);
    let minimize = minimize && support.minimize;
    let mut behavior = Behavior {
        minimize,
        close,
        live: false,
    };
    if !support.available {
        set_behavior(behavior);
        return Ok(support);
    }
    let shown = if minimize || close {
        show_icon(app)
    } else {
        hide_icon(app);
        Ok(())
    };
    behavior.live = (minimize || close) && shown.is_ok();
    set_behavior(behavior);
    shown.map(|()| support)
}

/// The trays a Linux desktop runs. Asked off the main thread: both answers come
/// from another process.
#[derive(Debug, Clone, Copy, Default)]
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub struct TrayHosts {
    /// A StatusNotifier watcher (KDE, GNOME's AppIndicator extension, waybar).
    status_notifier: bool,
    /// An XEmbed system tray on the X server (i3bar, stalonetray, older panels).
    xembed: bool,
}

#[cfg(target_os = "linux")]
pub fn find_hosts() -> TrayHosts {
    TrayHosts {
        status_notifier: status_notifier_watcher(),
        xembed: xembed_tray(),
    }
}

#[cfg(not(target_os = "linux"))]
pub fn find_hosts() -> TrayHosts {
    TrayHosts::default()
}

/// On Linux an icon shows only in a tray something is running — the library is
/// there on every packaged install, a tray is not: stock GNOME has none, and there
/// the window would hide into nothing. A native Wayland window is also never told it
/// was minimized, and cannot use an XEmbed tray.
#[cfg(target_os = "linux")]
fn support(app: &AppHandle, hosts: TrayHosts) -> TraySupportDto {
    let wayland = wayland(app);
    let available = tray_library_present() && (hosts.status_notifier || (hosts.xembed && !wayland));
    TraySupportDto {
        available,
        minimize: available && !wayland,
    }
}

/// macOS has no minimize event to act on, and keeps minimized windows in the Dock.
#[cfg(not(target_os = "linux"))]
fn support(_app: &AppHandle, _hosts: TrayHosts) -> TraySupportDto {
    TraySupportDto {
        available: true,
        minimize: !cfg!(target_os = "macos"),
    }
}

#[cfg(target_os = "linux")]
fn wayland(app: &AppHandle) -> bool {
    use gtk::prelude::*;
    app.get_webview_window("main")
        .and_then(|window| window.gtk_window().ok())
        .is_some_and(|window| window.display().type_().name() == "GdkWaylandDisplay")
}

#[cfg(target_os = "linux")]
fn status_notifier_watcher() -> bool {
    let Ok(bus) = zbus::blocking::Connection::session() else {
        return false;
    };
    let Ok(dbus) = zbus::blocking::fdo::DBusProxy::new(&bus) else {
        return false;
    };
    zbus::names::BusName::try_from("org.kde.StatusNotifierWatcher")
        .is_ok_and(|name| dbus.name_has_owner(name).unwrap_or(false))
}

#[cfg(target_os = "linux")]
fn xembed_tray() -> bool {
    let Ok(xlib) = x11_dl::xlib::Xlib::open() else {
        return false;
    };
    // SAFETY: a connection of our own, used on this thread only and closed before
    // returning; nothing read from it outlives it.
    unsafe {
        let display = (xlib.XOpenDisplay)(std::ptr::null());
        if display.is_null() {
            return false;
        }
        let screen = (xlib.XDefaultScreen)(display);
        let name = std::ffi::CString::new(format!("_NET_SYSTEM_TRAY_S{screen}"))
            .expect("no NUL in the atom name");
        let atom = (xlib.XInternAtom)(display, name.as_ptr(), x11_dl::xlib::True);
        let owned = atom != 0 && (xlib.XGetSelectionOwner)(display, atom) != 0;
        (xlib.XCloseDisplay)(display);
        owned
    }
}

/// Built once, then only shown and hidden: on Linux an icon can never really be
/// removed, so rebuilding would stack up dead ones.
fn show_icon(app: &AppHandle) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        return tray.set_visible(true).map_err(|e| e.to_string());
    }
    build_icon(app).map_err(|e| format!("Could not add the tray icon: {e}"))
}

fn hide_icon(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
}

fn build_icon(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ID, "Show OmnySSH", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit OmnySSH", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("OmnySSH")
        .menu(&menu)
        // A menu bar extra opens its menu on click; a Windows tray icon brings the
        // window back and keeps its menu for the right button.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| {
            if cfg!(target_os = "macos") {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Whether the library a Linux tray icon needs is installed. libappindicator panics
/// when it cannot load one of these — in this order — instead of returning an error.
#[cfg(target_os = "linux")]
fn tray_library_present() -> bool {
    static PRESENT: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *PRESENT.get_or_init(|| {
        [
            c"libayatana-appindicator3.so.1",
            c"libappindicator3.so.1",
            c"libayatana-appindicator3.so",
            c"libappindicator3.so",
        ]
        .iter()
        // SAFETY: loads a library by name with the flags libappindicator itself uses.
        // The handle is never closed: the library is about to be loaded for good,
        // and unloading GTK code that may have registered types is unsafe.
        .any(|name| {
            !unsafe { libc::dlopen(name.as_ptr(), libc::RTLD_LAZY | libc::RTLD_LOCAL) }.is_null()
        })
    })
}

/// Brings the window back from the tray, the Dock or a second launch.
pub fn reveal(app: &AppHandle) {
    if !REVEALED.load(Ordering::Acquire) {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        // In this order: `show` alone leaves a minimized window minimized on
        // Windows, and a minimized window ignores focus.
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_ID => reveal(app),
        // Never `prevent_exit` anywhere: it would stop this too.
        QUIT_ID => app.exit(0),
        _ => {}
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let behavior = behavior();
    match event {
        WindowEvent::CloseRequested { api, .. } if behavior.closes_to_tray() => {
            api.prevent_close();
            let _ = window.hide();
        }
        // Minimizing arrives as a resize, on GTK with the size unchanged.
        WindowEvent::Resized(_) => {
            let minimized = window.is_minimized().unwrap_or(false);
            let was = MINIMIZED.swap(minimized, Ordering::AcqRel);
            if minimized && !was && behavior.minimizes_to_tray() {
                let _ = window.hide();
            }
        }
        _ => {}
    }
}

/// On macOS the Dock icon brings back a window hidden in the tray.
pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        reveal(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg(test)]
mod tests {
    use super::Behavior;

    /// The window hides only into an icon that is up: an unavailable or failed tray
    /// must leave close and minimize as they were.
    #[test]
    fn the_window_hides_only_into_a_live_icon() {
        let on = Behavior {
            minimize: true,
            close: true,
            live: true,
        };
        assert!(on.closes_to_tray() && on.minimizes_to_tray());

        let no_icon = Behavior { live: false, ..on };
        assert!(!no_icon.closes_to_tray() && !no_icon.minimizes_to_tray());

        let close_only = Behavior {
            minimize: false,
            ..on
        };
        assert!(close_only.closes_to_tray() && !close_only.minimizes_to_tray());

        assert!(!Behavior::OFF.closes_to_tray() && !Behavior::OFF.minimizes_to_tray());
    }
}
