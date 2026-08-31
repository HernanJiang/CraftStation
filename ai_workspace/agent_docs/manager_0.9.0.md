# CraftStation Manager — v0.9.0

> 当前 Feature 的单一 Manager 交接入口。Part I 记录 Ideate，Part II 留待 Manager / Plan。

## Part I — Ideate

- Status：Ready for Plan
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
- Plan Status：Not Started
- Notes：三项核心产品语义已冻结。进入 Plan 前必须做 Ideate → Plan Gate Check，并从最新 Dev 基线创建独立 v0.9 Feature worktree；本次不创建 Coder/Debugger，不修改源码，不执行 merge/tag/push。

## Ideate → Plan Gate Check

> 待 Manager / Plan 进入 Planning 前结合最新 Dev Repo 执行。

- Feasibility：Pending
- Practicality：Pending
- Alignment：Pending
- Info Completeness：Pending

结论：PENDING

## Part II — Plan

状态：Not Started。等待用户明确进入 Manager / Plan。
