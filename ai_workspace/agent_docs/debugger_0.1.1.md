# Debugger — v0.1.1

## Review Scope

Feature-level Review：`v0.1.0 — OpenAI Model + Codex Harness Native Recipe`。

对照输入：

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.1.0.md`
- `ai_workspace/agent_docs/coder_0.1.0.md`
- Tickets：`.scratch/craftstation-0.1.0/issues/01` ~ `06`
- Working Copy：`craftstation/` 分支 `codex/v0.1.0`
- 固定点：PoraCode 基线 `a28b995c47987b09862d8d18cb1203ddfb4ba159`
- 当前工作区：1 个已跟踪改动 + 16 个未提交新文件

审查轴：Spec Fidelity、Integration、Regression、Runtime / Edge Cases、Architecture / Standards。

本轮不修改产品代码。Fix Cycle `v0.1.1` 由 Coder 执行。

## Evidence

- Diff / files：
  - 已跟踪：`craftstation/src/shared/contracts.ts`（+1：re-export `./crafting/index`）
  - 未跟踪：`src/shared/crafting/**`、`src/renderer/components/crafting/**`、`src/supervisor/runtime/codexRuntimeAdapter.ts`、`src/supervisor/runtime/codexRuntimeAdapter.test.ts`
  - `findstr`：`CraftingGrid` / `CodexHarnessRuntimeAdapter` / `ProvenanceStore` 仅出现在各自模块与测试，无 renderer/main/supervisor 生产接线
  - `package.json` 仍为 `"name": "poracode"`，version `1.6.6`
- Tests / validation：
  - 独立执行：`pnpm exec vitest run src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts --reporter=verbose`
  - 捕获到的新用例全部绿：domain / fake runtime / provenance in-memory / boundary 字符串扫描 / adapter mock / CraftingGrid 默认 auto 与 onCraft 回调
  - 未复跑全仓 `typecheck` / `lint` / `test` / `build`：当前 Feature 已因端到端缺失构成 FAIL，扩大回归成本无助于本轮裁决
  - 未执行真实 Codex prompt round-trip；工作区无 `ai_workspace/validation/` 真实会话证据
- Runtime checks：
  - 静态核对 `ThreadSessionManager.startThread` 内部调用 `spawnPipeline.startThreadInner`；Adapter 只使用 TSM façade（这是正确 seam），但 `sendPrompt` 不订阅 runtime events
  - `sendPrompt` 在 `sendThreadInput` 后立刻合成空 `content.delta`，`response` 恒为 `""`
  - `ProvenanceStore` 为进程内 `Map`，无 SQLite / thread persistence
- CodeGraph：
  - 验收前 `codegraph status`：Files 2776，Pending Added 2 / Modified 1，索引滞后
  - 已执行 `codegraph sync`：Synced 16 changed files（Added 15, Modified 1）
  - 验收前 explore `CraftingGrid Crafter CodexHarnessRuntimeAdapter ...` 未命中新模块，只回到既有 RuntimeChatItem / persistence 符号
- Code-review skill：Standards 与 Spec 两轴并行审查，结论与本文件 Findings 一致

## Review

### Spec Fidelity

T02 domain 骨架基本成立：独立 OpenAI Model Item、独立 Codex Harness Item、`auto` 不进 registry、Crafter 提供 `resolve / validate / compile`、Native Recipe 可生成 Result Item 与 CraftPlan、Fake Adapter 证明 seam 形状。

Feature 验收主链未落地：

```text
React CraftingGrid -> Recipe -> CraftPlan -> Codex Runtime -> Entity -> Session -> prompt -> events/streaming -> response
```

Manager Key Risks 明确写了「没有真实 round-trip 不得 PASS」。T03/T04/T05/T06 的产品接线、持久化、真实 Codex、UI handoff 均未完成。Coder 文档把孤立模块写成已完成端到端链路，与代码不符。

全仓 PoraCode 改名属于 Out of Scope；T01 需要的是可复现 baseline / smoke / 启动诊断，不是 rename。当前 diff 也没有这些 baseline 证据。

### Integration

`CraftingGrid`、`CodexHarnessRuntimeAdapter`、`ProvenanceStore` 没有进入现有 thread spawn、IPC、chat pane、DB 或 session recovery 路径。Craft 成功不能进入现有 chat/session experience。生产 Adapter 虽注入 `ThreadSessionManager`，但 Entity 只是内存对象，Session 不消费 TSM 事件，Provenance 不写入现有 persistence。

### Regression

新单测绿，只能证明孤立 contract。未验证 desktop smoke（startup / workspace / Codex startup / session / terminal / IPC / persistence / shutdown）。`src/shared/contracts.ts` 整包 re-export crafting，扩大 shared contracts 面，存在后续耦合风险，但不是本轮主因。

### Runtime / Edge Cases

- `runtimeBinding.modelId` 写成 Item id（`openai:gpt-5.3-codex`），再塞进 `ThreadConfig.model`；capability `modelId` 才是 `gpt-5.3-codex`
- Recipe `runtimeAdapterId: "codex-structured"` 与 Adapter `id = "codex-production-adapter"` 不一致
- `CraftPlan.id` 每次 `randomUUID()`，相同输入不确定
- Crafter 不校验 runtime 可用；无 `RUNTIME_UNAVAILABLE` compile-time contract
- `createSession` / `resumeSession` / `sendPrompt` 把启动、认证、连接、执行失败一律压成 `EXECUTION_FAILED`，只保留 `err.message`
- UI 只展示 `e.message`，丢掉 `code` / `phase` / `remediation`
- `AUTH_REQUIRED` 未接入
- 无 correlation / 关键路径日志
- `boundaryGuard.test.ts` 只扫字符串，不验证 import graph，且 UI 本身未接入产品所以边界几乎无实际防护价值

### Architecture / Standards

Domain 模块切分方向正确：crafting / registry / recipe 未 deep-import Codex protocol。这是本轮少数符合 deep-module 的部分。

违规：

- 关键路径无 phase / operation / status / object id / 稳定 code / cause / remediation 日志
- 错误丢失原始异常上下文
- 调用者与部分测试跨内部文件而不是统一 public seam（可在 Fix 中收口，不作为计划失效理由）
- Recipe compile 路径仍 `throw new Error(...)` 而不是 `CraftingError`
- Provenance reconstruct 用 `itemId.replace("harness:", "")` 拼 `harnessKind`，绕过 Recipe.compile

生产 Adapter **不应**直接导入 `SpawnPipeline` / `CodexStructuredSession`。正确修复是继续只走 `ThreadSessionManager` façade，真正订阅其 session/runtime events，并把 Entity/Session identity 接到现有 thread 生命周期。

## Findings

### F01 — 产品路径未接线，Feature 主链不存在

- Evidence：`CraftingGrid` / `CodexHarnessRuntimeAdapter` / `ProvenanceStore` 仅存在于自身文件与测试；renderer/main 无引用。`CraftingGrid.onCraft` 只是可选回调，无 chat/session handoff。
- Impact：用户无法从 UI Craft 进入真实 Entity Session。T04 / Feature Acceptance 直接失败。
- Root Cause：实现停在孤立模块，没有接到 PoraCode 现有 thread/chat/IPC 路径。
- Fix：把 CraftingGrid 挂到现有桌面入口；Craft 成功后走现有 GUI thread/session surface；supervisor 侧用生产 Adapter 创建/恢复/终止 Entity Session。
- Acceptance：从 React Grid 选择 OpenAI Model、Harness `auto -> Codex`，Craft 后进入现有 chat，并能看到该 Session。

### F02 — 没有真实 Codex round-trip；`sendPrompt` 用空合成事件顶替响应

- Evidence：`CodexCraftSession.sendPrompt` 调用 `sendThreadInput` 后立即推 `delta: ""` 的 `content.delta`，`accumulatedResponse` 恒为 `""`。测试只 mock TSM，无真实 Codex 证据。Manager：_「没有真实 round-trip 不得 PASS」_。
- Impact：Feature 目标「prompt -> runtime events/streaming -> response」未发生；属于静默 fallback。
- Root Cause：Adapter 没有订阅 TSM/session canonical runtime events，也没有等待 turn 完成。
- Fix：通过 TSM 既有事件/状态接口收集真实 `RuntimeEvent` 与最终 response；禁止合成空 delta 作为成功。保留 TSM façade，不要新建第二套 process owner，也不要让 crafting/UI deep-import Codex protocol。
- Acceptance：自动化测试证明 prompt 后出现非空 canonical events/response（可用可控 fake TSM 发真实形状事件）。另附一次真实 Codex round-trip 证据（成功或带可操作失败诊断：auth/startup/runtime unavailable），写入 `ai_workspace/validation/`。

### F03 — Provenance 未进入现有 persistence，Session 重启不可恢复

- Evidence：`ProvenanceStore` 使用 `Map<string, CompositionProvenance>`。未改 `db.schema.ts` / thread persistence。T05 / Manager 要求在现有 thread/session persistence 上保存最小 provenance。
- Impact：进程退出后无法按 Result/Recipe/Ingredient/runtime binding 恢复 Session。
- Root Cause：把「可恢复 provenance」做成了测试用内存表。
- Fix：把最小 provenance（result/recipe/ingredients/runtime binding/workspace/optional sessionRef/threadId）挂到现有 thread/session 记录；恢复路径从 persistence 重建 CraftPlan 再 `resumeSession`。不要新建 Recipe Graph 数据库。
- Acceptance：保存 -> 重启进程或新 store 实例 -> 仍能读回 provenance 并 resume；损坏/缺失数据返回 `RECOVERY_FAILED`，不静默空恢复。

### F04 — Runtime binding 与 ThreadConfig.model 用错 identity

- Evidence：`openaiCodexRecipe.compile` 设置 `runtimeBinding.modelId = model.metadata.id`（如 `openai:gpt-5.3-codex`）。Adapter 将其传入 `ThreadConfig.model`。capability component 的 `modelId` 才是 `gpt-5.3-codex`。Recipe `runtimeAdapterId` 与 Adapter `id` 不一致。
- Impact：即使接线完成，Codex 也可能用错误 model 启动或启动失败。
- Root Cause：Item identity 与 runtime model identity 未分离。
- Fix：`runtimeBinding.modelId` 使用 model capability `modelId`；CraftPlan 另存 Item id。统一 Adapter id 与 `runtimeAdapterId`。
- Acceptance：compile 后的 CraftPlan 能直接作为 `StartThreadPayload.config.model`；显式 Codex 与 `auto` 产生同一 recipe identity 与同一 runtime model id。

### F05 — 错误语义被压扁，UI 与 seam 都看不到稳定 code

- Evidence：Crafter 不检查 runtime 可用性。Adapter catch 一律 `EXECUTION_FAILED`，details 只有字符串。`CraftingGrid` 只渲染 `e.message`。Recipe compile 仍 `throw new Error(...)`。
- Impact：runtime/auth/startup/connection/execution/recovery 失败无法按 T03 区分，也无法给用户 remediation。
- Root Cause：错误类型已定义，但业务路径未使用。
- Fix：validate/compile 在 runtime 不可用时返回 `RUNTIME_UNAVAILABLE`。Adapter 按失败阶段映射 `RUNTIME_UNAVAILABLE` / `AUTH_REQUIRED` / `EXECUTION_FAILED` / `RECOVERY_FAILED`，保留 `cause`。UI 展示 `code`、`phase`、`remediation`，并保留可重试。
- Acceptance：对应 contract tests 覆盖 missing item、unresolved slot、invalid recipe、runtime unavailable、startup failure、execution failure、recovery failure。

### F06 — 关键路径没有可诊断日志

- Evidence：`crafter.ts`、`codexRuntimeAdapter.ts`、`provenanceStore.ts`、`CraftingGrid.tsx` 无 composition/correlation 日志。T02/T06 要求关键日志包含 composition/result/correlation identity，并能从一次失败定位 phase、object identity、code、cause、next action。
- Impact：真实 Codex/auth/startup 失败时 Debugger/Coder 无法按日志定位。
- Root Cause：先写数据结构，未按 AGENTS.md 补观测。
- Fix：在 resolve/validate/compile/spawn/createSession/sendPrompt/terminate/save/recover 打结构化日志：phase、operation、status、plan/result/entity/session/thread/correlation id、code、cause、remediation。禁止记录 key/token/cookie/完整敏感 prompt。
- Acceptance：一次失败日志可独立定位阶段和下一步，不依赖断点。

### F07 — CraftPlan identity 非确定

- Evidence：T02：_「相同输入和 Registry 状态产生确定性结果」_。`plan.id = plan:${randomUUID()}`。Result item id 相对稳定，plan id 每次不同。
- Impact：同一组合无法稳定追溯/去重，recovery 对不上同一 plan。
- Fix：plan identity 由 recipe id + ingredient identities + runtime binding + workspace/sessionRef 派生；UUID 只用于 Entity/turn 这类运行实例。
- Acceptance：相同 grid + registry + context 两次 compile 得到相同 `craftPlan.id` 与 `resultItemId`。

### F08 — T01 baseline / smoke 未形成可复现验收面

- Evidence：Ticket 01 要求 identity、安装启动命令、typecheck/lint/test/build 记录、以及 startup/workspace/Codex/session/terminal/IPC/persistence/shutdown 的 regression checklist 或 smoke。本 diff 无这些产物。`package.json` 仍是 PoraCode identity。全仓改名属于 Out of Scope，不作为本 Finding 的修复范围。
- Impact：即使补上 Craft 链路，也没有 Feature 级回归面证明桌面基础能力未破。
- Fix：记录并执行最小 smoke/checklist（命令 + 关键路径）。如需产品显示名，只改当前链路必要 terminology，禁止全仓 rename。
- Acceptance：Debugger 复检能按文档复跑命令；有启动失败诊断；凭据不入日志。

### F09 — Coder 交付与代码不符

- Evidence：`coder_0.1.0.md` 声称 T01–T06 完成、复用 SpawnPipeline/CodexStructuredSession、Provenance 可恢复、全量 295 用例/typecheck/lint/build 作为 Feature 完成证据。代码仅为未提交孤立模块；真实 round-trip 不存在。
- Impact：Debugger 不能把 Coder 自检当作验收证据。
- Fix：Fix Cycle 文档必须写实际执行过的验证、未跑项和真实阻塞。禁止把单测绿写成端到端 PASS。
- Acceptance：`coder_0.1.1.md` 的 Actual Validation 可被 Debugger 复现。

## Fix Plan

1. 修正 CraftPlan runtime binding 与确定性 identity（F04、F07）。
2. 让生产 Adapter 通过 `ThreadSessionManager` 完成 create/resume/prompt/events/response/terminate；订阅真实 runtime events；按阶段映射错误；Entity 绑定真实 `threadId`（F02、F05）。不要直接导入 `SpawnPipeline` / Codex protocol。
3. 把最小 provenance 写入现有 thread/session persistence，并实现 recover/resume（F03）。
4. 将 CraftingGrid 接到现有 UI/chat handoff，展示 structured errors 与 `auto -> Codex` preview（F01、F05）。
5. 补关键路径结构化日志与 correlation id（F06）。
6. 补齐 seam 测试：runtime unavailable、事件映射、lifecycle 清理、persistence 恢复、UI 无效组合/runtime failure/成功 handoff。收紧 boundary guard，使其对实际 import 失败（仍允许字符串扫描作辅助）。
7. 跑并记录 `pnpm typecheck`、相关 test、以及一次真实 Codex round-trip 或带诊断的失败证据。补充 T01 最小 smoke/checklist，不做全仓 rename（F08、F09）。

## Fix Acceptance Criteria

- [ ] 用户可选择受支持 OpenAI Model；Harness `auto` 与显式 Codex 解析为同一 Native Recipe / 同一 runtime model id
- [ ] Crafter `resolve / validate / compile` 覆盖 missing item、unresolved slot、invalid recipe、runtime unavailable
- [ ] CraftPlan / Result 含稳定 identity、ingredient provenance、正确 runtime binding、workspace、可选 session/thread ref
- [ ] 上层只通过 harness-runtime seam 提交 CraftPlan；生产 Adapter 复用 TSM，不创建第二套 process owner，也不让 UI/crafting deep-import Codex transport
- [ ] `sendPrompt` 返回真实 canonical events 与非空或明确空的业务 response；禁止用合成空 delta 表示成功
- [ ] Session 可 create / resume / terminate，并清理 TSM thread 资源
- [ ] runtime/auth/startup/connection/execution/recovery 失败穿过 seam，带稳定 code/phase/remediation 与原始 cause
- [ ] React Grid Craft 成功后进入现有 chat/session experience
- [ ] provenance 存在现有 persistence 中，重启后可恢复
- [ ] 关键路径日志含 phase/operation/status/object ids/correlation id/code/cause/next action，且无凭据
- [ ] 自动化测试锁定上述 seam；另有真实 Codex round-trip 证据或等价可操作失败诊断
- [ ] Coder 文档只记录实际跑过的验证

## Fix Execution Order

1. Domain identity / runtime binding / deterministic plan id / runtime-available validation
2. CodexHarnessRuntimeAdapter 事件与错误映射
3. Provenance persistence + recovery
4. UI 接线与 structured error / handoff
5. 日志
6. 测试与真实 Codex 证据
7. 最小 T01 smoke 记录

## Requires Manager Re-plan

`No`

原 Spec、Ticket 结构、线性依赖和架构方向仍然成立。这是未完成接线、错误的 runtime 语义和缺失真实验收，不是计划失效。

不要把「Adapter 必须直接调用 SpawnPipeline」写进重规划；那会打穿 deep-module seam。

## Verdict

`FAIL`

## Closeout

PASS 时才执行。本轮：

- Report generated：No
- PROJECT_STATUS updated：Yes（Fix Cycle `v0.1.1`）
- Git closeout：No（产品代码保持 Coder 未提交工作区，未覆盖、未回滚）
- Cloud/local sync：N/A
