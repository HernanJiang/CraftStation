# CraftStation v0.10 Cross-Thread 完整交接文档

> Feature：`v0.10.0 — Cross-Thread Model × Harness Dialogue`  
> 整理时间：2026-08-31  
> 用途：供新的 Coder、Debugger、Manager 或其他协作者在不依赖原会话历史的情况下接手。  
> 当前结论：`T01–T07 已实现并完成 Coder 自检；T08 真实验收 BLOCKED；Debugger 尚无有效 verdict。`

## 1. 一分钟接手摘要

这个 Feature 要解决的是：让 CraftStation 中两条长期存在、各自拥有独立 Model、Harness、Recipe、native Session 和 timeline 的 Thread 可以可靠地互相提问、获得真实回复并继续追问。

目前已经完成了主要工程实现：

- 建立 CraftStation-owned `Thread Collaboration Module`；
- 建立 durable `ConversationLink` / `ThreadExchange` SQLite ledger；
- 支持 idle target 立即投递、busy target 默认排队、显式 interrupt-and-send；
- 使用 exchange id、request anchor 和 completed-turn anchor 确定性关联回复；
- 新增 App Controls MCP 高层工具；
- 打通 Desktop IPC、remote HTTP/client、headless host 和 Renderer UI；
- 完成 context budget/redaction、provenance、权限和 loop guards；
- T01–T07 的定向测试与静态检查已通过。

目前还没有完成的关键事项：

- 没有真实 `Codex source Thread -> Grok target Thread -> reply -> follow-up` 证据；
- 没有第二条真实 Harness route；
- 没有真实 Electron UI/restart/stale-worker 验收 artifacts；
- 全仓 typecheck 被缺失的 Codex protocol generated files 阻塞；
- 专属 Debugger 的 `grok-4.6/high` 请求连续两次返回 HTTP 422，没有产生验收结论；
- 所有 v0.10 源码与文档改动当前仍是未提交工作区状态。

因此当前不能宣称 Feature PASS，也不能 merge、tag 或 push。

## 2. 唯一正确工作区

后续人员必须只在下面这个现有 Feature worktree 工作：

```text
D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration
```

当前 Git 事实：

```text
Git root:  D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration
Branch:    dev/v0.10-cross-thread-collaboration
HEAD:      0bbba5f66e5b7be782443206c02781ed6825ba77
```

重要说明：

- 当前所有 v0.10 实现都位于未提交修改中，不能 reset、checkout、clean 或覆盖；
- `package.json` 和 `pnpm-lock.yaml` 没有修改；
- 不要去旧路径 `D:\Work\CraftStation\craftstation-dev\.worktrees\...`；
- 不要在 `D:\Work\CraftStation` main、v0.9 worktree、旧 v0.7/v0.8 worktree或 Codex 自动创建的其他 worktree 修改；
- Manager Plan 中记录的旧 worktree/branch/base 是迁移前信息，接手时以本节的实际 Git 状态为准；
- 未经用户授权，不得 merge main、创建正式 tag 或 push。

## 3. 必读资料

建议按这个顺序读取：

1. `AGENTS.md`：CraftStation 长期架构、Git 与工作流硬规则；
2. `PROJECT_STATUS.md`：当前动态状态与阻塞；
3. 本文档：完整接手视图；
4. `ai_workspace/agent_docs/manager_0.10.0.md`：Feature Intent、Spec、Acceptance 和 T01–T08；
5. `ai_workspace/agent_docs/research_0.10.0-craftstation-cross-thread.md`：CraftStation 一手源码核验；
6. `ai_workspace/agent_docs/coder_0.10.0.md`：Coder 实现和验证报告；
7. `.scratch/craftstation-0.10.0/issues/01-thread-control-adapter.md` 至 `08-real-cross-thread-acceptance.md`。

## 4. 这个 Feature 到底解决什么

目标交互如下：

```text
Source Thread A
  Model/Harness: Codex + ChatGPT
        |
        | ThreadExchange E1
        v
Target Thread B
  Model/Harness: Grok Build + Grok 4.6
        |
        | target native Runtime 完成真实 Turn
        v
correlated reply projection 回到 Thread A
        |
        | ThreadExchange E2，沿同一 ConversationLink 继续追问
        v
Target Thread B 保持自己的 native context 与 timeline
```

它不是以下能力：

- 不是把两个 Thread 合并成一个 native Session；
- 不是 Crossagents `spawn_agent`；
- 不是群聊、broadcast、Team Mode 或自动 ping-pong；
- 不是跨项目、跨 host 协作；
- 不是把两个 worktree 的文件自动同步；
- 不是 v0.9 的同 Thread Runtime handoff。

## 5. 已冻结的核心产品和架构边界

后续修复和验收不能破坏这些决定：

1. 长期 Thread 对话复用 always-on App Controls MCP thread primitives。
2. Crossagents 保持 ephemeral subagent lane，不能与长期 Thread dialogue 混用。
3. UI、Desktop IPC、remote、headless 和 App Controls MCP 必须共用 CraftStation-owned Thread Collaboration Module。
4. target busy 时默认 `after-current-turn` durable queue，不 stealth steer，也不 interrupt。
5. `interrupt-and-send` 必须由用户显式选择，并等待官方 settled confirmation；中断失败时请求不得投递。
6. reply 必须通过 exchange id、request anchor、delivery baseline 和 target completed-turn anchor 确定性关联。
7. 禁止读取 target “最后一条 message”来猜回复。
8. 默认 context capsule 为空；只有显式附加时才生成，并执行预算和 redaction。
9. v0.10 不硬依赖尚未完成的 v0.9；只允许 optional `RuntimeProvenanceResolver` / `ThreadContextProjection` adapter。
10. 不导出 credentials、hidden reasoning、active permission、active tool handle 或完整敏感 payload。
11. 真实证据不足的 route 必须保持 `BLOCKED`，不能用 unit/mock 结果替代。

## 6. 当前实现结构

### 6.1 Shared contract

主文件：`src/shared/threadCollaboration.ts`。

它定义了 `ThreadExchangeStatus`、`ThreadDeliveryMode`、`ThreadRuntimeProvenance`、`ThreadContextCapsule`、`ThreadDialogueRequest`、`ThreadConversationLink`、`ThreadExchange` / `ThreadExchangeView`，以及 target/list/read/wait/cancel payload schemas。

当前保守常量：

| 常量                                         |     值 | 含义                           |
| -------------------------------------------- | -----: | ------------------------------ |
| `THREAD_COLLABORATION_MAX_HOP_DEPTH`         |      4 | 最大因果 hop depth             |
| `THREAD_COLLABORATION_MAX_QUEUED_PER_SOURCE` |      8 | 单 source queued exchange 上限 |
| `THREAD_COLLABORATION_MAX_REQUEST_CHARS`     | 50,000 | request 字符上限               |
| `THREAD_COLLABORATION_CONTEXT_BUDGET_CHARS`  | 12,000 | context capsule 字符预算       |
| `THREAD_COLLABORATION_REPLY_EXCERPT_CHARS`   |  8,000 | source reply excerpt 上限      |

Renderer/remote 使用 `ThreadExchangeView`，会移除 full request、context capsule、idempotency key 和 delivery claim internals。

### 6.2 Main-process deep module

```text
src/main/thread-collaboration/
├── ThreadControlAdapter.ts
├── ExchangeRepository.ts
├── ThreadCollaborationService.ts
├── provenance.ts
├── index.ts
└── *.test.ts
```

- `ThreadControlAdapter`：封装现有 Thread list/read/send/resume/interrupt/stop 与 live/persisted state；
- `ExchangeRepository`：SQLite link/exchange、sequence、idempotency、claim 与 recovery；
- `ThreadCollaborationService`：共享 policy、queue、delivery、wait、cancel、event reconciliation 与 reply capture；
- `provenance.ts`：composition provenance、optional resolver、context projection、secret/hidden-reasoning redaction。

### 6.3 SQLite persistence

Migration 为 v37，新增：

```text
thread_conversation_links
thread_exchanges
```

关键约束与索引包括：

- 同 project、同一对 participants 共享 link；
- `(source_thread_id, idempotency_key)` 唯一；
- `(link_id, sequence)` 唯一；
- target/status/sequence、source/updated 和 link/sequence 查询索引；
- link 删除时 exchange cascade；
- claim token + expiry 用于并发 worker/restart recovery。

相关文件：`src/main/db.schema.ts`、`src/main/db/connection.ts`、`src/main/db/migrations.ts`、`src/main/db/migrations.test.ts`、`src/main/db/runtimeItems.ts`、`src/main/db/runtimeItems.test.ts`。

### 6.4 App Controls MCP

新增高层工具：

```text
ask_thread
read_thread_exchange
wait_for_thread_reply
```

legacy `send_to_thread` 仍保留，但 delivery 必须经过 Collaboration Module。

关键文件：`src/main/app-controls/AppControlsMcpIngress.ts`、`src/main/app-controls/mcp/tools/threads.ts`、`src/main/app-controls/mcp/tools/types.ts`、`src/main/app-controls/mcp/toolRegistry.test.ts`。

### 6.5 Desktop IPC、remote 与 headless

本地 IPC procedures：

```text
listThreadCollaborationTargets
requestThreadDialogue
listThreadExchanges
readThreadExchange
waitForThreadExchange
cancelThreadExchange
```

关键文件：

```text
src/shared/ipc/procedures/collaboration.ts
src/shared/ipc/procedureMap.ts
src/main/ipc/localHandlers.ts
src/main/remote/threadCollaborationGateway.ts
src/main/remote/server/httpRouter.ts
src/main/remote/server/snapshots.ts
src/shared/remote/protocol.ts
src/shared/remote/client.ts
src/renderer/remoteProcedureRouter.ts
src/renderer/remoteProcedureRoutes.ts
src/renderer/state/remoteProjection.ts
src/renderer/state/remoteServersStore.ts
src/server/createHeadlessRemoteHost.ts
```

所有入口最终必须进入同一个 Service，remote 不能绕开 same-project、actor 或 participant policy。

### 6.6 Renderer UI

新增：

```text
src/renderer/components/thread/ThreadCollaborationDialog.tsx
src/renderer/components/thread/ThreadCollaborationActivity.tsx
src/renderer/components/thread/threadCollaborationUi.tsx
src/renderer/components/thread/threadCollaborationUi.test.tsx
```

通过 `src/renderer/components/thread/ThreadView.tsx` 接入。

目前 UI 包括 target picker/filter、composition/status/worktree、cross-worktree warning、两种 delivery mode、interrupt 二次确认、explicit context summary、exchange cards、cancel/wait、jump action 和 compact timeline activity。

UI 使用 HeroUI v3 compound component、`onPress`、ARIA listbox/option/label，并通过 Lingui macro 标记新增可见文案。

## 7. Exchange 状态机和行为

状态集合：

```text
created
queued
delivering
delivered
target_working
needs_attention
replied
cancelling
cancelled
failed
timed_out
```

主要路径：

```text
created -> queued -> delivering -> delivered -> target_working -> replied
                                      |              |
                                      |              -> needs_attention
                                      -> timed_out -> replied（允许 late reply）

created/queued/undelivered-attention -> cancelled
delivered/working/timed_out -> cancel source wait，不 interrupt target
```

容易误改的细节：

- 幂等重试必须在 queue-limit 检查之前解析；
- 同一 idempotency key 只有 payload 完全相同才能复用，否则返回 `THREAD_COLLABORATION_IDEMPOTENCY_CONFLICT`；
- 同一 ConversationLink 可有多个 follow-up，但按 sequence 顺序交付；
- 前一 exchange 未 settled 前，后一 exchange 不得投递；
- target attention 清除后，delivery 前的 `needs_attention` 可以重新排队；
- wait timeout 不 interrupt target；
- timeout 后 target 完成仍允许转为 `replied`；
- delivery 后 cancel 只停止 source 等待/投影，不终止 target turn；
- expired claim 不自动重发，而是 fail closed 为 `THREAD_COLLABORATION_DELIVERY_UNCERTAIN`；
- 并发 delivery claim 只有一个 worker 能取得；
- 显式 interrupt 失败时请求不能发送。

## 8. Reply correlation：最关键的正确性边界

回复捕获不允许使用 target 最新 message。当前正确路径是：

1. exchange 投递前记录 target completed-turn 数量；
2. 投递时记录 `deliveredAt`、request anchor 和 baseline turn index；
3. target 后续 settled 后，从 baseline 之后扫描 completed turns；
4. turn 时间不得早于 delivery；
5. anchor item 必须存在；
6. item 必须是 `type = assistant_message`；
7. item 必须是 `state = completed`；
8. reasoning、tool item、hidden request item、streaming assistant item 都不能成为 reply anchor；
9. 只把允许的 assistant text 生成有界、脱敏 excerpt；
10. durable 写入 reply turn/item anchor 后再向 source 投影。

这条边界已经有专门回归测试，后续不得改回“读最后一条消息”。

## 9. Context、provenance 与安全

### 9.1 Context

默认没有 context capsule。显式选择时允许 selected messages（最多 20 条）、summary、state、recent completed turns（最多 8 条）。处理顺序是先 redaction，再应用 12,000 字符预算。

### 9.2 Redaction

当前覆盖 `sk-...` API key、Bearer token、`api_key` / `access_token` / `password` / `cookie` / `secret` / `client_secret` 字段，以及 `<hidden_reasoning>`、`<chain_of_thought>`、`<cot>` 块。

### 9.3 Provenance

可投影 Thread/project/title、Model、Harness、Recipe、optional CraftPlan/Entity、native session、optional Segment/runtime epoch、worktree 和 agent-facing MCP support。

基础 resolver 对 `agentMcpSupported` 默认 `false`。只有真正观察到 effective launch/acceptance 的 optional resolver 才能设置 `true`，不能把“UI 控制面可用”误报为“Harness 内 Agent MCP 可用”。

### 9.4 Policy guards

已实现 self-target、cross-project、actor/source identity、participant read、source-only cancel、causal parent、immediate loop、hop depth、request/context size 和 stable runtime failure guards。auth/quota/binary/capability/runtime failure 不静默 fallback。

## 10. 稳定错误码

```text
THREAD_TARGET_BUSY
THREAD_NOT_RESUMABLE
THREAD_COLLABORATION_SELF_TARGET
THREAD_COLLABORATION_CROSS_PROJECT
THREAD_COLLABORATION_SOURCE_UNAUTHORIZED
THREAD_COLLABORATION_EXCHANGE_UNAUTHORIZED
THREAD_COLLABORATION_CANCEL_UNAUTHORIZED
THREAD_COLLABORATION_ALREADY_DELIVERED
THREAD_COLLABORATION_QUEUE_LIMIT
THREAD_COLLABORATION_IDEMPOTENCY_CONFLICT
THREAD_COLLABORATION_LINK_MISMATCH
THREAD_COLLABORATION_EXCHANGE_NOT_FOUND
THREAD_COLLABORATION_STALE_CLAIM
THREAD_COLLABORATION_DELIVERY_UNCERTAIN
THREAD_COLLABORATION_INTERRUPT_FAILED
THREAD_COLLABORATION_DELIVERY_FAILED
THREAD_COLLABORATION_TARGET_NEEDS_ATTENTION
THREAD_COLLABORATION_RUNTIME_UNAVAILABLE
THREAD_COLLABORATION_AUTH_REQUIRED
THREAD_COLLABORATION_QUOTA_EXHAUSTED
THREAD_COLLABORATION_BINARY_UNAVAILABLE
THREAD_COLLABORATION_CAPABILITY_UNAVAILABLE
THREAD_COLLABORATION_HOP_LIMIT
THREAD_COLLABORATION_INVALID_CAUSAL_PARENT
THREAD_COLLABORATION_INVALID_HOP
THREAD_COLLABORATION_LOOP
```

## 11. T01–T08 当前状态

| Ticket                     | 当前状态 | 已完成内容                                                 | 仍需关注                                           |
| -------------------------- | -------- | ---------------------------------------------------------- | -------------------------------------------------- |
| T01 Thread Control Adapter | 已实现   | Adapter、live/idle/resume/non-resumable、legacy MCP seam   | Debugger 独立复核合同兼容性                        |
| T02 Idle Dialogue          | 已实现   | durable link/exchange、一次投递、reply anchors、provenance | 真实 idle Runtime E2E 未完成                       |
| T03 Busy Queue             | 已实现   | durable queue、sequence、claim、cancel、idempotency        | 真实 busy UI/runtime 证据未完成                    |
| T04 Interrupt/Failure      | 已实现   | 显式 interrupt、attention、timeout、stable errors          | 真实 interrupt failure/attention 未完成            |
| T05 Context/Provenance     | 已实现   | default empty、budget、redaction、optional v0.9 seam       | 真实跨 worktree/provenance UI 需验收               |
| T06 Agent MCP              | 已实现   | ask/read/wait、legacy mapping、guards                      | 真正获得 built-in MCP 的多 Harness 验收未完成      |
| T07 UI/Remote/Restart      | 已实现   | picker、cards、jump、IPC/remote/headless、recovery         | managed Electron/restart artifacts 未完成          |
| T08 Real Acceptance        | BLOCKED  | 只有 deterministic/focused 证据                            | Codex→Grok、follow-up、第二 route、真实 UI/restart |

## 12. 已完成的验证

### 12.1 Collaboration core

```text
5 test files passed / 1 skipped
113 tests passed / 14 skipped
```

覆盖 Adapter、Service/Repository、provenance/context、runtime reply anchors、App Controls tool registry 和 UI status/a11y labels。

### 12.2 Remote、IPC、migration

五个定向文件最终合计：

```text
195 tests passed
```

其中 `RemoteAccessServer.test.ts` 首轮有一个 `fetch failed / bad port`，原因是 Windows/Node 随机分配到 Fetch forbidden port；单文件复跑 `82/82` 通过。没有修改源码来掩盖该环境波动。

### 12.3 静态检查

```text
oxfmt --check:             46 个触及 TS/TSX 文件通过
oxlint --deny-warnings:    46 个触及 TS/TSX 文件通过
git diff --check:          通过
```

### 12.4 TypeScript

v0.10 触及范围已经没有 TypeScript error。全仓 typecheck 仍失败，直接根因是：

```text
packages/codex-protocol/index.ts(8,8): Cannot find module './generated/index'
packages/codex-protocol/index.ts(9,15): Cannot find module './generated/v2/index'
node_modules/@craftstation/codex-protocol/index.ts: 同样缺 generated 输出
```

其余 `src/supervisor/agents/codex/**` 报错是缺少 protocol exports 的级联，不应误记为 v0.10 Thread Collaboration 的独立类型回归。

### 12.5 安全扫描

源码级扫描只命中预期的 redaction regex、假 token 测试数据和 auth error classifier。没有发现硬编码真实 credential，也没有发现业务日志输出完整 request/context/reply 或 hidden reasoning。

## 13. 已遇到的问题和处理结果

### 13.1 Windows 共享 pnpm store / postinstall rename 锁冲突

并行 v0.9 Coder 曾确认共享 pnpm store 和生成目录存在 Windows postinstall rename 锁冲突。Manager 因此明确要求：

- 不运行 `pnpm install --force`；
- 暂停 `pnpm`、`pnpm exec`、`npm`、`npx`；
- 暂停 native rebuild、postinstall 和 protocol generation；
- 不删除共享 store 或宽泛目录；
- 优先使用已安装的本地 binary 和定向测试。

当前 `package.json`、`pnpm-lock.yaml` 均无变化。

### 13.2 全量 Vitest 意外触发 better-sqlite3 native rebuild

直接运行全量 Vitest 时，既有测试初始化进入了：

```text
prepare-server-native
node-gyp
MSBuild
better-sqlite3 rebuild
```

发现后已立即中止测试与子进程。中止后确认：

- 没有 v0.10 路径相关 `node-gyp` / MSBuild 后台进程；
- Git 没有新增 tracked 产品文件；
- package/lockfile 无变化；
- ignored `dist/server-native/build/better-sqlite3` 留下约 59 MB 中间物。

按照 Manager 指令，该中间目录被保留，没有删除。接手者不要自行清理，除非 Manager 明确开放串行窗口和清理范围。

### 13.3 Codex protocol generated files 缺失

当前 worktree 缺少：

```text
packages/codex-protocol/generated
node_modules/@craftstation/codex-protocol/generated
```

生成它们需要当前被暂停的 protocol generation。此前没有复制其他 worktree 的 generated 文件，也没有伪造声明文件。

在 Manager 明确恢复串行验证窗口前，不要擅自运行生成命令。

### 13.4 Lingui catalog 全仓漂移

一次直接 `lingui extract` 发现 13 个 locale catalog 各有约 150 条跨版本缺失，并机械写入大量与 v0.10 无关的变化。

处理结果：

- 已撤销 13 个 locale 文件的全部机械差异；
- v0.10 新增 UI 文案仍保留 Lingui macro；
- 没有把 v0.7/v0.8/v0.9 的 catalog 漂移混入本 Feature；
- 没有宣称全仓翻译已经完成。

后续若要同步 catalog，应在依赖/生成窗口开放后单独治理，不要把全仓历史缺失算作本 Feature 的局部翻译任务。

### 13.5 RemoteAccessServer 随机 forbidden port

扩展定向测试首次出现：

```text
TypeError: fetch failed
Caused by: Error: bad port
```

这是随机端口落入 Fetch forbidden port 的环境波动。单文件复跑全部通过，不是已确认的 v0.10 生产回归。若再次出现，先用同一文件复跑确认，不要直接改产品逻辑。

### 13.6 Debugger grok-4.6 路由 HTTP 422

已创建专属、项目绑定的 Debugger：

```text
Title:     Debugger-0.10-Cross-Thread Collaboration
Thread ID: 01a057e4-fb70-7e52-b8a5-f68691c4c33f
Model:     grok-4.6
Thinking:  high
Project:   CraftStation
```

首次请求与一次同任务重试均返回：

```text
HTTP 422 Unprocessable Entity
http://127.0.0.1:28082/v1/responses
```

该 Debugger 没有产生 Assistant message、源码 review、Findings、Fix Plan 或 verdict。

准确状态是：

```text
DEBUGGER INFRASTRUCTURE BLOCKED / NO VERDICT
```

这不是源码 FAIL，也不是 PASS。路由恢复后必须复用这个已配对 Debugger，不创建第二个 Debugger，不改用其他模型冒充规定的独立验收。

## 14. 目前没有完成、不能声称通过的事项

- T08 真实 multi-Harness acceptance；
- 真实 Codex source → Grok target request；
- Grok official Runtime non-synthetic reply；
- 同一 ConversationLink 的真实 follow-up；
- 真实 busy queue 行为；
- 真实 explicit interrupt failure；
- 真实 needs-attention 跳转与恢复；
- 真实 app restart 后 queued/in-flight/replied recovery；
- 真实 stale-worker 不重复发送；
- 第二条 Harness route；
- managed Electron screenshot、runtime error、smoke report；
- full Vitest；
- full build；
- full typecheck PASS；
- Debugger verdict；
- commit、candidate closeout、merge、tag、push。

## 15. 接手者的推荐执行顺序

### 阶段 A：保护现场

1. 确认 cwd/Git root/branch/HEAD 与第 2 节一致；
2. 保存 `git status --short`；
3. 确认 `package.json`/lockfile 无 diff；
4. 不 reset、不 clean、不 checkout 现有修改；
5. 检查是否还有 native build/postinstall/protocol generation 后台进程。

### 阶段 B：恢复验证窗口

1. 向 Manager 确认 v0.9 依赖验证窗口是否结束；
2. 只有 Manager 明确恢复后，才考虑 protocol generation、full typecheck、build 或 managed Electron launcher；
3. 不要用复制其他 worktree generated 文件的方式制造绿色结果；
4. 不要删除 ignored native build 中间物，除非清理范围得到明确授权。

### 阶段 C：Debugger 独立复核

1. 路由恢复后继续 thread `01a057e4-fb70-7e52-b8a5-f68691c4c33f`；
2. Debugger 先独立审查源码，不只复述 Coder 文档；
3. 复核 shared Module ownership、policy、SQLite、reply anchors、remote boundary、安全与 restart；
4. 复跑允许范围内的 focused tests 和静态检查；
5. 若发现问题，按 my-workflow 生成 Findings/Fix Plan，通知原 Coder；
6. 没有真实证据时继续把 T08 保持 BLOCKED。

### 阶段 D：真实验收

在依赖窗口和凭据条件允许后，使用项目技能：

```text
D:\Work\CraftStation\.agents\skills\interactive-testing\SKILL.md
D:\Work\CraftStation\.agents\skills\provider-chat-smoke\SKILL.md
```

至少完成：

1. 真实 Codex source Thread；
2. 真实 Grok target Thread；
3. request 到 target timeline；
4. official Runtime reply；
5. source reply projection；
6. 同一 link follow-up；
7. busy default queue；
8. explicit interrupt failure；
9. needs-attention；
10. restart/recovery/stale claim；
11. 第二 Harness route或明确 BLOCKED；
12. credential/artifact scan。

真实验证必须记录 source/target Thread ID、composition provenance、exchange id、request/reply anchors、runtime status、screenshots/report 路径和错误边界，但不得把 token、cookie、API key 或隐藏推理写入 artifacts。

### 阶段 E：收口

只有 Debugger 有效完成独立验收后才进入收口：

- FAIL：在同一 worktree 进入 Fix Cycle；
- PASS：按当前 `AGENTS.md` 的 flat-worktree 规则在 `dev/v0.10-cross-thread-collaboration` 完成候选收口；
- 与 v0.9 冲突由 Debugger 按两边 Spec 解决并回归；
- 用户未明确授权前，不得 merge main、正式 tag 或 push。

## 16. 当前 Git 改动范围

当前 tracked 修改主要包括：

```text
PROJECT_STATUS.md
src/main/app-controls/**
src/main/db.schema.ts
src/main/db/**
src/main/ipc/localHandlers.ts
src/main/main.ts
src/main/remote/**
src/renderer/components/thread/ThreadView.tsx
src/renderer/remoteProcedure*.ts
src/renderer/state/remoteProjection.ts
src/renderer/state/remoteServers/**
src/renderer/state/remoteServersStore*.ts
src/server/createHeadlessRemoteHost.ts
src/shared/ipc/procedureMap.ts
src/shared/remote/**
```

当前 untracked、属于本 Feature 的文件：

```text
ai_workspace/agent_docs/coder_0.10.0.md
src/main/remote/threadCollaborationGateway.ts
src/main/thread-collaboration/ExchangeRepository.ts
src/main/thread-collaboration/ThreadCollaborationService.test.ts
src/main/thread-collaboration/ThreadCollaborationService.ts
src/main/thread-collaboration/ThreadControlAdapter.test.ts
src/main/thread-collaboration/ThreadControlAdapter.ts
src/main/thread-collaboration/index.ts
src/main/thread-collaboration/provenance.test.ts
src/main/thread-collaboration/provenance.ts
src/renderer/components/thread/ThreadCollaborationActivity.tsx
src/renderer/components/thread/ThreadCollaborationDialog.tsx
src/renderer/components/thread/threadCollaborationUi.test.tsx
src/renderer/components/thread/threadCollaborationUi.tsx
src/shared/ipc/procedures/collaboration.ts
src/shared/threadCollaboration.ts
HANDOFF_V0.10_CROSS_THREAD.md
```

不要因为这些文件是 untracked 就把它们当成临时垃圾；它们是 v0.10 的主要实现。

## 17. 接手时可直接使用的最短核验命令

```powershell
$wt = 'D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration'
git -C $wt rev-parse --show-toplevel
git -C $wt branch --show-current
git -C $wt rev-parse HEAD
git -C $wt status --short
git -C $wt diff -- package.json pnpm-lock.yaml
```

当前依赖窗口未恢复前，不要运行 `pnpm`、`npm`、`npx`、protocol generation、full build 或 full Vitest。

允许恢复验证后，应优先参考 `ai_workspace/agent_docs/coder_0.10.0.md` 中已经证明安全的 focused test 入口，而不是直接从全量命令开始。

## 18. 最终事实边界

截至本文整理时，可以说：

- v0.10 T01–T07 的工程实现已经完成；
- 关键状态机、policy、reply anchor、redaction、MCP/IPC/remote/UI seam 已有定向证据；
- Coder Feature-level self-check 已完成；
- 代码具备进入独立 Debugger Review 的条件。

截至本文整理时，不能说：

- v0.10 Feature 已 PASS；
- T08 已完成；
- Grok/Codex 跨 Thread 真实对话已经跑通；
- 全量测试、build 或 typecheck 已通过；
- Debugger 已验收；
- 候选已 commit、merge、tag 或发布。

接手者应继续保持这个证据边界，直到真实 Runtime 与独立 Debugger 证据补齐。
