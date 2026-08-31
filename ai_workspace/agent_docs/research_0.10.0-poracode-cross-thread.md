# v0.10 PoraCode Cross-thread MCP Source Review

- Reviewed：2026-08-31
- CraftStation baseline：`dev@8bc45cfe408a6e603c777f04bce3c22627b76656`
- PoraCode reference baseline：`a28b995c47987b09862d8d18cb1203ddfb4ba159`
- Scope：只读核验长期 Thread orchestration 与 Crossagents 的真实边界，为 v0.10 Ideate/Plan 提供一手事实。

## Finding 1 — Long-lived cross-thread control lives in App Controls MCP

PoraCode 的 always-on App Controls MCP 已提供 `get_current_thread`、`list_threads`、`get_thread`、`read_thread`、`create_thread`、`send_to_thread`、`interrupt_thread`、`stop_thread`、`wait_for_thread` 等长期 Thread 工具。它们操作的是用户在侧栏可见的一等 Thread，并可以携带 project、agent、model、presentation mode、worktree、status 和 attention。

Primary source：

- `reference/poracode/src/main/app-controls/mcp/tools/threads.ts:108-223`
- `reference/poracode/src/main/app-controls/mcp/tools/threads.ts:313-460`

CraftStation 当前对应文件与 PoraCode reference 的 SHA-256 相同：

`41204294A8D1FAF55051687ED3CD2D20B62A4B7C547DA1BBDD31A93120A6C588`

因此 v0.10 应在现有 App Controls MCP seam 上深化，而不是重写一个平行 MCP server。

## Finding 2 — Crossagents is a different, ephemeral lane

Crossagents MCP 明确用于当前 Thread 内的轻量、临时 subagent run；输出流回父 Thread，生命周期受父 Thread 管理。它自己的 instructions 明确要求：长期、侧栏可见、可有独立 worktree 的 Thread 应使用 App Controls MCP 的 thread tools。

Primary source：

- `reference/poracode/src/supervisor/crossagentMcp/toolRegistry.ts:55-72`
- `reference/poracode/src/supervisor/crossagentMcp/toolRegistry.ts:319-321`

所以 v0.10 不应把长期跨线程对话实现成 `spawn_agent`，但可复用 Crossagents 的结果回流、状态显示和防并发经验。

## Finding 3 — Existing send/read/wait are primitives, not a complete dialogue transaction

`send_to_thread` 能向 live session 发送，也能在 session 丢失时使用 persisted config/session ref 恢复；不可恢复则明确要求新建 Thread。`read_thread` 可分页读取持久化 runtime items，`wait_for_thread` 按 live/persisted state 等待 settled 状态。

Primary source：

- `reference/poracode/src/main/app-controls/mcp/tools/threads.ts:364-460`
- `reference/poracode/src/main/app-controls/mcp/toolRegistry.test.ts:617-681`

但现有 primitives 没有稳定的 exchange id、source/target reply correlation、目标 Turn anchor、自动把目标 reply 投影回源 Thread、跨 Harness provenance 或防对话循环。因此它们是 v0.10 的实现基础，不是 v0.10 已完成的证据。

## Finding 4 — Current thread identity is still legacy agent/model shaped

Thread row 当前包含 `agentKind`、`config.model`、`sessionRef`、CraftStation `compositionProvenance` 与 account binding；`parentThreadId` 只表达 create-thread parent grouping。它没有 durable dialogue link/exchange，也没有完整 Harness/CraftPlan/Entity reply provenance。

Primary source：

- `craftstation-dev/src/shared/contracts/thread.ts:26-78`
- `craftstation-dev/src/shared/contracts/thread.ts:143-183`

v0.10 应在 CraftStation-owned Thread Collaboration Module 中把 Model/Harness/Recipe/CraftPlan identity 解析为目标展示和审计信息，同时避免把旧 `agentKind` 继续当成完整 Composition identity。

## Finding 5 — Existing target delivery can accidentally inherit runtime-specific busy semantics

App Controls MCP 直接调用 Supervisor `sendThreadInput`；当前 live target 的 busy/steer 行为由具体 ThreadSessionManager/Runtime 路径决定。v0.10 需要统一“target busy 默认 queue after current turn，显式 interrupt 才中断”的跨 Thread 合同，不能让不同 Harness 偶然表现不同。

Primary source：

- `reference/poracode/src/main/app-controls/mcp/tools/threads.ts:410-434`
- `craftstation-dev/src/supervisor/runtime/threadSessionManager.ts:523-695`

## Planning Consequence

建立 CraftStation-owned `Thread Collaboration Module`，外部只暴露 request/wait/cancel/read exchange。其 implementation 复用 App Controls MCP、Thread persistence 与 Supervisor lifecycle，但隐藏 target resolution、busy queue、reply correlation、provenance projection、restart recovery、loop control 和 security policy。Crossagents 保持独立 ephemeral lane。
