# CraftStation Manager Plan — v0.8.0

## Feature

**v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility**

状态：`PLAN READY / CODER EXECUTING`

本 Feature 独立于正在开发的 v0.6、v0.7：

```text
Product Git Root: D:\Work\CraftStation\craftstation
Base branch:      dev (7ae6506ea01fc04029a10a711ebb0a65d7248e06)
Feature branch:   feature/v0.8-opencode-native
Feature worktree: D:\Work\CraftStation\craftstation\.worktrees\v0.8
Shared v0.6 tree: D:\Work\CraftStation\craftstation-dev（保持原样）
v0.7 tree:        D:\Work\CraftStation\craftstation\.worktrees\v0.7（保持原样）
```

## Part I — Ideate Brief

用户明确将 Pi 暂缓，本版本只接入 OpenCode。OpenCode 是开源的 Agent Harness，并已为大量模型提供 Provider/Model 适配；CraftStation 不重复实现各模型 HTTP API，而是把 OpenCode 官方 Runtime 作为一个 Native Harness 接入。

目标组合：

- OpenAI / ChatGPT Model Item + OpenCode Harness
- Grok / xAI Model Item + OpenCode Harness
- Gemini Model Item + OpenCode Harness（Gemini API/Vertex 按官方配置区分）
- DeepSeek Model Item + OpenCode Harness（这是 DeepSeek 模型 Provider，不是 DSH Harness）
- Kimi / Moonshot Model Item + OpenCode Harness（根据 OpenCode 当前 Provider/兼容层和真实模型 ID 核验）

不纳入本版本：Pi、Anthropic Model Item、DeepSeek/DSH 独立 Harness、Antigravity Harness、CLIProxyAPI、模型 API 的重写或新的 Usage 页面。

## Part II — Manager Plan

### Plan Gate Check

| 检查项                   | 结论           | 依据                                                                                                                 |
| ------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Feasibility              | OK             | OpenCode 官方仓库提供 `opencode serve`、HTTP/OpenAPI Session API、SSE 事件流和 Provider/Model 层。                   |
| Practicality             | OK（分阶段）   | 先完成协议审计和一个 OpenCode tracer bullet，再扩展五类 Model Provider 组合；真实凭据不可用时保留 unavailable 证据。 |
| Alignment                | OK             | 遵循 Official/Native Harness Runtime First；CraftStation 只包装 Runtime，不重写 OpenCode Agent Loop 或模型 API。     |
| Information completeness | Ready for Plan | OpenCode 版本、端点、事件 schema、Provider 名称、Kimi 模型 ID 和认证模式由 T01 冻结，不由 Coder 猜测。               |

### OpenCode 事实边界

- 通过 `opencode serve` 运行官方长生命周期 Server；优先 HTTP/OpenAPI 与官方 SSE `/event`，不抓取 TUI。
- Session API、prompt/async prompt、abort、summarize、message、provider/model config 均由 OpenCode 维护；CraftStation 只调用公开 machine-facing seam。
- OpenCode 当前 Provider 层使用 AI SDK、Models.dev 和 OpenAI-compatible 适配。OpenAI、Google、xAI 有对应官方 Provider；DeepSeek、Moonshot/Kimi 的具体路径可能是 Provider catalog 或 OpenAI-compatible，必须以锁定版本的官方源码/文档/实际配置为准。
- Provider 能发起请求不等于 CraftStation 已验证 Harness 能力。每个 Model×OpenCode×Auth 组合必须有独立 capability 状态和真实证据。

### Deep-module seams

1. **OpenCode Server Transport**：暴露 `start/connect`, `createSession`, `sendPrompt`, `subscribeEvents`, `abort`, `resume`, `dispose`；隐藏进程发现、端口/密码、HTTP client、SSE reconnect、server lifecycle。
2. **OpenCode Model Binding**：将 CraftStation Model Item、Provider/Auth reference、model ID、reasoning、context/tool constraints 转为 OpenCode 原生配置；不得把 secret 写入 CraftPlan、Renderer 或日志。
3. **OpenCode Event Canonicalizer**：将 OpenCode session/status/message/part/tool/permission/question/usage/compaction/error 事件映射到 CraftStation RuntimeEvent/native envelope。
4. **OpenCode Native Recipe/Registry**：保持 Model Item 与 OpenCode Harness Item 独立，只有兼容矩阵允许的组合才能编译为可执行 CraftPlan。

### 功能规格

#### Runtime

- 启动、连接、复用和关闭官方 OpenCode server；server 已运行时不能重复占用端口。
- 创建、恢复、发送 prompt、异步发送、abort、summarize/compaction 状态查询和清理。
- SSE 断线重连、server 重启、Session 不存在、超时、认证失败和非零退出具有稳定诊断；不得设置固定 60 秒上限替代 OpenCode 生命周期。
- OpenCode 继续拥有 Agent Loop、Context、Compaction、Tools、MCP、Permissions、Session persistence 和 Provider request shaping。

#### Model compatibility

- 支持 OpenAI、xAI/Grok、Google/Gemini、DeepSeek、Moonshot/Kimi 的 OpenCode provider/model binding。
- API Key、OAuth、Vertex 或其他认证仅通过安全的 `authRef/profileRef` 投影给 OpenCode；不同厂商订阅不能互相冒充。
- 能力矩阵至少记录 streaming、tool calling、file/shell、reasoning、context、compaction、MCP、subagents、usage 与 auth 状态。
- Kimi 必须区分 Moonshot 原生 Provider 与 OpenAI-compatible 配置；若某模型/能力只在配置层可用，状态标为 `SUPPORTED` 或 `UNVERIFIED`，不得写成 Native E2E PASS。

#### CraftStation composition

- 五类 Model Item 与 OpenCode Harness Item 通过 Native Recipe 形成 `CraftPlan -> Entity -> Session`。
- CraftPlan 完整传递 workspace、model/provider binding、profile/account ref、permission、MCP/Skills、context/compaction 和 runtime overrides。
- Session 在整个生命周期绑定 OpenCode session/provider identity；调度不在每次 prompt 重新选模型。

#### Security and observability

- Renderer/IPC 只接收脱敏 descriptor、事件、usage 和 diagnostics；不得包含 API key、OAuth token、cookie、密码或 raw provider payload。
- 关键日志携带 phase、operation、status、harness/model/session ID、correlation ID 和稳定 error code；不记录完整敏感 prompt。

### Execution Order

`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08`

- T01 冻结 OpenCode 版本、Server API、SSE、Provider/Model 和认证事实。
- T02 完成 server transport tracer bullet；T03 完成 Session/lifecycle/event 映射。
- T04 完成 ModelProviderBinding；T05 按五类模型扩展兼容矩阵。
- T06 接入 Native Recipe/CraftPlan；T07 接入 UI/IPC/capability/diagnostics；T08 完成真实组合 smoke、回归和证据。

### Acceptance Gates

**OpenCode Runtime Gate**

- 不使用 TUI；通过官方 `opencode serve` + HTTP/OpenAPI + SSE 完成真实 session、流式 response、abort/resume/cleanup 证据。
- OpenCode 原生 Context、Compaction、Tools、MCP、Permissions 和 Session 语义未被 CraftStation 重写或静默替换。

**Model Matrix Gate**

- OpenAI、Grok、Gemini、DeepSeek、Kimi 各至少一个真实模型组合取得 init、assistant stream、tool（若模型/配置支持）、多轮和终态证据。
- 记录每个组合的 auth、model ID、capability、失败原因和是否真实 E2E；测试 fixture 不能替代真实 PASS。
- 未认证、无模型、Provider 不支持或能力缺失必须显示明确状态，不自动 fallback 到其他厂商或 API proxy。

**Composition/UI Gate**

- 五类 Model Item 均能通过 OpenCode Native Recipe 生成 CraftPlan/Entity/Session；UI 能显示 Harness、Provider/Model、状态、流式事件和诊断。
- 既有 Codex、Grok Build、Kimi、Antigravity、DeepSeek 路径回归不被破坏；不创建第二套页面。

**Global Gate**

- 无 CLIProxyAPI；无 CraftStation Harness-specific deep import 作为 OpenCode runtime 依赖。
- Debugger 在 v0.8 Feature worktree 独立验收；PASS 只代表 DEV PASS/USER ACCEPTANCE PENDING，不自动 merge 或打正式 tag。

### Handoff

Coder 在 `D:\Work\CraftStation\craftstation\.worktrees\v0.8`、分支 `feature/v0.8-opencode-native` 执行 T01–T08；不得修改共享 v0.6/v0.7 工作树、main、dev，不得创建正式 tag。完成后写入 `ai_workspace/agent_docs/coder_0.8.0.md` 并通知 Debugger。

配对 Debugger：`grok-4.6 / high`。Debugger 仅在 Coder 完成全部 Ticket 后对同一 v0.8 worktree 做独立 Feature Review；其 PASS 只表示 `DEV PASS / USER ACCEPTANCE PENDING`。
