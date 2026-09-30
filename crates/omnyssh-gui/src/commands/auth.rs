//! Unlock passphrase-protected identity files and answer login-password
//! prompts (in-memory only).

use crate::error::CommandError;

/// Decrypt `key_path` with `passphrase` and remember it for this process. Only a
/// key the core reported in `key-passphrase-required` is accepted; connections
/// waiting on it retry at once.
#[tauri::command]
#[specta::specta]
pub async fn unlock_identity(key_path: String, passphrase: String) -> Result<(), CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        omnyssh_core::ssh::identity::unlock(&key_path, &passphrase)
    })
    .await
    .map_err(|e| CommandError {
        message: format!("unlock task failed: {e}"),
    })?
    .map_err(|e| CommandError {
        message: e.to_string(),
    })
}

/// Answer the `password-required` prompt `request_id`: a password to try, or
/// `null` to cancel that login. The connection checks it with the server and
/// asks again if it is refused.
#[tauri::command]
#[specta::specta]
pub fn answer_password(request_id: u64, password: Option<String>) -> Result<(), CommandError> {
    omnyssh_core::ssh::password::answer(request_id, password).map_err(|e| CommandError {
        message: e.to_string(),
    })
}
