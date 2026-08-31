# CraftStation Manager — v0.10.0

> 当前 Feature 的唯一 Manager 文档。Part I 记录 Ideate，Part II 由同一 Manager 在 Gate Check 后规划。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-08-31
- Last Updated：2026-08-31
- Roadmap Context：Phase 2 — Native Composition Runtime；在 v0.9 同 Thread Runtime handoff 之外，建立多个长期 Thread 之间的组合无关协作
- Owner：Manager / Ideate

### Feature Intent

#### Problem

CraftStation 的每条 Thread 都可以拥有不同 Model、Harness、Recipe、CraftPlan、Entity 和 native Session，但这些长期 Thread 当前仍是彼此孤立的。PoraCode 已提供 `list/read/create/send/wait/interrupt/stop thread` 等 App Controls MCP primitives，能够向另一条 Thread 投递消息；但它没有 CraftStation 所需的跨 Model × Harness reply correlation、对话 provenance、目标忙时统一语义、回复回流、持久化 exchange 或 UI 产品体验。

因此，“Codex + ChatGPT Thread 问 Grok Build + Grok 4.6 Thread 一个问题，再看到 Grok 的真实回复并继续追问”目前只能靠 Agent 手工串联多个 MCP tool call，无法作为可靠、可恢复、可审计的 CraftStation 功能。

#### Why Now

v0.9 解决同一用户可见 Thread 内切换 Model/Harness Runtime；v0.10 解决多个长期 Thread 保持各自身份和 native context 时彼此对话。两者共同构成后续工作台、Team Mode 和复杂 Recipe collaboration 的基础，但 v0.10 不依赖尚未完成的 v0.9 implementation，可以在独立 worktree 并行开发。

#### Desired Outcome

用户或经用户授权的 Agent，可以从一条 CraftStation Thread 向同项目另一条 Thread 发起有来源、有上下文边界、有稳定 exchange id 的请求。目标 Thread 使用自己的真实 Model × Harness Runtime 处理请求；回复保留在目标 Thread，也作为带 provenance 的协作结果回流源 Thread。双方可以在同一 durable conversation link 上继续多轮对话，应用重启后不丢失 exchange 状态。

### Expected Behavior

#### User Experience

- 在当前 Thread 的 composer/tool rail 中选择“Ask another thread”，从同项目 Thread picker 选择目标。
- picker 显示目标 Thread 的 title、status、worktree、Recipe、Model、Harness 和当前可用性；不得只显示 legacy `agentKind`。
- 用户输入请求，可选择附加最近若干轮/选中消息的 portable context；默认只发送明确请求和最小来源身份，不复制完整源 Thread。
- 目标 idle 时立即投递；目标 working 时默认排队到当前 Turn 完成后，不把请求偷偷变成 steer。
- UI 可显式选择“interrupt target and send”；必须确认目标中断后再投递，失败则保持 exchange 未投递并显示原因。
- 源 Thread 显示 request card：目标组合、queued/delivered/working/replied/needs-attention/failed/cancelled 状态。
- 目标 Thread 显示 cross-thread request card，明确来源 Thread、Model/Harness 和返回入口；请求同时作为目标 Harness 的真实输入。
- 目标真实 assistant response 保留在目标 timeline；其完成文本和必要结果自动作为 reply card 投影回源 Thread，可点击跳转目标原文。
- 用户可在同一 link 上继续追问，或从目标 Thread 反向发起请求；两条 Thread 始终保持各自 native context 和可见 timeline。

#### System Behavior

```text
Source Thread A (Codex + ChatGPT)
  -> ThreadExchange E1
      -> Target Thread B (Grok Build + Grok 4.6)
          -> native Turn / real response
      <- correlated reply projection
  -> ThreadExchange E2 (follow-up on same ConversationLink)
```

- `ConversationLink`、`ThreadExchange` 是 implementation-level lifecycle records，不新增一级 CraftStation Domain term。
- 请求目标是长期一等 Thread，不是 Crossagents ephemeral subagent。
- Thread A/B 保留各自 Recipe、CraftPlan、Entity、native Session、context/compaction/tools/MCP/permission/subagent 语义。
- 每个 exchange 记录 source/target Thread、observed Model/Harness/Recipe/CraftPlan/Entity/native Session provenance、request/reply anchors、causal chain、status 和 timestamps。
- 目标 binding 在投递时解析；未来若 v0.9 已存在，则记录目标 active Segment/epoch；没有 v0.9 时使用当前 Thread composition/session provenance。v0.10 不静态依赖 v0.9 类型。
- Source reply projection 只包含 completed assistant output、明确允许的结构化结果与跳转引用，不导出 hidden reasoning、active tool handles、permissions 或 credentials。
- 对方回复不是自动生成下一次 outbound request；新的跨线程请求必须由用户或已授权 Agent 显式发起，防止无限 ping-pong。

### Dialogue Semantics

- v0.10 支持同项目 Thread 之间的一对一、多轮、异步 dialogue；跨项目 dialogue 暂不开放。
- 默认 target delivery mode：`after-current-turn`。
- 显式 delivery mode：`interrupt-and-send`；不确认 interrupt 则 fail closed。
- Agent-facing compatibility primitives 保留 `list_threads/read_thread/send_to_thread/wait_for_thread`，但其底层路由进入 CraftStation Thread Collaboration Module。
- 新增高层 `ask_thread`/`wait_for_thread_reply`（最终名称由 Plan 固定），避免 Agent 手动读取错误的 target turn。
- 每次请求生成 exchange id；目标 reply 必须锚定该请求之后的一个确定 completed Turn，不能把旧 assistant message 当新回复。
- 同一 source→target 可同时存在有限个 exchange，但同一 ConversationLink 默认顺序交付；最大并发、hop depth、timeout 由 Plan 设保守上限。
- Target needs approval/reply 时 exchange 标记 `needs-attention`，不伪造完成；用户可跳转目标处理。
- Target runtime unavailable/auth required/quota/binary error 直接回传稳定错误，不静默换模型、Harness 或账号。

### Context and Privacy Policy

- 默认 envelope：source Thread display identity + explicit request + correlation metadata。
- 可选 context capsule：用户选中的消息、任务摘要、关键状态与最近若干 completed turns，受预算和 redaction 控制。
- v0.10 建立独立 `ThreadContextProjection` Interface；未来可适配 v0.9 `ConversationCheckpoint`，但不得复制其 implementation 或形成编译依赖。
- 不跨 Thread 自动复制完整 transcript、hidden reasoning、原始 tool output、active permission、cookie、token、API key、AK/SK 或本地秘密文件。
- 目标 Thread 的回复投影保留完整原文引用；长内容在源 Thread 使用有界 excerpt，按需跳转/读取原 Thread。
- 默认只允许同项目 target；跨 worktree 可以显式选择并显示警告，避免误以为共享同一 filesystem state。

### Scope

#### In Scope

- CraftStation-owned Thread Collaboration Module 与 durable link/exchange ledger。
- 对现有 PoraCode App Controls MCP thread primitives 的适配和深化。
- 同项目、不同 Model/Harness/Recipe 的长期 Thread directory、request、queue、wait、reply correlation 和 restart recovery。
- 所有 Runtime 可使用的 UI 发起路径；支持 MCP 注入的 Harness 可使用 agent-initiated path。
- Target busy 默认排队、显式 interrupt、needs-attention、failure/cancel/timeout semantics。
- Source/target timeline cards、reply projection、provenance、jump navigation 与 remote/restart sync。
- 至少一条真实 `Codex + ChatGPT Thread -> Grok Build + Grok Thread -> reply -> follow-up` tracer bullet，并覆盖另一条不同 Harness route（凭据可用时优先 OpenCode/Kimi）。

#### Out of Scope

- 跨项目或跨 CraftStation host 的 Thread dialogue。
- 把长期 Thread 改造成 Crossagents ephemeral subagent。
- 自动群聊、broadcast、会议主持、投票、learned routing 或 Team Mode orchestration。
- 无用户授权的 Agent 自主向任意 Thread 发消息。
- 全量 transcript 复制、native session 合并或隐藏推理共享。
- 自动合并两个 worktree 的文件变更。
- v0.9 同 Thread Runtime handoff implementation；只保留可选 provenance/context seam。

### Important Decisions

1. 长期 Thread dialogue 基于 App Controls MCP，不基于 Crossagents `spawn_agent`。
2. UI 控制面适用于所有 CraftStation Runtime；Agent 自主 MCP path 仅对真正获得 built-in MCP 的 Harness 宣告 SUPPORTED。
3. 默认 target busy 时排队，不中断；interrupt 必须显式。
4. 回复自动回流 source，但不会自动触发下一次请求。
5. durable exchange 只保存 identity、status、anchors、provenance 和必要 excerpt，不重复保存两边完整 transcript。
6. v0.10 与 v0.9 并行、互不依赖；两者合入 Dev 时通过可选 Segment/ContextProjection adapter 集成。

### Trade-offs

- 复用 PoraCode primitives 能快速获得 thread discovery/lifecycle，但必须在 CraftStation seam 后面消除 legacy `agentKind + model` 假设。
- 自动 reply projection 提升连续性，但必须用 request/turn anchors 防止读到旧回复。
- 同项目限制牺牲跨项目协作，换取明确的隐私、权限和 workspace 语义。
- 默认不复制历史降低泄露与上下文成本；需要更多背景时由用户显式附加 capsule。
- v0.9/v0.10 并行会产生潜在 Thread schema/event/UI merge conflict；通过新表、新 Module 和 optional adapter 缩小重叠，最终由后合入的 Debugger按 Spec解决并回归。

### Constraints

- Official / Native Harness Runtime First；目标回复必须来自目标 Thread 的真实 Runtime，不得 synthetic。
- 不改变目标 Harness 内部 Agent Loop、context management、compaction、tools、MCP、permissions 或 subagents。
- 所有 target resolution、send/wait/reply projection 都经过 CraftStation control-plane Interface，不允许 Renderer 直接串联 DB/Supervisor 调用。
- 同一 exchange 使用 correlation id 和幂等 delivery key；应用重启不得重复投递请求。
- 队列、取消、interrupt、reply capture 与 error path 必须保留稳定状态和诊断。
- 不记录 credentials、完整敏感 prompt 或隐藏推理。
- 既有 v0.8/v0.7/v0.6/v0.5/v0.4 证据边界不因本 Feature 升格。

### Acceptance Intent

- [ ] 用户从 Thread A 选择不同 Model/Harness 的 Thread B 并发起 request，A/B ID 与各自 native Session 保持独立。
- [ ] B idle 时真实收到 request；B working 时默认 queue，Turn 完成后再投递。
- [ ] 显式 interrupt-and-send 完成官方 interrupt handshake；失败时不投递。
- [ ] B 的真实 assistant response 被确定性关联到 exchange，并投影回 A；旧 response 不会误关联。
- [ ] A/B 两边 timeline 都有可追溯 cards，可互相跳转。
- [ ] A 可在同一 ConversationLink 继续追问，B 保留自己的 native context。
- [ ] Target needs-attention/error/unavailable/auth/quota 均准确传回，不静默 fallback。
- [ ] 应用重启后恢复 queued/in-flight/replied exchange，不重复发送。
- [ ] agent-facing `ask_thread` 在真正支持 MCP 的两个不同 Harness Thread 间工作；不支持者 UI path 仍可用且 capability 显示准确。
- [ ] context capsule 受预算/redaction，默认不传全量历史，无 credentials/hidden reasoning。
- [ ] 真实 Codex→Grok→reply→follow-up tracer 通过；第二 route 取得真实证据或保持明确 BLOCKED。
- [ ] 既有 PoraCode thread MCP primitives、Crossagents、normal composer、remote/restart 回归不被破坏。

### Open Questions

- 无阻塞性产品问题。Manager 已按用户授权自行固定最小可实施语义。

### Questions Reserved for Plan

- Exchange/link schema 与现有 runtime item persistence 的最小 seam。
- 如何为 target delivery 分配稳定 user-message/turn anchor，并在多 Harness canonical events 中捕获 reply。
- target busy queue 与当前 pending steer/structured request 的隔离位置。
- MCP tool Interface、UI action 与 remote transport 如何共享同一个 Module。
- v0.9 Segment/ConversationCheckpoint 存在或不存在时的 optional integration adapter。
- 真实 E2E fixture、凭据边界和防 loop/concurrency 的保守常量。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Complete / Ready for Coder
- Research：`ai_workspace/agent_docs/research_0.10.0-poracode-cross-thread.md`
- Notes：用户明确授权自行写 Ideate、Plan并启动 Coder。Part I 已冻结，下一步执行 Gate Check 与 Part II；不需要再次向用户确认产品问题。

## Ideate → Plan Gate Check

> 2026-08-31 基于 CraftStation `dev@8bc45cf`、PoraCode reference `a28b995`、App Controls MCP thread tools、Crossagents MCP、Thread schema、Supervisor session lifecycle 和 runtime item persistence 完成。

- Feasibility：**OK**。`list/read/create/send/wait/interrupt/stop` primitives、runtime items、live status 与 resumable Thread 路径均已存在；只需在其上建立 exchange transaction、reply correlation 和 CraftStation provenance。
- Practicality：**OK**。限定同项目、一对一、显式请求、有限 context capsule，不做群聊/广播/跨 host，可在一个 Feature 内形成真实闭环。
- Alignment：**OK**。属于 Phase 2 Native Composition Runtime，连接多个保持独立 Recipe/CraftPlan/Entity/Session 的长期 Thread，不进入 Auto-Crafting。
- Info Completeness：**OK**。目标忙时、interrupt、回复回流、上下文、权限、跨 worktree 和 v0.9 并行边界均已固定。

Manager 自行修复的小问题：

1. 把 PoraCode App Controls MCP 与 Crossagents 明确分成 long-lived Thread lane 和 ephemeral subagent lane，v0.10 只以前者为主体。
2. 用新 `ConversationLink`/`ThreadExchange` ledger 与 optional provenance resolver 隔离 v0.9 Segment schema，避免两条并行 Feature 编译依赖。
3. 将 `send_to_thread` 的 Runtime-specific busy 行为统一为 Module-owned `after-current-turn` 默认合同，显式 interrupt 才允许中断。
4. 以 request anchor + target completed-turn anchor 捕获回复，不用“读取目标最后一条消息”的脆弱启发式。

结论：**OK — PLAN READY**

## Part II — Plan

### Plan Metadata

- Status：`PLAN READY / READY FOR CODER`
- Feature：`v0.10.0 — Cross-Thread Model × Harness Dialogue`
- Planning Base：`dev@8bc45cfe408a6e603c777f04bce3c22627b76656`
- Feature Branch：`feature/v0.10-cross-thread-collaboration`
- Feature Worktree：`D:\Work\CraftStation\craftstation-dev\.worktrees\v0.10-cross-thread-collaboration`
- Research：`ai_workspace/agent_docs/research_0.10.0-poracode-cross-thread.md`
- Tickets：`.scratch/craftstation-0.10.0/issues/01-thread-control-adapter.md` 至 `08-real-cross-thread-acceptance.md`

### Objective

把 PoraCode 的长期 Thread control primitives 深化为 CraftStation-owned 跨线程对话能力：同项目中两条不同 Model × Harness Thread 可以通过 durable exchange 异步发问、排队、获得目标真实 Runtime 回复、继续追问并在两边 timeline 保留可审计 provenance；MCP、UI、remote 共用同一 Module。

### Solution

建立一个深的 `Thread Collaboration Module`。调用方只需要给出 source、target、明确 request、delivery mode 和可选 context policy；Module 隐藏 target resolution、capability/auth/runtime preflight、busy queue、interrupt、delivery idempotency、request/turn anchors、reply capture、source projection、restart recovery、loop/concurrency limits 和 diagnostics。

### User Stories

1. 作为用户，我想从当前 Thread 选择另一条不同 Model/Harness 的 Thread提问，以利用对方已经积累的原生上下文。
2. 作为用户，我想看到目标的 Recipe、Model、Harness、status 和 worktree，以免发错对象。
3. 作为用户，我想让忙碌目标默认完成当前 Turn 后再处理请求，以免破坏已有工作。
4. 作为用户，我想显式中断目标并发送紧急请求，同时在中断失败时得到明确错误。
5. 作为用户，我想在源 Thread 自动看到目标真实回复及跳转链接，同时目标 Thread 保留完整原文。
6. 作为用户，我想继续追问同一目标，并让每轮 request/reply 正确关联而不混入目标其他消息。
7. 作为用户，我想显式附带选中消息或有界任务上下文，而不是自动泄露整个源 Thread。
8. 作为 Agent，我想在获得用户授权后通过 MCP 发起、等待和读取 exchange，而不手工猜测目标最新消息。
9. 作为用户，我想在目标需要 permission/reply、认证失败或不可用时，从源 Thread 看到准确状态并能跳转处理。
10. 作为用户，我想重启应用后继续查看 queued/in-flight/replied exchanges，且请求不会重复投递。
11. 作为用户，我想跨不同 worktree 对话时看到明确警告，不把消息交流误认为文件自动同步。
12. 作为 Debugger，我想验证每个 reply 的 source/target Recipe/CraftPlan/Model/Harness/Entity/native Session provenance。

### Deep Module Design

#### External Interface

概念 Interface：

```ts
listTargets(sourceThreadRef, filter): Promise<ThreadTargetSummary[]>
requestDialogue(sourceThreadRef, targetThreadRef, request, options): Promise<ThreadExchange>
cancelExchange(exchangeId): Promise<ThreadExchange>
readExchange(exchangeId): Promise<ThreadExchangeView>
waitForExchange(exchangeId, cursor, timeout): Promise<ThreadExchangeUpdate>
```

Interface invariants：

- source/target 必须存在且默认属于同一 project；不能给自己发送。
- `requestDialogue` 只提交一次；重复 idempotency key 返回同一 exchange。
- 默认 `after-current-turn`，只有显式 `interrupt-and-send` 触发目标 interrupt。
- reply 只能来自 request delivery anchor 之后、属于目标 Thread 的确定 completed Turn。
- Module 返回稳定状态/错误；调用方不直接操作 DB、Supervisor 或 runtime reducer。

#### Internal Adapters

- `ThreadControlAdapter`：包装现有 list/read/create/send/wait/interrupt/stop primitives，保留 legacy MCP 行为。
- `RuntimeProvenanceResolver`：解析 Thread 当前 Recipe/CraftPlan/Model/Harness/Entity/native Session；v0.9 Segment/epoch存在时通过 optional adapter读取。
- `ThreadContextProjection`：从用户选中内容和 canonical ledger 生成有界、脱敏 capsule。
- `ReplyProjector`：把目标 completed Turn 的允许内容投影为 source timeline collaboration result。
- `ExchangeRepository`：durable link/exchange/outbox/anchors，保证幂等和 restart recovery。

这些都是 Module implementation 的内部 seam，不暴露给 Renderer/MCP callers。

### Durable Model and State Machine

建议新表：

- `thread_conversation_links`：linkId、projectId、participant thread ids、created/updated、status。
- `thread_exchanges`：exchangeId、linkId、source/target、sequence、delivery mode、status、request/capsule refs、source/target provenance snapshots、delivery idempotency key、request item/turn anchor、reply turn/item anchors、timestamps、stable error、causal parent/hop depth。

默认状态机：

```text
created
 -> queued
 -> delivering
 -> delivered
 -> target_working
 -> needs_attention | replied

created/queued -> cancelling -> cancelled
any pre-reply stage -> failed | timed_out
```

- `replied` 只在 reply anchor 和 source projection 均 durable 后提交。
- outbox/claim 或等价事务保证进程崩溃后不会重复投递。
- 同一 ConversationLink 默认一个 active exchange；后续请求排在前一个 settled 后。
- 保守限制：最大 hop depth 4、单 link active exchange 1、单 source queued exchanges 8；值集中配置并测试。
- timeout 只改变 exchange wait/status，不自动 interrupt/stop target；目标后续完成时仍可转 replied，除非用户已取消且 delivery 尚未发生。

### Request, Context and Reply Envelope

- Request envelope：exchange/link/source/target identity、explicit user/agent request、delivery mode、createdAt、optional context capsule、provenance snapshot。
- Context capsule 默认 empty；用户显式选择后可包含 selected messages、任务摘要、当前状态、关键决策与最近 completed turns，使用 allowlist schema和预算。
- 目标 Runtime 收到清晰标记的 cross-thread request，包含 source title、组合 identity、reply expectation；不得伪装成目标用户自己原先输入。
- Reply capture 监听 target canonical completed Turn，使用 exchange delivery anchor和 causation metadata；不依赖最后一条消息。
- Source projection 保存有界 excerpt、result kind、target anchors、provenance和跳转信息；目标完整 timeline 是原文 source of truth。
- 不投影 hidden reasoning、active tools、permissions、credentials 或未完成 stream。

### Busy, Attention, Failure and Cancellation Semantics

- target idle/inactive-resumable：preflight 后立即 deliver/resume。
- target working：默认 durable queue；safe settled 后 deliver，不写 pending steer。
- `interrupt-and-send`：调用官方 target interrupt并等待 settled confirmation；失败则 exchange failed且未投递。
- target needs approval/reply：状态 `needs_attention`，source显示跳转；不代替用户批准或回答。
- target unavailable/auth/quota/binary/capability failure：稳定错误回源，不 fallback到其他组合。
- cancel before delivery：取消并清除 outbox；delivered 后 cancel 只停止等待/投影，不擅自 interrupt目标已经开始的 Turn，除非用户另行明确要求。

### MCP Compatibility

- 保留现有 `get/list/get/read/create/send/interrupt/stop/wait thread` 名称和兼容行为。
- `send_to_thread` 经 Module 的 delivery path，默认 busy queue；`interruptFirst=true` 映射显式 interrupt模式。
- 新增高层 `ask_thread`，返回 exchangeId/status；新增 `read_thread_exchange` 和 `wait_for_thread_reply`（最终工具名必须在 contract test 固定）。
- Agent 工具必须执行 self-target、same-project、authorization、loop/hop、request size和secret policy。
- UI path不依赖目标 Harness MCP 能力；Agent initiated path只有在 built-in MCP 实际注入并可调用时才显示 SUPPORTED。

### UI, Timeline and Remote Sync

- Thread picker复用 sidebar/search/provenance display primitives，支持按 title、Model、Harness、status 和 worktree过滤。
- Source/target cards均显示对端 title、`Recipe · Model · Harness`、status、timestamp和jump action。
- Source card展示 queued/delivering/working/needs-attention/replied/failed/cancelled；回复 excerpt可展开但完整内容跳转target。
- Target card明确这是来自另一Thread的请求并带source jump；普通 user/assistant messages不丢失。
- local/remote/mobile snapshot统一携带 exchange summaries与 timeline items；remote client不能绕过same-project/security policy。
- restart恢复UI和worker claim；stale worker不能重复投递或覆盖新状态。

### Acceptance Criteria

- [ ] 现有 PoraCode thread MCP tools通过新的 Adapter后contract不退化。
- [ ] UI列出同项目不同Model/Harness targets并准确展示composition/worktree/status。
- [ ] idle target完成同Thread-id保持的真实request→native response→source reply projection。
- [ ] working target默认queue且不steer/interrupt；settled后只投递一次。
- [ ] explicit interrupt-and-send等待确认；失败不投递。
- [ ] request/reply使用durable exchange id和anchors，目标并行产生的其他message不会误关联。
- [ ] follow-up在同link排序并正确关联；loop/hop/concurrency limits生效。
- [ ] optional context capsule有预算、redaction和provenance；默认不复制history。
- [ ] target needs-attention/error/unavailable/auth/quota准确回源且无fallback。
- [ ] restart恢复queued/in-flight/replied，outbox幂等。
- [ ] MCP `ask/read/wait reply`与UI共享Module；无MCP的Harness capability显示准确。
- [ ] source/target/remote/mobile timeline cards和jump navigation工作。
- [ ] 真实Codex→Grok request/reply/follow-up通过；第二route真实通过或保持BLOCKED。
- [ ] credentials/hidden reasoning不进入DB、IPC、Renderer、logs或artifacts。

### Tickets

#### T01 — Encapsulate Existing Thread Controls

- Goal：把PoraCode thread primitives收进可替换的`ThreadControlAdapter`，保持全部现有MCP contract。
- Scope：list/read/create/send/wait/interrupt/stop、live/persisted snapshot、resumable dead session、stable errors和contract tests。
- Depends On：None。
- Acceptance：现有工具输入输出兼容；MCP不直接操作Supervisor/DB；live、resume、non-resumable、self-target测试通过。

#### T02 — Idle Cross-Thread Dialogue Tracer Bullet

- Goal：让用户从A向idle B提问，B真实回复并投影回A。
- Scope：link/exchange repository、minimal Module Interface、target selector、request envelope、delivery/reply anchors、source/target minimal cards、provenance。
- Depends On：T01。
- Acceptance：同项目不同Harness A/B保留独立Thread/native Session；只投递一次；reply不误读旧message；两边可跳转；重启可读replied exchange。

#### T03 — Busy Queue, Ordering and Cancellation

- Goal：target busy时可靠排队，并支持顺序follow-up和delivery前取消。
- Scope：durable outbox/claim、safe settled trigger、per-link ordering、replace/cancel policy、limits、crash recovery。
- Depends On：T02。
- Acceptance：不steer/interrupt busy target；settled后一次投递；并发worker不重复；follow-up顺序稳定；cancelled request不投递。

#### T04 — Explicit Interrupt and Failure/Attention Lifecycle

- Goal：关闭interrupt、needs-attention和runtime failure的产品语义。
- Scope：interrupt handshake、attention propagation、unavailable/auth/quota/binary errors、timeout、cleanup和diagnostics。
- Depends On：T03。
- Acceptance：未确认interrupt不发送；attention可跳转；错误不fallback；timeout不误杀target；状态和日志稳定、脱敏。

#### T05 — Context Capsule and Full Composition Provenance

- Goal：在用户授权下传递最小可移植上下文，并显示真实Model/Harness/Recipe/CraftPlan provenance。
- Scope：selected messages/summary/state/recent turns、budget/redaction、RuntimeProvenanceResolver、cross-worktree warning、optional v0.9 adapter。
- Depends On：T02。
- Acceptance：默认empty capsule；显式context有界；secret/hidden-reasoning negative tests；v0.9不存在时可运行；存在时可读Segment/epoch但不硬依赖。

#### T06 — Agent-facing Dialogue MCP

- Goal：让支持built-in MCP的Harness通过高层工具可靠发问、等待和读取reply。
- Scope：`ask_thread`、`read_thread_exchange`、`wait_for_thread_reply`、legacy send mapping、authorization/self/same-project/loop/hop guards。
- Depends On：T03、T04、T05。
- Acceptance：工具共用Module；返回exchange cursor而非猜last message；unauthorized/loop/cross-project拒绝；legacy tools回归通过；capability准确。

#### T07 — Complete UI, Remote Sync and Restart Recovery

- Goal：交付可日常使用的desktop/remote协作体验。
- Scope：picker filters、full cards、status actions、jump navigation、remote/mobile snapshot、restart worker recovery、a11y/i18n。
- Depends On：T04、T05、T06。
- Acceptance：所有status可见；source/target互跳；remote不能绕过policy；restart不重复投递；键盘/屏幕阅读可用。

#### T08 — Real Multi-Harness Cross-Thread Acceptance

- Goal：用真实官方Runtime关闭Feature evidence gate。
- Scope：Codex→Grok request/reply/follow-up、busy queue、interrupt failure、needs-attention、restart、另一route、credential scan和regression。
- Depends On：T07。
- Acceptance：真实non-synthetic targetresponses；anchors/provenance正确；第二route真实通过或明确BLOCKED；既有App Controls/Crossagents/normal composer/v0.8回归；Debugger独立验收。

### Dependency Graph and Execution Order

```text
T01 Thread Control Adapter
  -> T02 Idle Dialogue
      -> T03 Busy Queue
          -> T04 Interrupt / Failure
      -> T05 Context / Provenance
T03 + T04 + T05
  -> T06 Agent MCP
      -> T07 UI / Remote / Restart
          -> T08 Real Acceptance
```

单Coder执行顺序：`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08`。

### Key Risks and Controls

| Risk | Control |
| --- | --- |
| target回复误关联 | request item + completed-turn causation anchors，不读last message |
| crash重复投递 | durable outbox、idempotency key、claim epoch |
| busy target被意外steer | Module-owned queue；显式interrupt mode分离 |
| 无限Agent ping-pong | 不自动触发outbound、hop depth、same-link concurrency guard |
| context/credential泄露 | default empty capsule、allowlist projection、redaction和artifact scan |
| v0.9/v0.10 merge冲突 | 新表/新Module/optional adapter；不依赖Segment具体类型 |
| legacy PoraCode MCP退化 | T01 contract tests + T08 full regression |
| UI声称所有Harness支持Agent MCP | 区分UI control-plane SUPPORTED与agent MCP capability |

### Coder Start Contract

- Coder只在本v0.10 Feature worktree开发，不得修改v0.9、dev或main。
- 默认模型`gpt-5.6-sol/high`，一次性连续完成T01–T08。
- 重要并发、outbox、reply anchor、security路径先写失败测试，再实现。
- 全部Tickets与self-check完成后写`ai_workspace/agent_docs/coder_0.10.0.md`，自行创建全新的`Debugger-0.10-Cross-Thread Collaboration`，固定`grok-4.6/high`并交接同一worktree。
- Debugger PASS后自行合入nested Dev并解决与v0.9的冲突；Dev→Main、tag和push均未授权。
