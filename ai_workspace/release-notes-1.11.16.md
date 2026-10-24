# CraftStation 1.11.16

## 用户可见

- 模型目录每 15 分钟自动检查，回到窗口、打开管理模型页时检查过期目录；手动「获取模型」立即刷新。保留已有模型显示选择。
- Kimi 可获取 K2.8 Preview、K3.1 Pro 及其 Highspeed 档；K2.7 Highspeed 保持独立型号，旧会话的快速模式不再把 K2.8 请求改发到 K2.7。
- Claude 自动接纳 SDK 提供的新模型与名称；OpenCode 刷新官方目录，更新常驻服务里的旧模型信息。
- Windows Codex 使用完整、独立的运行文件目录，防止 CLI 更新替换正在运行的工具辅助程序，导致文件占用或 IPC 版本不匹配。安装新版后新启动的会话使用此机制。
- Windows 上更新 Step Code 时，官方安装脚本不再因为 PowerShell 模块路径丢失 `Get-FileHash` 而失败。内置 `step update` 若因发布包目录结构失败，会继续用官方脚本完成安装。

## 实现

- Kimi API Key 配置不再每次启动都重置；官方目录更新使用原子写入，保留显式覆盖，失败保留原配置。
- 并发渠道刷新合并最新缓存；前端自动与手动刷新共用去重、过期检查和超时处理。
- Codex 快照包含主程序、辅助程序及配套资源，发布前检查源目录在复制期间未发生变化；保留运行中的旧快照。

## 验证

- 模型目录、Kimi、Claude、OpenCode、Codex 快照与 Step 更新相关测试 232 项，以及更新器与路径测试 77 项通过。`pnpm typecheck` 与 `pnpm lint` 通过。
- 隔离应用中已确认 Kimi 页面刷新，以及 Codex 真实回合执行 `Get-Location` 并返回 `CODEX_TOOL_OK`；主进程与 code-mode 辅助进程来自同一快照。本轮发布前没有重跑整应用 smoke。
- Step 的 `Get-FileHash` 回归在修复前失败、修复后通过。官方安装脚本在修正模块路径后，于临时目录完成 0.1.6 安装；临时 PATH 已撤回，本机正式 `step.exe` 未替换。
- 本补丁仅发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.16

## User-facing

- Model catalogs refresh every 15 minutes and are checked for staleness on window focus and when opening model management. Manual refresh bypasses the age check and preserves visibility choices.
- Kimi discovers K2.8 Preview, K3.1 Pro and its Highspeed tier. K2.7 Highspeed stays a separate model; a saved Fast setting no longer redirects K2.8 requests to K2.7.
- Claude accepts new models and updated names from the SDK. OpenCode refreshes the official catalog instead of retaining stale metadata from a running server.
- On Windows, new Codex sessions use a complete isolated runtime directory so CLI upgrades cannot replace helpers used by a running server and cause file locks or IPC version mismatches.
- Updating Step Code on Windows no longer fails when the official installer cannot find `Get-FileHash` because PowerShell 7 module directories shadow Windows PowerShell 5.1. If the built-in `step update` fails on the release archive layout, the official installer still completes the update.

## Implementation

- Preserve managed Kimi API-key configurations across launches. Refresh official metadata atomically, retaining explicit overrides and the previous configuration on failure.
- Merge concurrent channel refreshes against the latest cache. Share deduplication, age checks and timeout handling between automatic and manual refreshes.
- Snapshot the complete Codex runtime, including helpers and resources, and check that the source stayed stable while copying. Retain old snapshots used by running processes.

## Verification

- 232 tests covering model catalogs, Kimi, Claude, OpenCode, the Codex snapshot and the Step updater passed, along with 77 updater and path tests. `pnpm typecheck` and `pnpm lint` passed.
- An isolated app confirmed the Kimi model-page refresh and a real Codex turn that ran `Get-Location` and returned `CODEX_TOOL_OK`. The server and code-mode helper came from the same snapshot. The full app smoke was not repeated immediately before this publish.
- The `Get-FileHash` regression failed before the fix and passed after it. With the repaired module path, the official installer completed a 0.1.6 install in a temporary directory. Those temporary PATH entries were removed, and the installed `step.exe` was left unchanged.
- This patch ships Windows x64 installer and portable packages.
