# CraftStation 1.11.5

## 用户可见

- DeepSeek 临时对话和正式会话不再因为 Notion 的本地命令不是绝对路径而停在「模型准备失败」。
- 某一个 MCP 在启动时连不上时，会跳过这一项并继续打开模型。其余 MCP 仍然注入。
- 本版为补丁版本，只发布 Windows x64 NSIS 安装包与便携版。安装后需要重新打开 CraftStation。

## 实现

- DeepSeek 启动前把 Windows 上的 npm `.cmd` 换成 `node.exe` 加上垫片里的绝对脚本路径。相对路径会先解析成绝对路径。SSE 服务器会被跳过。
- `session/new` 被 dsh 以某个 MCP 的名字或 `mcpServers[n]` 拒绝时，丢掉这一项再开一次。没有点名服务器的错误仍原样失败。`craft_goal` 不会被静默丢掉。

## 验证

- `mcpCommand.test.ts` 与 `mcpStartupRetry.test.ts` 共 12 项通过。变更文件的类型感知 lint 通过。
- 真实 dsh：`notion` 与 `notion-oauth` 一起开会话时，第一次失败并点名 `notion-oauth`，同一进程去掉它之后 `session/new` 成功。CodeKey 上的 `deepseek-v4.1-flash` 回答了一句模型名称，停止原因是 `end_turn`。
- 正在运行的 v1.11.4 窗口没有加载这版源码。安装本版后需要重新打开。

---

# CraftStation 1.11.5

## User-facing

- DeepSeek temporary chats and regular threads no longer stay on “model prepare failed” because the local Notion command is not an absolute path.
- When one MCP server is rejected while the session is opening, that server is skipped and the model still starts. The other MCP servers stay attached.
- This patch publishes Windows x64 only: an NSIS installer and a portable package. CraftStation has to be opened again after installing it.

## Implementation

- Before DeepSeek starts, a Windows npm `.cmd` shim is rewritten to `node.exe` plus the absolute script path inside the shim. Relative paths are resolved first. SSE servers are skipped.
- When dsh rejects `session/new` and names one MCP server, or cites `mcpServers[n]`, that server is dropped and the open is retried. An error that names no server still fails as before. `craft_goal` is never dropped silently.

## Verification

- `mcpCommand.test.ts` and `mcpStartupRetry.test.ts` passed, 12 tests. Type-aware lint passed on the changed files.
- Against the installed dsh, opening with both `notion` and `notion-oauth` failed once and named `notion-oauth`. The same process then opened without it. `deepseek-v4.1-flash` on CodeKey answered with its model name. The stop reason was `end_turn`.
- The already-running v1.11.4 window does not load this source. CraftStation has to be opened again after installing this version.
