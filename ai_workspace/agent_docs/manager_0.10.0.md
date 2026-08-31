# CraftStation Manager — v0.10.0

> 当前 Feature 的唯一 Manager 文档。Part I 记录 Ideate，Part II 由同一 Manager 在 Gate Check 后规划。

## Part I — Ideate

- Status：Ready for Plan
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
- Plan Status：Not Started
- Research：`ai_workspace/agent_docs/research_0.10.0-poracode-cross-thread.md`
- Notes：用户明确授权自行写 Ideate、Plan并启动 Coder。Part I 已冻结，下一步执行 Gate Check 与 Part II；不需要再次向用户确认产品问题。

## Ideate → Plan Gate Check

状态：Pending。

## Part II — Plan

状态：Not Started。
