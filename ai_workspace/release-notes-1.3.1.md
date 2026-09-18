# Release 1.3.1 — Craft-Harness 外围重试层 + 错误通知修复

## 用户可见

- **设置 → 一般 新增「重试次数」与「重试间隔」**：遇到网络错误或连接中断导致一轮对话失败时，CraftStation 现在会自动等待设定的秒数后重试（默认重试 2 次、间隔 5 秒，重试次数设为 0 即关闭）。重试由 **Craft-Harness**——跨 Harness 的外围 runtime 管理层——统一执行，对所有 structured harness 生效，不做任何 per-agent 适配。重试时自动注入续接提示词，让 Agent 从断点继续；等待期间顶部 toast 会提示「网络/连接中断，N 秒后自动重试（第 x/y 次）」。配额耗尽仍走原有的号池 failover，主动按 Stop 永远不会被重试。
- **Devin 线程的内置 MCP 真正注入了**：此前在 Devin 会话里 MCP 面板开关全开、Agent 却报「没有可用 MCP 服务器」。根因是新版 Devin CLI 在 ACP initialize 里广告 `mcpCapabilities: {http:false, sse:false}`（实测 3000.10.27 的 `session/new` 实际接受 HTTP MCP——广告是假的），而能力解析整体采用广告值，把我们假定支持（`assumedMcpCapabilities`）的 HTTP 传输全部静默丢弃。现在适配器实测确认的假定能力会盖过这种低报广告；若 Agent 真的拒绝，开会话失败后会自动去掉这部分服务器重试，绝不卡死线程。
- **MCP 未注入不再静默**：任何 Harness 上，面板里启用但最终没能注入会话的 MCP 服务器，现在会收到一条明确的应用内通知（同时进入铃铛通知栏积累），列出服务器名并说明会话已正常启动、这些服务器本轮不可用。
- **K3-256k 上下文容量显示修正**：Kimi `k3-256k` 此前错误显示 1M 上下文（probe 对整个 K3 家族都报 1M）。现在模型 id 里的 `-NNNk` 后缀作为产品契约优先于 probe 值，k3-256k 正确显示 256K；无后缀的 k3 仍保持 1M。
- **Kimi 压缩状态文案不再混进聊天**：`Compacting conversation context…` / `Compaction is blocked…` / `Messages compacted: N` / `Tokens before/after` 等 harness 状态行不再渲染进对话内容（text 与 thought 两条路径都过滤）。
- **错误提示不再显示不全**：错误 toast 的标题不再被单行截断，完整错误全文直接可见。
- **错误积累进通知栏**：所有错误 toast 现在同时进入左上角铃铛通知面板积累展示，不再一闪而过无法回看。
- **子代理面板不再永远转圈**：此前后台子代理（Kimi 线程的 background Agent）结束后，右侧子代理面板仍显示「已工作 N 小时」永不收敛。根因是后台任务完成桥在解析 Kimi 会话目录时使用了宿主默认根目录 `~/.kimi-code`，而托管账号线程的 `KIMI_CODE_HOME` 指向 per-profile 目录——桥在错误的根下永远等不到会话目录，任务完成/失败事件永远发不出来。现在桥跟随线程实际的 `KIMI_CODE_HOME`；会话被销毁（关闭线程/会话重建/退出）时，所有未完结的后台任务统一以「丢失」终态收敛；会话目录解析超过 10 分钟仍未命中也会兜底报错，不再无限静默等待。
- **Muse Spark 思考链恢复并行展示**：此前大部分 Muse Spark 回合把思考摘要折叠进「Ran N tools」工具组里，只在最后输出收尾文字。根因是渲染层把带文本的思考条目当成工具组的可折叠「胶水」。现在带实际文本的思考条目折出工具组、在主流程原位渲染，思考与工具调度交错并行展示（与 OpenCode 会话的真实事件顺序一致）。
- **定时任务（Schedule MCP）按 id 操作全部修复**：此前对 `list` 可见的记录执行 `get/update/pause/resume/delete` 会报「Scheduled task not found.」，`update` 传 `timezone: null` 还会被误判为非法时区（OpenCode bridge 会把 null 序列化成字符串 `"null"`）。现在 nullable 字段统一做字符串归一；宿主启动时做全量一致性自检（list 可见的 id 必须 get 得到，失败打 ERROR 诊断而非静默半残）；sweep 阶段绑定检查抛异常时保留记录并报诊断，不再误删。
- **排队消息的图片不再消失，编辑回到聊天框**：排队中的追问此前只显示纯文本——图片在视觉上"消失"，且点「编辑」做行内编辑会把附件数据真正丢弃。现在排队条直接渲染图片缩略图与非图片附件文件名；点「编辑」会把整条消息（文本 + 附件）移回聊天框本体编辑（移动端经 composer 收件箱投递，效果一致），队列条目随之消费。
- 附带修复一个既有隐性 bug：HeroUI toast 队列重建 content 时静默丢弃 `context`/`onPress` 等自定义字段，导致「线程完成」toast 的状态行与点击跳线程从未真正生效；现已在 toast 包装层统一转发。

## 实现

- `TurnRetryCoordinator`（`src/supervisor/runtime/threadSession/turnRetryCoordinator.ts`）：挂在 `StructuredTurnQueue.start` 的 catch 链上（pool failover 之后、`failStructuredSession` 之前）。turn 类网络错误（复用 `isNativeNetworkErrorMessage` 判定）在同一 live session 上重发；transport 类失败（ACP 连接关闭 / 进程退出）经 `restartThread` 重建会话后重放。续接提示词走 historyPreface 通道：只 prepend 到发送的 prompt，UI 绘制的用户消息保持原文；native resume 成功时 restartThread 会丢弃 preface，不会重复上下文。
- 排除语义：quota/auth/billing（`EXPECTED_PROVIDER_OUTCOME`，pool failover 已接管）、capacity 噪音（`isRetryableCapacityError`）、用户中断（`structuredTurnInterruptRequested`）一律不重试。重试链计数 `turnRetryAttempt` 挂在 turn 对象上（与 failover 链同构），跨会话重建也能正确终止。
- 设置链路：`turnRetryMaxAttempts`（0–10，默认 2）+ `turnRetryIntervalSeconds`（1–300，默认 5）入 `sharedSettingsSchema` 与 `defaultSharedSettings`；supervisor 经 `readTurnRetryPolicy` 在每次失败时实时读取，改设置立即生效。
- 通知：新 `thread-turn-retry` SupervisorEvent，渲染层 toast 复用 pool-failover 的顶部状态条模式。
- ACP MCP 能力解析（`resolveAcpMcpCapabilities`）：从「整体 advertised ?? assumed」改为按传输合并，且适配器 `assumed` 的 `true` 优先于广告的 `false`/缺失（实测 Devin 3000.10.27 广告 http:false 但 `session/new` 接受 HTTP MCP）。兼容失败回退集始终按严格广告值门控，assumed 带入的服务器在 `-32602/-32603` MCP 类报错时自动摘除重试。
- MCP 注入盲区上报：`AcpStructuredSession` 记录每次 open 实际未送达的服务器名（`consumeMcpInjectionDrops`），spawn 管线在启动/重启/换 Provider 三处 open 成功后经新 `thread-mcp-injection-drop` 事件上报；渲染层 toast + 通知栏积累，文案只含服务器名（不带 URL/header/token）。
- Kimi 上下文容量：`kimiModelContextTokens` 让模型 id 的 `-NNNk` 后缀优先于 ACP probe 的 `totalContextTokens`。
- Kimi 噪音过滤：`stripKimiHarnessNoise`（`src/shared/kimiHarnessNoise.ts`）行级前缀过滤 6 种压缩状态行，接入 ACP canonical mapping（text/thought）与 native canonicalizer 的 visibleText。
- toast extras 转发：`src/renderer/components/ui/toastExtras.ts` 原地包装共享 toast 的 success/danger/warning/info 变体方法，直接走 `getQueue().add` 保留全部自定义字段；danger toast 入通知栏由 `ToastLedgerEntry`（provider.tsx）完成，`ledgerLogged` 标记防与 notifications.ts 重复入栏。
- Kimi 后台子代理桥：`createKimiBackgroundBridge` 接受 `kimiHome`（`baseSpawnEnv.KIMI_CODE_HOME`），`resolveKimiSessionDir` 新增显式 home 参数覆盖宿主根；`dispose()` 会把仍 pending 的 launch 以 `lost` 终态补发完成事件（补发发生在 session dispose 之前，mapper 仍在位）；会话目录等待默认 10 分钟上限，超时以 `lost` 收敛并打诊断日志。
- 思考链渲染：`chatPaneSelectors.isToolGroupItem` 对带非空 `streams.reasoning_text` 的 reasoning 条目返回 false（折出工具组原位渲染），空 bracket 仍作胶水（完成即被丢弃，避免拆组闪烁）。
- Schedule MCP：`nullishArg` preprocess 把 `"null"`/`"undefined"`/`""` 归一为 null 应用于五个 nullable schema；`ScheduleService.start()` 自检存储一致性（list 可见 id 必须 get 可读，否则报 `STORE_INDEX_MISSING` 诊断）；`sweepUnavailableBindings` 检查异常保留记录；`requireSchedule`/`requireTask` 报错带 id 并区分「list 可见但 by-id 不可读」。
- 排队追问：`ThreadQueuedFollowUpStrip` 从 `queued.segments` 提取 attachment 段渲染缩略图/文件名 chip（去掉行内编辑，旧 `updateQueuedFollowUpPrompt` 会把 segments 整体替换成单条 text、附件真丢失，已删除）；桌面端「编辑」走 `handleEditQueuedFollowUp`——文本段回 editor、附件段经 `attachmentFromSegment` 重建并与现有附件合并 restore；移动端 strip 是 composer 的 sibling（拿不到 mentionRef），编辑改为把完整 segments 投递进 `useComposerInputInbox`（key=thread.id），composer 的 drain effect 拆出 attachment 段并入附件栏、文本段插入 editor。

## 验证

- 新增 `turnRetryCoordinator.test.ts` 10 例全过：网络/transport 分类、次数上限、间隔计时、续接注入、重建 vs 重发选择、quota/capacity/中断排除、会话替换放弃、重试自身失败回退。
- Devin MCP：真实 `devin acp` 探针实测——initialize 广告 `{http:false,sse:false}` 但带 HTTP MCP 的 `session/new` 成功建会话；`session.test.ts` 新增 3 例（低报广告下 assumed 生效并送达、兼容报错回退摘除并上报、无能力时丢弃并上报），acp/factory/userMcp/devin 套件 481 例全过。
- toast 侧：`provider.test.tsx` 新增 4 例（danger 不截断、入通知栏、防重复、extras 转发）+ `notifications.test.ts` 断言更新，共 36 例全过。
- Kimi：`detection.test.ts`（k3 保持 1M、k3-256k 显示 256K）与 `kimiHarnessNoise.test.ts` 5 例全过。
- 子代理桥：`src/supervisor/agents/kimi/` 全套 143 例全过（含 kimiHome 真实临时目录端到端、dispose 时 pending launch 以 lost 收敛、10 分钟目录等待兜底）。
- 思考链渲染：`chatPaneSelectors` / `ToolCallGroup` 套件 69 例全过（含带文本 reasoning 折出工具组、空 bracket 仍作胶水）。
- Schedule MCP：`src/main/schedules/` 66 例全过（含 `"null"` 字符串归一、启动自检 STORE_INDEX_MISSING、sweep 异常保留记录）。
- 排队追问：`ThreadComposerSection.test.tsx` 队列套件 7 例全过（排队条显示图片缩略图、Edit 后队列清空且文本+附件回到 composer、inbox attachment 段 drain 进附件栏）。
- `pnpm typecheck` PASS；全部触碰文件 oxlint 0 警告；i18n 已 extract 并补齐 zh-CN。
- `src/supervisor/runtime/` 全量 947 过 / 6 失败，6 个失败已逐一用 stash 基线对比证实为干净 HEAD 既有（startClose 3、nativeAdapter DeepSeek max-tokens 1、spawnPipeline MCP 1、compatibilityBridge e2e 1），与本批无关；`runtime.test.ts` 失败名单与干净 HEAD 逐行一致。

# Release 1.3.1 — Craft-Harness outer retry layer & error notification fixes

## User-visible

- **New "Turn retry attempts" and "Turn retry interval" settings (Settings → General)**: when a turn dies on a network error or an unexpected connection drop, CraftStation now waits the configured interval and retries automatically (2 attempts / 5 seconds by default; set attempts to 0 to disable). Retries are owned by **Craft-Harness**, the cross-harness outer runtime layer, and apply to every structured harness with no per-agent adaptation. Each retry injects an invisible continuation prompt so the agent resumes from where it stopped, and a top toast announces the wait ("retrying in Ns, attempt x/y"). Quota exhaustion still belongs to pool failover, and an explicit Stop is never retried.
- **Built-in MCP servers actually reach Devin threads**: previously the MCP panel showed every toggle on while the agent reported no MCP servers at all. Root cause: newer Devin CLI builds advertise `mcpCapabilities: {http:false, sse:false}` in ACP initialize, yet `session/new` provably accepts HTTP MCP servers (verified against devin 3000.10.27) — the advertisement is bogus, and whole-object capability resolution silently dropped every assumed HTTP transport. Adapter-confirmed assumed capabilities now override such under-reporting; if an agent genuinely rejects a transport, the session open retries without those servers instead of bricking the thread.
- **MCP injection failures are no longer silent**: on any harness, MCP servers that are enabled in the panel but could not be injected now produce an explicit in-app notification (also accumulated in the bell panel) naming the servers and stating the session started without them.
- **K3-256k context size corrected**: Kimi `k3-256k` showed a 1M context window because the ACP probe reports 1M for the whole K3 family. The `-NNNk` suffix in the model id is a product contract and now wins over the probe, so k3-256k correctly shows 256K while suffix-less k3 keeps 1M.
- **Kimi compaction chatter no longer leaks into chat**: `Compacting conversation context…`, `Compaction is blocked…`, `Messages compacted: N`, `Tokens before/after` and similar harness status lines are filtered out of both text and thought paths.
- **Error toasts no longer truncate**: danger toast titles now wrap and show the full error text.
- **Errors accumulate in the notification panel**: error toasts are also recorded in the bell notification panel instead of vanishing.
- **Subagent panel no longer spins forever**: background subagents in Kimi threads used to keep showing "working for N hours" long after they finished. Root cause: the background-task completion bridge resolved the Kimi session directory under the host default root `~/.kimi-code`, while managed-account threads point `KIMI_CODE_HOME` at a per-profile directory — the bridge waited forever in the wrong root and never emitted the completion/failure event. The bridge now follows the thread's actual `KIMI_CODE_HOME`; when a session is torn down (thread closed / session rebuilt / quit), every unfinished background task settles as "lost"; and session-directory discovery now has a 10-minute ceiling instead of waiting silently forever.
- **Muse Spark thinking streams in parallel again**: most Muse Spark turns used to collapse thinking summaries into the "Ran N tools" group and only surface the final wrap-up text. Root cause: the renderer treated thinking entries with real text as collapsible "glue" inside tool groups. Thinking entries that carry text now render in place in the main flow, interleaved with tool calls (matching the real event order in OpenCode sessions).
- **Schedule MCP by-id operations fixed**: `get/update/pause/resume/delete` on records visible in `list` used to return "Scheduled task not found.", and `update` with `timezone: null` was rejected as an invalid time zone (the OpenCode bridge serializes null as the string `"null"`). Nullable fields now normalize these strings; the host runs a consistency self-check at startup (every id visible in `list` must be readable via `get`, otherwise an ERROR diagnostic is logged instead of a silently half-broken service); and the sweep stage keeps records when a binding check throws instead of deleting them.
- **Queued messages keep their images, and Edit returns to the composer**: a queued follow-up used to render as plain text — images visually "disappeared" — and its inline Edit replaced the whole segment list with a single text segment, truly discarding attachments. The queue strip now renders image thumbnails and file-name chips for non-image attachments; Edit moves the whole message (text + attachments) back into the composer body for editing (on mobile via the composer input inbox, same effect) and consumes the queue entry.
- Also fixes a latent bug where the HeroUI toast queue silently dropped `context`/`onPress` custom fields, so the thread-completion toast's status line and click-to-jump never actually worked; extras are now forwarded at the toast wrapper layer.

## Implementation

- `TurnRetryCoordinator` hooks the `StructuredTurnQueue.start` catch chain (after pool failover, before `failStructuredSession`). Turn-class network errors re-send on the same live session; transport-class failures (connection closed / process exit) replay through `restartThread`. The continuation note rides the historyPreface channel: prepended to the sent prompt only, never painted, and dropped when the session resumes natively.
- Exclusions: quota/auth/billing (owned by pool failover / fail-closed), capacity-throttle noise, and user-requested interrupts are never retried. The chain counter `turnRetryAttempt` rides the turn object, mirroring the failover chain.
- Settings: `turnRetryMaxAttempts` (0–10, default 2) + `turnRetryIntervalSeconds` (1–300, default 5) in the shared-settings schema; the supervisor reads the policy live on every failure.
- ACP MCP capability resolution (`resolveAcpMcpCapabilities`) is now per-transport, and an adapter's assumed `true` beats a `false`/missing advertisement (Devin 3000.10.27 advertises http:false yet accepts HTTP MCP in `session/new`). The compatibility fallback set is always gated by the strictly advertised capabilities, so assumed-only servers are dropped and retried on `-32602/-32603` MCP-flavoured errors.
- MCP injection blind-spot reporting: `AcpStructuredSession` records the server names each open failed to deliver (`consumeMcpInjectionDrops`); the spawn pipeline drains them after the launch/restart/provider-switch opens and emits the new `thread-mcp-injection-drop` event; the renderer shows a toast plus a notification-ledger entry. Names only — never URLs, headers, or tokens.
- Kimi context size: `kimiModelContextTokens` prefers the model id's `-NNNk` suffix over the probe's `totalContextTokens`.
- Kimi noise: `stripKimiHarnessNoise` filters six compaction status line prefixes, wired into the ACP canonical mapping (text/thought) and the native canonicalizer's visibleText.
- Kimi background-subagent bridge: `createKimiBackgroundBridge` accepts `kimiHome` (from `baseSpawnEnv.KIMI_CODE_HOME`), and `resolveKimiSessionDir` takes an explicit home override of the host root; `dispose()` settles still-pending launches with a `lost` completion event (emitted before session dispose, while the mapper is still in place); session-directory discovery has a default 10-minute ceiling and settles as `lost` with a diagnostic log on timeout.
- Thinking rendering: `chatPaneSelectors.isToolGroupItem` returns false for reasoning entries with non-empty `streams.reasoning_text` (rendered in place outside the tool group); empty-bracket reasoning still acts as glue (discarded on completion, avoiding group-split flicker).
- Schedule MCP: a `nullishArg` preprocess normalizes `"null"`/`"undefined"`/`""` to null across five nullable schemas; `ScheduleService.start()` self-checks store consistency (every id visible in `list` must be readable via `get`, otherwise a `STORE_INDEX_MISSING` diagnostic); `sweepUnavailableBindings` keeps records when a check throws; `requireSchedule`/`requireTask` errors carry the id and distinguish "visible in list but unreadable by id".
- Queued follow-ups: `ThreadQueuedFollowUpStrip` extracts attachment segments from `queued.segments` to render thumbnails/file chips (inline edit removed — the old `updateQueuedFollowUpPrompt` replaced all segments with one text segment and truly lost attachments; now deleted). Desktop Edit runs `handleEditQueuedFollowUp` — text segments back into the editor, attachment segments rebuilt via `attachmentFromSegment` and merged into the existing attachments; the mobile strip is a sibling of the composer (no shared ref), so Edit enqueues the full segments into `useComposerInputInbox` (key = thread.id) and the composer's drain effect splits attachment segments into the attachment bar while inserting text into the editor.

## Verification

- New `turnRetryCoordinator.test.ts`: 10 cases covering classification, caps, timing, continuation injection, rebuild-vs-resend, exclusions, and fall-through — all green.
- Devin MCP: a live `devin acp` probe confirmed initialize advertises `{http:false,sse:false}` while `session/new` with an HTTP MCP server succeeds; 3 new `session.test.ts` cases (assumed wins over under-reporting and is delivered, compatibility fallback drops and reports, uncovered servers drop and report); acp/factory/userMcp/devin suites: 481 green.
- Toast side: 4 new provider tests + updated notification assertions, 36 green.
- Kimi: `detection.test.ts` (k3 keeps 1M, k3-256k shows 256K) and 5 `kimiHarnessNoise.test.ts` cases, all green.
- Subagent bridge: full `src/supervisor/agents/kimi/` suite 143 green (real-temp-dir end-to-end with explicit kimiHome, dispose settles pending launches as lost, 10-minute directory-discovery ceiling).
- Thinking rendering: `chatPaneSelectors` / `ToolCallGroup` suites 69 green (text-carrying reasoning leaves the tool group, empty brackets remain glue).
- Schedule MCP: `src/main/schedules/` 66 green (`"null"` string normalization, startup self-check STORE_INDEX_MISSING, sweep keeps records on check failure).
- Queued follow-ups: `ThreadComposerSection.test.tsx` queue suite 7 green (strip shows image thumbnails, Edit clears the queue and returns text + attachments to the composer, inbox attachment segments drain into the attachment bar).
- `pnpm typecheck` PASS; oxlint clean on every touched file; i18n extracted with zh-CN filled.
- Full `src/supervisor/runtime/` run: 947 passed / 6 failed, each failure confirmed pre-existing on clean HEAD via stash comparison; `runtime.test.ts` failure list identical to clean HEAD line for line.
