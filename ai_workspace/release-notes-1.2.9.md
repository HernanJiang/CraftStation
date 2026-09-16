## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.9-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.9/CraftStation-Portable-1.2.9-x64.exe)**

双击即可运行。包内已带 Electron / Chromium、`better-sqlite3`、`node-pty`、外设 sidecar，以及官方 Windows **CLIProxyAPI** sidecar。各家 Agent CLI 仍使用你本机已安装的官方工具和订阅。

用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。换电脑请一并备份该目录。

---

## 中文

### 本版修复

- **Gemini / Antigravity 聊天格式**：后台任务回执（`Wait for … Task id … finished`、`The command exited with code 0`、`<system_information>`）不再画进对话或思考。
- **思考收尾**：思考步进结束和回合完成时关掉思考项，不再一直停在展开的「Thinking」。
- **收尾不再重贴全文**：流式增量按快照去重，最终信封只补尚未出现的尾巴，避免把工具日志和系统块糊在回答后面。

### 已知限制

- 便携版不是 U 盘绿色版：会话、设置、配方在 `~\.craftstation\`。

---

## English

Double-click the portable exe to run. The bundle includes Electron/Chromium, native modules, the peripheral sidecar, and the official Windows **CLIProxyAPI** sidecar. Agent CLIs still use the official tools and subscriptions installed on your machine.

User data lives in `C:\Users\<you>\.craftstation\`, not next to the exe.

### Fixes

- **Gemini / Antigravity chat format**: Async-task receipts (`Wait for … Task id … finished`, `The command exited with code 0`, `<system_information>`) are no longer painted as chat or thinking.
- **Thinking wrap-up**: Reasoning items close when the thinking step ends and when the turn completes, so they no longer stay expanded as Thinking.
- **No full-transcript reprint**: Streamed text is de-duplicated against snapshots; the final envelope only appends the unseen tail, so tool logs and system blocks are not glued onto the answer.

### Known limits

- The portable build is not a USB-green app: sessions, settings, and recipes stay in `~\.craftstation\`.
