# Debugger — v0.3.0 / T01 Review

## Review Scope

对照 `manager_0.3.0.md` 的 `v0.3/T01` 与 Coder 报告 `coder_0.3.0.md`。

这不是 Feature Closeout。v0.3.0 还有 T02–T09。本轮只验收 T01：Native Runtime Interface + Fake Parity Harness。

## Evidence

- Coder：`ai_workspace/agent_docs/coder_0.3.0.md`
- Ticket：`.scratch/craftstation-0.3.0/issues/01-native-runtime-interface-parity-harness.md`（Coder 标 done）
- 关键文件：
  - `src/shared/crafting/runtimeInterface.ts`
  - `src/shared/crafting/fakeCodexHarness.ts`
  - `src/shared/crafting/fakeCodexHarness.test.ts`
  - `src/shared/crafting/types.ts`（`runtimeOverridesSchema`）
  - `src/shared/crafting/recipes/openaiCodexRecipe.ts`
  - `src/supervisor/runtime/codexRuntimeAdapter.ts`（为满足新 `CraftSession` 补了方法）
- Debugger 独立跑：
  `vitest run src/shared/crafting/fakeCodexHarness.test.ts src/shared/crafting/boundaryGuard.test.ts src/shared/crafting/crafting.test.ts`
  结果：3 files / 22 tests passed
- CodeGraph：验收前滞后；已 `codegraph sync`（46 files）

## Review

### Spec Fidelity（相对 T01，不是整 Feature）

T01 要求的 fake seam 已落地：

- fake Runtime 从 CraftPlan 创建 Entity/Session
- `startTurn` 流式发 `item.started` / `content.delta` / `turn.completed`
- `subscribe` + `getSnapshot`
- `interrupt` / AbortSignal
- `terminate` 清理 listeners
- CraftPlan `overrides` 可选，未指定字段可缺失
- Turn 完成不依赖固定 60s timeout（fake 路径）
- Crafting/Crafter/UI 仍不导入 Codex JSON-RPC DTO

### Integration

生产 `CodexCraftSession.startTurn` 仍包装旧 `sendPrompt`，而 `sendPrompt` 仍有 60s timeout。这不阻断 T01（T01 验收面是 Interface + fake harness），但 T02/T03 不能把这条当新 runtime。

### Regression

相关 crafting / fake harness / boundary 测试绿。未跑全仓 test。工作区仍混有 v0.1/v0.2 未提交品牌与 UI 改动，不在本 Ticket 范围。

### Runtime / Edge Cases

fake 覆盖：overrides 传递、流式 snapshot、多轮、interrupt、resume、terminate、turn failure。无真实 app-server，符合 T01。

### Architecture

方向正确：后续官方 Codex 应跨同一 `CraftSession` seam。当前产品路径仍是 v0.1 的 TSM Adapter。

## Findings

T01 范围内无阻断 Finding。

记录给后续 Ticket（不触发 Fix Cycle）：

- `CodexCraftSession.startTurn` 仍走 60s `sendPrompt`，不是事件驱动 completion
- Feature 未完成，不得 Feature PASS / Closeout

## Verdict

`T01 ACCEPT`  
`Feature v0.3.0: NOT READY`

Requires Manager Re-plan：`No`

## Next Step

Coder 继续 `v0.3/T02`：直接连接官方 `codex app-server`。不要把 TSM Adapter 的 `startTurn` 包装当作 T02 完成。
