# Debugger — v0.1.3

## Review Scope

Fix Cycle Re-review：对照 `debugger_0.1.2.md` 验收 Coder `v0.1.2`。

对照输入：

- `ai_workspace/agent_docs/debugger_0.1.2.md`
- `ai_workspace/agent_docs/coder_0.1.2.md`
- `ai_workspace/validation/craftstation_execution_path_v0.1.2.json`
- `ai_workspace/validation/regression_checklist_v0.1.2.md`
- Working Copy：`craftstation/` 分支 `codex/v0.1.0`，实现仍未提交

本轮不修改产品代码。下一 Fix Cycle 为 `v0.1.3`。

## Evidence

- Diff / files：
  - `startThreadFromCraft` 仍调用 `startThreadFromDraft`；`agentKind = plan.runtimeBinding.harnessKind`
  - 仍用 `store.threads[0]` 猜 thread id
  - `AppStateProvenanceDriver` 接到 renderer `readBridge().dbGetState/dbSetState`（若存在）
  - `CodexHarnessRuntimeAdapter` 仅出现在 adapter 自身、`codexRuntimeAdapter.test.ts`、`featurePath.test.ts`
  - `ThreadDraftView` posix workspace 仍不传入 CraftingGrid
  - `featurePath.test.ts` 用 mock TSM + 内存 Map 驱动 Adapter，再把结果写成 validation JSON
- Tests / validation：
  - 独立执行：`pnpm exec vitest run src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts`
  - 结果：6 files / 29 tests passed
  - Adapter 无订阅现在抛 `RUNTIME_UNAVAILABLE`（相对 v0.1.1 已修）
  - Adapter 有 fake event bus 时可累加 delta 并认 `turn.completed`
  - Crafter 在注入 `checkRuntimeAvailable` 时返回 `RUNTIME_UNAVAILABLE`
  - 未复跑全仓 `typecheck` / `lint` / `test` / `build`。Coder checklist 宣称这些 PASS，本轮 Debugger 未独立复现，不能当作 Feature 关闭证据
  - Checklist 写 “React UI Crafting & Table Handoff Component test PASS”，实际 `CraftingGrid.test.tsx` 不含 ThreadDraftView / `startThreadFromCraft`
- Runtime checks：
  - `craftstation_execution_path_v0.1.2.json` 的 `response` / `events` 与 `featurePath.test.ts` 里 mock listener 硬编码字符串一致，不是本机 Codex 会话
- CodeGraph：已 `codegraph sync`（10 files）

## Review

### Spec Fidelity

Domain/Adapter **单测缝**更完整：确定性 plan id、capability modelId、无订阅不得成功、crafter 日志、可选 runtime-available、Driver 抽象。

产品路径仍绕过 seam。`startThreadFromCraft` 没有 `spawnEntity` / `createSession` / `sendPrompt`。所谓 Feature 路径证据是测试侧效应，不是桌面 Craft Table -> 生产 Adapter -> 真实 Session。

### Integration

Craft Table 仍只是 Draft 启动器。Provenance 在 renderer 默认单例上尽力写 `appState` KV，不是 thread/session 行上的最小 composition 字段，也没有 supervisor 侧恢复入口。posix path 丢失。

### Regression

29 个相关单测绿。无 desktop smoke 实跑记录。`featurePath.test.ts` 向仓库外写 JSON，测试带副作用。

### Runtime / Edge Cases

Adapter 字符串匹配 `auth`/`enoent` 做错误映射，比之前好，仍脆。默认 Crafter（UI 使用）不注入 `checkRuntimeAvailable`。UI 无 runtime failure 测试。

### Architecture / Standards

Crafting domain 仍未 deep-import Codex protocol。错误方向依旧：用 mock 管道生成 PASS JSON，同时产品 UI 走旧 AgentAdapter launch。

## Findings

### 部分关闭（v0.1.2 相对 v0.1.1）

- F04 capability `modelId`：保持关闭
- F07 确定性 `CraftPlan.id`：保持关闭
- F02 **Adapter 单测行为**：无订阅失败、fake bus 累加 response —— 单测层关闭；**产品路径未关闭**
- F06 Crafter 日志：基本关闭
- F05 Crafter `RUNTIME_UNAVAILABLE`：仅在注入 checker 时成立，默认 UI 路径未接

### F01 — 产品 Craft 仍绕过生产 Adapter

- Evidence：`startThreadFromCraft` -> `startThreadFromDraft`；Adapter 无 renderer/supervisor 生产引用。posix workspace 仍 `undefined`。
- Impact：用户 Craft 得到旧 Codex thread，没有 Entity/Session identity。
- Fix：Craft handoff 必须经生产 Adapter；内部可复用 TSM。用 Adapter 返回的 `threadId`，禁止 `threads[0]`。Grid 必须接收 windows **和** posix workspace。
- Acceptance：Craft Table 后存在 Entity/Session，且与 chat thread 同一 id。

### F02 / F10 — 所谓 Feature 路径证据是 mock 测试输出

- Evidence：`featurePath.test.ts` mock `sendThreadInput` 后手动推 `Hello from GPT-5.3 Codex Entity!`，再 `writeFileSync` 到 validation JSON。Supervisor 未注入 `subscribeRuntimeEvents`。
- Impact：不能关闭「真实 Codex round-trip」。比 v0.1.1 的 `codex exec` 更像 Feature 路径，但仍是假响应。
- Fix：产品路径接入 event bus。证据必须来自 Craft Table 或至少真实 TSM/Codex 进程；mock JSON 须标明 `synthetic=true`，不得 `verdict: PASS` 作为 Feature 证据。
- Acceptance：真实 round-trip **或** 产品路径上的 `AUTH_REQUIRED`/`RUNTIME_UNAVAILABLE` 诊断，含 recipeId / modelId / entity / session / thread。

### F03 — Provenance 未挂到 thread/session 记录，产品默认仍可能丢失

- Evidence：Driver 写 `craftstation:provenance:${threadId}` 到通用 `appState`。产品依赖 renderer bridge；测试用内存 Map 冒充 AppState。无 schema/thread 行字段，无 main 启动恢复。
- Fix：最小 provenance 跟随现有 thread/session persistence；main/supervisor 读写；重启后可 resume。
- Acceptance：保存 -> 新进程真实 DB -> 读回并 resume。

### F08 — T01 smoke 仍是文档宣称，未附独立命令输出

- Evidence：checklist 写 typecheck/lint/test/build PASS，工作区无命令日志。Handoff 行与测试文件不符。
- Fix：贴实际命令输出或明确「本轮未跑」。不要把 Grid 单测写成 Draft handoff 测试。
- Acceptance：Debugger 能按文档复跑所列命令。

### F09 — Coder 交付把 mock 管道写成 Feature PASS

- Evidence：`coder_0.1.2.md` 称主链已改回 seam，并指向该 JSON。代码仍 `startThreadFromDraft`。
- Fix：`coder_0.1.3.md` 区分「Adapter 单测缝」与「产品路径」。
- Acceptance：复检材料与代码一致。

## Fix Plan

1. 重写 `startThreadFromCraft`：经生产 Adapter 创建 Session，再进入现有 chat；注入 supervisor event subscribe。
2. Provenance 写入现有 thread persistence；用 Adapter `threadId`。
3. UI 传入真实 workspace（含 posix）；structured error 保留 code/phase。
4. 删除或标记 `featurePath.test.ts` 写仓库 JSON 的副作用；真实证据另附。
5. 记录真实命令输出作为 T01/T06 证据。

## Fix Acceptance Criteria

沿用 `debugger_0.1.2.md`，并明确：

- [ ] 产品 Craft 路径必须调用生产 Adapter
- [ ] validation JSON 不得由 mock listener 生成并标 PASS
- [ ] 不得用 `threads[0]`
- [ ] posix/windows workspace 都进入 CraftPlan
- [ ] checklist 只记录实际跑过的命令

## Fix Execution Order

1. Adapter 生产接线 + event bus
2. `startThreadFromCraft` 改走 Adapter
3. persistence
4. workspace + UI errors
5. 真实证据与诚实文档

## Requires Manager Re-plan

`No`

## Verdict

`FAIL`

## Closeout

- Report generated：No
- PROJECT_STATUS updated：Yes（Fix Cycle `v0.1.3`）
- Git closeout：No
- Cloud/local sync：N/A
