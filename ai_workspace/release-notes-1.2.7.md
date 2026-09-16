## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.7-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.7/CraftStation-Portable-1.2.7-x64.exe)**

双击即可运行。包内已带 Electron / Chromium、`better-sqlite3`、`node-pty`、外设 sidecar，以及官方 Windows **CLIProxyAPI** sidecar。各家 Agent CLI（Devin、Codex、Kimi Code、Antigravity、Grok 等）仍使用你本机已安装的官方工具和订阅。

用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。换电脑请一并备份该目录。

---

## 中文

### 本版新增

- **Devin CLI**：合成台出现 Devin Native Harness；未安装可一键下载安装；登录、ACP 会话、MCP（Schedule / 跨线程 / 自定义服务器）与检查更新均按官方 CLI 接入。
- **凭据填写改为弹窗**：OpenAI 兼容 API、Kimi Code Key、火山方舟 AK/SK 及其他 API Key/Cookie 均在 Modal 中填写、探测、保存；未登录时首次点击「添加账号」不再无反应。

### 本版改进

- **浅色主题**：顶部工具栏与侧边栏跟随浅色外观，不再保持深色渐变。
- **应用更新**：发布源为 `HernanJiang/CraftStation`；单次检查约 8 秒；便携版发现新版本会打开 GitHub Releases，不会自动覆盖当前 exe。
- **合成台安装**：未安装的 Harness/CLI 点击整行或「下载并安装」即在当前页执行官方安装命令，显示「安装中…」；失败给出原因并提供「重试」，不再跳到代理设置页。

### 本版修复

- Gemini `UNAVAILABLE (code 503) No capacity available` 的容量重试不再当作会话错误刷出；真正的额度/配额错误仍会显示。

### 已知限制

- Devin 与其他 CLI 的真实安装仍依赖本机 curl / PowerShell / Homebrew 等官方安装器；安装输出在应用内终端可见。
- 便携版不是 U 盘绿色版：会话、设置、配方在 `~\.craftstation\`，各家 CLI 登录态在各自目录（如 `~\.devin`、`~\.codex`）。

---

## English

Double-click the portable exe to run. The bundle includes Electron/Chromium, native modules, the peripheral sidecar, and the official Windows **CLIProxyAPI** sidecar. Agent CLIs (Devin, Codex, Kimi Code, Antigravity, Grok, and others) still use the official tools and subscriptions installed on your machine.

User data lives in `C:\Users\<you>\.craftstation\`, not next to the exe. Back that folder up if you move machines.

### What's new

- **Devin CLI**: Devin Native Harness appears on the Crafting Table. You can one-click install it, sign in, run ACP sessions, inject CraftStation MCP servers (Schedule, cross-thread, custom), and check for CLI updates.
- **Credential dialogs**: OpenAI-compatible APIs, Kimi Code keys, Volcengine Ark AK/SK, and other API key/cookie forms now open in a modal with probe and save. Adding an account while signed out no longer does nothing on the first click.

### Improvements

- **Light theme**: The title bar and sidebar follow the light appearance instead of staying on a dark gradient.
- **App updates**: The feed is `HernanJiang/CraftStation`. A check times out in about 8 seconds. Portable builds open GitHub Releases when a new version exists; they do not auto-overwrite the running exe.
- **Crafting Table install**: Clicking an uninstalled Harness/CLI row (or Download and install) runs the official installer in place, shows Installing…, and offers Retry on failure — without leaving for Agent Settings.

### Fixes

- Gemini capacity retries (`UNAVAILABLE (code 503) No capacity available`) are no longer painted as session errors. Real quota failures still show.

### Known limits

- Real CLI installs still need curl, PowerShell, or Homebrew on the machine. Installer output is visible in the in-app terminal.
- The portable build is not a USB-green app: sessions, settings, and recipes stay in `~\.craftstation\`; CLI logins stay in each vendor's own home (for example `~\.devin`, `~\.codex`).
