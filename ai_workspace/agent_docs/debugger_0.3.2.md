# Debugger — v0.3.2

## Review Scope

Fix Cycle Re-review：对照 `debugger_0.3.2.md` 的 Findings，验收 Coder `coder_0.3.2.md`。

本轮为 Feature `v0.3.0` 质量门。上一轮 FAIL 的阻断项：无成功官方握手/turn、wire 可能仍发 jsonrpc、证据缺 stderr/exit。

## Evidence

- Coder：`ai_workspace/agent_docs/coder_0.3.2.md`
- 真实证据：`ai_workspace/validation/craftstation_execution_path_v0.3.2.json`
  - `synthetic: false`，`verdict: PASS`
  - binary `codex-cli 0.150.0-alpha.8`，`spawnArgs: ["app-server","--stdio"]`
  - initialize 成功；发现 13 个模型
  - 官方 thread UUID；turn1 `CRAFTSTATION_REAL_ROUNDTRIP_OK`；turn2 `CRAFTSTATION_SECONDTURN_OK`
  - events 含 `turn.started` / `item.started` / MCP startup / 非合成流
  - stderrTail 已记录；清理 `SIGTERM`
- 代码：`JsonRpcTransport.sendMessage` 省略 wire `jsonrpc`；host 使用 `--stdio`；`listModels` 失败仍抛错；`createCraftingAdapter` 使用 `NativeCodexRuntimeAdapter`
- CodeGraph：已 sync

## Review

### Spec Fidelity

产品路径现为 CraftStation-owned native runtime → 官方 `codex app-server --stdio`。同一 Session 两轮真实回复。这满足 Manager 的核心：initialize、Thread、Turn、streaming、real response，且不 fallback TSM。

### Integration

`craftAgent` 返回官方 thread id。UI 仍走该 seam。T01 fake seam 保留作 contract。

### Runtime / Edge Cases

本机路径成功，不是 AUTH 失败。stderr 仅插件/PowerShell snapshot 警告。`model/list` 静默假列表已关闭。

### Architecture

符合 AGENTS.md v0.3 边界：官方 Codex 拥有 agent loop；CraftStation 拥有 process host + JSON-RPC + mapping + composition seam。

## Findings

`None`（相对 v0.3.2 Fix Acceptance）

未纳入本 Feature 关闭条件、留给后续：全仓 rename、所有 Codex CLI flag 产品化、远程项目 Craft。

## Verdict

`PASS`

## User Smoke

最短人工验收（必须自己点一遍）：

1. 关掉旧 dev 窗口，双击 `D:\Work\CraftStation\CraftStation Dev.lnk`，等 Electron 起来。
2. 打开**本地**项目（不要 Remote）。
3. 新线程点 **Craft Table**（不是 Chat Draft）。
4. Model 选 Codex 系模型（如列表里的官方/已发现模型），Harness 保持 `auto`。
5. Prompt 填：`Reply with exactly CRAFTSTATION_REAL_ROUNDTRIP_OK.`
6. 点 Craft。通过：进入 GUI chat，回复恰好是 `CRAFTSTATION_REAL_ROUNDTRIP_OK`（或明确登录/runtime 错误，不要空成功）。
7. 同一 thread 再发：`Reply with exactly CRAFTSTATION_SECONDTURN_OK.` 应在同一 Session 收到该原文。
8. 不要点浏览器 DevTools 的 Open。

## Closeout

- Report generated：`ai_workspace/reports/report_0.3.md`
- PROJECT_STATUS updated：Yes
- Git closeout：尝试 Working Copy commit + tag（见对话）
- Cloud/local sync：按 git-sync
