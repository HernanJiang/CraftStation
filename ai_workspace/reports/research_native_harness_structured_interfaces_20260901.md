# CraftStation Native Harness 结构化接口核验

> 核验日期：2026-09-01  
> 范围：Antigravity / `agy`、Grok Build CLI、Kimi Code CLI、OpenCode。  
> 方法：只采用官方文档、官方仓库源码、官方协议文档；未进行账号登录或真实付费请求，不读取任何凭据。  
> 说明：本文判断的是“上游是否提供可编程、结构化的后台接口”，不是 CraftStation 当前实现是否已经正确接入。

## 结论摘要

1. **Grok、Kimi、OpenCode 都不需要把 TUI/CLI 界面嵌入 CraftStation。**
   - Grok：官方 `grok agent stdio` / `serve` 提供 ACP JSON-RPC。
   - Kimi：官方 `kimi acp` 提供多 Session ACP JSON-RPC。
   - OpenCode：官方 `opencode serve` + `@opencode-ai/sdk` 提供 OpenAPI/HTTP + SSE；另有 `opencode acp`。
   - 以上接口足以让 Harness 在后台运行，由 CraftStation 原生 UI 渲染消息、reasoning、tool、permission、状态与停止操作。

2. **Antigravity `agy` 的 `stream-json` 是正式机器协议，不是 TUI 文本抓取，但它只达到“部分结构化 Native Harness”。**
   - 它能提供消息增量、工具调用与结果、usage、conversation ID、终态、部分 subagent metadata。
   - 它不接受 `control_request` / `control_response`；headless 权限请求不能交给外部 UI 实时回答，而是按预配置策略 soft-deny 或全量自动批准。
   - 官方文档没有给出独立 reasoning 内容流、MCP lifecycle 事件或结构化 cancel RPC。
   - 因此只靠 `agy stream-json`，**不能诚实宣称达到 Codex app-server 的完整交互等价**。

3. **“读取 stdout”本身不是错误，关键是 stdout 的契约。**
   - 读取官方定义的 NDJSON / JSON-RPC machine protocol 是正确的结构化接入。
   - 读取 ANSI TUI、提示符、光标控制序列或人类可读文本并猜测状态，才是禁止的 CLI scraping。

## 版本与来源快照

| 上游            | 本次核验快照                                                              | 主要一手来源                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Antigravity CLI | 官方文档标示 `v1.1.22`                                                    | [Headless mode](https://antigravity.google/docs/cli/headless)、[Installation & Auth](https://antigravity.google/docs/cli/install)、[Permissions](https://antigravity.google/docs/cli/permissions)                                                                                                                                                                                                                  |
| Grok Build      | 官方仓库 `main`：`bb7f39d5858cbf5e00de639367f59debbdcb0138`               | [Agent mode / ACP](https://github.com/xai-org/grok-build/blob/bb7f39d5858cbf5e00de639367f59debbdcb0138/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)、[xAI Headless & Scripting docs](https://docs.x.ai/build/cli/headless-scripting)、[ACP 官方协议](https://agentclientprotocol.com/protocol/overview)                                                                                         |
| Kimi Code CLI   | release `1.49.0`，tag commit `4a550effdfcb29a25a5d325bf935296cc50cd417`   | [`kimi acp` 文档](https://github.com/MoonshotAI/kimi-cli/blob/1.49.0/docs/en/reference/kimi-acp.md)、[ACP server](https://github.com/MoonshotAI/kimi-cli/blob/1.49.0/src/kimi_cli/acp/server.py)、[ACP session/event mapping](https://github.com/MoonshotAI/kimi-cli/blob/1.49.0/src/kimi_cli/acp/session.py)                                                                                                      |
| OpenCode        | release `v1.18.25`，tag commit `cb7d8b2f5e44876ef98b661dc10590c915af3a9f` | [SDK](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/web/src/content/docs/sdk.mdx)、[Server](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/web/src/content/docs/server.mdx)、[ACP](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/web/src/content/docs/acp.mdx)、[生成的类型](https://github.com/anomalyco/opencode/blob/v1.18.25/packages/sdk/js/src/gen/types.gen.ts) |

## 能力矩阵

| 能力                      | Antigravity `agy stream-json`                                   | Grok ACP                                | Kimi ACP 1.49.0                           | OpenCode SDK/server 1.18.25              |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| 后台、非 TUI 运行         | 是                                                              | 是                                      | 是                                        | 是                                       |
| 多轮 Session              | 是，单进程 stdin 流；也可按 conversation ID 恢复                | 是，create/load/resume                  | 是，new/load/resume/list                  | 是，create/list/get/messages             |
| Assistant 流式文本        | `step_update.text_delta`                                        | `agent_message_chunk`                   | `agent_message_chunk`                     | SSE `message.part.updated` + `TextPart`  |
| 独立 reasoning 流         | **官方 stream schema 未提供**；只有 thinking token 统计         | `agent_thought_chunk`                   | `agent_thought_chunk`                     | `ReasoningPart` + part delta             |
| Tool call / result        | `tool_info`，含 name/parameters/output/error                    | `tool_call` / `tool_call_update`        | `tool_call` / `tool_call_update`          | `ToolPart` 状态 + message-part 事件      |
| 交互式权限请求            | **否**；headless 走静态 policy/soft-deny/全批准                 | 是，ACP reverse request                 | 是，`request_permission`                  | 是，permission event + reply API         |
| Stop / Cancel             | 无输入侧结构化 cancel；只能结束/中断进程等外围控制              | 是，ACP cancel                          | 是，`session/cancel`                      | 是，`session.abort()` / HTTP abort       |
| MCP                       | Harness 本身支持 MCP，但 stream schema 未提供完整 MCP lifecycle | `session/new.mcpServers`，并有 xAI 扩展 | `mcp_servers` 转换；ACP 能力有明确边界    | MCP status/add/connect/auth API + events |
| Subagent 可视化           | `subagent_info` 有 metadata，但不是完整控制协议                 | 有标准/扩展事件，可映射                 | **当前 ACP adapter 忽略 `SubagentEvent`** | child sessions / subtask parts / events  |
| Codex app-server 完整等价 | 否                                                              | 否，协议不同但核心 UI 能力强            | 否，且有明确缺口                          | 否，协议不同但核心 UI 能力强             |
| CraftStation 原生 UI 判断 | **可部分原生；必须显式标注能力缺口**                            | **应直接原生接入**                      | **核心路径应原生接入**                    | **应直接原生接入**                       |

## 1. Antigravity / `agy`

### 官方结构化接口

官方 Headless 文档定义：

- `--output-format stream-json` 输出 NDJSON。
- `--input-format stream-json` 配合上述输出模式，在一个进程中连续接收多轮 `{ "event": "user" }`。
- 输出顺序是一个 `init`、若干 `step_update`、每轮一个 `result`。
- `step_update` 可携带：
  - `agent_response` 的 `text_delta`
  - `tool` 的 `tool_name` / `tool_info.name` / `parameters` / `output` / `error`
  - `checkpoint`
  - `usage`
  - `subagent_info`
- `result` 包含 `conversation_id`、`status`、`response`、`error`、`num_turns` 和 token usage。
- 可用 `--continue` 或 `--conversation <id>` 恢复历史会话。

这意味着 CraftStation 可以安全地把 `agy` 作为后台进程运行，并把官方 NDJSON 映射为自己的 Session/Event/UI。该做法不是 ANSI/TUI scraping。

### 已证实限制

官方文档同时明确：

- 输入只支持 user text；其他 content block 会终止 session。
- `control_request` 和 `control_response` 被明确列为 unsupported，收到后返回 ERROR 并结束 session。
- headless 没有交互式权限提示：
  - 默认遵从 settings 中的 permission policy；
  - 需要 Ask 且无法批准的工具会 soft-deny；
  - 或使用 `--dangerously-skip-permissions` 全量批准。
- 文档列出的 stream event 没有独立 thought/reasoning 内容事件；`thinking_tokens` 只是 usage。
- 文档没有提供输入侧的结构化 cancel/interrupt RPC，也没有完整 MCP lifecycle/status event。

### CraftStation 应如何表达

可映射：

- Session / conversation identity
- turn start/end
- assistant text delta
- tool call、参数、结果、错误
- token usage
- final success/error/canceled/interrupted
- subagent metadata

不得伪造：

- 实时 permission request/response UI
- 独立 reasoning 内容流
- MCP 连接状态与事件
- Codex 等价的结构化 interrupt/cancel

建议 capability 声明至少包含：

```text
structuredStreaming = true
interactivePermission = false
reasoningStream = false
structuredCancel = false
mcpLifecycleEvents = false
```

## 2. Grok Build

### 官方结构化接口

xAI 官方源码文档把 `grok agent stdio` 定义为长驻 ACP Agent：

```text
grok agent stdio
```

它在 stdin/stdout 上运行 JSON-RPC，而不是渲染 TUI。官方文档列出的 lifecycle 和事件包括：

- `initialize`
- `session/new`
- `session/load`
- `session/resume`
- `session/prompt`
- `session/update`
- ACP permission request
- `agent_message_chunk`
- `agent_thought_chunk`
- `tool_call`
- `tool_call_update`
- `plan`

Grok 还提供 `grok agent serve` WebSocket server，并有 `x.ai/*` 扩展，覆盖 filesystem、git/worktree、search、terminal、session fork、history/rewind、compaction、auth 和通知等。

### CraftStation 判断

Grok ACP 已经具备 CraftStation 原生 UI 所需的核心控制面：

- 聊天和 reasoning 分流
- tool call 生命周期
- permission request/response
- session lifecycle 与恢复
- stop/cancel
- MCP 输入和相关扩展

因此默认打开 Grok TUI/PTY 是错误产品路径。正确路径应是 ACP client → canonical events → CraftStation Session/UI。

它仍不等于 Codex app-server：方法名、扩展 namespace、事件 metadata、session persistence 和高级能力都不同。应统一 CraftStation 需要的语义，不应假设协议逐字段相同。

## 3. Kimi Code CLI

### 官方结构化接口

官方文档定义 `kimi acp` 为“multi-session ACP server”。1.49.0 源码证实：

- `initialize` 返回 capabilities 和 auth methods。
- 支持 `new_session`、`load_session`、`resume_session`、`list_sessions`。
- 支持 session model 列表和 `set_session_model`。
- 支持 `prompt` 与 `cancel`。
- 支持 client 提供 MCP server 配置。
- 支持 text、image 和 embedded context。

`ACPSession` 把内部 wire messages 映射为：

- `ThinkPart` → `agent_thought_chunk`
- `TextPart` → `agent_message_chunk`
- `ToolCall` → `tool_call`
- Tool argument delta → `tool_call_update`
- `ToolResult` → completed/failed `tool_call_update`
- `ApprovalRequest` → ACP `request_permission`
- todo → ACP `plan`

如果客户端声明 terminal capability，Kimi 还能通过 ACP terminal reverse calls 让客户端执行命令并呈现 terminal tool content，而不是显示 Kimi 自己的 TUI。

### 已证实限制

1. `fork_session` 在 1.49.0 中仍是 `NotImplementedError`。
2. `QuestionRequest` 在 ACP session 中被明确记为 unsupported，并以空答案解决。
3. `SubagentEvent` 当前未转发。
4. `CompactionBegin/End`、`MCPLoadingBegin/End`、`StatusUpdate` 当前没有映射为 ACP UI 事件。
5. 未登录时返回结构化 `AUTH_REQUIRED`，但 auth method 指向运行 `kimi login` 的 terminal auth；这不等于完整的应用内 OAuth UI。

### CraftStation 判断

Kimi 的消息、thinking、tool、permission、plan、cancel、session persistence 已足够实现 Codex 风格的核心原生聊天体验，默认 TUI/PTY 不应存在。

但必须如实降级未暴露能力，尤其是 subagent、question、compaction/MCP loading 状态和 fork；不能从 Kimi TUI 文本反推这些事件。

## 4. OpenCode

### 官方结构化接口

OpenCode 官方明确说明：

- `opencode serve` 启动 headless HTTP server。
- server 暴露 OpenAPI 3.1。
- `@opencode-ai/sdk` 是由该 OpenAPI spec 生成的 type-safe JS/TS client。
- `createOpencode()` 可启动 server 并返回 client。
- `createOpencodeClient()` 可连接已有 server。
- `event.subscribe()` 提供 SSE。

1.18.25 的 SDK/Server 文档和生成类型证实核心能力包括：

- Session create/list/get/children/messages
- prompt / async prompt
- abort
- summarize/compaction
- permission response
- MCP status/add
- provider/model/auth APIs
- `TextPart`
- `ReasoningPart`
- `ToolPart`
- `StepStartPart` / `StepFinishPart`，含 token usage
- `message.part.updated`，可携带 delta
- `permission.updated` / `permission.replied`
- `session.status` / `session.idle` / `session.error`

OpenCode 另有 `opencode acp`，但 CraftStation 使用 SDK/server 已经是官方、结构化、非 TUI 的路径。

### CraftStation 判断

OpenCode 最适合直接采用：

```text
opencode serve
  → @opencode-ai/sdk
  → SSE event.subscribe()
  → canonical event mapping
  → CraftStation Session/UI
```

不应调用 `/tui/*` 来驱动 OpenCode TUI，也不应把 OpenCode PTY 作为聊天主界面。PTY API 只能用于 Agent 的 terminal tool，不能承担整个 Harness UI。

OpenCode 同样不与 Codex app-server 协议等价；CraftStation 需要处理其 Message/Part 聚合、SSE 订阅、session correlation 和 permission endpoint。

## 建议的统一 CraftStation Seam

```text
Official Harness Machine Interface
  ├─ Codex app-server JSON-RPC
  ├─ Grok ACP JSON-RPC
  ├─ Kimi ACP JSON-RPC
  ├─ OpenCode OpenAPI/SDK + SSE
  └─ Antigravity NDJSON stream-json
          ↓
Provider-specific Adapter
          ↓
CraftStation Canonical Runtime Events
          ↓
CraftStation Session Store
          ↓
CraftStation Native Chat UI
```

Canonical 最小事件建议：

```text
session.started / resumed / exited
turn.started / completed / failed / canceled
content.delta / content.completed
reasoning.delta / reasoning.completed
tool.started / updated / completed / failed
permission.requested / resolved
mcp.status
plan.updated
usage.updated
runtime.error
```

每个 adapter 必须同时返回 capability matrix。UI 只显示真实能力：

- Grok：ACP native。
- Kimi：ACP native，但显式标记当前 subagent/question/compaction-status 缺口。
- OpenCode：SDK/server native。
- Antigravity：stream-json partial native；不可用的 permission/reasoning/cancel/MCP lifecycle 保持 unavailable，不能用 TUI 文本解析补齐。

## 最终判定

| Harness     |     是否存在官方结构化后台接口 | 是否应继续嵌入 TUI | 能否达到 CraftStation 原生 UI | 是否已证明 Codex 完整等价 |
| ----------- | -----------------------------: | -----------------: | ----------------------------: | ------------------------: |
| Antigravity |              是，`stream-json` |                 否 |                      部分可以 |                        否 |
| Grok        |                        是，ACP |                 否 |                          可以 |            否，需协议映射 |
| Kimi        |                        是，ACP |                 否 |          核心可以，有明确缺口 |                        否 |
| OpenCode    | 是，SDK/server + SSE；另有 ACP |                 否 |                          可以 |            否，需协议映射 |

所以本轮产品修复的事实基础是：

> Grok、Kimi、OpenCode 应立即退出“CLI 容器”路径，改走官方 machine interface 并进入 CraftStation 原生 UI；Antigravity 也应退出 TUI，但只能按 `stream-json` 的真实能力做部分原生接入，不能伪造 Codex app-server 级别的交互权限、reasoning 和控制面。
