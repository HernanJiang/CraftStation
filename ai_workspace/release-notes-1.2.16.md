# Release 1.2.16 — 启动同步检查更新 + Gemini 闪终端窗根治

## 用户可见

- 每次启动自动检查一轮更新：CLI 与 CraftStation 应用同步检查，结果直接进右上角更新菜单的 badge；自动检查失败保持静默（不弹错误），手动点「检查」仍会提示真实原因。
- Gemini（Antigravity）会话期间不再反复弹出 PowerShell 终端窗：此前每次工具调用（shell 命令）都会闪一个 `C:\Program Files\PowerShell\7` 窗口，现已根除。

## 根因

- 闪窗：1.2.13 用 `detached: true`（DETACHED_PROCESS）消掉了 agy 自身的控制台，但没有控制台的父进程会让每个 console 子系统孙子进程（agy shell 工具 → pwsh、language_server、stdio MCP）各分配一个全新的可见控制台——每次 tool call 闪一次。真机实验证实 `windowsHide`（CREATE_NO_WINDOW）单独使用即可让整棵进程树无窗（孙子 `GetConsoleWindow()=0`），而 `detached` 下孙子 `VISIBLE=True`。
- 修法：nativeTransport 与 antigravity 账号探针去掉 `detached`（`noConsole` 选项随之删除）；补 `pi/mcpExtension.ts` stdio MCP spawn 缺失的 `windowsHide`。
- 启动检查：自动路径此前复用手动检查 IPC（失败会 toast），现 `checkForUpdate` 支持 `{ automatic: true }` 静默语义；手动检查通知行为不变。

## 验证

- `pnpm typecheck` PASS；触碰文件 oxlint 0 警告。
- 新增/更新测试：自动检查静默（autoUpdater）、启动自动检查 vs 手动检查的 IPC 参数（CliUpdateMenu）、孙子进程无可见控制台真机断言（nativeTransportWindowsConsole，Windows 实际执行）。
- updates / ipc / CliUpdateMenu / MainTitlebar / nativeHarness / antigravity / pi 目标套件全过；`nativeAdapter.test.ts` DeepSeek max-tokens 1 例失败为 HEAD 既有（stash 基线对比证实）。

---

# Release 1.2.16 — synchronized startup update check & Gemini console-flash fix

## User-visible

- Every launch now runs one synchronized update check — agent CLIs and CraftStation itself — with results surfaced on the titlebar update badge; automatic checks stay silent on failure while manual checks still report real errors.
- Gemini (Antigravity) sessions no longer flash a PowerShell terminal window on every tool call.

## Root cause

- Console flash: the previous `detached: true` spawn left agy with no console, so every console-subsystem grandchild (shell tool → pwsh, language_server, stdio MCP) allocated its own fresh visible console. `windowsHide` (CREATE_NO_WINDOW) alone keeps the whole tree windowless — verified live (`GetConsoleWindow()=0` for grandchildren).

## Verification

- `pnpm typecheck` PASS; oxlint clean on every touched file.
- New/updated tests: silent automatic check (autoUpdater), startup auto-check vs manual-check IPC args (CliUpdateMenu), and a live Windows assertion that grandchildren get no visible console (nativeTransportWindowsConsole).
- updates / ipc / CliUpdateMenu / MainTitlebar / nativeHarness / antigravity / pi target suites all green; the one `nativeAdapter.test.ts` DeepSeek max-tokens failure is pre-existing on HEAD (confirmed via stash baseline).
