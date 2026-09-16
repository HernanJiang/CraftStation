## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.8-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.8/CraftStation-Portable-1.2.8-x64.exe)**

双击即可运行。包内已带 Electron / Chromium、`better-sqlite3`、`node-pty`、外设 sidecar，以及官方 Windows **CLIProxyAPI** sidecar。各家 Agent CLI（Devin、Codex、Kimi Code、Antigravity、Grok 等）仍使用你本机已安装的官方工具和订阅。

用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。换电脑请一并备份该目录。

---

## 中文

### 本版新增

- **Devin 渠道与额度**：未登录时「渠道与额度」右侧出现 Devin 卡片，可「登录/授权」（`devin auth login`）或粘贴 API Key。登录成功后进入已配置渠道，并显示身份与额度。
- **Devin 模型按需勾选**：ACP 上报的数十个细分模型默认全部隐藏（仅保留 SWE 默认模型）。只有在「管理模型」里勾选的 Devin 模型才会出现在首页选择器。

### 本版改进

- **浅色模式**：侧栏「模型与用量 / 添加新模型」字迹清晰；「渠道与额度」工作区与账号卡片不再写死深黑；额度进度条在浅色下可见；「管理模型」的搜索框、列表与已选名单全部改用语义色。

### 本版修复

- Windows 后台探测/更新再补 `windowsHide: true` + `shell: false`，减少 conhost 黑窗闪现。
- Gemini `UNAVAILABLE (code 503) No capacity available` 容量重试：错误坞、状态栏、ACP RPC、Antigravity 原生事件与 assistant 增量全部抑制，真正的额度/配额错误仍会显示。

### 已知限制

- Devin 与其他 CLI 的真实安装仍依赖本机 curl / PowerShell / Homebrew 等官方安装器。
- 便携版不是 U 盘绿色版：会话、设置、配方在 `~\.craftstation\`，各家 CLI 登录态在各自目录（如 `~\.devin`、`~\.codex`）。

---

## English

Double-click the portable exe to run. The bundle includes Electron/Chromium, native modules, the peripheral sidecar, and the official Windows **CLIProxyAPI** sidecar. Agent CLIs (Devin, Codex, Kimi Code, Antigravity, Grok, and others) still use the official tools and subscriptions installed on your machine.

User data lives in `C:\Users\<you>\.craftstation\`, not next to the exe. Back that folder up if you move machines.

### What's new

- **Devin in Channels & quota**: An unauthenticated Devin card appears on the right. Sign in with `devin auth login` or paste an API key. After auth it joins configured channels with identity and quota.
- **Devin models on demand**: Dozens of ACP-reported variants stay hidden by default (only the SWE default remains). Only models you check in Manage models appear in the homepage picker.

### Improvements

- **Light mode**: Sidebar "Models & usage" labels are readable; the usage workspace and account cards no longer stay pitch-black; quota tracks are visible; Manage models inputs, lists, and the selected roster use semantic colors.

### Fixes

- Windows background probes set `windowsHide: true` and `shell: false` so conhost is less likely to flash.
- Gemini capacity retries (`UNAVAILABLE (code 503) No capacity available`) are dropped from the error dock, status bar, ACP RPC, Antigravity native events, and assistant deltas. Real quota failures still show.

### Known limits

- Real CLI installs still need curl, PowerShell, or Homebrew on the machine.
- The portable build is not a USB-green app: sessions, settings, and recipes stay in `~\.craftstation\`; CLI logins stay in each vendor's own home (for example `~\.devin`, `~\.codex`).
