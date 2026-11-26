# Changelog

All notable changes to OmnySSH are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/).

---

## 1.1.11 — 2026-11-27

### 最后一个版本：项目迁移至 KoraSSH

- **项目已升级为独立品牌 [KoraSSH](https://github.com/AnonyJcy/korassh)**，本仓库自本版本起停止更新。
- **更新检查指向 KoraSSH**：终端版与桌面端的更新检查改为查询 `AnonyJcy/korassh` 的最新发行版。本版本不再提供原地自更新（`can_self_update = false`），更新横幅与终端版提示会引导前往 KoraSSH 的发布页下载安装。
- **配置无缝迁移**：KoraSSH 首次启动会自动复制本版本的 `hosts.toml` / `snippets.toml` / `config.toml` 与桌面端偏好设置，并将明文密码升级为 AES-256-GCM 加密存储。
- README 顶部新增迁移公告。

---

## 1.1.10 — 2026-11-26

### 新增特性与功能改进
- **全平台安装包瘦身，鸿蒙黑体改为按需检测/在线加载**：
  - 移除随前端打包静态内嵌的 `@luzixu/harmonyos-sans`（约 14 MB 字体切片），全平台二进制与安装包体积大幅缩减回 ~5 MB。
  - 默认界面字体使用原生系统字体（零额外网络请求）；在「设置 → 外观」选择 **鸿蒙黑体** 时，会先检测本机是否已安装 `HarmonyOS Sans` / `HarmonyOS Sans SC`，未安装再通过多 CDN 镜像按需加载当前字符集并缓存，断网或不可达时自动平滑回退系统字体并支持手动重试。
- **修复设置页分段控件折行与预览框渲染问题**：
  - 将「界面字体」「终端字体」和「鼠标右键操作」调整为「上文描述 + 下方整行单排胶囊控件」布局，彻底解决控件在常规或窄窗口下折行错位的问题。
  - 修复字体预览框背景透明度修饰符被忽略导致无底框的问题，增加清晰边框与底色。
- **修复 Windows 安装程序默认弹出英文选择框的问题**：
  - 将 Windows NSIS 配置调整为仅内置 `SimpChinese`（关闭 `displayLanguageSelector`），彻底消除英文语言选择弹窗及跨语言系统上的英文回退，双击打开即直接进入纯简体中文安装与卸载向导。

---

## 1.1.9 — 2026-11-25

### 新增特性与功能改进
- **修复并增强 Windows 下的刷新体验**：
  - **拦截浏览器刷新快捷键**：拦截桌面端 WebView2 默认的 `F5` / `Ctrl+R`（macOS 为 `⌘R`）整页刷新行为，避免误触导致所有已打开终端和 SFTP 标签页丢失，改为安全执行应用内视图刷新；同时完整保留终端内部 `Ctrl+R` 反向搜索历史（reverse-i-search）功能。
  - **失败主机点击即重连**：在仪表盘点击刷新按钮或按下 `R` / `F5` / `Ctrl+R` 时，若存在处于连接失败或未知状态的主机（此前会卡在退避等待中），将自动重载配置并立即触发重连；当所有主机均在线时则轻量触发即时指标采集而不中断现有会话；按住 `Shift` 点击或按 `Shift+F5` / `Ctrl+Shift+R` 可随时强制重载 SSH 配置。
  - **核心轮询区分定时与手动刷新**：在后端核心轮询与 TUI 端区分 `Scheduled` 与 `Manual` 刷新信号，手动刷新可立即唤醒退避等待中的主机。
  - **SFTP 与命令片段刷新反馈**：SFTP 本地/远程刷新按钮新增旋转加载动画，并支持 `F5` / `Ctrl+R` 一键同时刷新本地盘符列表、本地目录与远程目录；命令片段页同样支持快捷键刷新。
- **默认内置鸿蒙黑体（HarmonyOS Sans）与字体自由切换**：
  - **开箱即用的清晰中文渲染**：桌面客户端默认离线打包华为免费可商用的 **鸿蒙黑体（HarmonyOS Sans）** 可变字体（Unicode 范围切分 WOFF2），彻底告别 Windows 下默认英文字体回退造成的中文显示发虚问题，并配备无闪烁（No-FOUC）首帧渲染脚本。
  - **设置页支持实时字体切换**：在「设置 → 外观」中新增 **界面字体**（鸿蒙黑体、系统默认、经典默认、自定义）与 **终端字体**（系统等宽、Cascadia、JetBrains、Fira Code、自定义）切换选项，支持填写本机已安装字体、实时预览与一键恢复默认；终端字体实时生效并自动保留全部 Nerd Font 图标回退。
- **Windows 安装流程简体中文汉化**：
  - Windows NSIS 安装包（`OmnySSH-x86_64-setup.exe`）默认启用 **简体中文** 安装及卸载向导（同时提供简体中文 / English 语言选择器，支持非中文系统手动切换），并配置统一应用图标。

---

## 1.1.8 — 2026-11-21

### 新增特性与功能改进
- **支持通过 SSH 远程采集 Windows 主机监控指标（PR #138）**：
  - 无需在远程 Windows 服务器上安装额外 Agent，OmnySSH 在建立 SSH 连接后自动探测 Windows 系统平台。
  - 通过 UTF-16LE 编码的非交互式 PowerShell CIM 查询（`Get-CimInstance`）直接采集 CPU 使用率、物理内存使用率、系统盘使用率、系统运行时间、系统版本（Windows Edition）以及 CPU 占用最高的进程列表。
  - 采集结果严格保持缺失项不可用状态，避免伪造为零，Linux 与 macOS/BSD 主机的监控机制保持不变。
- **跨平台测试与构建兼容性优化**：
  - 优化 Windows 环境下换行符（CRLF）与路径分隔符的测试断言兼容性，确保全平台测试稳定运行。

---

## 1.1.7 — 2026-11-05

### 新增特性与功能改进
- **终端文本快速查找与高亮（PR #152）**：在桌面端终端中支持通过 `⌘F`（macOS）或 `Ctrl+Shift+F`（Windows / Linux）打开搜索栏，实时高亮并统计匹配项，支持回车/Shift+回车切换上下匹配，支持区分大小写与正则表达式，单行选中文本自动填入搜索框。
- **PuTTY 风格复制与粘贴（PR #162）**：选中文本立即自动复制到剪贴板，支持鼠标右键直接粘贴、中键粘贴，以及 `Shift+Insert` 粘贴和 `Ctrl+Insert` 复制；自动去除每行末尾的多余空白字符。
- **全屏与全部复制（Copy all）**：支持 `Ctrl+Shift+A`（macOS 为 `⇧⌘A`）一键复制整个终端回滚缓冲区的全部输出历史；支持 `Ctrl+右键` 弹出包含复制、粘贴、复制全部、全选的上下文菜单。
- **多行粘贴安全确认**：当粘贴内容包含换行符时支持弹出确认弹窗，显示行数并提供预览，防止 Shell 误触立即执行；可在设置中开启或关闭。
- **剪贴板与终端操作偏好设置**：在设置页新增「复制与粘贴」配置面板，可自由调节选中文本自动复制、右键行为（粘贴、复制或粘贴、菜单、无操作）、中键粘贴、去除末尾空白、多行确认，并支持一键恢复 PuTTY 默认值。
- **本地化与全平台适配**：完整提供中英文双语翻译字典与无障碍文本；Windows 版本支持安装版与无需 WebView2 安装器预装的独立便携包。

---

## 1.1.6 — 2026-10-15

### Features
- **Settings shows the installed version.** On Windows and Linux the desktop app showed its version nowhere. Settings now ends with it, and it can be copied into a bug report.
- **Group and arrange hosts on the dashboard.** With many hosts the dashboard was one long grid in config order. Both apps now group it with `g`: each host goes under its first tag, untagged hosts last. In the desktop app, View options also sorts the cards by name or status, sections fold from their header, and a card's handle drags it, or moves it with the arrow keys, into an order of your own that is kept across restarts.
- **Drag files and folders between the SFTP panes, or onto the remote pane from your file manager.** In the desktop app, dragging a row to the other pane uploads or downloads it into the folder row it is dropped on, or else into the folder on show, and dragging a ticked row takes every ticked row along. Files and folders dropped from Explorer, Finder or a Linux file manager onto the remote pane upload to it. Escape cancels a drag.
- **Both apps transfer whole folders.** Upload and Download in the desktop app, and copy and paste in the terminal app, take a folder with everything in it, merge it into a folder of the same name and replace files that clash, and the desktop app asks first when the folder on show already has those names. Files and folders keep their permission bits, so scripts stay executable, and a copy stays writable for you so the next transfer can replace it; symbolic links and special files are skipped, and the transfer ends by saying how many items were skipped or failed and why the first one was. Cancel in the desktop app's progress strip, closing its tab, or Esc in the terminal app stops a transfer and removes the file it was part way through.
- **The file panes show when each file was last changed.** The desktop app's panes gain a Modified column, with the full date and time on hover, once the window is wide enough. The terminal app's file manager shows the time at the end of each row when its panel is wide enough.
- **Streamer mode shows when it is on and switches from anywhere.** In the desktop app it could only be switched in Settings, and nothing on screen said it was on. While it is on, an eye in the status bar says so. `⌘⇧S` on macOS or `Ctrl+Shift+S` elsewhere and "Toggle streamer mode" in the command palette switch it from any screen, a terminal included.

### Bug Fixes
- **Security: a server that offers a host key of another type than the one saved for it is refused.** OmnySSH compared the offered key only with saved keys of the same type. A host saved with its Ed25519 key that suddenly offered only an RSA or ECDSA key was therefore taken for a new host: the key was saved and the login went ahead, password included, and the dashboard did this in the background without anyone connecting. Someone intercepting the connection could get past the saved key this way. Like `ssh`, OmnySSH now refuses any key that matches none of those saved for the host, whatever its type, and says which type is saved. A server that really dropped the type of key it was saved with needs its old key removed once, as `ssh` also asks.
- **Security: the terminal app no longer lets server-supplied names control your terminal.** A file or process name with escape sequences went to the terminal as is, so anyone who can create a file in a folder you browse could retitle the terminal, recolour text or clear the screen. Control characters in anything the app draws now show as �, tabs as spaces, and a file keeps its exact name for transfers.
- **A changed host key names its type and, on Windows, whose list held the old one.** OmnySSH 1.1.3 and earlier kept host keys in `%USERPROFILE%\ssh\known_hosts`, a list that PuTTY and OpenSSH never read. When a server was reinstalled, or a new one took over its address, OmnySSH refused it while PuTTY and PowerShell's `ssh` connected, and nothing said why they disagree. A refusal from that file now says it is the list OmnySSH kept up to 1.1.3. Every refusal also names the type of the key the server offered, ED25519, ECDSA or RSA, and the command that prints that key's fingerprint on the server: a server has one key of each type, and comparing the wrong one shows a mismatch that is not there.
- **Servers from the RHEL/CentOS 6 era connect.** OpenSSH before 5.7 failed with "no common key exchange method". Its only key exchange without SHA-1 is diffie-hellman-group-exchange-sha256, which OmnySSH did not offer. Its only host keys are ssh-rsa and ssh-dss, and it predates the rsa-sha2 signatures, so an RSA key could not log in either. OmnySSH now offers diffie-hellman-group-exchange-sha256 and the ssh-rsa host key after every other method, so a server that supports anything newer negotiates exactly as before. An RSA key signs with SHA-1 only for a server that accepts nothing else: one that lists only ssh-rsa as the signatures it takes, or whose version, OpenSSH before 7.2 or Dropbear before 2020.79, predates that list, as PuTTY and `ssh` before 8.8 sign for it. SHA-1 key exchange, CBC ciphers and DSA keys are still left out.
- **FreeBSD hosts show CPU, RAM, load average and top processes.** A FreeBSD server's card showed only disk and uptime: its `top` rejects the options OmnySSH passed, it has neither `free` nor `/proc`, and its `ps` read the list of columns as a single column. CPU is now measured from the kernel's tick counters over one second, so each update of a FreeBSD host takes a second longer. RAM is read from the kernel's page counts, with free and inactive memory, the buffer cache and the ZFS ARC above its minimum counted as available, as htop counts them, so a server on ZFS does not look nearly full. The kernel's idle process, which `ps` charges with all idle time, is left out of the top processes. Where `/proc/loadavg` is missing, the load average now comes from `uptime`, which also fills it in for macOS hosts in the terminal app's host details. As on any system, an account whose login shell is csh or tcsh still shows no metrics.
- **Servers that take only NIST key exchange or aes128-gcm connect, such as Cisco RoomOS video devices.** A server whose key exchange methods include no curve25519 or Diffie-Hellman group 14/16, or whose only cipher is aes128-gcm, failed with "No common algorithm". OmnySSH now also offers ecdh-sha2-nistp256, -nistp384 and -nistp521 key exchange and the aes128-gcm@openssh.com cipher, which macOS's own `ssh` tries first. A host whose only host key is ECDSA P-384, as on a RoomOS device set to ECDSA, now connects the first time too; before, that key was only accepted once it was saved in `known_hosts`. The new key exchange methods and host key type come after the ones offered before, so a server that already worked keeps its key exchange and host key. This needed a newer release of the SSH library (russh 0.63), and building from source with `cargo install omnyssh` now needs Rust 1.89 or later.
- **A server with no algorithm in common says which kind is missing and what it offers.** The error read "No common algorithm", and a key exchange mismatch even "Unknown algorithm", without saying whether the key exchange, host key, cipher or MAC was the problem, so there was nothing to go on. It now reads, for example, "no common cipher; the server offers aes128-cbc". Servers that offer only methods OmnySSH leaves out on purpose, such as SHA-1 Diffie-Hellman or CBC ciphers, still do not connect.
- **macOS: a host on your local network that fails with "No route to host" says macOS may be blocking it.** macOS keeps an app away from devices on the local network until you allow it, and a blocked connection fails at once with "No route to host (os error 65)", while the router usually stays reachable because it is also your DNS server, so it looked like a fault on that one machine. The error now adds that macOS may be blocking the app and where to allow it: System Settings, Privacy & Security, Local Network, then reopen the app. The desktop app also now carries the explanation macOS shows when it asks for that permission. The terminal app needs the permission for the terminal it runs in; Apple's Terminal has it already.
- **A terminal the server closes right after login stays open and shows why.** A Synology NAS gives a shell only to administrators: any other account logs in, gets DSM's "Permission denied, please try again." and the session ends. `ssh` shows that message, but OmnySSH closed the tab the moment the session ended, so the terminal seemed to vanish right after the password while file sessions to the same NAS worked. In both apps, a terminal tab that showed anything now stays open when the remote side ends its session, including after `exit` or a dropped connection, with "[Connection closed. Press Enter to close this tab.]" under the last output. Enter or Esc closes it, and it takes no other input. A terminal that fails before showing anything still closes, with the reason in the status bar. The desktop app could also drop the last lines a session printed just before it ended; they now always arrive.
- **Settings keeps its bottom margin when scrolled to the end.** The last section sat flush against the bottom of the window.
- **A snippet with the same tag twice no longer empties the Snippets screen.** Tags typed as `db, db` in a snippet form, or written so into `snippets.toml`, left the desktop app's Snippets screen blank, so the snippet could not even be opened to fix it. The Run dialog broke the same way when two hosts share a name, as two `Host` blocks with one name in `~/.ssh/config` give. It now lists that name once, for the host a run goes to. The host picker and the command palette listed such a name twice, and either row opened the first host; they now list it once too.
- **Sizes in the terminal app's file manager stay in their column next to wide file names.** A name with Chinese, Japanese or Korean characters or emoji, which take two cells each, pushed its size past the panel's edge, so a 14-byte file read `1`. Names are now padded and cut by the cells they take.
- **Closing the host picker with Esc gives the keyboard back to the terminal.** In the desktop app, clicking SFTP or Terminal in the sidebar over an open terminal and then pressing Esc left the keyboard on the sidebar, so typing reached nothing until you clicked in the terminal. The command palette's sidebar button had the same problem, and so did clicking the terminal's own tab. A terminal that finishes connecting while the palette is open, or comes into view just as a passphrase prompt opens, no longer takes the keyboard from it.
- **Pasting a folder in the terminal app copies it instead of leaving an empty file.** The file manager handed a folder to the transfer as if it were a file, so the paste failed after creating an empty file of that name on the other side.
- **A paste or delete of more than 64 items in the terminal app handles them all.** They went to the SFTP queue at once, and whatever did not fit in its 64 places was dropped without a word while the app kept waiting for it. They now go one at a time.
- **The terminal app no longer crashes when a file grows while it is copied.** A log still being written to could end up larger than when its transfer started, which took the progress bar past 100% and brought the app down.
- **Key setup no longer reports success while the server still takes passwords.** Turning password login off needs sudo without a password prompt. Without it, as for an account whose sudo asks for a password, key setup stopped once the new key worked, yet the desktop app said "Key authentication configured", the card showed a key badge and the key button was gone, so there was no way to try again. The terminal app went further: it marked the host key-only and deleted the saved password. Both apps now say that key login works and password login is still on, and keep the saved password. The desktop app's card shows a "Password on" badge that runs the setup again, for when sudo allows it, and a shield for a host that takes keys only. After a full setup it also says that the server's SSH settings were changed, where their backup is, and that the saved password was removed.
- **The desktop app asks before setting up a key.** One click on the key icon generated a key, added it to the server and could turn password login off for every account on it. A dialog now says what will happen and names the key file, and nothing starts until you confirm. Cancel is focused, and Esc or a click outside cancels.
- **Key setup that fails after turning password login off says so.** When the last check failed, the desktop app said "Password authentication was not changed", although password login had been turned off, and even when turning it back on failed and left the server reachable only through the hosting provider's console. It now says when password login was turned back on, and when it may still be off, now or after the SSH service restarts: then it keeps the new key for the host, says how to check the server's setting and restore its backup, and offers a terminal to do it.
- **The desktop app asks before quitting while anything is still open.** Closing the window, `⌘Q`, the tray's Quit, and `⌘W` on macOS ended every terminal, transfer, tunnel and snippet run without a word. Closing or quitting now asks first and names what will be closed, with a "Don't ask again" box; Settings → Window turns the question back on. On macOS `⌘W` closes the active tab and `⌘⇧W` the window. Quitting from the Dock or by logging out still does not ask.
- **Streamer mode hides addresses in error messages and the host form too.** The cards showed made-up addresses, but the status bar printed real ones, for example for a changed host key or a tunnel that could not open, and so did the file panes, snippet results and key setup. Errors now show the same made-up addresses as the cards, and the host form hides its addresses until you click Reveal.

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
