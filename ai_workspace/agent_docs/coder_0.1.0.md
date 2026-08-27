# Coder v0.1.0 — OpenAI Model + Codex Harness Native Recipe Implementation Report

## Summary

根据 Manager v0.1.0 规划与 `.scratch/craftstation-0.1.0/issues/` 的 6 个 Tickets，以 `craftstation/` 为工作副本，基于 PoraCode 基线完成了 CraftStation Minecraft Composition Model 的首条 Native Recipe 核心链路实现与 deep-module 重构。

完成的架构主链：
```text
OpenAI Model Item + Codex Harness Item (or auto)
-> Registry & Native Recipe -> Crafter (resolve/validate/compile)
-> Result Item + CraftPlan -> CodexHarnessRuntimeAdapter (harness-runtime seam)
-> Entity -> Session -> sendPrompt -> Canonical RuntimeEvents / Streaming -> Terminate / Cleanup
-> ProvenanceStore (Session Recovery & Reconstruct)
-> React CraftingGrid Component (UI Preview, Slot Validation, Craft Handoff)
```

## Implemented Tickets & Components

### 1. v0.1/T01: 建立 CraftStation Working Baseline 与 Regression Harness
- 初始化依赖安装与 Electron native 依赖环境（better-sqlite3）。
- 锁定全套工具链命令：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`。
- 确认现有 Codex app-server、stdio、JSON-RPC、canonicalMapping 等 13 个测试套件（270 个用例）全部保持 100% 绿灯。

### 2. v0.1/T02: 实现 Crafting Domain、Registry 与 Crafter
- **文件路径**:
  - `src/shared/crafting/types.ts`: 定义 Item、ItemMetadata、Component、ModelCapabilityComponent、HarnessRuntimeComponent、IngredientProvenance、CompositionProvenance、RuntimeBinding、CraftPlan、ResultItem、CraftingGrid、ResolvedGrid、Recipe、CraftingErrorDetail 等核心数据契约。
  - `src/shared/crafting/errors.ts`: 结构化 `CraftingError` 类，包含标准错误代码（`ITEM_NOT_FOUND`, `UNRESOLVED_SLOT`, `RECIPE_NOT_FOUND`, `INCOMPATIBLE_COMBINATION`, `RUNTIME_UNAVAILABLE`, `COMPILATION_ERROR`, `AUTH_REQUIRED`, `EXECUTION_FAILED`, `RECOVERY_FAILED`）及阶段（`resolve`, `validate`, `compile`, `runtime`, `recovery`）与 remediation 指引。
  - `src/shared/crafting/recipes/openaiCodexRecipe.ts`: 实现 `OpenAICodexNativeRecipe`，声明 Model/Harness Slot 需求，实现 `matches` 与 `compile` 编译生成 CraftPlan。
  - `src/shared/crafting/registry.ts`: 实现 `ItemRegistry`，内置 4 款 OpenAI 模型 Item（`openai:gpt-5.3-codex`, `openai:gpt-5-hybrid`, `openai:gpt-4o`, `openai:o3-mini`）及 Codex Harness Item（`harness:codex`）。支持确定性 `auto` 解析为 Codex Harness Item（`auto` 本身不注册为 Item）。
  - `src/shared/crafting/crafter.ts`: 实现 `Crafter`（`resolve -> validate -> compile`），提供确定性决策与编译。
  - `src/shared/crafting/runtimeInterface.ts`: 定义 `Entity`, `CraftSession`, `HarnessRuntimeAdapter` seam 契约。
- **单元测试**: `src/shared/crafting/crafting.test.ts`（12 个测试全过，包含 Fake Runtime Adapter 生命周期）。

### 3. v0.1/T03: 通过 Codex Runtime 运行 Entity Session
- **文件路径**:
  - `src/supervisor/runtime/codexRuntimeAdapter.ts`: 实现 `CodexHarnessRuntimeAdapter` 与 `CodexCraftSession`，复用 Supervisor 的 `ThreadSessionManager`、`SpawnPipeline` 与 `CodexStructuredSession`，上层仅跨 `HarnessRuntimeAdapter` seam 提交 CraftPlan 并控制 Session 生命周期（`spawnEntity`, `createSession`, `resumeSession`, `sendPrompt`, `terminate`）。
- **集成测试**: `src/supervisor/runtime/codexRuntimeAdapter.test.ts`（3 个测试全过）。

### 4. v0.1/T04: React Crafting Grid 到真实 Session
- **文件路径**:
  - `src/renderer/components/crafting/CraftingGrid.tsx`: 实现 Agent Crafting Table React 组件，提供 Model Slot 选择、Harness Slot 选择（默认 `auto` 并展示确定性解析）、实时 Recipe / Result Preview、Slot 校验、Prompt 输入与 Craft Agent 动作派发。
- **组件测试**: `src/renderer/components/crafting/CraftingGrid.test.tsx`（4 个测试全过，验证默认 auto、显式 Codex、更换模型、Craft 触发与参数传递）。

### 5. v0.1/T05: 持久化 Composition Provenance 与 Session Recovery
- **文件路径**:
  - `src/shared/crafting/provenanceStore.ts`: 实现 `ProvenanceStore`，负责持久化存储/提取 `CompositionProvenance`、校验 provenance 完整性、重建 `CraftPlan`，并通过 `HarnessRuntimeAdapter` 恢复已有 Entity Session。
- **单元测试**: `src/shared/crafting/provenanceStore.test.ts`（4 个测试全过，覆盖保存获取、重建、无效 Recipe 报错以及 SessionRef 恢复）。

### 6. v0.1/T06: Deep-Module 架构防线与全量回归
- **文件路径**:
  - `src/shared/crafting/boundaryGuard.test.ts`: 架构防线测试，自动递归扫描 `src/shared/crafting` 与 `src/renderer/components/crafting`，断言没有任何底层 Codex transport、JSON-RPC、node-pty 或 child_process 的侵入导入。
- **全量测试结果**:
  - `pnpm vitest run src/shared/crafting/ src/supervisor/runtime/codexRuntimeAdapter.test.ts src/renderer/components/crafting/ src/supervisor/agents/codex/` -> **18 test files, 295 passed (0 failed)**
  - `pnpm typecheck` -> **Pass (0 errors)**
  - `pnpm lint` -> **Pass (0 warnings, 0 errors)**
  - `pnpm build` -> **Pass (renderer & electron bundle built successfully)**

## Ticket Status Table

| Ticket ID | Name | Status |
|---|---|---|
| `v0.1/T01` | 建立 CraftStation Working Baseline 与 Regression Harness | `COMPLETED` |
| `v0.1/T02` | Craft OpenAI + Codex Native Recipe | `COMPLETED` |
| `v0.1/T03` | 通过 Codex Runtime 运行 Entity Session | `COMPLETED` |
| `v0.1/T04` | React Crafting Grid 到真实 Session | `COMPLETED` |
| `v0.1/T05` | 持久化 Composition Provenance 与 Session Recovery | `COMPLETED` |
| `v0.1/T06` | Deep Module Guards 与 Feature 交付 | `COMPLETED` |

## Hand-off to Debugger

所有代码、契约、适配层、UI 组件、持久化机制、边界防线测试以及全量类型/代码检查均已就绪。
请 Debugger 执行全面回归测试与验收，完成 Feature Closeout。
