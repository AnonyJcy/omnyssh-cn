//! Port forwarding (tech-gui.md §4.2): start and stop a host's tunnel. Progress
//! arrives as `tunnel-status-changed` through the bridge.

use tauri::State;

use crate::error::CommandError;
use crate::state::GuiState;

/// Start `hostName`'s tunnel, or restart it if one is running. Async because the
/// tunnel is spawned onto the Tauri runtime.
#[tauri::command]
#[specta::specta]
pub async fn tunnel_start(
    host_name: String,
    state: State<'_, GuiState>,
) -> Result<(), CommandError> {
    state
        .start_tunnel(&host_name)
        .map_err(|message| CommandError { message })
}

/// Stop `hostName`'s tunnel. A no-op when none runs.
#[tauri::command]
#[specta::specta]
pub fn tunnel_stop(host_name: String, state: State<'_, GuiState>) -> Result<(), CommandError> {
    state.stop_tunnel(&host_name);
    Ok(())
}
