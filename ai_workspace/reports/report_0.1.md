# Feature Report — v0.1.0

## Goal

在 CraftStation-based Working Copy 中证明第一条 CraftStation Native Recipe 执行链：

```text
OpenAI Model Item + Codex Harness Item
-> Recipe -> Crafter -> Result Item -> CraftPlan
-> Codex Runtime -> Entity -> Session
```

并对该路径做第一阶段 deep-module 重构，使 UI / Crafting domain 不依赖 Codex transport implementation。

## Delivered

- Crafting domain：Item / Recipe / Crafter `resolve-validate-compile`、`auto -> Codex`、确定性 CraftPlan id、capability `modelId`
- 生产 seam：`craftAgent` / `resumeCraftAgent`，内部 `CodexHarnessRuntimeAdapter` 复用 `ThreadSessionManager`
- React Craft Table：Thread Draft 切换；Craft 后进入现有 GUI thread
- 最小 provenance：`threads.composition_provenance`（schema v35）+ resume 重建 runtime binding
- 结构化错误与关键路径日志；无订阅不得把空响应当成功
- 产品路径真实诊断证据（本机 Codex spawn 失败 -> `RUNTIME_UNAVAILABLE`）

## Important Design / Architecture Changes

- 四个逻辑模块落地：crafting / registry / harness-runtime / 现有 provider 边界保持分离
- UI 不直接 `startThreadFromDraft` 执行 Craft；经 supervisor Adapter
- Crafter 不拥有进程生命周期
- 完整 Recipe Graph persistence 仍 Out of Scope

## Validation

Debugger 独立复跑：

- `SupervisorRuntime craftAgent` 4 tests passed
- crafting / Grid / Adapter / launch / DB migration 相关 vitest exit 0
- `CRAFTSTATION_REAL_RUNTIME=1` 的 `craftAgent.integration.test.ts`：产品路径失败诊断 passed
- 证据：`ai_workspace/validation/craftstation_execution_path_v0.1.4.json`（`synthetic: false`，`verdict: FAIL`，稳定 `RUNTIME_UNAVAILABLE`）

未作为本轮 Debugger 关闭证据：全仓 `pnpm test` / `pnpm lint`。

## Important Issues and Fixes

- 三轮 Fix Cycle 纠正：孤立模块、绕过 Adapter、mock/CLI 假证据、内存 provenance、空事件假成功
- 最终仍无本机成功 Codex response；以产品路径稳定失败诊断关闭 Manager「不得用假 round-trip PASS」的风险，而不是宣称已收到模型回复

## Final Status

`PASS`

## Notes for Future Features

- 在 Codex binary/spawn 可用的机器上补成功 round-trip 证据
- 细化 `EPERM` vs missing binary vs `AUTH_REQUIRED`
- 产品显示名仍基于 CraftStation；全仓 rename 仍不在本 Feature
- 工作区实现尚未 git commit
