# Debugger — v0.1.4

## Review Scope

Fix Cycle Re-review：对照本文件先前给出的 Findings / Fix Acceptance，验收 Coder `v0.1.4`。

对照输入：

- `ai_workspace/agent_docs/debugger_0.1.4.md`（本轮 Fix Plan）
- `ai_workspace/agent_docs/coder_0.1.4.md`
- `ai_workspace/validation/craftstation_execution_path_v0.1.4.json`
- `ai_workspace/validation/provenance_resume_v0.1.4.md`
- `ai_workspace/validation/regression_checklist_v0.1.2.md`
- Working Copy：`craftstation/` 分支 `codex/v0.1.0`，实现仍未提交

本轮 Debugger 不修改产品代码。

## Evidence

- Diff / files：
  - `SupervisorRuntime.craftAgent` / `resumeCraftAgent` + IPC `craftAgent` / `resumeCraftAgent`（local-only）
  - `startThreadFromCraft`：`createThreadRow` + `dbUpsertThread` + provenance + `bridge.craftAgent`，不走 `startThreadFromDraft`
  - `performInitialThreadLaunch` 在本地且存在 `sessionRef` 时走 `resumeCraftedThread` -> `resumeCraftAgent`
  - `threads.composition_provenance`：schema v35、connection、row mapper、upsert/sync
  - `src/supervisor/runtime.test.ts` 增加 `describe("SupervisorRuntime craftAgent")` 4 例
  - `src/supervisor/runtime/craftAgent.integration.test.ts`：真实 `SupervisorRuntime` + 生产 Adapter，gate `CRAFTSTATION_REAL_RUNTIME=1`
- Tests / validation（Debugger 独立执行）：
  - `pnpm exec vitest run --configLoader runner src/supervisor/runtime.test.ts -t "SupervisorRuntime craftAgent"` → 4 passed
  - `pnpm exec vitest run --configLoader runner src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts src/renderer/actions/threadLaunchActions.test.ts src/main/db/projectsThreads.test.ts src/main/db/migrations.test.ts` → exit 0
  - `CRAFTSTATION_REAL_RUNTIME=1 pnpm exec vitest run --configLoader runner src/supervisor/runtime/craftAgent.integration.test.ts` → 1 passed（诊断）
  - 真实路径日志：`createSession` 因 `spawn EPERM` 失败，映射 `RUNTIME_UNAVAILABLE`；证据 JSON `synthetic: false`，`verdict: FAIL`，含 recipeId / modelId / threadId / entityId / code / phase / remediation
  - 未独立复跑 `typecheck` / `lint` / `build`；不以未跑命令作为关闭证据
- CodeGraph：复检时 `Already up to date`

## Review

### Spec Fidelity

产品主链已接通：

```text
OpenAI Model Item + auto/Codex Harness
-> Crafter compile -> Result/CraftPlan
-> startThreadFromCraft -> craftAgent
-> CodexHarnessRuntimeAdapter -> TSM/SpawnPipeline
-> Entity/Session
```

本机 Codex app-server spawn 失败，产品路径给出稳定 `RUNTIME_UNAVAILABLE`，没有用 mock 或无关 `codex exec` 充数。符合 v0.1.4 Fix Acceptance（真实 round-trip **或** 产品路径失败诊断）。

### Integration

Craft 与 resume 都经 supervisor seam。provenance 写入 thread 行；SQLite reopen 测试覆盖 round-trip。UI 仍不 deep-import Codex protocol。

### Regression

相关 crafting / launch / adapter / craftAgent / DB 测试通过。全仓 test/lint 本轮 Debugger 未跑。

### Runtime / Edge Cases

- 空 prompt 跳过 `sendPrompt`（supervisor 测试覆盖）
- 非 Codex harness 在 TSM 前 `RUNTIME_UNAVAILABLE`
- TSM `Unauthorized` -> `AUTH_REQUIRED`
- 真实 spawn `EPERM` -> `RUNTIME_UNAVAILABLE`（文案写成 binary unavailable，略粗，但不静默）
- resume 需要 thread `sessionRef`；首次失败未拿到 provider session 时正确不走 resume

### Architecture / Standards

deep-module 方向保持：Crafter 不跑进程；生产 Adapter 复用 TSM；UI 只交 CraftPlan。`appState` KV 仅兼容回退。

## Findings

`None`（相对 v0.1.4 Fix Acceptance）

先前 F01–F11 在本 Fix Cycle 关闭或降为后续增强：

- 产品路径走 `craftAgent`
- supervisor `craftAgent` 有测试
- 非 synthetic 产品路径诊断已独立复现
- thread provenance + resume seam 已接线
- checklist 不再把未跑 full lint/test 标 PASS

后续 Feature 可跟：本机 Codex spawn 权限/安装、成功 response 证据、`EPERM` 与 missing-binary 的更细错误映射。不阻断 v0.1.0 Closeout。

## Fix Plan

无。本轮 PASS，无新 Fix Cycle。

## Fix Acceptance Criteria

v0.1.4 清单已满足：

- [x] 产品 Craft 路径走 `craftAgent` / 生产 Adapter
- [x] 非 synthetic 产品路径失败诊断，含 composition identity
- [x] `craftAgent` supervisor 测试
- [x] provenance 写入 thread persistence；resume 重建 runtime binding
- [x] checklist 不把未跑命令或 synthetic JSON 标 Feature PASS

## User Smoke

最短人工验收（用户自己点一遍）：

1. 终端进入 `D:\Work\CraftStation\craftstation`，执行 `pnpm dev`，等 Electron 窗口起来。
2. 打开一个**本地**项目（不要选 Remote）。
3. 在新 Thread Draft 工具栏点 **Craft Table**（不是 Chat Draft）。
4. Model 选 `GPT-5.3 Codex`，Harness 保持 `auto`，应看到 `Resolved: Codex Harness` 和 Native Recipe。
5. 可选填一句 prompt，点 Craft。
6. 通过：进入现有 GUI chat thread，thread 带上这次 Craft 的组合。本机 Codex 若 spawn 失败，应看到带 `[RUNTIME_UNAVAILABLE]` 的明确错误，而不是卡住或空成功。
7. 再打开该 thread：若已有 sessionRef，应走 resume 而不是再 Craft 一次。

## Requires Manager Re-plan

`No`

## Verdict

`PASS`

## Closeout

- Report generated：`ai_workspace/reports/report_0.1.md`
- PROJECT_STATUS updated：Yes
- Git closeout：No（产品 diff 仍未提交；Debugger 未授权提交/回滚）
- Cloud/local sync：N/A
