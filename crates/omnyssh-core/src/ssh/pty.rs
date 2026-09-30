//! russh-backed SSH sessions for the multi-session terminal.
//!
//! Each session is a tokio task that owns a russh [`Channel`] with a
//! server-allocated PTY (via `request_pty` + `request_shell`), drives a
//! [`vt100::Parser`], and multiplexes I/O over a control channel. The parsed
//! screen state is exposed via an `Arc<Mutex<vt100::Parser>>` that the render
//! loop can snapshot without blocking. Using russh over a plain TCP socket
//! avoids the local pseudo-console entirely, so the same code path works on
//! every OS (notably fixing the dead Windows terminal).
//!
//! [`PtyManager`] owns all active sessions and provides a simple API for the
//! application layer.

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use async_trait::async_trait;
use russh::ChannelMsg;
use tokio::sync::mpsc;

use crate::event::CoreEvent;
use crate::ssh::client::Host;
use crate::ssh::identity;
use crate::ssh::password::{AskPassword, NoAnswer, Prompt};
use crate::ssh::session::{
    connect_for_shell, forwards_agent, passphrase_required, Passwords, SshConnection,
};

/// Stable numeric identifier for a PTY session (mirrors [`crate::event::SessionId`]).
pub type SessionId = u64;

// ---------------------------------------------------------------------------
// Control messages — main thread → session task
// ---------------------------------------------------------------------------

/// A command sent to a session's owning task.
enum Ctrl {
    /// Keystrokes or pasted bytes for the remote shell.
    Input(Vec<u8>),
    /// Window resize; forwarded to the server as `window_change`.
    Resize { cols: u16, rows: u16 },
    /// Request the task to end and close the connection.
    Close,
}

// ---------------------------------------------------------------------------
// PtySession — a handle to a running session task
// ---------------------------------------------------------------------------

/// Handle to a session task. Holds the shared parser for rendering and the
/// control sender; dropping the sender (or sending [`Ctrl::Close`]) ends the
/// task, which closes the russh connection.
struct PtySession {
    /// Unique identifier for this session.
    id: SessionId,
    /// Shared VT100 parser. The task writes into it; the render loop takes a
    /// read-side snapshot. Held only for microseconds to avoid blocking.
    parser: Arc<Mutex<vt100::Parser>>,
    /// Control channel to the session task (input / resize / close).
    ctrl_tx: mpsc::UnboundedSender<Ctrl>,
}

/// Feeds bytes to the parser in 256-byte sub-chunks, releasing the lock between
/// chunks so a large burst does not starve the render loop.
fn feed_parser(parser: &Arc<Mutex<vt100::Parser>>, data: &[u8]) {
    const CHUNK: usize = 256;
    let mut off = 0;
    while off < data.len() {
        let end = (off + CHUNK).min(data.len());
        if let Ok(mut p) = parser.lock() {
            p.process(&data[off..end]);
        }
        off = end;
    }
}

/// Whether a locale value names the UTF-8 codeset (`en_US.UTF-8`, `ru_RU.utf8`,
/// `de_DE.UTF-8@euro`, …).
fn is_utf8_locale(value: &str) -> bool {
    match value.rsplit_once('.') {
        Some((_, codeset)) => {
            let codeset = codeset.split('@').next().unwrap_or(codeset);
            codeset.eq_ignore_ascii_case("utf-8") || codeset.eq_ignore_ascii_case("utf8")
        }
        None => false,
    }
}

/// The locale environment to forward to a remote shell: every `LANG`/`LC_*`
/// variable from `vars`, plus an `LC_CTYPE=C.UTF-8` fallback *only* when the
/// forwarded set doesn't already resolve the character type to UTF-8. Mirrors an
/// ssh client's `SendEnv LANG LC_*` while guaranteeing a UTF-8 character type for
/// a process with no locale env (a GUI launched from Finder) — without clobbering
/// an already-UTF-8 `LANG` with a `C.UTF-8` the server may not have. Pure, so it
/// can be unit-tested; [`forward_locale`] just relays the result.
fn locale_env<I>(vars: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut out = Vec::new();
    let (mut lc_all, mut lc_ctype, mut lang) = (None, None, None);
    for (name, value) in vars {
        if name == "LANG" || name.starts_with("LC_") {
            match name.as_str() {
                "LC_ALL" => lc_all = Some(value.clone()),
                "LC_CTYPE" => lc_ctype = Some(value.clone()),
                "LANG" => lang = Some(value.clone()),
                _ => {}
            }
            out.push((name, value));
        }
    }
    // `LC_ALL` overrides every category, so respect the user's explicit choice
    // verbatim. Otherwise the character type resolves from `LC_CTYPE` then `LANG`;
    // force UTF-8 only when neither already provides it, replacing a non-UTF-8
    // `LC_CTYPE` rather than sending a duplicate.
    let force_utf8 = match lc_all {
        Some(_) => false,
        None => !lc_ctype
            .as_deref()
            .or(lang.as_deref())
            .is_some_and(is_utf8_locale),
    };
    if force_utf8 {
        out.retain(|(name, _)| name != "LC_CTYPE");
        out.push(("LC_CTYPE".to_string(), "C.UTF-8".to_string()));
    }
    out
}

/// Forwards a UTF-8 locale to the remote shell, mirroring an ssh client's
/// default `SendEnv LANG LC_*`. Best-effort: servers without `AcceptEnv` ignore
/// it, so behaviour is unchanged there.
async fn forward_locale(channel: &russh::Channel<russh::client::Msg>) {
    // `vars_os` (not `vars`) so a non-UTF-8 variable elsewhere in the environment
    // can't panic this session task; locale values are ASCII, so dropping any
    // undecodable entry is safe.
    let vars = std::env::vars_os()
        .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)));
    for (name, value) in locale_env(vars) {
        let _ = channel.set_env(false, name, value).await;
    }
}

/// Opens a channel and requests a remote PTY + shell (the `ssh -t` equivalent).
async fn open_shell(
    handle: &SshConnection,
    lends_agent: bool,
    cols: u16,
    rows: u16,
) -> Result<russh::Channel<russh::client::Msg>> {
    let channel = handle
        .channel_open_session()
        .await
        .context("open terminal channel")?;
    // Sent before the shell starts so it inherits the locale.
    forward_locale(&channel).await;
    // Likewise `SSH_AUTH_SOCK`.
    if lends_agent {
        channel
            .agent_forward(false)
            .await
            .context("request agent forwarding")?;
    }
    // IUTF8 tells the server's line discipline that input is UTF-8, so multibyte
    // (e.g. Cyrillic) editing works in canonical mode. Unknown modes are ignored.
    channel
        .request_pty(
            false,
            "xterm-256color",
            cols as u32,
            rows as u32,
            0,
            0,
            &[(russh::Pty::IUTF8, 1)],
        )
        .await
        .context("request remote pty")?;
    channel
        .request_shell(false)
        .await
        .context("request remote shell")?;
    Ok(channel)
}

/// Owns the russh channel for one session and multiplexes I/O until close/EOF.
#[allow(clippy::too_many_arguments)] // additive raw-output sink (§3.6) is the 8th
async fn session_task(
    id: SessionId,
    host: Host,
    cols: u16,
    rows: u16,
    parser: Arc<Mutex<vt100::Parser>>,
    mut ctrl_rx: mpsc::UnboundedReceiver<Ctrl>,
    tx: mpsc::Sender<CoreEvent>,
    raw_output: Option<mpsc::Sender<(SessionId, Vec<u8>)>>,
) {
    // Phase A/B: connect, authenticate — asking for a password in the tab when
    // the keys do not get in — and open the remote shell. Failures are reported
    // in the status bar and tear the tab down via PtyExited.
    let mut prompt = InlinePrompt {
        id,
        parser: &parser,
        tx: &tx,
        raw_output: raw_output.as_ref(),
        ctrl_rx: &mut ctrl_rx,
        size: (cols, rows),
        asked: false,
        closed: false,
    };
    // Asked once: the connection that takes agent channels and the request that
    // invites them must agree, even if the agent comes or goes during the login.
    let lends_agent = forwards_agent(&host);
    let connected = connect_for_shell(&host, Passwords::Ask(&mut prompt), lends_agent).await;
    // Keys typed past a password prompt must not reach the new shell (a
    // password entered twice would be echoed there). Without a prompt they are
    // the user's first command, and stay queued.
    if prompt.asked {
        prompt.flush();
    }
    let ((cols, rows), closed) = (prompt.size, prompt.closed);
    if closed && connected.is_ok() {
        // Closed at the prompt: no shell for a tab that is gone.
        let _ = tx.send(CoreEvent::PtyExited(id)).await;
        return;
    }
    let result = match connected {
        Ok(handle) => open_shell(&handle, lends_agent, cols, rows)
            .await
            .map(|ch| (handle, ch)),
        Err(e) => Err(e),
    };
    let (_handle, mut channel) = match result {
        Ok(pair) => pair,
        Err(e) => {
            // The tab goes first: the TUI reports a closed tab in the status bar,
            // and the reason has to be the message that stays there.
            let _ = tx.send(CoreEvent::PtyExited(id)).await;
            // A tab closed at the password prompt needs no error.
            if !closed {
                let _ = tx.send(CoreEvent::Error(format!("Terminal: {e}"))).await;
            }
            if let Some(path) = passphrase_required(&e) {
                identity::ask_passphrase(&tx, &host.name, path).await;
            }
            return;
        }
    };

    // Phase C: pump loop (official russh interactive idiom). `wait` is the only
    // &mut method, so a single owning task can select over it and the control
    // receiver without aliasing.
    loop {
        tokio::select! {
            msg = channel.wait() => match msg {
                // stdout and remote stderr both render in a real terminal.
                Some(ChannelMsg::Data { data })
                | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    feed_parser(&parser, &data);
                    let _ = tx.send(CoreEvent::PtyOutput(id)).await;
                    // Additive GUI tap (tech-gui.md §3.6): mirror the raw bytes to
                    // the frontend channel. Absent for the TUI → no behaviour change.
                    if let Some(raw) = &raw_output {
                        let _ = raw.send((id, data.to_vec())).await;
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                _ => {} // ExitStatus etc.: ignore, wait for Close.
            },
            cmd = ctrl_rx.recv() => match cmd {
                Some(Ctrl::Input(bytes)) => {
                    let _ = channel.data(&bytes[..]).await;
                }
                Some(Ctrl::Resize { cols, rows }) => {
                    let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                }
                Some(Ctrl::Close) | None => break,
            },
        }
    }

    let _ = channel.eof().await;
    let _ = tx.send(CoreEvent::PtyExited(id)).await;
    // _handle drops here → russh closes the TCP connection.
}

/// Asks for the login password inside the tab, the way ssh(1) does: the prompt
/// is drawn as terminal output, and keystrokes are read without echo until
/// Enter. Nothing typed here reaches the server as shell input.
struct InlinePrompt<'a> {
    id: SessionId,
    parser: &'a Arc<Mutex<vt100::Parser>>,
    tx: &'a mpsc::Sender<CoreEvent>,
    raw_output: Option<&'a mpsc::Sender<(SessionId, Vec<u8>)>>,
    ctrl_rx: &'a mut mpsc::UnboundedReceiver<Ctrl>,
    /// The latest window size, for the shell opened once the login is done.
    size: (u16, u16),
    /// A password prompt was shown.
    asked: bool,
    /// The tab was closed at the prompt.
    closed: bool,
}

impl InlinePrompt<'_> {
    /// Drops keystrokes typed ahead, as ssh(1) does before and after a password
    /// prompt, keeping a resize and a close.
    fn flush(&mut self) {
        while let Ok(ctrl) = self.ctrl_rx.try_recv() {
            match ctrl {
                Ctrl::Input(_) => {}
                Ctrl::Resize { cols, rows } => self.size = (cols, rows),
                Ctrl::Close => self.closed = true,
            }
        }
    }

    async fn print(&self, text: &str) {
        feed_parser(self.parser, text.as_bytes());
        let _ = self.tx.send(CoreEvent::PtyOutput(self.id)).await;
        if let Some(raw) = self.raw_output {
            let _ = raw.send((self.id, text.as_bytes().to_vec())).await;
        }
    }
}

#[async_trait]
impl<'a> AskPassword for InlinePrompt<'a> {
    async fn ask(&mut self, prompt: Prompt<'_>) -> Result<String, NoAnswer> {
        self.asked = true;
        self.flush();
        if self.closed {
            return Err(NoAnswer::Cancelled);
        }
        if prompt.retry {
            self.print("Permission denied, please try again.\r\n").await;
        } else if let Some(key) = prompt.new_host_key {
            // A server first met on this connection: show its key before the
            // password goes to it.
            self.print(&format!("New host key recorded: {key}\r\n"))
                .await;
        }
        self.print(&format!("{}'s password: ", prompt.login)).await;
        let mut line = PasswordLine::default();
        let typed = loop {
            match self.ctrl_rx.recv().await {
                Some(Ctrl::Input(bytes)) => {
                    if let Some(typed) = line.feed(&bytes) {
                        break typed;
                    }
                }
                Some(Ctrl::Resize { cols, rows }) => self.size = (cols, rows),
                Some(Ctrl::Close) | None => {
                    self.closed = true;
                    return Err(NoAnswer::Cancelled);
                }
            }
        };
        self.print("\r\n").await;
        typed.ok_or(NoAnswer::Cancelled)
    }
}

/// A password being typed at the inline prompt.
#[derive(Default)]
struct PasswordLine {
    bytes: Vec<u8>,
    escape: Escape,
}

/// Where the prompt is inside a terminal escape sequence (arrow keys, function
/// keys, paste markers), which are dropped.
#[derive(Default, Clone, Copy)]
enum Escape {
    #[default]
    None,
    Started,
    Sequence,
}

impl PasswordLine {
    /// Takes keystrokes. `Some` once the line is done: the password on Enter,
    /// `None` on Ctrl+C (or Ctrl+D on an empty line). Input after Enter is
    /// dropped, never sent on.
    fn feed(&mut self, input: &[u8]) -> Option<Option<String>> {
        for &byte in input {
            match self.escape {
                Escape::Started if matches!(byte, b'[' | b'O') => {
                    self.escape = Escape::Sequence;
                    continue;
                }
                // A lone Esc: drop it, keep what follows.
                Escape::Started => self.escape = Escape::None,
                // Parameters and intermediates run 0x20..=0x3f; the final byte ends it.
                Escape::Sequence => {
                    if !(0x20..=0x3f).contains(&byte) {
                        self.escape = Escape::None;
                    }
                    continue;
                }
                Escape::None => {}
            }
            match byte {
                0x1b => self.escape = Escape::Started,
                b'\r' | b'\n' => {
                    return Some(Some(String::from_utf8_lossy(&self.bytes).into_owned()))
                }
                0x03 => return Some(None),
                0x04 if self.bytes.is_empty() => return Some(None),
                0x15 => self.bytes.clear(),
                // One character, not one byte.
                0x08 | 0x7f => {
                    while let Some(last) = self.bytes.pop() {
                        if last & 0xc0 != 0x80 {
                            break;
                        }
                    }
                }
                byte if byte < 0x20 => {}
                byte => self.bytes.push(byte),
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// PtyManager
// ---------------------------------------------------------------------------

/// Manages all active terminal sessions.
///
/// Stored by the frontend outside of its shared state to avoid reference cycles.
/// Dropping `PtyManager` or calling [`PtyManager::shutdown`] closes all
/// sessions gracefully.
pub struct PtyManager {
    sessions: Vec<PtySession>,
    next_id: u64,
    /// Optional raw-output tap (GUI only). When set, each session task ALSO
    /// forwards every data chunk here, tagged by its [`SessionId`], alongside the
    /// existing parser feed + `PtyOutput` nudge. `None` for the TUI, whose path is
    /// byte-for-byte unchanged.
    raw_output: Option<mpsc::Sender<(SessionId, Vec<u8>)>>,
}

impl PtyManager {
    /// Creates an empty manager with no raw-output tap (the TUI path).
    pub fn new() -> Self {
        Self {
            sessions: Vec::new(),
            next_id: 1,
            raw_output: None,
        }
    }

    /// Creates an empty manager that also mirrors every session's raw bytes into
    /// `raw_output`, keyed by [`SessionId`] (the GUI terminal tap). Sessions and
    /// the id space are identical to [`PtyManager::new`]; only the extra sink
    /// differs, so the TUI construction path is unaffected.
    pub fn with_raw_output(raw_output: mpsc::Sender<(SessionId, Vec<u8>)>) -> Self {
        Self {
            sessions: Vec::new(),
            next_id: 1,
            raw_output: Some(raw_output),
        }
    }

    /// Opens a new terminal tab for `host` and returns the assigned [`SessionId`].
    ///
    /// Returns immediately; the connection runs in a background task. Connection
    /// or auth errors surface later via `CoreEvent::Error` + `PtyExited`.
    ///
    /// # Errors
    /// Currently infallible, but kept fallible so the caller's error handling
    /// (and the public API) stays unchanged.
    pub fn open(
        &mut self,
        host: &Host,
        cols: u16,
        rows: u16,
        tx: mpsc::Sender<CoreEvent>,
    ) -> Result<SessionId> {
        let id = self.next_id;
        self.next_id += 1;
        let parser = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, 1000)));
        let (ctrl_tx, ctrl_rx) = mpsc::unbounded_channel();
        tokio::spawn(session_task(
            id,
            host.clone(),
            cols,
            rows,
            Arc::clone(&parser),
            ctrl_rx,
            tx,
            self.raw_output.clone(),
        ));
        self.sessions.push(PtySession {
            id,
            parser,
            ctrl_tx,
        });
        tracing::info!("terminal session {} opened for host '{}'", id, host.name);
        Ok(id)
    }

    /// Sends raw bytes to the session identified by `id`. Unknown id is a no-op.
    ///
    /// # Errors
    /// Infallible in practice; a dropped task is ignored like a closed session.
    pub fn write(&mut self, id: SessionId, data: &[u8]) -> Result<()> {
        if let Some(s) = self.sessions.iter().find(|s| s.id == id) {
            let _ = s.ctrl_tx.send(Ctrl::Input(data.to_vec()));
        }
        Ok(())
    }

    /// Forwards a resize to the session identified by `id`. No-op if not found.
    ///
    /// The vt100 parser is resized by the app layer; the task only relays
    /// `window_change` to the server.
    ///
    /// # Errors
    /// Infallible; kept fallible to preserve the public signature.
    pub fn resize(&mut self, id: SessionId, cols: u16, rows: u16) -> Result<()> {
        if let Some(s) = self.sessions.iter().find(|s| s.id == id) {
            let _ = s.ctrl_tx.send(Ctrl::Resize { cols, rows });
        }
        Ok(())
    }

    /// Closes and removes the session with the given `id`.
    pub fn close(&mut self, id: SessionId) {
        if let Some(pos) = self.sessions.iter().position(|s| s.id == id) {
            let s = self.sessions.remove(pos);
            let _ = s.ctrl_tx.send(Ctrl::Close);
            tracing::info!("terminal session {} closed", id);
        }
    }

    /// Gracefully shuts down all sessions.
    pub fn shutdown(self) {
        for s in self.sessions {
            let _ = s.ctrl_tx.send(Ctrl::Close);
        }
        // Dropping each ctrl_tx also ends its task as a backstop.
    }

    /// Returns the parser `Arc` for the session with the given `id`, if any.
    pub fn parser_for(&self, id: SessionId) -> Option<Arc<Mutex<vt100::Parser>>> {
        self.sessions
            .iter()
            .find(|s| s.id == id)
            .map(|s| Arc::clone(&s.parser))
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(chunks: &[&[u8]]) -> Option<Option<String>> {
        let mut line = PasswordLine::default();
        chunks.iter().find_map(|chunk| line.feed(chunk))
    }

    #[test]
    fn the_password_is_whatever_was_typed_before_enter() {
        assert_eq!(
            typed(&[b"se", b"cret\r"]),
            Some(Some(String::from("secret")))
        );
        assert_eq!(typed(&[b"secret\n"]), Some(Some(String::from("secret"))));
        assert_eq!(typed(&[b"\r"]), Some(Some(String::new())));
        assert_eq!(typed(&[b"secret"]), None, "not done before Enter");
    }

    #[test]
    fn the_prompt_edits_like_a_line() {
        assert_eq!(
            typed(&["pässw\x7fword\r".as_bytes()]),
            Some(Some(String::from("pässword")))
        );
        assert_eq!(
            typed(&["pä\x7f\x7fx\r".as_bytes()]),
            Some(Some(String::from("x"))),
            "backspace removes a whole character"
        );
        assert_eq!(
            typed(&[b"wrong\x15right\r"]),
            Some(Some(String::from("right")))
        );
    }

    #[test]
    fn escape_sequences_are_not_part_of_the_password() {
        // Arrow keys, an SS3 function key and bracketed-paste markers.
        let keys: &[u8] = b"\x1b[Ase\x1bOPcr\x1b[1;5Det\x1b[200~!\x1b[201~\r";
        assert_eq!(typed(&[keys]), Some(Some(String::from("secret!"))));
    }

    #[test]
    fn a_lone_escape_keeps_the_next_key() {
        assert_eq!(
            typed(&[b"\x1bsecret\r"]),
            Some(Some(String::from("secret")))
        );
    }

    #[test]
    fn ctrl_c_or_ctrl_d_on_an_empty_line_cancels() {
        assert_eq!(typed(&[b"secr\x03"]), Some(None));
        assert_eq!(typed(&[b"\x04"]), Some(None));
        assert_eq!(typed(&[b"a\x04b\r"]), Some(Some(String::from("ab"))));
    }

    #[test]
    fn nothing_after_enter_is_kept() {
        let mut line = PasswordLine::default();
        assert_eq!(
            line.feed(b"secret\rls -la\r"),
            Some(Some(String::from("secret")))
        );
    }

    fn dummy_tx() -> mpsc::Sender<CoreEvent> {
        mpsc::channel(1).0
    }

    #[test]
    fn default_construction_has_no_raw_tap() {
        // The TUI path must be byte-for-byte unchanged (tech-gui.md §3.6): the
        // additive sink is absent unless a GUI opts in via `with_raw_output`.
        assert!(PtyManager::new().raw_output.is_none());
        assert!(PtyManager::default().raw_output.is_none());
    }

    #[test]
    fn with_raw_output_installs_the_tap() {
        let (raw_tx, _raw_rx) = mpsc::channel::<(SessionId, Vec<u8>)>(1);
        assert!(PtyManager::with_raw_output(raw_tx).raw_output.is_some());
    }

    #[tokio::test]
    async fn open_assigns_incrementing_ids() {
        let mut mgr = PtyManager::new();
        let host = Host::default();
        let a = mgr.open(&host, 80, 24, dummy_tx()).unwrap();
        let b = mgr.open(&host, 80, 24, dummy_tx()).unwrap();
        assert_eq!((a, b), (1, 2));
        assert_eq!(mgr.sessions.len(), 2);
    }

    #[tokio::test]
    async fn close_removes_only_the_target() {
        let mut mgr = PtyManager::new();
        let host = Host::default();
        let a = mgr.open(&host, 80, 24, dummy_tx()).unwrap();
        let b = mgr.open(&host, 80, 24, dummy_tx()).unwrap();
        mgr.close(a);
        assert_eq!(mgr.sessions.len(), 1);
        assert_eq!(mgr.sessions[0].id, b);
    }

    #[tokio::test]
    async fn write_and_resize_unknown_id_are_noops() {
        let mut mgr = PtyManager::new();
        assert!(mgr.write(999, b"x").is_ok());
        assert!(mgr.resize(999, 80, 24).is_ok());
    }

    #[tokio::test]
    async fn parser_for_returns_open_session_only() {
        let mut mgr = PtyManager::new();
        let id = mgr.open(&Host::default(), 80, 24, dummy_tx()).unwrap();
        assert!(mgr.parser_for(id).is_some());
        assert!(mgr.parser_for(id + 1).is_none());
    }

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn is_utf8_locale_recognizes_common_forms() {
        assert!(is_utf8_locale("en_US.UTF-8"));
        assert!(is_utf8_locale("ru_RU.utf8"));
        assert!(is_utf8_locale("de_DE.UTF-8@euro"));
        assert!(!is_utf8_locale("C"));
        assert!(!is_utf8_locale("POSIX"));
        assert!(!is_utf8_locale("en_US.ISO8859-1"));
    }

    #[test]
    fn locale_env_defaults_ctype_to_utf8_when_no_locale_env() {
        // A process with no locale env (e.g. a GUI launched from Finder) still
        // gets a UTF-8 character type forwarded.
        let got = locale_env(env(&[("PATH", "/bin"), ("HOME", "/root")]));
        assert_eq!(got, env(&[("LC_CTYPE", "C.UTF-8")]));
    }

    #[test]
    fn locale_env_forces_utf8_when_lang_is_not_utf8() {
        let got = locale_env(env(&[("LANG", "C")]));
        assert!(got.contains(&("LANG".into(), "C".into())));
        assert!(got.contains(&("LC_CTYPE".into(), "C.UTF-8".into())));
    }

    #[test]
    fn locale_env_keeps_a_utf8_lang_and_adds_no_fallback() {
        // Regression guard: a working UTF-8 LANG must not be overridden by a
        // C.UTF-8 the server might not have.
        let got = locale_env(env(&[
            ("LANG", "ru_RU.UTF-8"),
            ("LC_MESSAGES", "ru_RU.UTF-8"),
        ]));
        assert!(got.contains(&("LANG".into(), "ru_RU.UTF-8".into())));
        assert!(got.iter().all(|(k, _)| k != "LC_CTYPE"));
    }

    #[test]
    fn locale_env_replaces_a_non_utf8_ctype_without_duplicating() {
        let got = locale_env(env(&[("LC_CTYPE", "C")]));
        assert_eq!(got, env(&[("LC_CTYPE", "C.UTF-8")]));
    }

    #[test]
    fn locale_env_respects_an_explicit_utf8_ctype() {
        let got = locale_env(env(&[("LC_CTYPE", "ru_RU.UTF-8")]));
        assert_eq!(got, env(&[("LC_CTYPE", "ru_RU.UTF-8")]));
    }

    #[test]
    fn locale_env_respects_lc_all() {
        // LC_ALL overrides every category, so leave the explicit choice untouched.
        let got = locale_env(env(&[("LC_ALL", "C")]));
        assert_eq!(got, env(&[("LC_ALL", "C")]));
    }
}
