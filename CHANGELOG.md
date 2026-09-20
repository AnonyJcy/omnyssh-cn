# Changelog

All notable changes to OmnySSH are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## 1.1.5 — 2026-09-15

### 新特性与交互优化 (Features & Usability)
- **SFTP 本地目录优化与常用位置快捷跳转**：
  - 本地文件传输初始默认路径优先改为**桌面（Desktop）**，告别默认繁琐的主目录路径（无桌面环境时自动回退）。
  - 新增交互式**可编辑地址栏**：点击路径栏即可手动输入或粘贴任意本地/远程路径（支持按回车键直接跳转），彻底解决路径无法直接输入或修改的问题。
  - 新增跨平台**常用位置快捷按钮**（桌面、下载、文档、主目录、根目录等），采用扁平圆角胶囊设计，并根据当前所处目录高亮指示，一键瞬时直达。
  - 输入体验优化：支持 `~` 自动展开为主目录，Windows 下输入盘符（如 `D:`）自动补全根路径 `D:\`。

### 基础设施与自动化修复 (Improvements & Fixes)
- 修复 `bindings.ts` 跨平台换行符（CRLF/LF）导致的 TypeScript 绑定一致性校验漂移问题。
- 优化定时同步工作流，拉取上游仓库时禁用标签覆盖选项，避免本地版本发布 Tag 冲突导致自动同步失败。
- 优化 `.gitignore`，补充过滤本地开发临时目录。

---

## 1.1.4 — 2026-08-28

### 新特性 (Features)
- **支持一键「恢复密码登录」功能**：
  - 在主机卡片操作区中新增「恢复密码登录」按钮，点击后弹出统一风格的确认弹窗。
  - 安全将远程服务器 SSH 的 `PasswordAuthentication` 恢复为 `yes`，并同步更新 `UsePAM`、`ChallengeResponseAuthentication` 及 `KbdInteractiveAuthentication`。
  - 自动解除 `#Include /etc/ssh/sshd_config.d/` 注释，并深度兼容 `/etc/ssh/sshd_config.d/*.conf`（如 cloud-init 配置）。
  - 执行前自动创建带时间戳的配置文件备份，并在修改后使用 `sudo sshd -t` 进行严格语法检验，检验失败自动秒级回滚，成功后再重载（reload）SSH 服务。
  - 完整保留现有 SSH 密钥与 `~/.ssh/authorized_keys`，绝不影响公钥登录。

---

## 1.1.3 — 2026-08-24

### 问题修复 (Bug Fixes)
- **修复桌面端 Star / GitHub 仓库链接无法在外部浏览器打开的问题**：补充了 Tauri v2 安全权限配置中的外部 URL 白名单，修复了点击弹窗支持链接时被拦截并报错 `Not allowed to open url` 的问题。
- **完善主播 / 隐私模式（Streamer Mode）脱敏逻辑**：
  - 开启隐私模式后，公网 IP 与主机地址统一安全脱敏为 `127.0.0.1`（IPv6 脱敏为 `::1`）。
  - 登录用户名统一安全脱敏为 `admin`。
  - 修复了此前主机卡片标题、快捷搜索（⌘K）、脚本运行器、侧边栏及 SFTP 面板等区域在特定情况下仍暴露真实 IP 和用户名的问题。
  - 底部状态栏增加“主播模式已开启 —— 主机名已脱敏”状态提示。

---

## 1.1.2 — 2026-08-22

### 新特性 (Features)
- **从 `~/.ssh/config` 导入的主机支持在桌面端直接编辑**：此前导入的主机为只读状态，修改端口或用户名必须手动去编辑 SSH 配置文件。现在编辑导入的主机时会将其保存为本地独立副本，后续由 OmnySSH 统一管理，绝不会修改原 `~/.ssh/config` 文件。原配置解析出的跳板机（Bastion）和密钥路径会被无缝保留（即使表单未完全显示），确保通过 `ProxyJump` 的主机能继续连通。删除操作仅针对自建副本，删除后会自动还原为只读的导入状态。
- **支持仅通过 TCP 端口健康检查（无需 SSH 登录）**：对于防火墙、交换机等仅开放 SSH 端口但无法执行 `top` / `free` 命令的网络设备，此前监控会频繁因超时报错并反复重连。现在可为设备配置 **TCP 端口检查** 模式：仅建立 TCP 连接并立即关闭，无需登录即可判定主机的在线/离线状态。可在主机编辑表单中选择 TCP 端口模式。

### 问题修复 (Bug Fixes)
- **桌面端下拉菜单样式与应用主题统一**：重构了主机表单与代码片段表单中的下拉选择控件，剥离各系统原生控件的生硬外观，完美匹配深色与浅色主题，且完全保留键盘和无障碍支持。
- **完美渲染 Nerd Font 图标字符，告别方框乱码**：在字体栈中添加了主流 Nerd Font 作为后备回退字体（Fallback），修复了 Starship、Powerlevel10k、`eza --icons` 等终端提示符图标显示为方框的问题；命令片段输出和 SFTP 文件预览也同步支持。
- **桌面客户端记住上次关闭时的窗口大小与位置**：修复了每次启动窗口被重置为 1100x720 的问题，现在可记住多显示器与自定义窗口尺寸及坐标。
- **macOS：窗口控制按钮不再遮挡折叠后的侧边栏边缘**：微调了 macOS 侧边栏折叠宽度，确保红黄绿三色窗口控制按钮完全容纳在侧边栏内部，不遮挡主视图。
- **支持通过 `Include` 拆分的 SSH 配置文件**：修复了 `Include conf.d/*.conf` 相对路径因启动工作目录不同而解析失败的问题，并完善了 Glob 通配符（`?`、`[abc]`、多星号）、单行多路径与带空格路径的支持。
- **修复非英语系统 VPS 空闲 CPU 显示为 91~100% 的误报问题**：针对部分欧洲语言系统中 `top` 命令使用逗号作为小数点导致空闲率解析错误的问题，固定了监控命令的语言环境并增加了对小数点逗号的兼容。
- **修复网络设备每隔 30 秒频繁反复登录的问题**：修正了对无法执行 Shell 命令的设备的退避重试算法与保活机制，避免频繁发起无意义的连接。
- **`ProxyJump` 跳板机链路原生穿透**：修复了此前通过跳板机连接的主机在终端、SFTP、命令片段和密钥配置中直连目标 IP 的问题，现已如同 `ssh -J` 一样依次建立跳板隧道，完整支持多跳、别名解析及 IPv6。
- **Windows：彻底修复 1.1.1 遗留的控制台黑框问题**：确保编译产物完全以 Windows GUI 子系统模式运行，启动软件或生成 SSH 密钥时不再闪烁弹出 CMD 控制台黑框。
- **更新横幅点击直接跳转至 Release 页面**：点击“更新”将直接在默认浏览器中打开下载页面。
- **Linux：白屏/黑屏时自动以软件渲染模式重启一次**：在特定显卡/驱动硬件加速失败时，若 12 秒内未完成渲染，自动切换至软件渲染模式重启，解决黑屏问题。
- **编辑主机配置不再中断其他主机的实时监控会话**：优化了监控会话池机制，仅在修改了 IP、端口、用户名、密钥等关键连接参数时才重启对应会话。
- **macOS：修复 `install.sh` 脚本覆盖安装老版本的问题**。
- **Linux：修复 `.deb` 依赖失败却误报安装成功的问题**，并在安装 `.deb` 时自动清理旧的 AppImage 冲突副本。
- **ARM64 Linux 与 Termux 自动安装终端版 (TUI)**：在没有桌面端的架构上自动降级安装终端版，避免报错退出。

### 打包与分发 (Packaging)
- **新增 Fedora / RHEL 生态原生 `.rpm` 安装包**：支持通过 `dnf` 一键安装与卸载。
- **Linux 系统包名标准化为 `omny-ssh`**。

---

## 1.1.1 — 2026-07-28

### Bug Fixes
- **Windows: the desktop app no longer opens a console window next to itself.** The GUI was linked as a console application, so Windows gave it a terminal and kept it on screen for the whole session. Release builds now link as a GUI binary. The same fix would have made one-click SSH key setup flash a console of its own while `ssh-keygen` runs, so that is suppressed too. macOS and Linux were never affected.
- **No more white flash when the desktop app launches.** The window used to appear before the webview had painted anything, so the first frame was blank white before the dark (or light) interface took over. The window is now created hidden and revealed once the page is up, with a fallback that shows it anyway if the interface is slow to load.

---

## 1.1.0 — 2026-07-24

### Features
- **OmnySSH Desktop — a new native GUI app.** A desktop application built on the same engine as the TUI, sharing your `hosts.toml` and `snippets.toml`. It bundles a live metrics dashboard, a multi-session terminal, an SFTP file manager, command snippets, host management, one-click SSH key setup, a command palette, and light/dark themes. Distributed as native installers (macOS `.dmg`, Linux `.AppImage`/`.deb`, Windows `.exe`). The TUI is unchanged and still installs the same ways. macOS builds are unsigned — on first launch right-click the app and choose **Open** (or install via `install.sh`, which sidesteps the Gatekeeper prompt).
- **File manager hidden-file toggle (`.`)**: show or hide dot-prefixed entries (hidden by default). The `..` parent entry is always shown.
- **Nerd Font file icons in the file manager**: per-type glyphs replace the `[DIR]`/`[   ]` markers. Requires a Nerd Font — without one the glyphs render as empty boxes.

### Changed
- **Terminal next-tab moved from `Tab` to `Ctrl+N`**, freeing `Tab` for the shell's own completion inside the embedded terminal.
- **File manager `h`/`Left` now navigates to the parent directory** (previously moved the cursor up), matching `ranger`/`lf`/`nnn`/`vifm`. Returning to a parent places the cursor on the directory just left.

### Bug Fixes
- **The terminal now handles Cyrillic and other multibyte text.** OmnySSH forwards a UTF-8 locale (and the `IUTF8` PTY mode) to the remote shell, mirroring a normal ssh client's `SendEnv LANG LC_*`. Previously the session could fall back to a single-byte locale, so line editing corrupted the prompt on Cyrillic input and editors like `vim` rendered mojibake (plain `cat` was fine). Applies to both the TUI and GUI terminals. Best-effort — servers that don't accept forwarded env vars are unaffected.

### Packaging
- **Release builds now ship the GUI.** CI bundles native desktop installers for macOS (arm64 + x86_64), Linux x86_64 (`.AppImage` + `.deb`), and Windows x86_64, attached to each GitHub Release alongside the TUI archives and covered by `SHA256SUMS`.
- **`install.sh` can install the GUI, the TUI, or both** via `--gui` / `--tui` / `--both` (or `OMNYSSH_INSTALL=…`); it prompts when run interactively and defaults to the GUI (the flagship app) for piped `curl | sh`.

### Documentation
- **CONTRIBUTING** now documents the `omnyssh-gui` crate and how to build/test the GUI with the Node/Tauri toolchain.
- Documented the Auto SSH Key Setup feature (`Shift+K`): added a README Features entry, a Quick Start key reference, and a Help popup shortcut. The feature already existed but was undiscoverable.
- README "Development Roadmap" now lists the current `1.1.0` release (and `1.0.5`); it previously stopped at `1.0.4`.
- Removed the dead `connect` keybinding from the `config.toml` example and the `[keybindings]` config struct. Enter-to-connect was always hard-coded, so the field never had any effect.

### Internal
- **Repository converted to a cargo workspace; the engine now lives in its own crate**: The SSH engine, host/snippet/app configuration, metrics parsers, domain events, and the self-updater moved into the new `omnyssh-core` library crate (`crates/omnyssh-core`), which has no dependency on terminal-UI or CLI crates. The TUI application keeps the `omnyssh` package name and the `omny` binary (`crates/omnyssh`) and consumes the core as a regular dependency. This prepares the architecture for additional frontends (e.g. a GUI) without duplicating the engine.
  - The event bus is split: background tasks emit `CoreEvent` values; the TUI wraps them into its own `AppEvent` stream alongside input events.
  - `threshold_color` was replaced by a UI-agnostic `ThresholdLevel` in the core; the colour mapping moved to the TUI theme module.
  - Keybinding parsing (config strings → key codes) and PTY key-to-bytes translation moved from the engine into the TUI crate; the core PTY API accepts raw bytes only.
  - Removed the unused `nucleo` dependency.
  - No user-facing changes: behavior, appearance, the binary name, and install paths are unchanged.
- **Removed leftover Alerts/Deep Probe remnants**: Deleted the unused `[smart_context]` config (`SmartContextConfig` was parsed but never read) and reworded stale "Deep Probe" comments left after the subsystem was removed in 1.0.5. No user-facing change — existing config files containing a `[smart_context]` section still load, as the section is ignored.

---

## 1.0.5 — 2026-06-07

### Bug Fixes
- **docs.rs documentation build fixed**: The build script wrote the generated man page into the source tree (`doc/omny.1`), which fails on docs.rs because it mounts the sources read-only. The man page is now skipped when building on docs.rs (detected via the `DOCS_RS` environment variable); normal builds still generate and check it in as before.

### Internal
- **Dead-code cleanup**: Removed the unimplemented Alerts/Deep Probe subsystem (backend and UI) and a range of unused items — enum variants, struct fields, helpers, and theme colors. No user-facing behavior changes: METRICS and SERVICES on the detail page, the file manager, and the terminal work as before. The crate-level `#![allow(dead_code)]` was dropped so the compiler now catches dead code on its own.

---

## 1.0.4 — 2026-05-29

### Features
- **Terminal now uses the native russh client (fixes the dead Windows terminal)**: The interactive terminal no longer spawns the system `ssh` binary inside a local pseudo-console (ConPTY on Windows). It now runs over the same pure-Rust russh client as metrics and SFTP, so the terminal works identically on every OS — the blank, unresponsive Terminal tab on Windows is fixed. The terminal reuses the app's existing key, SSH agent, password, and `known_hosts` (trust-on-first-use) authentication, so password-auth hosts still connect without prompting and the separate `SSH_ASKPASS` helper has been removed.
  - ProxyJump (`-J`) is not yet supported in the terminal and is refused with a clear message instead of connecting direct; metrics/SFTP never used it. Tracked as a follow-up.
  - Passphrase-protected keys without an SSH agent cannot be unlocked interactively in the terminal anymore. Use an SSH agent or an unencrypted key. On Windows there is no agent fallback yet, so prefer an unencrypted key there.
  - The terminal no longer reads `~/.ssh/config` directly, so exotic directives such as `ProxyCommand` no longer apply (the parsed HostName/User/Port/IdentityFile/ProxyJump still do). This makes the terminal consistent with the rest of the app.

### Security
- Validate public-key format and reject control characters before embedding keys in remote shell commands.
- Sanitize `sshd_config` directive edits and scope the disabled `Include` to the cloud-init drop-in only.
- Store `config.toml`, `hosts.toml`, and `snippets.toml` with `0600` permissions, and remove temp files left by a failed save.
- Reject `..` traversal and null bytes in SFTP upload/download paths.
- Pin all GitHub Actions to commit SHAs and verify release archives against `SHA256SUMS` in `install.sh` (with a `shasum` fallback on macOS).

### Bug Fixes
- **Log files no longer fill the disk**: On startup OmnySSH now prunes rolling log files older than 7 days from its config directory. The cleanup is best-effort and never blocks startup, works on every platform via the native config path, and only touches `omnyssh.log*` files — `config.toml`, `hosts.toml`, and `snippets.toml` are left untouched.
- **Man page now installs reliably**: `install.sh` failed to install the man page into the system directory (e.g. `/usr/local/share/man` on macOS) because it never elevated with `sudo`, so `man omny` reported "No manual entry". The man page is now downloaded to a temp file first and installed with a `sudo` fallback, mirroring the binary install.
- **Remote command exit status is no longer lost** when it arrives after EOF.
- **Multi-file deletes fixed**: all in-flight remote deletes are tracked before the panel refreshes, and every error from a multi-file local delete is reported.
- **Terminal is always restored on exit**, even if an earlier teardown step fails.
- **Docker view scales to many containers**: `docker inspect` is batched to stay under `ARG_MAX`.

### Documentation
- Fixed inaccurate docs: `--verbose` now correctly states logs are written to a log file (not stderr) in `--help`, the man page, and the README; `install.sh` prints the OS-specific config directory; corrected the horizontal split keybinding in the changelog (`Ctrl+]`, not `Ctrl+-`).
- More inaccurate docs corrected: `--theme` is now documented as persisting your choice to `config.toml` (it always wrote the config back, but the README called it temporary); the `[ui]` config example no longer lists `show_ip`, `show_uptime`, `card_layout`, and `border_style`, which are parsed for forward compatibility but not yet wired to the renderer; and the "static binary" wording was corrected since the x86_64 Linux and macOS builds are not statically linked.

### Other
- Removed the vestigial empty `package.json` and `package-lock.json` (left over from an earlier project name); they served no purpose in this Rust project.
- Removed the unused `config/default.toml` template — it was never read by the app, and the README already carries the canonical config example.
- CI now fails if the committed `doc/omny.1` man page drifts from `src/cli.rs`, so the generated man page can no longer go stale.
- Removed dead code with no effect on runtime behaviour: unused functions with no callers (`Screen::title`, `Host::id`, `key_path_for_host`, the superseded `host_list` render path, and two unused popup renderers), plus three methods that were only reachable from their own tests (`FileManagerPanel::clamp_scroll`, `ProbeOutput::section_names`, `KeySetupMachine::password_disabled`) and those tests.
- Made the `sshd` rollback backup lookup portable so it also works on BusyBox/Alpine hosts.

---

## 1.0.3 — 2026-05-21

### Features
- **Termux / Android support**: Releases now include a statically linked `aarch64-unknown-linux-musl` build that runs on Termux. `install.sh` detects Termux via `$TERMUX_VERSION` / `$PREFIX` and installs the binary into `$PREFIX/bin` (and the man page into `$PREFIX/share/man/man1`) without `sudo`.

---

## 1.0.2 — 2026-05-16

### Features
- **Automatic update checks**: On startup OmnySSH checks GitHub Releases for a newer version and shows a popup when one is available. You can install the update, skip that version, or disable checks entirely. Failed or offline checks are silent and never delay startup.
- **In-app self-update**: For manual / `install.sh` installs on Linux and macOS, an update can be downloaded and installed from within the app — the release archive is verified against its SHA-256 checksum before the binary is replaced. Homebrew, Cargo, and Nix installs instead show the matching upgrade command.
- **Top processes on the detail page**: The server detail view now shows the three busiest processes by CPU usage, along with their CPU and memory percentages.

### Bug Fixes
- **Windows double input fixed**: Each keystroke is now registered once instead of twice (e.g. "j" no longer produced "jj"). Key-release events reported by the Windows console are no longer treated as input.
- **Ubuntu 22.04 compatibility**: Linux release binaries are now built against an older glibc, fixing the `version 'GLIBC_2.39' not found` error when running on Ubuntu 22.04 and similarly aged distributions.
- **Mouse scroll inside full-screen apps fixed**: On the Terminal screen, the mouse wheel now scrolls inside `vim`, `less`, `htop`, and other alternate-screen apps. The wheel is forwarded to the foreground application — as native mouse-wheel events when it enabled mouse reporting, or as cursor-key presses otherwise. The normal screen still scrolls local scrollback.
- **Multi-line paste into the terminal fixed**: Bracketed paste is now implemented. Pasting multi-line text into the Terminal screen no longer drops the first characters, and editors like `vim` insert it verbatim without cascading auto-indent.
- **Top processes exclude OmnySSH's own connection**: The detail-page top-processes panel no longer lists OmnySSH's metric-polling SSH connection. Its `sshd` process chain is filtered out by PID, so an idle server shows real workload while SSH sessions from other users still appear.
- **Bracketed paste restored after system SSH**: Connecting to a host via the system `ssh` binary no longer leaves bracketed paste disabled on return, so multi-line paste into the terminal keeps working.
- **Host keys are now verified**: A server's host key is recorded in `~/.ssh/known_hosts` on first connection (trust on first use). A later key change — or an unreadable `known_hosts` — refuses the connection instead of silently accepting an unverified key.
- **Password authentication reliably disabled**: Auto SSH Key Setup now adds the `PasswordAuthentication`, `UsePAM`, and challenge/keyboard-interactive directives when `sshd_config` omits them, so password login is disabled even on configs that previously relied on compiled-in defaults.
- **System SSH launch failure no longer quits the app**: If the `ssh` binary cannot be started, OmnySSH restores the TUI and reports the error in the status bar instead of exiting.
- **Remote command exit status honoured**: SSH command execution now exposes a non-zero remote exit status; the key-setup sudo check uses it to detect missing sudo access correctly.

### Other
- Release archives are now published alongside a `SHA256SUMS` checksum file.
- **Internal refactor**: The oversized `app.rs` was split into focused submodules under `src/app/` (host, snippets, file manager, terminal, update, input, and action dispatch). This is a pure code reorganization with no change in behaviour.
- **Test coverage**: Added unit tests for previously untested core logic — snippet parameter substitution, host/snippet form validation, the SSH-config/manual host merge, `hosts.toml` serialization, form-field UTF-8 editing, host/snippet filtering and sorting, file-panel selection, and terminal pane state.

---

## 1.0.1 — 2026-04-22

### Bug Fixes
- **TUI display corruption fixed**: Log output no longer bleeds through the TUI interface. All logging is now redirected to a log file (`~/.config/omnyssh/omnyssh.log` on Linux, `~/Library/Application Support/omnyssh/omnyssh.log.*` on macOS) instead of stderr, preventing raw error messages (such as SSH timeout warnings) from corrupting the terminal display during background operations.
- **Error notifications**: Connection failures, discovery timeouts, and snippet execution errors are now displayed as concise notifications in the status bar instead of being silently logged.
- **SFTP connection freeze fixed**: SFTP connections now run in the background with a 30-second timeout, preventing the UI from freezing indefinitely when connecting to slow or unresponsive servers. A "Connecting… (30s timeout)" indicator is displayed during the connection attempt.
- **Terminal scroll fixed**: Two-finger trackpad and mouse-wheel scroll on the Terminal screen now scrolls local scrollback instead of cycling the remote shell's command history. Previously, mouse capture was disabled on the Terminal screen to allow native mouse text selection, which caused host terminal emulators to translate scroll gestures into ArrowUp/ArrowDown keys that bash readline interpreted as history navigation. Mouse capture is now kept on across all screens.
- **Native drag-to-select preserved**: Mouse capture now enables only button and scroll-wheel reporting (`?1000h` + `?1006h`), dropping the aggressive any-motion tracking (`?1002h` / `?1003h`) that crossterm enables by default. In terminals that honor the modifier-bypass for mouse reporting (iTerm2 on macOS, most Linux terminals), hold `Option` (iTerm2) or `Shift` (Linux) while dragging to select and copy text in the Terminal screen without the application intercepting the drag. Note: macOS Terminal.app does not support modifier-bypass for mouse reporting at all — users on Terminal.app should switch to iTerm2 or a similar emulator for in-app text selection.

---

## 1.0.0 — 2026-04-18

First production-ready release of OmnySSH.

### Features

#### Dashboard
- Server cards with live **CPU / RAM / Disk** metrics, uptime, and load average
- Colour-coded thresholds: 🟢 < 60%, 🟡 60–85%, 🔴 > 85%
- Async metrics collection — each host polled independently via SSH
- Cross-platform parsers: Linux (`top`/`free`/`/proc/stat`), macOS (`vm_stat`), Alpine BusyBox
- Configurable poll interval (default 30 s) with exponential backoff on failure
- Sort by name / CPU / RAM / status (`s`)
- Filter by tag (`t`)
- Manual refresh (`r`)
- Connection status indicator: `●` online, `◐` connecting, `✗` failed
- Connection pool: one SSH connection per host, reused for all metrics

#### Host management
- Host list with instant fuzzy search (`/`)
- Automatic import from `~/.ssh/config` (Host, HostName, User, Port, IdentityFile, ProxyJump, Include)
- Add / Edit / Delete hosts via TUI forms
- Tags and notes for each host
- Persistence in `~/.config/omnyssh/hosts.toml` — original `~/.ssh/config` is never modified
- Delete confirmation popup

#### File Manager (SFTP)
- Split-panel browser: local files ↔ remote SFTP
- Directory navigation with `h/j/k/l` and arrow keys
- File operations: upload, download, delete, mkdir, rename
- Progress bar with percentage for transfers
- Multiple file selection with `Space`
- Copy (`c`) / Paste (`p`) across panels
- Plain-text file preview
- Host-picker popup for remote panel

#### Snippets
- Save, edit, and delete global and host-scoped command snippets
- Parameterised snippets with `{{placeholder}}` syntax
- Quick-execute (`x`): run ad-hoc commands from the Dashboard
- Broadcast mode (`b`): execute on multiple hosts in parallel
- Fuzzy search on the Snippets screen
- Persistence in `~/.config/omnyssh/snippets.toml`

#### Multi-session terminal
- PTY-backed terminal with tabs (`Ctrl+T` / `Ctrl+W`)
- Split-view: `Ctrl+\` vertical, `Ctrl+]` horizontal
- Tab navigation with `Ctrl+Right` / `Ctrl+Left`
- Activity indicator on tabs with unseen output
- Full VT100 terminal emulation (`portable-pty` + `vt100`)
- Non-blocking render — terminal never freezes the UI

#### Themes & Configuration
- 4 built-in colour themes: `default`, `dracula`, `nord`, `gruvbox`
- `--theme <THEME>` CLI flag to override theme at runtime: `omny --theme dracula`
- Fully configurable keybindings via `[keybindings]` in config
- `--config <FILE>` flag to load a custom config
- `--help` / `--version` flags

#### General
- Cross-platform: Linux, macOS, Windows (single static binary)
- Panic hook that restores the terminal before printing backtrace
- `russh`-based async SSH client (no external `ssh` binary dependency for metrics)
- CI: GitHub Actions matrix for Ubuntu, macOS, Windows

---

## Development history

| Date | Version | Milestone |
|------|---------|-----------|
| 2026-04-04 | `0.0.1` | Project skeleton — TUI shell, event loop, placeholder screens |
| 2026-04-05 | `0.1.0` | Host list, SSH connect, fuzzy search — first MVP |
| 2026-04-06 | `0.2.0` | Live metrics dashboard with async polling |
| 2026-04-07 | `0.3.0` | Command snippets, quick-execute, broadcast |
| 2026-04-08 | `0.4.0` | SFTP file manager with split-panel UI |
| 2026-04-09 | `0.5.0` | Multi-session PTY tabs and split-view |
| 2026-04-10 | **`1.0.0`** | **Themes, configurable keybindings, production release** |
