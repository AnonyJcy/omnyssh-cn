//! The system tray (tech-gui.md §4.2): the frontend owns the preference and hands
//! it over here, where the window events it governs are handled.

use tauri::AppHandle;

use crate::dto::TraySupportDto;
use crate::error::CommandError;

/// Minimize and close to the tray, or not. Resolves to what this desktop allows —
/// a tray at all, and minimizing into it; what it does not, the window keeps doing
/// as before.
#[tauri::command]
#[specta::specta]
pub async fn set_tray_behavior(
    app: AppHandle,
    minimize_to_tray: bool,
    close_to_tray: bool,
) -> Result<TraySupportDto, CommandError> {
    let error = |e: &dyn std::fmt::Display| CommandError {
        message: e.to_string(),
    };
    // Other processes answer these, so they are asked before the main thread is.
    let hosts = tokio::task::spawn_blocking(crate::tray::find_hosts)
        .await
        .map_err(|e| error(&e))?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    // The icon is built and shown on the main thread; a Linux build that panics there
    // would take the event loop with it, which is why `apply` probes first.
    app.run_on_main_thread(move || {
        let _ = tx.send(crate::tray::apply(
            &handle,
            minimize_to_tray,
            close_to_tray,
            hosts,
        ));
    })
    .map_err(|e| error(&e))?;
    rx.await
        .map_err(|e| error(&e))?
        .map_err(|message| CommandError { message })
}
