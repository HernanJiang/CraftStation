# Manager v0.1.0 — OpenAI Model + Codex Harness Native Recipe

## Objective

在新的 PoraCode-based `craftstation/` Working Copy 中证明第一条正式 CraftStation execution path：

```text
OpenAI Model Item + Codex Harness Item
-> Native Recipe -> Crafter -> Result Item -> CraftPlan
-> Codex Runtime -> Entity -> Session
-> prompt -> runtime events/streaming -> response
```

同时通过 Strangler Refactor 建立第一批 CraftStation deep modules，使上层 domain 与 React UI 不再依赖 Codex transport implementation。

旧 DSH-based v0.0/v0.1 路线没有通过当前 Feature 验收，统一状态为 `NOT PASSED / SUPERSEDED`，不作为实现输入。

## Problem Statement

用户需要 CraftStation 从“以某个 Harness 为产品本体”的路线迁移为真正的 Agent Runtime Composition System。当前 PoraCode 已经具备可靠的 Codex process、transport、session、IPC、workspace 与 persistence implementation，但其 `AgentAdapter` 与 UI/runtime abstractions 不是 CraftStation 的 Minecraft Composition Model，也向调用者暴露了过多 Harness-specific 知识。

v0.1.0 需要在不重写成熟 infrastructure 的前提下，让用户通过 OpenAI Model Item 与 Codex Harness Item 形成真实 Recipe，得到可执行 CraftPlan，并运行、恢复和终止 Entity/Session。

## Solution

以 PoraCode 为产品代码基线，在现有 execution path 外建立 CraftStation domain 与三个关键 seam：

1. `crafting` 负责 `resolve / validate / compile`。
2. `registry` 负责 Items、Recipes 与 runtime binding。
3. `harness-runtime` 负责把 CraftPlan 变成 Entity/Session，并隐藏 Codex app-server、stdio、JSON-RPC、pool 与 Codex-specific session。

CLIProxyAPI 作为独立 Go provider/API implementation 保留，通过公开 seam 接入；Codex 原生认证路径不因本 Feature 被强制改道。

## User Stories

1. 作为 CraftStation 用户，我希望选择一个受支持的 OpenAI Model Item，以便明确 Native Recipe 的模型输入。
2. 作为 CraftStation 用户，我希望 Harness Slot 默认使用 `auto`，以便系统确定性地解析为 Codex Harness Item。
3. 作为 CraftStation 用户，我希望看到被解析的 Ingredients、Recipe 与 Result，以便理解最终执行组合。
4. 作为 CraftStation 用户，我希望无效 Item、未解析 Slot 或 runtime 不可用时得到明确错误，以便知道失败阶段和修复方向。
5. 作为 CraftStation 用户，我希望 Craft 后得到可追溯的 Result Item 与 CraftPlan，以便未来恢复或继续组合。
6. 作为 CraftStation 用户，我希望从 CraftPlan 创建 Entity 和 Session，以便运行真实 Codex Harness。
7. 作为 CraftStation 用户，我希望 Session 支持 prompt、streaming/events 与 response，以便完成端到端工作流。
8. 作为 CraftStation 用户，我希望恢复已有 Session，以便继续同一连续工作过程。
9. 作为 CraftStation 用户，我希望终止 Entity/Session 后必要资源被清理，以免残留 Codex process 或连接。
10. 作为 CraftStation 用户，我希望认证、启动、transport 与 runtime 错误被完整透传，以免系统静默 fallback 到未知路径。
11. 作为维护者，我希望 React UI 只依赖 CraftStation contracts，以便 Codex protocol 演进不扩散到界面。
12. 作为维护者，我希望 Crafter 不操作 process/RPC lifecycle，以便组合决策和运行执行可以独立测试与演进。
13. 作为维护者，我希望生产 Codex Adapter 复用 PoraCode 的成熟实现，以便保留现有稳定性和功能。
14. 作为维护者，我希望通过轻量 runtime Adapter 测试 domain execution path，以便无需真实 Codex process 验证大多数行为。
15. 作为维护者，我希望保留 PoraCode 的 workspace、terminal、IPC、persistence 与 shutdown regression surface，以便第一阶段重构不破坏桌面基础能力。
16. 作为未来 Feature 的设计者，我希望 Model 与 Harness 仍为独立 Items，Result 仍为 Item，以便增加新 Harness 或递归 Recipe 时无需推翻数据模型。

## Repo Evidence

当前 PoraCode Codex 主链：

```text
React Renderer
-> preload typed IPC
-> Main
-> Supervisor IPC
-> ThreadSessionManager
-> SpawnPipeline
-> AgentAdapter
-> CodexStructuredSession
-> shared Codex app-server pool
-> Codex JSON-RPC over stdio
-> canonical RuntimeEvent
-> Renderer chat
```

关键事实：

- Supervisor 是所有 agent process 的 owner；Renderer 不 spawn agent。
- `ThreadSessionManager` 是 session lifecycle 的现有高层协调者。
- `SpawnPipeline` 负责 structured/terminal launch pipeline。
- `CodexStructuredSession`、server pool、RPC 与 stdio 已形成成熟 Codex implementation。
- `AgentAdapter` 同时承载 detection、capability、PTY、structured session、auth、plugin、discovery 与 one-shot，Interface 过宽，不适合作为 CraftStation domain seam。
- 现有 SQLite thread/session/runtime item persistence 可承载最小 composition provenance；本 Feature 不需要完整 Recipe Graph database。

主要 evidence 路径：

- `craftstation/src/supervisor/runtime/threadSessionManager.ts`
- `craftstation/src/supervisor/runtime/threadSession/spawnPipeline.ts`
- `craftstation/src/supervisor/agents/base/types.ts`
- `craftstation/src/supervisor/agents/codex/index.ts`
- `craftstation/src/supervisor/agents/codex/acp.ts`
- `craftstation/src/supervisor/agents/codex/serverPool.ts`
- `craftstation/src/supervisor/agents/codex/appServerRpc.ts`
- `craftstation/src/supervisor/agents/codex/stdioTransport.ts`
- `craftstation/src/shared/contracts/thread.ts`
- `craftstation/src/main/db.schema.ts`

## Feature Spec

### Composition Behavior

- Registry 至少注册一个受支持 OpenAI Model Item、Codex Harness Item 与对应 Native Recipe。
- Harness Slot 未显式指定时使用 `auto`，确定性解析为 Codex Harness Item。
- Resolve 后必须验证 Item 存在、required Slots 已解析、Recipe 合法且 runtime implementation 可用。
- Compile 生成携带稳定 identity、Recipe/Ingredient provenance、runtime binding、workspace 与可选 session reference 的 CraftPlan。
- Result 保持 Item 语义，并保存 result identity、source recipe、ingredient provenance 与 components/runtime binding。

### Runtime Behavior

- `harness-runtime` Interface 接受 CraftPlan 与 lifecycle intent，不接受 Codex protocol/RPC/stdio details。
- 生产 Codex Adapter 调用现有 PoraCode execution path；不复制第二套 Codex process/session owner。
- Runtime 返回 Entity identity、Session identity、canonical runtime events 与明确 lifecycle/error results。
- 支持创建与恢复 Session、发送 prompt、接收 events/streaming/response、正常终止与必要资源清理。
- Codex 不可用、认证失败、启动失败、连接失败、session 恢复失败与执行失败必须穿过 seam 被上层感知，不静默 fallback。

### UI Behavior

- React UI 提供最小 Crafting Grid：Model Slot、Harness Slot、Recipe/Result preview 与 Craft action。
- Harness 默认显示 `auto` 及其确定性解析结果。
- Craft 成功后可启动/进入 Entity Session，并沿用现有稳定 chat/event surface。
- UI 只消费 shared/domain contracts，不导入 Codex app-server、transport、RPC 或 session implementation。

### Persistence and Observability

- 在现有 thread/session persistence 上增加最小 composition provenance；不另建完整 Recipe Graph store。
- Recipe resolve、validate、compile、Entity create/resume/terminate 与 prompt execution 使用稳定事件/错误 code。
- 关键日志携带 composition/result/entity/session/correlation identity，并覆盖成功、跳过、降级与失败。

## Implementation Decisions

- 采用 Strangler Refactor：新增 domain façade 后逐个迁移调用者，不做全仓 rewrite 或 global rename。
- `crafting` Module 的 Interface 以纯输入/结果表达 `resolve / validate / compile`，将匹配、默认值、校验与错误知识隐藏在 implementation。
- `registry` domain registry 与现有 AgentAdapter registry 分离；前者管理可组合定义，后者继续管理底层 agent implementation。
- `harness-runtime` 是最高 test seam。生产 Codex Adapter 和测试 Adapter 是两个真实 Adapter，证明 seam 有实际变化价值。
- 生产 Adapter 复用现有 `ThreadSessionManager -> SpawnPipeline -> CodexStructuredSession` 链，不让 domain 调用更低层 implementation。
- `AgentAdapter` 不重命名为 Harness Item；它保留 implementation terminology，并逐步藏到 runtime module 内。
- Provider/API concern 与 Harness execution concern 分离。CLIProxyAPI 保持 Go implementation，v0.1.0 不强制接入 Codex 原生执行链。
- Result provenance 复用现有 persistence 能力做最小扩展；数据结构允许未来 Result 再次作为 Recipe 输入，但不提前实现 Recipe Graph 查询引擎。
- `auto` 只存在于 Slot resolution input/state，不进入 Item registry。
- 架构 enforcement 优先复用 TypeScript、lint 与测试；只有实际出现违规且现有工具不能表达时再引入 dependency rule tooling。

## Testing Decisions

- 主要测试跨 `crafting` 与 `harness-runtime` Interface 验证外部行为，不断言 Codex transport implementation details。
- Crafting contract tests 覆盖 explicit/auto resolution、missing Item、unresolved Slot、invalid Recipe、runtime unavailable 与稳定错误 code。
- In-memory runtime Adapter 验证 CraftPlan -> Entity -> Session -> prompt/events/response -> cleanup 的完整 domain 链。
- 生产 Codex Adapter integration tests 验证现有 canonical event mapping、session create/resume、error propagation 与 resource cleanup。
- React tests 验证用户选择、auto preview、Craft action、错误呈现和进入 Session；不 mock Codex JSON-RPC message shapes。
- Persistence tests 验证 Result/Recipe/Ingredient/runtime provenance 写入与 Session recovery。
- Regression validation 锁定 application startup、workspace opening、Codex startup、session operation、terminal、IPC、persistence 与 shutdown/cleanup。
- 最终必须有真实本机 Codex round-trip 证据；无认证环境时可完成自动测试，但 Feature 不得判定 PASS。

## Tickets

以下 tracer-bullet breakdown 已获用户批准，并发布到 `.scratch/craftstation-0.1.0/issues/`，状态为 `ready-for-agent`。

### v0.1/T01 — 建立 CraftStation Working Baseline 与 Regression Harness

**Goal:** 新产品能以 CraftStation identity 从 PoraCode 基线安装、检查和启动，并用自动化 smoke 锁定现有桌面/Codex 基础能力。

**Blocked by:** None。

**Acceptance:**

- Working Copy、分支、包管理器、品牌入口和命令有单一基线。
- typecheck/lint/test/build 或可解释的最小替代验证被记录。
- application startup、workspace、Codex/session、terminal、IPC、persistence、shutdown 有可执行 regression checklist/smoke surface。
- 不引入 Crafting domain 功能。

### v0.1/T02 — Craft OpenAI + Codex Native Recipe

**Goal:** 通过 registry 和 deterministic Crafter，从 OpenAI Model Slot 与 `auto` Harness Slot 产出可追溯 Result Item 和 CraftPlan，并能用 fake runtime 创建最小 Entity。

**Blocked by:** T01。

**Acceptance:**

- Model 与 Harness 是独立 Items，Native Recipe 可查询。
- `auto` 正确解析 Codex；explicit Codex 产生相同 Recipe identity。
- `resolve / validate / compile` 的成功与主要失败分支有 contract tests。
- Result/CraftPlan 保留 identity、Recipe/Ingredient provenance 与 runtime binding。
- fake Adapter 证明 CraftPlan 可以跨 runtime seam 创建 Entity，Crafting 不导入 Codex implementation。

### v0.1/T03 — 通过 Codex Runtime 运行 Entity Session

**Goal:** 将 T02 的 CraftPlan 交给生产 Codex Adapter，复用 PoraCode execution path 完成 Session create/resume、prompt/events/response 与 cleanup。

**Blocked by:** T02。

**Acceptance:**

- 上层只使用 `harness-runtime` Interface。
- 生产 Adapter 复用现有 Supervisor process ownership 与 Codex session implementation。
- Entity/Session identity 与 canonical events 正确返回。
- unavailable/auth/start/connect/execute/recovery 错误不静默 fallback。
- 正常终止清理必要资源，并保留现有 Codex/session regression。

### v0.1/T04 — React Crafting Grid 到真实 Session

**Goal:** 用户在 React UI 选择 OpenAI Model、看到 `auto -> Codex` 与 Recipe/Result，Craft 后进入真实 Entity Session。

**Blocked by:** T03。

**Acceptance:**

- Model Slot、Harness Slot、Recipe/Result preview 与 Craft action 可用。
- 成功路径进入现有 chat/session experience，并完成真实 prompt round-trip。
- resolve/validate/runtime 错误按稳定语义呈现。
- React/shared contracts 不深度导入 Codex protocol/transport。

### v0.1/T05 — 持久化 Composition Provenance 与 Session Recovery

**Goal:** 用户重启或重新打开 workspace 后，可以理解已有 Entity 的来源并恢复同一 Session。

**Blocked by:** T04。

**Acceptance:**

- 现有 persistence 保存最小 Result/Recipe/Ingredient/runtime provenance。
- Session recovery 能重建必要 CraftStation identity 与 runtime binding。
- 损坏、缺失或不兼容 provenance 有明确错误/降级，不产生错误组合。
- 不实现完整 Recipe Graph persistence。

### v0.1/T06 — Deep-module Guards 与 Feature Acceptance

**Goal:** 对完整链路执行架构、回归、诊断与真实 Codex 验收，确保第一阶段 refactor 可持续。

**Blocked by:** T05。

**Acceptance:**

- 自动检查或测试阻止 UI/Crafting accidental deep imports 到 Codex implementation。
- 完整回归面通过，或所有与 Feature 无关的基线失败有可复现证据。
- 关键路径日志能从一次失败定位 phase、object identity、code、cause 与 next action。
- 真实 `React -> Recipe -> CraftPlan -> Codex -> Entity -> Session -> response` 证据完成。
- Coder 文档完整，可交 Debugger 做独立 Feature Review。

## Dependencies and Execution Order

```text
T01 -> T02 -> T03 -> T04 -> T05 -> T06
```

这是单 Coder 的明确执行顺序。T02 先用 fake Adapter 证明 domain seam，T03 再连接生产 Codex implementation；这让关键架构错误在 UI 与 persistence 扩张前暴露。T05 依赖真实 UI/session identity 稳定后再固化 persistence shape。T06 是集成与架构验收收口。

## Feature Acceptance Criteria

### Functional

- 用户可选择受支持 OpenAI Model，Harness `auto` 确定性解析 Codex。
- 真实 Recipe 生成 Result Item 与有效 CraftPlan。
- Codex runtime 从 CraftPlan 创建 Entity/Session，完成 prompt/events/streaming/response。
- Session 可恢复，Entity/Session 可正常终止并清理资源。
- runtime/auth/start/transport/execute failure 正确透传。

### Architecture

- React UI 与 Crafting domain 不依赖 Codex protocol/transport implementation。
- Crafter 不负责 process/RPC lifecycle。
- Codex implementation 隐藏在 `harness-runtime` 后并复用 PoraCode 稳定链路。
- CLIProxyAPI Go core 未被不必要重写，provider/API concern 与 Harness execution concern 可分离。
- deep-module Interface 同时成为主要 test surface。

### Domain

- Model 与 Harness 是独立 Items；Harness 不硬编码进 Model Item。
- `auto` 不是 Item，Ingredient 不形成继承体系。
- Result 保持 Item 语义并保存最小 provenance。
- Item definition、Entity instance 与 Session continuity 明确区分。

## Out of Scope

- DeepSeek Harness、Grok Build、第二个 Harness runtime。
- Cross-vendor Recipe、完整 compatibility matrix。
- Context/Tool Policy/Memory/Compaction/Verifier Items。
- Auto-Crafting、Recipe Search、Model Fingerprint、benchmark、learned routing 与复杂 constraint solving。
- 完整 Recipe Graph persistence。
- 全仓架构重写或全部 PoraCode 命名替换。
- 将 CLIProxyAPI 重写为 TypeScript或强制作为 Codex execution hop。

## Key Risks

- 真实 Codex acceptance 依赖本机安装、认证与网络；没有真实 round-trip 不得 PASS。
- `AgentAdapter` surface 横跨多种 agent mode，直接拆除会扩大 blast radius；必须 façade-first。
- persistence schema 过早泛化会把未来 Recipe Graph 假设固化；本 Feature 只保存恢复与追溯所需最小数据。
- UI 品牌迁移若与架构迁移混成一次全仓 rename，会掩盖回归；Ticket 只改当前链路必要 terminology。
- CLIProxyAPI 当前是官方 zipball snapshot；若 Coder 需要其完整历史，应先恢复官方 clone，而不是基于本地快照 commit 推断上游 ancestry。

## Manager Handoff

- 用户已批准六个 Ticket 的粒度与线性 blocking edges。
- Tickets 已发布到 `.scratch/craftstation-0.1.0/issues/`，每个文件状态为 `ready-for-agent`。
- 单 Coder execution order 为 `T01 -> T02 -> T03 -> T04 -> T05 -> T06`。
- 当前 frontier 只有 `v0.1/T01`。Coder 先读取 `01-working-baseline-regression-harness.md`，完成全部 Acceptance 并记录实际验证后再进入 T02。
- 计划与真实 Repo 明显冲突时，停止受影响 Ticket并提交具体代码事实；只有计划失效才返回 Manager Re-plan。
