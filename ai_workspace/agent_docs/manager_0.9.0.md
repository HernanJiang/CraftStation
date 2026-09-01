# CraftStation Manager — v0.9.0

> 当前 Feature 的单一 Manager 交接入口。Part I 记录 Ideate，Part II 留待 Manager / Plan。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-08-31
- Last Updated：2026-08-31
- Roadmap Context：Phase 2 — Native Composition Runtime；承接 v0.8 多 Harness Runtime，作为 v1.0 Model × Harness Workbench 的会话连续性基础
- Owner：Manager / Ideate

### Feature Intent

#### Problem

CraftStation 已经能够把不同 Model 与 Harness 组合编译为各自的 Recipe、CraftPlan、Entity 和原生 Session，但当前缺少一条正式的跨 Harness continuation 路径。用户在同一个可见会话中从 `ChatGPT + Codex Harness` 切换到 `Grok 4.6 + Grok Build Harness` 时，不应被迫新建对话、手工复制背景或丢失工作区进度；同时也不能把 Codex、Grok Build、OpenCode 等互不兼容的原生 Session 格式伪装成可以直接 resume。

#### Why Now

v0.8 已把 OpenCode 作为新的 Native Harness 合入 Dev，后续 v1.0 将开放 Model × Harness 组合工作台。如果没有稳定的跨 Harness 会话接力，同一任务中的组合切换仍然只是多个互相隔离的启动器，无法形成 CraftStation 的连续 Composition Runtime。

#### Desired Outcome

用户在同一条 CraftStation 可见会话和同一工作区中，可以在安全边界把后续工作交给另一组 Model × Harness。CraftStation 保存一份厂商无关的 `ConversationCheckpoint`，为目标 Harness 创建新的 continuation Runtime Segment，并在目标 Runtime Ready 后原子切换 active binding。切换前后的消息、文件状态和任务进度连续可见，每条输出仍可追溯到真实 Recipe、CraftPlan、Model、Harness、Entity 和原生 Session。

### Expected Behavior

#### User Experience

- 会话时间线、工作区与用户可见的 Thread identity 保持不变；切换不会自动创建另一条用户会话。
- 当前组合选择器显示 Model、Harness 与 Recipe 配置；用户可以请求切换到另一组已注册且通过 preflight 的组合。
- 默认在当前 Turn 完成后自动切换；如果当前 Turn 尚未结束，UI 显示排队中的目标组合和当前阶段。
- UI 同时提供“终止当前 Turn 并切换”。该操作必须先请求旧 Runtime abort、等待终止确认并保存可用 checkpoint，再启动目标 Runtime。
- 切换过程显示准备、保存状态、启动目标 Runtime、交接上下文、已切换或失败回滚等可诊断状态。
- 时间线保持连续，并以轻量标签或分隔标记每段消息的 `Model · Harness` 来源；右下角继续显示当前 `Recipe 配置名称 · 模型名称`。
- 目标 Runtime 启动失败时，旧组合继续保持可恢复，用户消息与已完成工作不丢失。

#### System Behavior

同一用户可见 Thread 可以包含多个有序的 Runtime Segment：

```text
CraftStation Thread
├── Runtime Segment A
│   └── Recipe A -> CraftPlan A -> Entity A -> Codex Native Session
├── Runtime Segment B
│   └── Recipe B -> CraftPlan B -> Entity B -> Grok Build Native Session
└── Runtime Segment C
    └── Recipe C -> CraftPlan C -> Entity C -> continuation Session
```

- `Runtime Segment` 是 implementation-level lifecycle record，不新增 CraftStation 一级 Domain term。
- `ConversationCheckpoint` 是 implementation-level、版本化的跨 Runtime 交接记录，不是 Item、Ingredient、Recipe 或 Result。
- 每次跨 Harness 切换都生成新的 Recipe/CraftPlan（或引用已解析且内容不可变的等价实例）、新的 Entity 与新的原生 Session；历史 CraftPlan 不被原地修改。
- CraftStation Thread 只负责组织用户可见的连续时间线；各 Harness 仍拥有自己的 Agent Loop、Context、Compaction、Tools、MCP、Permissions、Subagents 和 native Session persistence。
- 目标 Harness 接收的是明确标记的 continuation handoff，不得把它描述为跨厂商 native resume。
- 任一时刻只允许一个 active Runtime Segment 接收新的用户 Prompt。
- 事件路由至少使用 `threadId + segmentId + runtimeSessionId + bindingEpoch`；旧 Segment 的迟到事件可以归档，但不得改变当前 active Segment 的 UI、Turn 或 lifecycle 状态。

#### Context Handoff Policy

CraftStation 保存完整、厂商无关且可审计的 conversation ledger，并从中生成目标相关的 `ConversationCheckpoint`。默认交接内容是：

```text
任务摘要
+ 当前任务/工作状态
+ 重要决策与必要工具结果
+ 工作区及文件变更摘要
+ 最近若干轮原始消息
+ provenance 与旧 native session reference
```

- 默认不全量重放所有历史，避免重复消耗目标模型上下文窗口。
- 交接投影必须受目标模型上下文预算和目标 Harness 可接受输入约束控制。
- 不导出隐藏推理、不可移植的 Provider 内部状态、活跃工具句柄、未决权限请求或任何凭据。
- CraftStation 只负责切换边界的 context projection；切换完成后的日常上下文管理与 compaction 继续由目标官方 Harness 拥有。

#### Switching Semantics

- 默认切换模式：当前 Turn 完成后自动执行 handoff。
- 主动终止模式：用户选择“终止当前 Turn 并切换”后，系统先完成 abort handshake；未确认旧 Runtime 已停止前，不把新 Segment 设为 active。
- v0.9 只支持 safe-boundary switch，不承诺工具执行中、权限等待中、子 Agent 活跃中或 compaction 进行中的真正 mid-turn hot swap。
- 切回曾使用过的 Harness 时，只要中间的 Segment 产生了新消息、工具结果或工作区变化，就必须创建新的 continuation Segment，把增量 checkpoint 交给新 Session。
- 只有中间没有产生任何新内容且原生 Session 仍可安全 resume 时，Plan 才可允许复用原 native session reference；不能让落后的旧 Session 假装已经看见中间工作。

#### Important Scenarios

- `ChatGPT + Codex Harness` 完成一轮代码修改后，切换到 `Grok 4.6 + Grok Build`，Grok 能继续同一任务并看到相关文件状态。
- 用户在 Codex 正在输出时请求切换，系统排队并在 Turn 完成后接管，不混合两套 stream。
- 用户主动终止长 Turn 后切换；旧 Runtime abort 失败时，系统 fail closed，不允许两个 active Segment 同时处理输入。
- 目标组合因认证、额度、binary 或 capability 不可用而无法启动，系统回滚旧 active Segment并给出稳定诊断。
- `Codex A -> Grok B -> Codex C`：因为 B 已产生新内容，C 是新的 continuation Segment，而不是直接恢复已经落后的 A。
- 应用重启后恢复同一 Thread、Segment 历史与当前 active binding，不把旧 Segment 重新激活。

### Scope

#### In Scope

- 同一 CraftStation Thread 下的多 Runtime Segment 数据与生命周期模型。
- 厂商无关、版本化的 `ConversationCheckpoint` 和目标相关 context projection。
- 当前 Turn 完成后自动切换，以及“终止当前 Turn 并切换”的受控 abort 流程。
- 目标 Model × Harness × Auth/Profile capability preflight。
- 事务式 prepare/checkpoint/start/ready/activate/rollback handoff。
- `threadId + segmentId + runtimeSessionId + bindingEpoch` 事件隔离与迟到事件处理。
- 切回旧 Harness 时的增量 continuation Segment 规则。
- Session persistence、应用重启后的 active Segment 恢复和完整 provenance。
- 同一会话中的组合选择器、切换状态、消息来源与 handoff diagnostics。
- 至少一条 `Codex -> Grok Build -> Codex continuation` 的真实跨 Harness、多轮、同工作区 tracer bullet。

#### Out of Scope

- 工具执行中直接迁移执行栈的真正 mid-turn hot swap。
- 在两个 Harness 之间互导或伪造 native session 文件、内部 compaction state 或隐藏推理。
- 多个 Harness 同时作为 active writer 处理同一用户输入。
- 自动选择最优 Model/Harness、Learned Router、Auto-Crafting 或 Runtime Re-Crafting 算法。
- v1.0 四格/九格工作台的完整 Model × Harness matrix 编辑体验。
- 重写任何官方 Harness 的 Agent Loop、MCP、权限、子 Agent、Context、Compaction 或 Session persistence。

### Important Decisions

#### Product Decisions

- “同一个会话”正式解释为同一个 CraftStation 用户可见 Thread 和连续时间线，不要求不同厂商复用同一个 native session ID。
- 用户确认默认在当前 Turn 完成后自动切换，同时提供“终止当前 Turn 并切换”。
- 用户确认默认采用“任务摘要 + 状态 + 最近若干轮”的 checkpoint 投影，不全量重放历史。
- 用户确认切回曾使用的 Harness 时，只要中间产生新内容，就创建新的 continuation Segment。
- 切换后的每条消息必须保留 Model、Harness、Recipe/CraftPlan、Segment 与 native Session provenance。

#### High-level Architecture Direction

- 在现有 Crafting 与 Harness Runtime seam 之间形成一个深的 Session Handoff Module；调用方只提交当前 Thread、目标组合和切换意图，模块隐藏 preflight、锁、checkpoint、projection、目标启动、epoch 交换与 rollback。
- `CraftPlan` 继续描述一个确定且不可变的运行时绑定；切换创建新计划，不把旧计划原地改写。
- Conversation ledger 是跨 Runtime 的 portable source of truth；native Session ref 是特定 Segment 的恢复引用，二者不得混同。
- capability resolution 与 v1.0 的 Model × Harness Compatibility Layer 对齐，但 v0.9 只消费已解析组合，不提前实现完整矩阵工作台。

建议的最小外部 Interface 由 Plan 结合真实 Repo 设计，但调用语义应收敛为：

```text
requestSwitch(threadRef, targetBinding, mode)
  -> prepared | queued | activated | rolledBack | failed
```

复杂的 checkpoint schema、Runtime-specific bootstrap、event fencing 与 rollback 留在 Module implementation 内部。

#### Trade-offs

- 产品连续性优先于伪造 native continuity：用户获得同一任务体验，但系统明确记录 native Session 的分段事实。
- 摘要与最近轮次能控制上下文成本，但可能遗漏历史细节；完整 ledger 保留用于审计和按需补充，不默认全部注入。
- safe-boundary switch 不是真正的执行中热迁移，但能避免工具、权限与子 Agent 状态损坏，是第一版可可靠验收的范围。
- 保留旧 native session reference 有利于诊断和有限回退，但只能有一个 active writer，且旧 Session 不得越过增量内容直接恢复。

### Constraints

- 遵守 Official / Native Harness Runtime First；不使用 TUI 抓取、键盘注入或伪造协议完成 handoff。
- 不把 API key、OAuth token、cookie、AK/SK 或完整敏感 Prompt 写入 checkpoint、CraftPlan、Renderer payload 或日志。
- 目标组合未通过 capability/auth/runtime preflight 时 fail closed，不静默换到其他模型、Harness 或账号。
- 已完成的消息和工具结果才能进入 portable checkpoint；进行中状态必须先安全完成或 abort。
- 切换操作具备 correlation id、稳定阶段、错误 code、rollback 结果和可恢复诊断。
- 保持现有 Harness Adapter 相互独立；Session Handoff Module 不要求它们采用相同内部架构。
- v0.8 当前仅 Kimi native route 具备真实两轮 response 证据；其他 Provider/Harness 的未验证状态不能因 v0.9 Ideate 被升格。
- v0.6 F35/F36、v0.5 F29/F33 与 v0.4 F04 的既有 FAIL/BLOCKED verdict 保持不变。

### Acceptance Intent

- [ ] 同一用户可见 Thread 中，Codex Segment 完成真实多轮交互和至少一次工作区读取或修改。
- [ ] 默认切换在当前 Turn 完成后自动发生，不混合旧、新 Runtime stream。
- [ ] `ConversationCheckpoint` 使用任务摘要、当前状态、必要结果和最近若干轮完成跨 Harness continuation，不默认全量重放。
- [ ] Grok Build 目标 Segment 通过真实官方 Runtime 启动、接收 handoff 并输出真实流式 response。
- [ ] Grok 能延续任务目标、关键决策和同一工作区的已完成文件状态。
- [ ] 从 Grok 切回 Codex 时，因为中间已有新内容而创建新的 Codex continuation Segment，并获得真实 response。
- [ ] “终止当前 Turn 并切换”完成 abort handshake；abort 失败时 fail closed，不形成双 active writer。
- [ ] 目标 Runtime 初始化失败时原子回滚旧 active Segment，时间线、用户消息与工作状态不丢失。
- [ ] 旧 Runtime 的迟到事件不会污染新 Segment 的消息、权限、完成态或 UI。
- [ ] 应用重启后恢复 Thread、Segment provenance 与唯一 active binding。
- [ ] 每条相关消息可追溯 Recipe、CraftPlan、Model、Harness、Entity、Segment 和 native Session。
- [ ] checkpoint、持久化、Renderer/IPC 和日志中不存在明文凭据或不可导出的隐藏推理。
- [ ] 既有 Harness 路径回归不被破坏；未取得真实 E2E 的组合保持 UNVERIFIED/BLOCKED。

### Open Questions

- 无阻塞性产品问题。三项核心切换语义已由用户于 2026-08-31 确认。

### Questions Reserved for Plan

- 现有 Thread、CraftSession、SessionSnapshot、CraftPlan persistence 与 event dispatcher 中，Segment identity 和 active epoch 的最小迁移位置。
- `ConversationCheckpoint` schema、版本迁移、大小预算、最近轮数和摘要生成/复用策略的默认值。
- 各 Harness 官方 bootstrap/resume 接口能接受哪些 transcript、system context、summary 或 metadata；不支持时的统一 fail-closed/limited 语义。
- safe-boundary detector 如何统一表达 active tool、permission、question、subagent、compaction 和 terminal state。
- 目标 Runtime prepare 的超时、取消、重试、rollback 与资源清理策略，避免固定 60 秒硬上限。
- UI 如何复用 v1.0 组合选择与 CapabilityResolution 方向，而不提前实现完整四格工作台。
- 如何构造可重复、脱敏的真实 `Codex -> Grok Build -> Codex` Debugger 验收环境。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Complete / Awaiting Coder Authorization
- Notes：三项核心产品语义已冻结；Gate Check 与 Plan 已在独立 v0.9 Feature worktree 完成。本次不创建 Coder/Debugger，不修改产品源码，不执行 merge/tag/push。

## Ideate → Plan Gate Check

> 2026-08-31 结合最新 Dev Repo、Crafting Runtime seam、Supervisor、canonical event routing、数据库 schema 与既有 Continue-in-Provider 流程完成。

- Feasibility：**OK**。结构化 Runtime seam 已具备 session create/resume/interrupt/terminate 与 canonical event 入口，可以建立同 Thread handoff transaction。
- Practicality：**OK WITH STAGED MIGRATION**。现有事件与持久化以 `threadId` 为主键，采用 expand → migrate active writers → contract，避免一次性破坏所有事件消费者。
- Alignment：**OK**。属于 Phase 2 Native Composition Runtime，是 v1.0 Model × Harness Workbench 的连续性基础，不进入 Auto-Crafting 或官方 Harness 内部 agent loop。
- Info Completeness：**OK**。默认切换时机、主动终止语义、checkpoint 内容和回切规则均已确认。

Manager 自行修复的非产品级问题：

1. 先加入可选 Segment envelope 与 durable ledger，再迁移 active writer 到 epoch fencing，最后覆盖 Renderer/remote sync。
2. 复用 `ContinueInProviderDialog` 的选择器与 context extraction 经验，保留 Fork/Move；新 Switch 必须由 Supervisor 在同一 Thread 内完成事务。
3. canonical runtime items 继续作为 conversation ledger/source of truth；`ConversationCheckpoint` 只保存版本化投影、锚点与 provenance，不沿用 50,000 字符 transcript fallback。

结论：**OK — READY FOR IMPLEMENTATION AFTER USER AUTHORIZATION**

## Part II — Plan

### Plan Metadata

- Status：`PLAN READY / NOT EXECUTING`
- Feature：`v0.9.0 — Cross-Harness Session Handoff`
- Planning Base：`dev@8bc45cfe408a6e603c777f04bce3c22627b76656`
- Feature Branch：`feature/v0.9-cross-harness-handoff`
- Feature Worktree：`D:\Work\CraftStation\craftstation-dev\.worktrees\v0.9-cross-harness-handoff`
- Implementation Owner：尚未创建；等待用户授权启动 Coder
- Local Tickets：`.scratch/craftstation-0.9.0/issues/01-runtime-segment-ledger.md` 至 `08-real-cross-harness-acceptance.md`

### Objective

在不伪造跨厂商 native resume 的前提下，让同一 CraftStation Thread 的后续 Turn 从一个 Model × Harness 组合安全、可恢复地交接到另一个组合。切换使用可审计的 `ConversationCheckpoint`、新的 Runtime Segment/Entity/native Session 和唯一 active binding epoch；失败时回滚，迟到事件不得污染当前 Runtime。

### User Stories

1. 用户可让当前 Turn 完成后自动切换，不中断工作、不新建对话。
2. 用户可终止过长的 Turn 并切换；旧 Runtime 未确认停止时系统 fail closed。
3. 目标 Harness 获得任务摘要、状态、关键结果、最近若干轮和同一工作区，而不是全量重放历史。
4. 切换失败后旧组合仍可恢复，消息、文件变更和任务状态不丢失。
5. 每条输出可追溯 Segment、Recipe、CraftPlan、Model、Harness、Entity 和 native Session。
6. 应用重启后恢复同一 Thread、Segment 历史和唯一 active 组合。

### Architecture and Interfaces

#### Runtime Segment Ledger

- `RuntimeSegment` 是 implementation-level lifecycle record，不加入一级 Domain language。
- 同一 Thread 拥有按 `ordinal` 排序的 Segment ledger，任一时刻最多一个 `active` Segment/`bindingEpoch`。
- Segment 至少持久化：identity、ordinal、epoch、status、脱敏 CraftPlan/provenance snapshot 或引用、model/harness/provider/auth/profile opaque refs、Entity/runtime/native session refs、predecessor/checkpoint ref 与 lifecycle timestamps。
- 建议 durable status：`preparing | active | inactive | failed | rolled_back | terminated`。
- 旧 Thread 无 Segment 时执行幂等 lazy bootstrap；完整 runtime items 仍形成一条 Thread timeline，不拆成多个用户 Thread。

#### Versioned ConversationCheckpoint

- 至少包含 source Segment/native ref、任务摘要、当前状态、关键决策、重要工具/文件结果、workspace change summary、最近 N 个 completed turns、ledger anchors、projection policy、预算/截断 metadata 与脱敏 provenance。
- canonical ledger 是 source of truth；checkpoint 是可重建的目标相关投影，不取代原 timeline，也不默认注入全量历史。
- 最近轮数与 token/字符预算集中配置并受目标能力限制；`extractContext` 可作为摘要来源之一，但不是唯一数据源。
- 不导出 hidden reasoning、provider internal state、活动工具句柄、未决 permission/question 或 credentials。

#### Session Handoff Deep Module

外部 Interface 保持小而稳定：

```ts
requestSwitch(threadRef, targetCraftPlan, mode): Promise<SwitchResult>
cancelQueuedSwitch(threadRef, requestId): Promise<void>
readSwitchState(threadRef): SwitchState
```

`mode` 只支持 `after-current-turn` 与 `abort-current-turn`。模块内部隐藏 per-thread lock、preflight、safe-boundary detection、checkpoint projection、target prepare/bootstrap/readiness、epoch event subscription、active binding CAS、source deactivation、rollback、cleanup 与 diagnostics。Renderer 不得自行编排 `close + craftAgent`。

#### Transaction State Machine

```text
requested -> queued -> preparing -> checkpointed
          -> target_starting -> target_ready -> activating -> active

abort: requested -> interrupting_source -> source_stopped -> checkpointed -> ...
failure: ... -> rolling_back -> rolled_back | failed
```

- target Ready 与 subscription 完成前，source 保持可恢复；只有 active binding CAS 成功后才更新 Thread 当前组合并接收 Prompt。
- queued request 采用 replace-latest；进入 preparing 后不能静默替换。
- 不设置固定 60 秒总超时；每阶段使用可取消、可配置 timeout，并报告 phase、operation、code 和 cleanup/rollback result。

#### Safe Boundary and Fencing

- 激活目标前必须确认：source 已完成 Turn 或 abort 已确认；无 active tool、permission、question、request、steer、subagent、compaction 或 interrupt handshake；completed items/turns 已持久化；switch lock 与 source epoch 仍有效。
- canonical `RuntimeEvent` 先扩展可选 execution envelope：`segmentId`、`runtimeSessionId`、`bindingEpoch`、可选 `eventSequence`，保持旧事件可解码。
- 新 Prompt、steer、permission/question answer、interrupt 与 terminate 必须验证当前 active epoch。
- 旧 epoch 事件可归档，但不得更新 active message、Turn、permission/question、attention、usage、request 或 completion state。

#### Return-to-Harness Rule

从 Segment A 离开后，只要中间 Segment 产生新消息、工具结果、completed turn 或 workspace change，回到同一 Harness 必须创建新的 continuation Segment C、新 Entity 和新 native Session，并注入增量 checkpoint。中间无新内容且官方能力明确支持安全 resume 时才可复用旧 ref；该优化不是 v0.9 PASS 条件。

#### UI and Persistence

- 复用 Continue-in-Provider 选择入口，保留 Fork/Move，新增 `Switch in this conversation`。
- 显示 current/target combination、两种 mode、queued/preparing/checkpointed/starting/activated/rollback/failed 状态。
- timeline 用轻量分隔/标签显示 `Model · Harness` provenance；当前组合显示 `Recipe 配置名称 · 模型名称`。
- 重启从 durable ledger 恢复；不能安全恢复的 preparing transaction 标为 failed/rolled_back，绝不自动激活两个 Runtime。
- 关键日志携带 correlation/thread/segment/epoch/phase/operation/status/error/cleanup，不记录敏感内容。

### Acceptance Criteria

- [ ] 旧 Thread 可 lazy bootstrap initial Segment，新旧 Thread 均保持单一连续 timeline。
- [ ] 重启恢复全部 Segment、provenance 与唯一 active binding。
- [ ] checkpoint 默认只含摘要、状态、必要结果、最近若干 completed turns 和 anchors；预算、截断、版本与 redaction 有测试。
- [ ] idle Codex → Grok switch 在同一 Thread 完成，目标真实 response 进入原 timeline。
- [ ] busy Runtime 默认 queued，并在 safe boundary 自动切换；下一 Prompt 不抢跑给旧 Segment。
- [ ] abort 模式等待官方 interrupt confirmation；失败不激活目标、不形成双 writer。
- [ ] target preflight/start/bootstrap/activation 任一步失败均保留或恢复 source，并给出稳定诊断。
- [ ] active input 与 canonical events 受 epoch fence 保护，迟到事件不污染当前状态。
- [ ] `Codex A -> Grok B -> Codex C` 中，B 产生新内容后 C 是新 continuation Segment。
- [ ] UI 同一 Thread 展示切换进度、回滚和 provenance，既有 Fork/Move 不退化。
- [ ] 真实 Debugger tracer 完成 Codex → Grok → Codex 多轮、同工作区 continuation，均为官方 Runtime non-synthetic response。
- [ ] secrets/artifacts scan 无明文凭据或隐藏推理；未验证组合继续 UNVERIFIED/BLOCKED。

### Tickets

#### T01 — Expand Durable Runtime Segment Ledger

- Goal：建立 Segment history 与唯一 active epoch 的持久化基础。
- Scope：DB migration、repository API、lazy bootstrap、restart recovery、脱敏 provenance。
- Depends On：None。
- Acceptance：迁移幂等；同 Thread 不能有两个 active Segment；重启恢复 order/epoch/native refs；旧单 Session 路径不变。

#### T02 — Build Versioned ConversationCheckpoint Projection

- Goal：从 canonical ledger 生成可预算、脱敏、可追溯的 portable continuation context。
- Scope：schema/versioning、summary/state/decisions/results/recent turns/anchors、budget、redaction。
- Depends On：T01。
- Acceptance：默认无全量 transcript；确定性投影；预算截断；敏感数据/hidden reasoning negative tests；可关联 source Segment。

#### T03 — First Same-Thread Safe Switch Tracer Bullet

- Goal：完成 idle Codex Segment → Grok Segment 的 Supervisor-owned vertical slice。
- Scope：`requestSwitch`、lock、preflight/start/bootstrap、最小 epoch CAS、rollback、原 timeline event。
- Depends On：T01、T02。
- Acceptance：不创建新 Thread；Ready 后才 active；target failure 时 source 可用；无双 writer。

#### T04 — Queue Switch at Turn Boundary

- Goal：实现默认的 Turn 完成后自动切换。
- Scope：safe-boundary detector、queued/replace-latest/cancel、所有 active/pending gates、next-Prompt routing。
- Depends On：T03。
- Acceptance：busy 时只排队；Turn 持久化后自动切换；pending gate 阻止 activation；queued request 可取消/替换。

#### T05 — Abort Current Turn and Transactional Rollback

- Goal：实现“终止当前 Turn 并切换”及完整 failure cleanup。
- Scope：official interrupt handshake、source-stopped confirmation、target failure rollback、phase timeout/cancel、diagnostics。
- Depends On：T04。
- Acceptance：abort 未确认则 fail closed；target 失败时 source 可恢复；无资源泄漏、无双 writer；错误含 correlation/phase/code/rollback。

#### T06 — Fence Events and Inputs Across Active Paths

- Goal：把最小 epoch transaction 扩展到 canonical events、commands、remote sync 与 restart replay。
- Scope：optional envelope、dispatcher/input guards、stale archive policy、Renderer boundary、兼容迁移。
- Depends On：T03。
- Acceptance：旧事件仍可读但不改变 active state；stale command 被拒绝；remote/restart 保留 provenance；不做全仓 breaking migration。

#### T07 — In-place Switch UI and Provenance Timeline

- Goal：提供同一对话内可理解、可操作、可恢复的组合切换体验。
- Scope：复用 selector、保留 Fork/Move、新增 Switch、两种 mode、progress/error/rollback、provenance、a11y/i18n。
- Depends On：T04、T05、T06。
- Acceptance：Renderer 仅调用 Handoff Interface；timeline 连续；状态清楚；Fork/Move 不退化；restart presentation 可恢复。

#### T08 — Real Codex → Grok → Codex Continuation Acceptance

- Goal：以真实官方 Runtime 关闭 Feature-level evidence gate。
- Scope：真实多轮/文件状态、queued/abort/rollback/late-event/restart、回切新 Segment、安全扫描与回归。
- Depends On：T07。
- Acceptance：三段真实 non-synthetic response；Grok 理解 checkpoint/workspace；回 Codex 创建新 continuation；失败场景有证据；未验证 route 不升格。

### Execution Order

```text
T01 -> T02 -> T03 -> T04 -> T05
                  +-> T06
T04 + T05 + T06 -> T07 -> T08
```

单 Coder 推荐顺序：`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08`。T03 必须包含最小 epoch CAS，T06 再覆盖所有入口；不能在没有 fencing 的情况下先暴露 UI。

### Key Risks

| Risk | Control |
| --- | --- |
| 迟到事件污染新 Segment | epoch + runtimeSessionId fence；旧事件只归档 |
| abort 形成双 writer | 官方停止确认、per-thread lock、CAS、fail closed |
| checkpoint 遗漏历史 | 完整 ledger 保留，checkpoint 有 anchors，可按需重投影 |
| 凭据或隐藏推理泄露 | allowlist schema、central redaction、negative tests、artifact scan |
| migration 破坏旧 Thread | expand/lazy bootstrap/idempotent migration，旧字段 optional |
| Renderer 导致非原子切换 | Supervisor-owned deep module |
| portable continuation 被误称 native resume | UI/event/docs 明确 Segment 边界 |
| 未验证 Harness 被误升格 | T08 逐 Runtime 真实证据；其余保持 UNVERIFIED/BLOCKED |

### Coder Start Contract

- 当前只完成 Manager Plan 和 Ticket 草案，不修改产品源码。
- 用户明确授权执行后，Manager 才创建项目绑定的 `Coder-0.9-Cross-Harness Handoff`，模型 `gpt-5.6-sol` / `high`，唯一允许工作区为本 Feature worktree。
- Coder 按 T01–T08 交付，并在 Feature self-check 后自行创建同 worktree 的 `Debugger-0.9-Cross-Harness Handoff`，模型 `grok-4.6` / `high`。
- Debugger PASS 后才允许合入 nested Dev；Dev → Main、正式 tag 与 push 不在本 Plan 授权范围。
