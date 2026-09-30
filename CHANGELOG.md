# Changelog

All notable changes to OmnySSH are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## 1.1.5 — 2026-09-28

### 同步官方更新 (Sync with Upstream v1.1.4 & Latest Main)
- **端口转发与 SSH 隧道 (Port Forwarding, like `ssh -L`)**：
  - 支持在主机编辑页面或 `~/.ssh/config` 中配置本地端口转发（`LocalForward`）。
  - 可在仪表盘卡片或终端中随时一键启停 SSH 隧道，断线具备自动重连机制。
- **登录密码与密钥 Passphrase 解锁弹窗**：
  - 加密密钥（Passphrase）和需要密码登录的主机现在提供图形化弹窗提示输入，密码仅保留在内存中，不落盘。
  - 自动识别 keyboard-interactive 验证，支持 UniFi 等特殊设备。
- **系统托盘支持 (System Tray)**：
  - 桌面客户端支持最小化或关闭至系统托盘，后台保持终端、文件传输和 SSH 隧道持续运行。
- **终端体验优化**：
  - Windows / Linux 桌面终端支持 `Ctrl+Shift+C` 快捷复制。
  - 支持 SSH 代理转发（SSH Agent Forwarding，类似 `ssh -A`）。
  - 终端退出或断开后保持标签页开启并显示原因（`[Connection closed. Press Enter to close this tab.]`），避免闪退。
- **连接兼容性与算法升级**：
  - 底层 SSH 引擎升级至 `russh 0.63`，支持 NIST 椭圆曲线密钥交换（ecdh-sha2-nistp256/384/521）、aes128-gcm 及 ECDSA P-384 主机密钥，全面兼容 Cisco RoomOS 等视频与网络设备。
  - 精准提示协商失败的具体算法类型。
  - macOS 本地网络访问权限检测与提示。
  - Windows 系统共享 `%USERPROFILE%\.ssh\known_hosts`。

### 新特性与交互优化 (Features & Usability)
- **SFTP 本地目录优化与常用位置快捷跳转**：
  - 本地文件传输初始默认路径优先改为**桌面（Desktop）**，告别默认繁琐的主目录路径（无桌面环境时自动回退）。
  - 新增交互式**可编辑地址栏**：点击路径栏即可手动输入或粘贴任意本地/远程路径（支持按回车键直接跳转），彻底解决路径无法直接输入或修改的问题。
  - 新增跨平台**常用位置快捷按钮**（桌面、下载、文档、主目录、根目录等），采用扁平圆角胶囊设计，并根据当前所处目录高亮指示，一键瞬时直达。
  - **智能隐藏 Windows 快捷方式 (.lnk)**：针对 Windows 系统桌面常有大量 `.lnk` 文件挤占视线的问题，默认自动过滤隐藏 `.lnk` 快捷方式文件，工具栏提供一键切换按钮及数量徽标，既保持目录整洁又可随时切换查看。
  - 输入体验优化：支持 `~` 自动展开为主目录，Windows 下输入盘符（如 `D:`）自动补全根路径 `D:\`。
  - Windows 本地文件面板支持盘符切换器，终端按 `d` 切换驱动器。
- **支持一键「恢复密码登录」功能**：
  - 在主机卡片操作区中新增「恢复密码登录」按钮，点击后弹出统一风格的确认弹窗。
  - 安全将远程服务器 SSH 的 `PasswordAuthentication` 恢复为 `yes`，并同步更新 `UsePAM`、`ChallengeResponseAuthentication` 及 `KbdInteractiveAuthentication`。
  - 自动解除 `#Include /etc/ssh/sshd_config.d/` 注释，并深度兼容 `/etc/ssh/sshd_config.d/*.conf`（如 cloud-init 配置）。
  - 执行前自动创建带时间戳的配置文件备份，并在修改后使用 `sudo sshd -t` 进行严格语法检验，检验失败自动秒级回滚，成功后再重载（reload）SSH 服务。
  - 完整保留现有 SSH 密钥与 `~/.ssh/authorized_keys`，绝不影响公钥登录。

### 基础设施与自动化修复 (Improvements & Fixes)
- 修复 `bindings.ts` 跨平台换行符（CRLF/LF）导致的 TypeScript 绑定一致性校验漂移问题。
- 优化定时同步工作流，拉取上游仓库时禁用标签覆盖选项，避免本地版本发布 Tag 冲突导致自动同步失败。
- 优化 `.gitignore`，补充过滤本地开发临时目录。

---

## 1.1.4 — 2026-09-28 (Upstream)

### Bug Fixes
- **macOS: the app from the `.dmg` opens instead of being "damaged".**
- **A changed host key says so, and names the file to fix.**
- **Windows: host keys are kept in `%USERPROFILE%\.ssh\known_hosts`, shared with OpenSSH.**
- **Host keys are matched the way `ssh` matches them.**
- **The local file pane can switch drives (Windows).**
- **Hosts with an `IdentityFile` log in with that key first, however many keys the SSH agent holds.**

---

## 1.1.3 — 2026-09-27 (Upstream)

### Features
- **Forward local ports over SSH, like `ssh -L`.**
- **OmnySSH asks for the login password when no key gets in.**
- **Copy from the desktop terminal with Ctrl+Shift+C.**
- **Forward your SSH agent to a host, like `ssh -A`.**
- **Minimize or close the desktop app to the system tray.**

### Bug Fixes
- **Ctrl keys work in the desktop terminal on a non-Latin keyboard layout (Linux).**
- **Devices that only take the password by keyboard-interactive log in.**
- **A silent or refusing SSH agent no longer leaves every host stuck on "connecting".**
- **The dashboard card says why a host is down.**
- **`omny -v` no longer writes login passwords to its log.**
- **Settings under a `Match` block in `~/.ssh/config` no longer land on the host above it.**
- **The Linux AppImage opens on current graphics drivers.**
- **Keys with a passphrase work.**

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
- **Windows: the desktop app no longer opens a console window next to itself.**
- **No more white flash when the desktop app launches.**

---

## 1.1.0 — 2026-07-24

### Features
- **OmnySSH Desktop — a new native GUI app.**
- **File manager hidden-file toggle (`.`)**: show or hide dot-prefixed entries (hidden by default).
- **Nerd Font file icons in the file manager**: per-type glyphs replace the `[DIR]`/`[   ]` markers.

### Changed
- **Terminal next-tab moved from `Tab` to `Ctrl+N`**.
- **File manager `h`/`Left` now navigates to the parent directory**.

### Bug Fixes
- **The terminal now handles Cyrillic and other multibyte text.**

### Packaging
- **Release builds now ship the GUI.**
- **`install.sh` can install the GUI, the TUI, or both**.

---

## 1.0.5 — 2026-06-07

### Bug Fixes
- **docs.rs documentation build fixed**.

---

## 1.0.4 — 2026-05-29

### Features
- **Terminal now uses the native russh client (fixes the dead Windows terminal)**.

---

## 1.0.3 — 2026-05-21

### Features
- **Termux / Android support**.

---

## 1.0.2 — 2026-05-16

### Features
- **Automatic update checks**.
- **In-app self-update**.
- **Top processes on the detail page**.

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
