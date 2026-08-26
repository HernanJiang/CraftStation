# Manager — v0.3.0 Codex Native Runtime Parity & CraftStation Control Plane

> 当前 Feature 的单一 Manager 交接入口。Part I 记录已批准的 Ideate，Part II 记录可执行 Plan。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-08-25
- Last Updated：2026-08-25
- Roadmap Context：Phase 1 — Runtime Foundation，向 Phase 2 — Native Composition Runtime 建立可信 Codex execution seam
- Owner：Manager / Ideate

### Feature Intent

#### Problem

v0.1.0 已建立：

```text
OpenAI Model Item + Codex Harness Item
-> Recipe -> Crafter -> CraftPlan
-> Entity -> Session
```

但当前 Codex 产品执行链仍把真正的 Harness Runtime 外包给 PoraCode：

```text
Renderer startThreadFromCraft
-> craftAgent IPC
-> SupervisorRuntime
-> CodexHarnessRuntimeAdapter
-> ThreadSessionManager
-> PoraCode CodexStructuredSession / app-server integration
```

这条路径证明了 CraftStation Composition 可以到达一个 Runtime Adapter，却没有证明 CraftStation 已经拥有独立的 Codex Harness Runtime Module。当前 Session 仍以 `sendPrompt() -> Promise<完整字符串>` 为中心，存在固定 60 秒 Turn 超时；CraftPlan 主要传递 model，UI、官方有效配置、原生事件、审批请求和 Session 生命周期尚未形成忠实闭环。

#### Why Now

- Codex 是 CraftStation 第一条已建立 Recipe 的 Harness，应先把它从 PoraCode-specific execution path 迁移为 CraftStation-owned Runtime。
- 如果继续在旧 `ThreadSessionManager`、`SpawnPipeline`、`AgentAdapter` 与 canonical event mapping 上扩展，CraftStation Domain 会进一步依赖 PoraCode 内部架构。
- 官方 `codex app-server` 已提供 Thread、Turn、Item、streaming、approval、usage、compaction、MCP、Skills、review 与 Session lifecycle 的 programmatic interface，适合作为 CraftStation Codex Runtime 的唯一上游。
- 先建立一个真实、稳定、可验收的 `harness-runtime` deep module，后续 DeepSeek Harness 与 Grok Build 才能复用同一 CraftStation seam，而不要求三种 Harness 重写成相同内部实现。

#### Desired Outcome

目标生产链：

```text
OpenAI Model Item
+
Codex Harness Item
-> Native Recipe
-> Crafter
-> CraftPlan
-> CraftStation-owned Codex Runtime
-> official codex app-server
-> Entity
-> Session
-> user prompt
-> native streaming/events/requests
-> CraftStation UI
```

CraftStation 成为 Codex Harness 的 Composition、Control 与 Presentation Plane；官方 Codex Runtime 继续拥有 Agent Loop、上下文、压缩、工具、MCP、Skills、子 Agent 和原生 Session 语义。

### Expected Behavior

#### User Experience

- 用户仍在同一个 CraftStation UI 中选择 Model Item、Codex Harness Item、Recipe 与显式 Runtime 选项。
- 用户提交 Prompt 后，行为等价于把输入交给相同官方 Codex Runtime，而不是由 CraftStation 模拟 Agent Loop。
- assistant text、reasoning summary、工具执行、文件变化、MCP、审批、usage、compaction、review 与子 Agent 状态按官方事件实时投影到 UI。
- 用户可以继续同一 Session 的第二轮对话，并在支持范围内执行 resume、fork、steer、interrupt、manual compact 和 review。
- 用户未在 UI 显式覆盖的配置继续由 Codex 自己的 config、requirements、account/auth、`CODEX_HOME`、MCP 与 Skills resolution 决定。
- 官方版本不支持的 capability 在 UI 中明确禁用或降级，不由 CraftStation 伪造。

#### System Behavior

- CraftPlan 保存 Composition provenance、Runtime identity、protocol identity、model、workspace、显式 overrides 与可选 Codex Thread ref。
- CraftStation 直接启动并管理官方 `codex app-server`，执行 initialize/initialized、能力发现和 JSON-RPC correlation。
- Session 采用 command/event/snapshot lifecycle，不再依赖“等待完整 response string”作为核心抽象。
- 长 Turn 没有任意固定完成超时；仅 process spawn、initialize 和单次 RPC acknowledgement 可以有 transport timeout。
- Native Codex event envelope 与 CraftStation normalized UI projection 同时保留；未知事件不得静默丢弃。
- approval、permission、request-user-input 与 MCP elicitation 等 server-initiated request 保留 request identity，并能把用户决定回传官方 Runtime。
- Context、token usage 与 compaction 状态以官方事件为事实来源。
- 最终 Codex 产品路径不依赖或 fallback 到旧 PoraCode Codex execution implementation。

#### Important Scenarios

- 首次启动时发现实际 Codex binary、version、account/auth、effective config 与可用模型。
- 新建 Thread，启动 Turn，接收流式 assistant/reasoning/tool/file 事件并得到真实 response。
- 在同一官方 Thread 上完成第二轮 Prompt。
- UI 显式覆盖 model、reasoning effort、service tier、approval policy 或 permission profile；未选字段省略并继承 Codex。
- 自动或手动 compaction 发生后，UI 显示官方 usage/context 事实。
- Turn 运行超过 60 秒仍继续；用户可以主动 steer 或 interrupt。
- command、file change、permission 和 MCP elicitation 请求在 UI 中可审查、接受、拒绝或取消。
- 应用重启后用持久化的官方 thread ref 和 CraftPlan provenance 恢复 Session。
- app-server crash、auth failure、rate limit、unsupported capability、schema/version mismatch 与未知事件有稳定错误和诊断信息。

### Scope

#### In Scope

- CraftStation-owned Codex Runtime Module 与稳定 Interface。
- 官方 `codex app-server` process、stdio JSON-RPC、initialize、schema compatibility 与 capability discovery。
- `model/list` 驱动 Codex Model Item refresh。
- event-driven Entity/Session command、event、snapshot 与 lifecycle。
- CraftPlan Runtime configuration 的 typed、optional、traceable 传递。
- Thread start/resume/fork/read 与 Turn start/steer/interrupt/completion。
- streaming、token usage、context compaction、approval、permission、MCP elicitation。
- Skills、MCP status/reload/OAuth，以及当前官方版本支持的 review、goal、subagent 事件。
- Composition provenance、官方 Thread ref、恢复、资源清理、错误语义与 observability。
- Codex 产品切换、legacy fallback 移除和 architecture dependency guard。

#### Out of Scope

- 重写 Codex Agent Loop、Codex Core、上下文选择、自动压缩、工具系统、MCP、Skills 或子 Agent。
- 同时重写 DeepSeek Harness、Grok Build 或其他 PoraCode Agent integration。
- 一次性移除 PoraCode Desktop、Electron、Workspace、IPC、数据库、Terminal、Git/Worktree 等通用基础设施。
- Auto-Crafting、Interaction-Aware Search、Model Fingerprint、Learned Router 或 Phase 3/4 研究能力。
- 把 Context、MCP、Skills、Permission 提前升级为新的一级 Item。
- 为官方未提供或当前版本不支持的 experimental capability 自建不兼容替代实现。
- 要求两次非确定性模型输出逐字相同，或复制 Codex CLI/TUI 的视觉布局。

### Important Decisions

#### Product Decisions

- Runtime parity 指相同官方 Runtime、effective configuration、protocol semantics、events 与 lifecycle，不指随机文本逐字一致。
- CraftStation UI 同时是展示台和控制面：用户显式控制的配置由 UI 提供，Harness 内部 Agent 行为仍由官方 Runtime 拥有。
- 所有 Codex-compatible Model Items 共享一个 Codex Harness Runtime Adapter，不按模型重写 Adapter。
- 默认继承用户现有 Codex 环境，只有 UI 明确选择才形成 override。
- stable protocol 是最低承诺；experimental capability 必须经过 version/capability gate。

#### High-level Architecture Direction

- `harness-runtime` 是最高、最小、稳定的 execution seam。
- 外部调用者只提交 CraftPlan、Workspace、可选 Session ref 与 command，并接收 Entity/Session identity、runtime events、snapshots 和 lifecycle result。
- app-server process host、transport、JSON-RPC、generated schema、request correlation、Codex event mapping 与 recovery 都隐藏在 Codex Module implementation 内。
- UI projection 是 CraftStation-owned presentation contract；Native Codex envelope 保留用于兼容、诊断与未知事件处理。
- Provider/API 与 Harness process execution 继续分离；CLIProxyAPI 不成为 Codex 必经路径。
- 采用 Strangler Refactor：新 Runtime 与 legacy 对照共存到真实验收完成，再切断产品 fallback 和清理旧实现。

#### Trade-offs

- 本 Feature 覆盖 Codex 的核心稳定行为和对 CraftStation 有价值的高级能力，但不承诺实现 app-server 每个实验 RPC。
- 保留 native envelope 会增加 persistence/event surface，但可避免官方协议演进时信息被永久丢失。
- 先建立 parity harness、fake server 与 generated schema，再接真实 Runtime，会增加前置工作，但能把协议兼容问题限制在 Codex Module 内。
- 线性 9 Ticket 牺牲并行速度，换取单 Coder 下清晰依赖、可回滚节点和逐步真实证据。

### Constraints

- 当前 `craftstation/` 的 v0.2.16 UI-only 工作树包含大量未提交修改；v0.3 实现必须等待 v0.2 关闭，并保护现有改动。
- 根治理仓库当前没有 tracking remote；Plan 前的 `git pull --ff-only` 无法完成，不能声称已与远端对齐。
- 不得让新 Codex Module import 或 fallback 到 `ThreadSessionManager`、`SpawnPipeline`、PoraCode `AgentAdapter`、`CodexStructuredSession`、PoraCode canonical event mapping 或 Codex hook plugin。
- 不得把官方 Runtime 的内部能力复制进 CraftStation。
- 不记录 API key、Token、Cookie、完整敏感 Prompt 或 credential。
- 未取得真实官方 Codex 双轮 Session 证据前，Feature 不得 PASS。

### Acceptance Intent

- [ ] `Model Item + Codex Harness Item -> Recipe -> Crafter -> CraftPlan` 进入 CraftStation-owned Codex Runtime。
- [ ] 官方 app-server 完成 initialize、Thread、Turn、streaming 与真实 response。
- [ ] 同一官方 Thread 完成至少两轮连续 Prompt。
- [ ] 最终产品路径没有 PoraCode Codex execution dependency 或 fallback。
- [ ] UI 显式配置忠实传递，未选配置由 Codex 原生 resolution 决定。
- [ ] Context、usage、compaction、approval、permission、MCP、Skills 和 lifecycle 在支持范围内由官方 Runtime 驱动。
- [ ] 长 Turn 不因固定 60 秒超时失败。
- [ ] 未知事件、官方错误、进程退出和 capability 缺失不会被静默吞掉。
- [ ] persistence、resume、interrupt 与 cleanup 具有真实证据。

### Open Questions

- 无阻塞产品问题。
- 各项 experimental capability 的最终支持集合由实现时发现的 Codex binary/version/schema 决定；这不会改变 Feature Intent，只影响 capability gate 的可用状态。

### Questions Reserved for Plan

- Runtime Interface 如何从字符串式 `sendPrompt` 变为 event-driven command/event/snapshot。
- CraftPlan 哪些字段属于显式 override，哪些字段必须省略以继承 Codex。
- 哪些能力属于最低稳定验收，哪些能力按 capability gate 验收。
- legacy 对照、产品切换与删除应如何排序，避免未验证的大爆炸替换。
- 真实 app-server、fake server、generated schema、UI 和 persistence 的测试 seam 如何组织。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Completed
- Notes：已将 `ai_workspace/agent_docs/ideate_0.3.0.md` 的批准内容正式收敛到本 Manager document Part I；独立 Ideate 文件保留为历史输入，不再作为 Coder 的主交接入口。

## Ideate → Plan Gate Check

- Feasibility：OK。官方 app-server 提供 initialize、model/list、Thread/Turn、streaming、usage、compaction、approvals、Skills、MCP 与 lifecycle；当前 Repo 已有 CraftPlan、HarnessRuntimeAdapter、Entity/Session 和 UI/IPC 接入点，可建立新 Codex Adapter。
- Practicality：OK。影响面集中在 Crafting runtime Interface、Supervisor、Renderer launch、provenance、Codex Adapter 和相关测试；采用 9 个线性 tracer-bullet Ticket，避免与 v0.2 UI 工作树并行修改。
- Alignment：OK。直接推进 Roadmap Phase 1 的独立 Harness Runtime，并巩固 Phase 2 的 `Recipe -> CraftPlan -> Runtime -> Entity -> Session`，未引入 Auto-Crafting。
- Info Completeness：OK。产品所有权、parity 定义、legacy 边界、默认配置继承、capability gating、真实验收和 non-goals 已明确。

结论：OK

Manager 自行修复的非阻塞小问题：

- 将独立 Ideate 文档整理为本文件正式 Part I，恢复“一 Feature 一 Manager document”的工作流约定。
- 将“全部 Runtime 一致”收敛为核心稳定语义必须验收、experimental 能力按版本和 capability gate 暴露，避免承诺实现所有实验 RPC。
- 把缺失 tracking remote 记录为同步限制；本轮以本地已批准 Ideate、当前 Repo 和只读官方 Codex reference 规划。
- 把 v0.2.16 脏工作树记录为实施前置门；本轮只写治理和计划文档，不启动产品实现。
- 将当前固定 60 秒 Turn timeout、字符串式结果、弱 Runtime configuration 与旧 TSM dependency 明确转化为 Ticket acceptance，而不是模糊的“重构 Adapter”。

## Part II — Plan

### Planning Inputs

- `AGENTS.md`
- `PROJECT_STATUS.md`（包括四阶段 Roadmap 与 v0.2.16 当前状态）
- 本文档 Part I — 已批准 Ideate
- `ai_workspace/agent_docs/ideate_0.3.0.md`（历史输入）
- `ai_workspace/agent_docs/manager_0.1.0.md` 与 v0.1 Feature 事实
- 当前 `craftstation/` Working Copy
- 已同步的 CodeGraph：2,818 files、39,275 nodes、147,381 edges；`HarnessRuntimeAdapter` 与 `CodexHarnessRuntimeAdapter` 的主要影响面集中在 Crafting、Supervisor、Renderer launch、provenance 和测试
- 只读官方 Codex reference 中的 app-server README、protocol schema 与 tests

### Objective

在不重写官方 Codex Harness 内部能力的前提下，把 v0.1 的 Codex execution critical path 从 PoraCode Runtime 迁移到一个由 CraftStation 拥有的深 `harness-runtime` Module，并以真实双轮 Session 证明：

```text
Model Item + Codex Harness Item
-> Recipe -> Crafter -> CraftPlan
-> CraftStation-owned Codex Runtime
-> official codex app-server
-> Entity -> Session
-> native capabilities and real response
```

### Feature Spec

#### Problem Statement

CraftStation 用户当前看到的是 Minecraft Composition UI，但 Prompt 进入 Codex 后仍由 PoraCode 的通用 Session/Agent 适配链负责执行。CraftPlan 没有忠实表达 UI 对 Runtime 的控制，Session 把一次 Turn 压缩成固定超时内返回的字符串，官方 Codex 原生事件、配置、审批与生命周期不是 CraftStation 的直接事实来源。

因此当前效果不能被称为“同一 UI 中的官方 Codex Harness parity”，也阻碍了后续把 DeepSeek Harness、Codex 和 Grok Build 作为独立 Runtime 放在同一个 CraftStation Composition Model 下。

#### Solution

建立一个 CraftStation-owned `harness-runtime` Module。它向 Crafting、Supervisor、IPC 与 UI 暴露小而稳定的 Interface，并在 Codex implementation 内直接管理官方 app-server process、JSON-RPC connection、generated protocol schema、capability discovery、Thread/Turn lifecycle、server requests、native events 与 recovery。

CraftPlan 编译 UI 的显式选择，但省略未选择字段，让 Codex 原生配置层继续解析默认值。Session 通过 command/event/snapshot 工作，不再等待完整字符串或使用固定 Turn 完成超时。迁移期保留 legacy implementation 作为隔离对照，只有新路径通过真实验收后才切断 fallback 与移除生产引用。

#### User Stories

1. 作为 CraftStation 用户，我希望选择 Codex Model Item 和 Codex Harness Item 后得到真实可执行 CraftPlan，以便 Composition 决定实际 Runtime。
2. 作为 CraftStation 用户，我希望未显式修改的 Codex 配置继续使用现有 `CODEX_HOME`、config、requirements 与 account，以便 CraftStation 不悄悄改变我的 Harness 行为。
3. 作为 CraftStation 用户，我希望 UI 中显式选择的 model、reasoning effort、service tier、approval 或 permission 设置被忠实传递，以便 CraftStation 是可预测的控制面。
4. 作为 CraftStation 用户，我希望可用模型来自官方 `model/list`，以便模型列表与实际 Codex Runtime 一致。
5. 作为 CraftStation 用户，我希望在启动前看到 Codex binary、version、auth 与 capability 状态，以便理解当前环境能否运行。
6. 作为 CraftStation 用户，我希望 Prompt 直接进入官方 Codex Thread/Turn，以便 Agent Loop 和工具行为与官方 Harness 一致。
7. 作为 CraftStation 用户，我希望 assistant text 和 reasoning summary 实时出现，以便长任务不需要等待最终字符串。
8. 作为 CraftStation 用户，我希望实时看到 command、file change、MCP、plan、review 和 subagent 状态，以便理解 Agent 正在做什么。
9. 作为 CraftStation 用户，我希望同一 Session 可以连续发送第二轮 Prompt，以便上下文由官方 Codex Thread 延续。
10. 作为 CraftStation 用户，我希望 Turn 超过 60 秒仍能继续，以便真实长任务不会被 CraftStation 任意终止。
11. 作为 CraftStation 用户，我希望可以 steer 正在运行的普通 Turn，以便补充信息而不必重启 Session。
12. 作为 CraftStation 用户，我希望可以 interrupt 当前 Turn，以便停止不再需要的工作。
13. 作为 CraftStation 用户，我希望可以 resume、fork 和 read 官方 Thread，以便恢复、分支和检查连续工作。
14. 作为 CraftStation 用户，我希望 context/token usage 来自官方 Runtime，以便 UI 不显示与真实窗口不一致的估算。
15. 作为 CraftStation 用户，我希望自动和手动 compaction 在 UI 中可见，以便理解上下文变化。
16. 作为 CraftStation 用户，我希望 command 和 file-change approval 在 UI 中展示具体请求并回传决定，以便权限由我控制。
17. 作为 CraftStation 用户，我希望 permission request 和 MCP elicitation 能在 UI 中完成，以便官方工具流不会卡死。
18. 作为 CraftStation 用户，我希望查看 Skills 与 MCP 状态并在支持时刷新、启停或完成 OAuth，以便复用现有 Codex 能力。
19. 作为 CraftStation 用户，我希望官方版本不支持的能力被明确禁用，以便不会误以为功能已经工作。
20. 作为 CraftStation 用户，我希望 app-server crash、auth failure、rate limit 或 schema mismatch 有明确错误和恢复建议，以便可以诊断失败。
21. 作为 CraftStation 用户，我希望应用重启后恢复同一官方 Thread 和 Composition provenance，以便连续工作不丢失。
22. 作为维护者，我希望 UI、Crafting 和 Crafter 只依赖 `harness-runtime` Interface，以便 Codex protocol 变化不会扩散。
23. 作为维护者，我希望 Codex process、transport、RPC、schema 与 request correlation 隐藏在一个深 Module 内，以便修复具有 locality。
24. 作为维护者，我希望 native event envelope 与 normalized projection 并存，以便既能稳定渲染又不丢失新协议信息。
25. 作为维护者，我希望 fake app-server 和真实 app-server 通过同一 Interface 验证，以便大多数行为可自动化、最终行为可真实验收。
26. 作为维护者，我希望最终依赖检查能证明 Codex 产品路径不再引用 PoraCode Codex Runtime classes，以便独立性是可验证事实。
27. 作为未来 Harness 开发者，我希望 DeepSeek Harness 与 Grok Build 能实现同一高层语义而保留不同内部 architecture，以便 CraftStation 不重写各 Harness。

#### Implementation Decisions

- `harness-runtime` Module 的外部 Interface 是本 Feature 的主要 test surface。它表达 Entity/Session identity、Runtime commands、Runtime events、snapshots 与 lifecycle result，不暴露 Codex JSON-RPC DTO、stdio 或 process handle。
- 现有以 `sendPrompt() -> Promise<PromptResult>` 为中心的 Interface 采用 expand–migrate–contract 演进：先增加事件驱动语义和兼容层，再迁移调用者，最终从 Codex 生产路径移除字符串聚合与固定 Turn timeout。
- CraftPlan 增加 typed Runtime configuration，区分：
  - Composition identity 与 provenance；
  - Runtime/protocol identity；
  - model/workspace/session identity；
  - 用户显式 overrides；
  - capability assumptions 与 schema/version evidence。
- 未显式选择的 optional override 不写入启动/Turn request；不得用 CraftStation 固定默认覆盖 Codex 原生 config resolution。
- CraftPlan 保持不可变。Session 中明确改变 model/settings 时生成可追溯 revision 或 Runtime event，不静默改写原计划。
- Codex implementation 内部拥有 process host、connection、RPC correlation、generated schema、capability discovery、session controller、event projection、approval broker、errors 与 recovery；这些是内部 implementation，不扩展为多个上层 seams。
- 生产优先使用官方支持的 stdio transport。experimental transport 或 method 不成为 Feature 最低验收依赖。
- 每个实际运行 Codex binary 的 schema 由其官方 schema generation 或兼容层约束；未知字段保留，未知 method/event 记录并安全投影，不静默丢弃。
- Runtime event 同时保留 native envelope 和稳定 normalized projection。UI 默认消费 normalized projection；诊断、兼容和未来映射可读取受控 native metadata。
- server-initiated request 使用 request ID、thread ID、turn ID、item ID 与 correlation ID 建模；响应必须恰好关联一次，Turn 结束或 interrupt 时清理悬挂请求。
- process spawn、initialize 和 RPC acknowledgement 可配置 transport timeout；Turn completion 由官方事件、进程状态或用户操作决定，没有任意固定时限。
- `model/list` 是 Codex Model Item availability/capability 的 Runtime 来源；静态 registry 只保留启动前占位、已验证 fallback metadata 或测试定义，不冒充实时可用性。
- Context usage 使用官方 `thread/tokenUsage/updated`；compaction 使用官方 item/Turn lifecycle；CraftStation 不自行推断真实 context window。
- stable capability 是最低保证。experimental capability 必须在 initialize opt-in、schema/version 与 capability discovery 全部允许时才启用。
- Provider/API concern 与 Harness process execution 分离。CLIProxyAPI 仅在明确 provider/auth Recipe 需要时接入，不进入本 Feature 默认 Codex 路径。
- legacy PoraCode Codex execution implementation 在迁移期只可作为隔离对照，不可成为最终产品 fallback。
- 最终增加依赖守卫，禁止新 Codex Module 和 Codex Native Recipe 产品路径导入 legacy PoraCode Codex execution classes。
- 关键错误至少区分 binary unavailable、initialize failed、auth required、protocol incompatible、capability unsupported、request timeout、process exited、turn failed、recovery failed 与 persistence incompatible。
- 关键日志携带 phase、operation、status、craftPlan/entity/session/thread/turn/request/correlation identity，并保留原始异常上下文但不记录敏感凭据或完整 Prompt。

#### Testing Decisions

- 主要测试跨同一个 `harness-runtime` Interface 验证外部行为，不断言内部类拆分。
- Contract tests 同时运行 fake app-server Adapter 与 production Codex Adapter 的可测试表面，验证 command/event/snapshot 与错误语义。
- 协议测试使用官方 generated schema/fixtures，覆盖 initialize、request/response correlation、notification、server request、未知事件与 experimental gate。
- 事件投影测试验证 streaming 顺序、重复/迟到事件、Turn terminal state、native envelope 保留和 UI normalized state。
- CraftPlan tests 验证 explicit override 忠实传递、未选字段省略、immutable revision 与 provenance。
- lifecycle tests 覆盖 start、second turn、resume、fork、read、steer、interrupt、long turn、crash、restart、cleanup 与悬挂 request 清理。
- approval tests 覆盖 command、file change、permission、request-user-input 和 MCP elicitation 的 accept/decline/cancel/session-scope。
- capability tests 在 stable-only、experimental-enabled、unsupported-old-version 三种服务能力下验证 UI gate 与错误。
- persistence tests 验证 official thread ref、protocol/runtime identity、CraftPlan provenance、重启恢复、损坏和版本不兼容。
- architecture tests 阻止 Codex 产品路径依赖 legacy PoraCode execution implementation。
- 最终验收必须使用用户实际安装和认证的官方 Codex binary，完成真实 streaming 与同一 Session 双轮 response；fake/synthetic success 不能替代。
- v0.2 关闭后的实现需要执行与实际影响匹配的 typecheck、lint、test、build 和桌面回归；本 Manager 规划轮不运行产品测试。

#### Out of Scope

- DeepSeek Harness、Grok Build 和非 Codex Harness 的 Runtime 重写。
- PoraCode 通用 Desktop 基础设施替换。
- Codex CLI/TUI 视觉和键盘交互复制。
- 官方 Codex Core 或 Agent Loop fork。
- 全量实现所有 experimental app-server RPC。
- Auto-Crafting、Recipe Search、Cold Start、Runtime Re-Crafting。
- 新的一等 Context Strategy、Tool Policy、Memory、Compaction、Permission 或 Subagent Strategy Item。
- CLIProxyAPI TypeScript 重写或强制接入。

#### Further Notes

- “parity”是运行时与协议等价，不是输出文本 determinism。
- 官方 Codex reference 会继续演进；Coder 应以实现时实际 binary 生成的 schema 和本地固定 reference baseline 共同判断兼容性。
- 如果实现发现必须改变用户行为、Feature Scope 或 Runtime ownership，返回 Manager / Ideate；普通协议差异和局部实现问题由 Coder/Debugger 处理。

### Tickets

#### v0.3/T01 — 建立 Native Codex Runtime Interface 与 Parity Harness

- Goal：建立事件驱动的 CraftStation `harness-runtime` Interface，并用 fake app-server 跑通一个可观察的 Entity/Session/Turn，使后续 Codex implementation 只需填充同一 seam。
- Scope：
  - 定义 Runtime command、event、snapshot、Entity/Session identity、lifecycle 和稳定错误语义。
  - 扩展 CraftPlan 的 typed Runtime configuration 与 explicit-override 语义。
  - 建立 fake app-server/parity harness、协议 fixture 和 contract test。
  - 允许旧 Interface 暂时兼容，但新 Codex 路径不得以完整 response string 或固定 Turn timeout 为设计中心。
- Depends on：None；但执行必须等待 v0.2 Feature 关闭。
- Acceptance：
  - [ ] 一个 fake Runtime 可从 CraftPlan 创建 Entity/Session、提交 Turn、流式发送事件并形成 terminal snapshot。
  - [ ] Session Interface 支持 subscribe/snapshot 和至少 start turn、interrupt、terminate 的命令语义。
  - [ ] Turn completion 不依赖固定 60 秒 timeout。
  - [ ] CraftPlan 能表达 typed explicit overrides，未选择字段可以保持缺失。
  - [ ] Interface、错误、事件与日志 contract 有自动测试。
  - [ ] Crafting、Crafter 和 UI contract 不包含 Codex JSON-RPC DTO。

#### v0.3/T02 — 直接启动官方 app-server 并发现 Runtime 能力

- Goal：CraftStation 直接启动用户实际安装的官方 `codex app-server`，完成握手、环境诊断、schema/capability discovery 与 Model Item refresh。
- Scope：
  - 建立 process host、stdio transport、JSON-RPC correlation、initialize/initialized 与 shutdown。
  - 发现 binary/version、Codex home、account/auth、effective config、stable/experimental capabilities。
  - 使用官方 `model/list` 刷新 Codex Model Items 和可选 reasoning/service metadata。
  - 为 unavailable、auth、initialize、protocol mismatch、overload 与 process exit 建立稳定错误。
- Depends on：T01。
- Acceptance：
  - [ ] 在 fake server 和真实官方 binary 上完成 initialize/initialized。
  - [ ] UI/registry 可获得真实 model list、Runtime version、auth 和 capability snapshot。
  - [ ] 未启用 experimental API 时不会发送 gated method/field。
  - [ ] RPC request、response、notification 和 server request 可正确区分与关联。
  - [ ] app-server stderr/log 不污染 JSON-RPC transport，关闭后无遗留进程。
  - [ ] 本 Ticket 不经过 `ThreadSessionManager` 或 PoraCode Codex session implementation。

#### v0.3/T03 — 打通首条真实 Native Thread/Turn 流式链

- Goal：用户从 CraftStation Crafting UI 启动官方 Codex Thread/Turn，并在现有 Session UI 中实时看到真实 response 和原生工作事件。
- Scope：
  - `CraftPlan -> Native Codex Runtime -> thread/start -> turn/start`。
  - 投影 thread、turn、item、assistant、reasoning、command、file change、MCP、plan、error 与 completion 事件。
  - Renderer/IPC 从“等待完整字符串”迁移到 event-driven launch 和 Session state。
  - 保留 native envelope，未知事件显式记录并形成安全 generic projection。
- Depends on：T02。
- Acceptance：
  - [ ] 真实官方 Codex binary 从 CraftPlan 创建 Thread 和首个 Turn。
  - [ ] assistant/reasoning/tool/file 等支持事件按顺序流式显示。
  - [ ] Turn terminal state 与最终 assistant message 可从官方事件恢复。
  - [ ] `craftAgentResult` 不再把完整 `response: string` 作为实时 UI 的事实来源。
  - [ ] 未知通知不会静默丢弃，也不会导致 Session 崩溃。
  - [ ] 产品调用链不经过 `ThreadSessionManager`、`SpawnPipeline` 或 PoraCode CodexStructuredSession。

#### v0.3/T04 — 配置忠实传递与 Context/Usage/Compaction

- Goal：让 CraftStation UI 的显式控制准确进入 CraftPlan 和官方 Codex request，同时让未选配置、context usage 与 compaction 继续由 Codex 原生机制决定。
- Scope：
  - 编译 model、reasoning effort、service tier、approval/permission/sandbox、workspace/runtime roots 等显式选择。
  - 省略未选择字段，并展示 effective Runtime settings 与 provenance。
  - 接入官方 token usage、automatic compaction 与 manual compact。
  - 配置变化生成可追溯 revision 或 Runtime event。
- Depends on：T03。
- Acceptance：
  - [ ] 显式 UI 选择与实际 thread/turn request 逐字段一致。
  - [ ] 未选择字段不被 CraftStation 固定默认覆盖。
  - [ ] UI context/token usage 只使用官方 Runtime 事件或 snapshot。
  - [ ] 自动 compaction 可见，manual compact 可触发并观察完成。
  - [ ] invalid/managed/unsupported configuration 有稳定错误或明确 disabled state。
  - [ ] Session 中的受支持 settings change 有 provenance，不静默修改原 CraftPlan。

#### v0.3/T05 — 完整 Native Session 生命周期与长任务控制

- Goal：用户可以把官方 Codex Thread 当作连续 CraftStation Session 使用，覆盖 second turn、resume、fork/read、steer、interrupt、crash recovery 和 cleanup。
- Scope：
  - 同一 Thread 多 Turn。
  - thread resume/fork/read 与 Turn steer/interrupt。
  - 移除生产 Turn 固定完成 timeout；保留合理 transport timeout。
  - process crash、reconnect/restart、Session terminate 和资源清理。
- Depends on：T04。
- Acceptance：
  - [ ] 同一官方 Thread 完成真实第二轮 Prompt 并保留上下文。
  - [ ] resume、fork/read、steer 和 interrupt 在官方支持范围内通过测试。
  - [ ] 超过 60 秒的 fake/controlled long Turn 不被 CraftStation 自动失败。
  - [ ] process exit 会使相关 Session 进入明确状态并提供可诊断 recovery path。
  - [ ] terminate/shutdown 清理 connection、process、subscription 与 pending request。
  - [ ] 重复、迟到和 terminal 后事件不会破坏 Session state。

#### v0.3/T06 — Approval 与 Permission Control Plane

- Goal：把官方 Codex 的 server-initiated approval、permission 和用户输入请求完整投影到 CraftStation UI，并把用户决定精确回传。
- Scope：
  - command execution、file change、permissions、request-user-input 和 MCP elicitation。
  - request broker、UI pending state、accept/decline/cancel/session-scope 与 cleanup。
  - approval policy/permission profile 的显式 UI 控制与 managed constraints。
- Depends on：T05。
- Acceptance：
  - [ ] 每个请求保留 request/thread/turn/item correlation identity。
  - [ ] UI 能展示必要上下文并提交官方允许的 decision。
  - [ ] accept、decline、cancel 和支持的 session-scoped grant 均有 end-to-end 证据。
  - [ ] Turn completion/interrupt/process exit 会清理或明确 resolve 悬挂请求。
  - [ ] 重复响应、未知 request type 和不可渲染 elicitation 安全失败且可诊断。
  - [ ] 敏感 credential 与完整 Prompt 不进入普通日志。

#### v0.3/T07 — MCP、Skills 与高级原生能力

- Goal：让 CraftStation 在不重写内部行为的情况下发现、展示并控制官方 Codex 的 MCP、Skills 和受支持高级能力。
- Scope：
  - Skills list/change/config/invocation input。
  - MCP status、startup、reload、OAuth、tool/resource/elicitation events。
  - review、goal、subagent/collaboration events 等当前官方版本支持的能力。
  - stable/experimental/unsupported capability gate。
- Depends on：T06。
- Acceptance：
  - [ ] Skills 列表和 change invalidation 来自官方 Runtime，并能形成正确 Turn input。
  - [ ] MCP status/startup/reload/OAuth 状态可见，错误有明确 remediation。
  - [ ] MCP tool lifecycle 与 elicitation 在 Session UI 中连续可追踪。
  - [ ] review、goal、subagent 等已支持能力通过同一 command/event seam 工作。
  - [ ] unsupported 或未 opt-in 的 capability 明确 disabled/experimental，不被模拟。
  - [ ] 增加新官方 event 不要求 UI/Crafting deep-import Codex implementation。

#### v0.3/T08 — Composition Provenance 与重启恢复

- Goal：应用重启后可以根据不可变 CraftPlan provenance、Runtime/protocol identity 和官方 Thread ref 恢复同一 Entity/Session。
- Scope：
  - 持久化完整 Composition/Runtime provenance、explicit overrides、capability/schema evidence 与 official thread ref。
  - 重建 CraftPlan revision、Runtime binding、Session snapshot 和 UI state。
  - 损坏、缺失、过期、版本不兼容和 thread unavailable 的错误/降级。
- Depends on：T07。
- Acceptance：
  - [ ] 重启后可从持久化记录 resume 同一官方 Thread 并继续新 Turn。
  - [ ] 恢复后的 model、settings、usage 与 provenance 可解释且不被静默重写。
  - [ ] 缺失或损坏记录不会生成错误 Composition。
  - [ ] protocol/runtime incompatibility 有稳定错误和用户可执行 remediation。
  - [ ] 不持久化 credential、Token、Cookie 或完整敏感 Prompt。
  - [ ] persistence tests 覆盖版本迁移与 legacy v0.1 provenance 的明确处理。

#### v0.3/T09 — 产品切换、Legacy 移除与 Feature Acceptance

- Goal：把 Codex Native Recipe 的唯一生产路径切换到 CraftStation-owned Runtime，移除 legacy fallback，并以真实双轮 Session 和架构证据关闭 Feature。
- Scope：
  - 切换所有 Codex Craft/launch/resume 产品入口。
  - 移除或隔离无生产引用的 legacy Codex Adapter integration。
  - dependency guard、回归、真实 Runtime parity matrix、错误和 cleanup 验收。
  - 完成 Coder 交接证据供 Debugger 独立 Review。
- Depends on：T08。
- Acceptance：
  - [ ] Codex 产品路径不存在对 `ThreadSessionManager`、`SpawnPipeline`、PoraCode `AgentAdapter`、`CodexStructuredSession`、PoraCode canonical event mapping 或 Codex hook plugin 的依赖或 fallback。
  - [ ] 依赖守卫能在重新引入 legacy import 时失败。
  - [ ] 真实 `Model -> Recipe -> CraftPlan -> official app-server -> Session -> streaming -> response -> second turn` 通过。
  - [ ] 配置、usage、compaction、approval、MCP、Skills、resume、interrupt、long turn 与 cleanup 的最低支持矩阵通过。
  - [ ] typecheck、lint、tests、build 和受影响 Desktop regression 通过，或非 Feature 基线失败有可复现证据。
  - [ ] 未识别事件、官方错误和 legacy provenance 不会静默 fallback。
  - [ ] Coder 文档完整，Feature 可交 Debugger；没有真实证据不得声明 PASS。

### Dependencies

```text
v0.2 Feature Close
  -> T01
  -> T02
  -> T03
  -> T04
  -> T05
  -> T06
  -> T07
  -> T08
  -> T09
  -> Debugger Feature Review
```

全部 Ticket 使用线性 blocking edge。原因是每一步都稳定前一步的外部行为和真实证据；单 Coder 不应在 process/protocol、UI lifecycle、approval 与 persistence 之间建立未经验证的并行分支。

### Execution Order

1. `v0.3/T01` — Native Runtime Interface 与 Parity Harness
2. `v0.3/T02` — 官方 app-server process、协议和能力发现
3. `v0.3/T03` — 首条真实 Thread/Turn streaming
4. `v0.3/T04` — 配置、usage 与 compaction parity
5. `v0.3/T05` — 完整 Session lifecycle 与 long turn
6. `v0.3/T06` — Approval/Permission control plane
7. `v0.3/T07` — MCP、Skills 与高级 capability
8. `v0.3/T08` — Provenance 与 restart recovery
9. `v0.3/T09` — 产品 cutover、legacy removal 与 Feature acceptance

### Feature Acceptance Criteria

#### Functional

- [ ] 用户可从 CraftStation Model Item 与 Codex Harness Item 编译可执行 CraftPlan。
- [ ] CraftStation 直接驱动官方 app-server 完成 initialize、Thread、Turn、streaming 和真实 response。
- [ ] 同一官方 Session 完成至少两轮连续 Prompt。
- [ ] resume、fork/read、steer、interrupt、manual compact 和 terminate 在支持范围内可用。
- [ ] command/file/permission/MCP 请求可由 UI 控制并正确回传。
- [ ] Skills、MCP、review、goal、subagent 等受支持能力通过同一 Runtime seam 投影。

#### Runtime Parity

- [ ] 使用用户实际选择/解析的官方 Codex binary、account/auth、`CODEX_HOME`、config 与 requirements。
- [ ] UI 显式 override 忠实传递，未选字段由 Codex 自己解析。
- [ ] Agent Loop、Context、Compaction、Tools、MCP、Skills 与 Subagents 由官方 Runtime 拥有。
- [ ] Context/token usage 与 compaction 以官方事件为事实来源。
- [ ] Turn completion 无固定 60 秒 timeout。
- [ ] stable/experimental capability 状态真实反映当前 Runtime。

#### Architecture

- [ ] Crafting、Crafter、Registry、React 和通用 IPC 不 deep-import Codex process/RPC/schema implementation。
- [ ] Codex process、transport、protocol、event/request correlation 隐藏在一个深 `harness-runtime` Module 内。
- [ ] 最终 Codex 产品路径不依赖或 fallback 到 PoraCode Codex execution chain。
- [ ] provider/API concern 与 Harness process execution 分离。
- [ ] 依赖守卫和测试跨同一外部 seam。

#### Reliability and Observability

- [ ] binary/auth/protocol/capability/process/turn/recovery/persistence failure 有稳定错误与 remediation。
- [ ] native event envelope 被保留，未知事件不会静默丢失。
- [ ] crash、interrupt、terminate 和 app shutdown 清理 process、connection、subscription 和 pending request。
- [ ] provenance 可重启恢复，损坏或不兼容记录不会产生错误 Composition。
- [ ] 日志具备必要 IDs 和原始异常上下文，不泄露敏感信息。

#### Required Evidence

- [ ] fake app-server contract test。
- [ ] 当前官方 binary schema/capability compatibility test。
- [ ] 真实官方 Codex streaming 首轮与同 Session 第二轮。
- [ ] 配置继承与显式 override 对照。
- [ ] long-turn、approval、usage/compaction、resume/interrupt 和 cleanup 证据。
- [ ] legacy dependency absence 与无 fallback 证据。

### Key Decisions / Risks

- 最大架构风险是把新 Module 做成 PoraCode TSM 的薄 façade。T02/T03 的验收明确要求直接 app-server 路径，T09 以 dependency guard 收口。
- 最大协议风险是 Codex app-server 持续演进。通过运行时 schema/version evidence、unknown-event preservation 和 capability gate 控制，而不是把 experimental RPC 固化为永久 contract。
- 最大 UX 风险是 UI normalized event 丢失原生语义。采用 native envelope + normalized projection，并以官方 terminal item/turn state 为权威。
- 最大生命周期风险是继续使用 request/response 心智模型。T01 先改变 Interface，T03 再迁移 UI，T05 才完整扩展 lifecycle。
- 最大数据风险是把 credential 或敏感 Prompt 混入 provenance/native event persistence。持久化只保存恢复和诊断所需 metadata，并增加敏感字段测试。
- 最大实施风险是当前 v0.2 脏工作树。v0.3 Coder 必须等 v0.2 关闭、确认工作树基线后开始；不得在当前 UI-only 审阅状态直接实施。
- 根仓库没有 tracking remote，当前 Plan 未完成远端对齐。配置 remote 后应在 Coder 启动前再次 `git pull --ff-only` 或记录明确本地基线。
- 真实验收依赖本机官方 Codex 安装、认证和网络；没有真实双轮证据只能记录阻塞，不得用 synthetic success 替代 PASS。

### Published Tickets

本地 tracker：

```text
.scratch/craftstation-0.3.0/issues/
├── 01-native-runtime-interface-parity-harness.md
├── 02-official-app-server-capability-discovery.md
├── 03-native-thread-turn-streaming.md
├── 04-config-context-usage-compaction.md
├── 05-native-session-lifecycle.md
├── 06-approval-permission-control-plane.md
├── 07-mcp-skills-native-capabilities.md
├── 08-provenance-restart-recovery.md
└── 09-cutover-legacy-removal-acceptance.md
```

全部状态为 `ready-for-agent`，但在 `PROJECT_STATUS.md` 中统一标记为等待 v0.2 关闭。

### Coder Start

当前不启动 Coder。

在用户关闭 v0.2 并明确进入 `$my-workflow` Coder 后：

1. 读取本 Manager document 的 Part I 与 Part II。
2. 确认根仓库和 `craftstation/` 的 Git 基线，保护现有修改。
3. 从 `.scratch/craftstation-0.3.0/issues/01-native-runtime-interface-parity-harness.md` 开始。
4. 严格按 `T01 -> T09` 执行；每个 Ticket 完成 Acceptance 和实际验证后再进入下一项。
5. 计划与 Repo 事实冲突但 Feature Intent 仍成立时返回 Manager / Plan Re-plan。
6. 若必须改变产品目标、用户行为、Runtime ownership 或 Feature Scope，返回 Manager / Ideate。
7. 普通 Debugger FAIL 直接执行 Debugger Fix Plan，不经过 Manager。
