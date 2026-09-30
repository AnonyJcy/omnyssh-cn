//! Terminal session commands (tech-gui.md §4.2). Thin wrappers over the PTY manager
//! and session registry in `GuiState`. Output flows out-of-band on the per-session
//! raw `Channel` (§3.3/§3.6) — never as a command return or a global event; the
//! frontend-facing ids are the registry's public ids.

use tauri::ipc::Channel;
use tauri::State;

use crate::dto::TerminalBytes;
use crate::error::CommandError;
use crate::state::GuiState;

/// Open a terminal for `host_name`, streaming raw output into `on_output`. Returns
/// the public session id used by the write/resize/close commands (tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub async fn terminal_open(
    state: State<'_, GuiState>,
    host_name: String,
    cols: u16,
    rows: u16,
    on_output: Channel<TerminalBytes>,
) -> Result<u64, CommandError> {
    // Async so this runs on the Tauri async runtime: `PtyManager::open` spawns the
    // session task with `tokio::spawn`, which panics ("no reactor running") from a
    // sync command on the main thread. Mirrors async `sftp_open`/`reload_hosts`.
    state
        .open_terminal(&host_name, cols, rows, on_output)
        .map_err(|message| CommandError { message })
}

/// Send keystrokes / pasted bytes to a terminal (tech-gui.md §4.2). Input is
/// low-volume, so the ordinary `number[]` path is fine here (only output is raw).
#[tauri::command]
#[specta::specta]
pub fn terminal_write(
    state: State<'_, GuiState>,
    session_id: u64,
    data: Vec<u8>,
) -> Result<(), CommandError> {
    state.write_terminal(session_id, &data);
    Ok(())
}

/// Reflow a terminal to `cols` x `rows` (tech-gui.md §4.2).
#[tauri::command]
#[specta::specta]
pub fn terminal_resize(
    state: State<'_, GuiState>,
    session_id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), CommandError> {
    state.resize_terminal(session_id, cols, rows);
    Ok(())
}

/// Close a terminal and its connection (tech-gui.md §4.2). The frontend has already
/// dropped the tab, so the resulting `PtyExited` emits no `terminal-exited` (§3.4).
#[tauri::command]
#[specta::specta]
pub fn terminal_close(state: State<'_, GuiState>, session_id: u64) -> Result<(), CommandError> {
    state.close_terminal(session_id);
    Ok(())
}

/// Paste into the focused terminal the way the webview's own Ctrl+Shift+V does.
/// WebKitGTK binds that chord by its key symbol, so under a non-Latin layout it never
/// fires and the frontend asks here instead. The other webviews bind it by the
/// physical key and never need this.
#[tauri::command]
#[specta::specta]
pub fn terminal_paste(webview: tauri::Webview) -> Result<(), CommandError> {
    #[cfg(target_os = "linux")]
    webview
        .with_webview(|platform| {
            use webkit2gtk::WebViewExt;
            platform.inner().execute_editing_command("PasteAsPlainText");
        })
        .map_err(|e| CommandError {
            message: e.to_string(),
        })?;
    #[cfg(not(target_os = "linux"))]
    let _ = webview;
    Ok(())
}
