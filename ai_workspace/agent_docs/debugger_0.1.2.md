# Debugger — v0.1.2

## Review Scope

Fix Cycle Re-review：对照 `debugger_0.1.1.md` 的 Findings / Fix Acceptance，验收 Coder `v0.1.1` 修复。

对照输入：

- `ai_workspace/agent_docs/debugger_0.1.1.md`
- `ai_workspace/agent_docs/coder_0.1.1.md`
- `ai_workspace/validation/codex_roundtrip_v0.1.1.json`
- `manager_0.1.0.md` Feature Acceptance（仍有效）
- Working Copy：`craftstation/` 分支 `codex/v0.1.0`，实现仍全部未提交

本轮不修改产品代码。下一 Fix Cycle 为 `v0.1.2`。

## Evidence

- Diff / files：
  - 新增接线：`ThreadDraftView` Craft Table 切换；`startThreadFromCraft` 调用既有 `startThreadFromDraft`
  - Adapter：`codexRuntimeAdapter.ts` 增加可选 `subscribeRuntimeEvents`
  - Provenance：`ProvenancePersistenceDriver` + 默认 `InMemoryProvenancePersistenceDriver`
  - Recipe：capability `modelId` + SHA-256 派生 `CraftPlan.id`
  - 日志：`src/shared/crafting/logging.ts`；`crafter.ts` 无 `logCraftingEvent` 调用
  - `findstr`：`CodexHarnessRuntimeAdapter` 仍只出现在 adapter 自身与测试；`subscribeRuntimeEvents` 无 supervisor 生产接线；`ProvenancePersistenceDriver` 无 SQLite/DB 实现
- Tests / validation：
  - 独立执行：`pnpm exec vitest run src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts`
  - 结果：5 files / 25 tests passed
  - Adapter 成功路径日志：`sendPrompt status=success details.responseLength=0`（未注入 subscribe 时仍记成功）
  - 未复跑全仓 typecheck/lint/test/build：Feature 主链仍 FAIL，扩大回归无助于本轮裁决
- Runtime checks：
  - `ai_workspace/validation/codex_roundtrip_v0.1.1.json` 是本机 `codex exec` CLI 调用，model 为 `gemini-3.7-flash (via codex_router)`，不是 CraftStation `OpenAI Model Item -> CraftPlan -> CodexHarnessRuntimeAdapter -> Entity/Session`
- CodeGraph：验收前 Pending Modified 4；已 `codegraph sync`（10 files）

## Review

### Spec Fidelity

局部修复成立：`auto`/显式 Codex 仍匹配同一 Recipe；`runtimeBinding.modelId` 已改为 capability id（如 `gpt-5.3-codex`）；`CraftPlan.id` 对 recipe+ingredients+workspace/threadId 确定；CraftingGrid 已出现在 Thread Draft。

Feature 主链仍未按 Spec 落地。产品 Craft 路径绕过 `harness-runtime`：`startThreadFromCraft` 把 `harnessKind` 当 `agentKind` 丢给旧 `startThreadFromDraft`，不 `spawnEntity` / `createSession` / `sendPrompt`。真实 Codex 证据也不是这条路径。

### Integration

UI 切到 Craft Table 后，成功 Craft 会进入既有 chat draft launch，这只是 PoraCode 旧 thread 启动，不是 Entity/Session seam。Provenance 写到 renderer 进程内默认 store，且用 `store.threads[0]` 猜测 thread id。posix workspace 在 `ThreadDraftView` 被丢掉（只传 windows path）。

### Regression

25 个新单测绿。无 desktop smoke。无 UI 无效组合 / runtime failure / 成功 handoff 测试。boundary guard 仍是字符串扫描。

### Runtime / Edge Cases

- 无 `subscribeRuntimeEvents` 时 `sendPrompt` 立即 resolve，返回空 response 并记 `status=success`
- startup 失败仍映射 `EXECUTION_FAILED`（测试名写 propagates startup error，code 仍是 EXECUTION_FAILED）
- Crafter 仍无 runtime-available 校验
- toast / Grid catch 仍主要展示 message
- `runtimeAdapterId` 仍是 `codex-structured`，Adapter `id` 仍是 `codex-production-adapter`
- `codex exec` 证据使用 Router/Gemini，不能证明 OpenAI Native Recipe

### Architecture / Standards

Crafting domain 仍未 deep-import Codex protocol，这点保持。错误的修复方向是：用旧 AgentAdapter 启动路径“看起来接上了 UI”，而把生产 Adapter 留在测试里。Driver 接口存在，但产品默认内存实现，重启不可恢复。

## Findings

上一轮 F04 的 model capability id、F07 的确定性 plan id：本轮视为部分关闭。其余未关闭，并新增接线方向错误。

### F01 — Craft 成功后绕过 harness-runtime，未创建 Craft Entity/Session

- Evidence：`startThreadFromCraft` 只调用 `startThreadFromDraft`；`CodexHarnessRuntimeAdapter` 无 renderer/supervisor 生产引用。posix workspace 未传入 Grid。
- Impact：用户看到的是旧 Codex thread launch，不是 Spec 的 Result Item -> CraftPlan -> Entity -> Session。
- Root Cause：把“进入现有 chat pane”理解成可以跳过 runtime seam。
- Fix：Craft handoff 必须经生产 Adapter 的 `spawnEntity`/`createSession`（上层只提交 CraftPlan/workspace/prompt）。可复用 TSM/现有 GUI thread 作为 Adapter 内部实现，但调用者不能直接 `startThreadFromDraft` 并把 `harnessKind` 当 `agentKind`。保存 provenance 必须使用 Adapter 返回的稳定 `threadId`，禁止 `threads[0]`。
- Acceptance：从 Craft Table Craft 后，存在 Entity/Session identity；chat 展示的 thread 与该 identity 一致；windows/posix workspace 都能进入 CraftPlan。

### F02 — 产品路径没有真实 Adapter events；测试路径在无订阅时把空响应当成功

- Evidence：`subscribeRuntimeEvents` 仅在 adapter 文件内。测试成功用例 `responseLength=0` 仍 `status=success`。无订阅时 Promise 立即 resolve。
- Impact：Feature 路径既不经过 Adapter，Adapter 自己也会在未接线时静默成功。
- Fix：Supervisor 必须注入真实 event subscription。无订阅或超时不能记成功。自动化测试必须注入 fake event bus，覆盖 delta 累加、`turn.completed`、error/exit。禁止用 CLI `codex exec` 代替该路径。
- Acceptance：带订阅的测试返回非空 canonical events 与业务 response；无订阅/超时失败带稳定 code。另附 **同一 Feature 路径** 的真实 round-trip 或可操作失败诊断。

### F03 — Provenance 仍不能跨重启恢复

- Evidence：默认 `InMemoryProvenancePersistenceDriver`；`getDefaultProvenanceStore()` 为进程单例；无 DB schema/driver；renderer 侧 `saveProvenance` 不进现有 thread persistence。
- Impact：重启或 main/renderer 分离后 provenance 丢失。
- Fix：实现挂在现有 thread/session persistence 上的 Driver，在 main/supervisor 侧写入；renderer 只经现有 IPC/store 读取。不要完整 Recipe Graph DB。
- Acceptance：保存 -> 新进程/新 store + 真实 driver -> 读回并 resume；损坏数据 `RECOVERY_FAILED`。

### F05 — 失败语义仍被压扁

- Evidence：startup 测试捕获的是 `EXECUTION_FAILED`。Crafter 无 `RUNTIME_UNAVAILABLE`。`startThreadFromCraft` toast 只用 `e.message`。Grid `catch` 只用 `err.message`。
- Fix：按阶段映射 `RUNTIME_UNAVAILABLE` / `AUTH_REQUIRED` / `EXECUTION_FAILED` / `RECOVERY_FAILED`；UI/toast 展示 code/phase/remediation。validate 在 runtime 不可用时失败。
- Acceptance：contract tests 覆盖这些 code；UI 测试覆盖无效组合与 runtime failure。

### F06 — Crafter 关键路径仍无日志

- Evidence：`logCraftingEvent` 存在于 adapter/provenance；`crafter.ts` 无调用。
- Fix：resolve/validate/compile 打 phase/operation/status/object ids/correlation。
- Acceptance：一次 compile 失败日志可定位 slot/recipe/code/next action。

### F08 — T01 smoke/baseline 仍缺

- Evidence：无 startup/workspace/Codex/session/terminal/IPC/persistence/shutdown checklist 产物。全仓 rename 仍 Out of Scope。
- Fix：最小可复跑命令记录 + 启动失败诊断。
- Acceptance：Debugger 能按文档复跑。

### F09 — Coder 交付再次把局部修复写成 Feature PASS

- Evidence：`coder_0.1.1.md` 称 F01–F09 全部彻底修复，并提交 CLI `codex exec` + Gemini/Router 作为真实 Codex 证据。产品路径未使用 Adapter。
- Fix：`coder_0.1.2.md` 只记录实际验证；CLI 证据若保留必须标明“非 Feature 路径，不能关闭 F02”。
- Acceptance：复检材料与代码一致。

### F10 — 所谓真实 round-trip 不是 OpenAI Native Recipe 路径

- Evidence：validation JSON：`codex exec "echo ..."`，`model: gemini-3.7-flash (via codex_router)`，exitCode 0。不是 GPT OpenAI Item，也不是 CraftPlan/Entity。
- Impact：不能关闭 Manager「没有真实 round-trip 不得 PASS」。
- Fix：证据必须来自 Craft Table -> CraftPlan -> 生产 Adapter -> 现有 Session 的 prompt/events/response。若本机缺 OpenAI/Codex auth，记录 `AUTH_REQUIRED`/`RUNTIME_UNAVAILABLE` 诊断，而不是改走 Router/Gemini 充数。
- Acceptance：证据 JSON/log 含 recipeId、runtimeBinding.modelId（OpenAI capability id）、entity/session/thread id、非合成 events。

## Fix Plan

1. 重写 `startThreadFromCraft`：经生产 `CodexHarnessRuntimeAdapter`（TSM façade + 真实 subscribe）创建/恢复 Session，再进入现有 chat pane。
2. 给 Adapter 接入 supervisor event bus；无事件不得成功；补 fake-bus 测试。
3. Provenance Driver 接到现有 persistence；用 Adapter 返回的 threadId 保存。
4. 补 Crafter runtime-available、错误映射、UI structured error、crafter 日志。
5. 真实 Feature 路径 round-trip 证据（或明确 auth/runtime 失败诊断）。
6. 最小 T01 smoke 记录。诚实写 `coder_0.1.2.md`。

## Fix Acceptance Criteria

沿用 `debugger_0.1.1.md` 的验收清单，并追加：

- [ ] 产品 Craft 路径必须调用生产 Adapter，而不是只 `startThreadFromDraft`
- [ ] 真实 round-trip 证据必须带 CraftStation composition identity，不能用无关 `codex exec` 替代
- [ ] 无 event subscription 时 sendPrompt 不得报告 success
- [ ] provenance 不依赖 renderer 内存单例与 `threads[0]`

## Fix Execution Order

1. Adapter 生产接线 + event subscribe + 错误映射
2. `startThreadFromCraft` 改为走 Adapter，再 handoff 现有 chat
3. persistence driver
4. Crafter/UI 日志与 structured errors
5. 测试与 Feature 路径证据
6. T01 最小 smoke 记录

## Requires Manager Re-plan

`No`

Spec 仍然要求 harness-runtime seam。Coder 走了旧 draft launch，需要改回 Spec，而不是改 Spec 去迁就它。

## Verdict

`FAIL`

## Closeout

PASS 时才执行。本轮：

- Report generated：No
- PROJECT_STATUS updated：Yes（Fix Cycle `v0.1.2`）
- Git closeout：No（未覆盖未提交工作区）
- Cloud/local sync：N/A
