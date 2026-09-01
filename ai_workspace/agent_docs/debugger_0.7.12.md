# Debugger v0.7.12 独立复检报告

- Feature：v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters
- 本轮验收对象：DeepSeek API provider paths（不是官方 DSH Harness）
- 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 分支：`feature/v0.7-native-harnesses`
- 复检时间：2026-08-31
- Verdict：**FAIL / PARTIAL**

## 结论摘要

本轮按用户要求将 DeepSeek 验收分成两条真实 API 路径：

1. 官方 DeepSeek API：`https://api.deepseek.com/v1`
2. 火山方舟 Coding API：`https://ark.cn-beijing.volces.com/api/coding/v3`

通过 CraftStation 生产路径 `SupervisorRuntime.craftAgent -> DeepSeekApiRuntimeAdapter -> OpenAI-compatible HTTPS -> Entity -> Session` 运行真实请求。官方 API 的 `deepseek-chat` 与 `deepseek-reasoner` 均取得非空、精确 marker 响应；方舟 `deepseek-v4-flash` 与 `deepseek-v4-pro` 均由服务端返回 401，适配器正确归类为 `AUTH_REQUIRED`，因此不能宣称四个模型全部成功。

官方 DSH JSON-RPC Harness 不在本轮 API provider 验收中，也不能用普通 API 的成功替代 DSH 的产品路径验收。AGY 压缩、Claude 按用户要求暂不作为本轮修复对象。

## Evidence

### 1. 真实 DeepSeek API 产品路径

证据文件：

`D:\Work\CraftStation\craftstation\.worktrees\v0.7\ai_workspace\validation\v0.7.12-deepseek-api-product-path.json`

| Provider path | Model | 真实结果 | 清理 |
|---|---|---|---|
| 官方 DeepSeek API | `deepseek-chat` | PASS；非空响应、精确 marker、`synthetic=false` | `session.exited` 已观察 |
| 官方 DeepSeek API | `deepseek-reasoner` | PASS；非空响应、精确 marker、`synthetic=false` | `session.exited` 已观察 |
| 火山方舟 Coding API | `deepseek-v4-flash` | FAIL；真实 HTTP 401，诊断 `AUTH_REQUIRED` | `session.exited` 已观察 |
| 火山方舟 Coding API | `deepseek-v4-pro` | FAIL；真实 HTTP 401，诊断 `AUTH_REQUIRED` | `session.exited` 已观察 |

artifact 汇总：`configured=4`、`attempted=4`、`passed=2`、`failed=2`、`cleanupPassed=4`。artifact 未保存 key、Bearer 值或完整响应正文。

本轮产品路径使用用户临时提供的官方凭据时，官方两个模型均取得 PASS；方舟两个模型则由服务端返回 HTTP 401，说明该方舟凭据当前未被该 endpoint 授权。两把 key 已出现在聊天上下文，应尽快在服务端撤销并重新生成。

### 2. 本轮直接修复

- 修复 `NativeHarnessRecipe` 的模型路由隔离：增加 `modelItemIds` 白名单，避免保留给 DSH 的 `deepseek:deepseek-chat` 误匹配到 `harness:deepseek-api`。
- API Recipe 现在只接受四个明确的 API model Item：
  - `deepseek:deepseek-chat-api`
  - `deepseek:deepseek-reasoner-api`
  - `deepseek:deepseek-v4-flash-api`
  - `deepseek:deepseek-v4-pro-api`
- 产品路径测试扩展为上述四个模型；未配置的 provider 会明确记录 `KEY_NOT_CONFIGURED`，已配置的 provider 必须全部 PASS 才能通过测试。
- 修复产品路径测试错误导入、测试格式和未使用的 `TurnStatus` 导入。
- 401 失败证据使用结构化 `errorCode/errorMessage/errorDetails` 记录，避免把完整错误 JSON 或凭据写入 artifact。

### 3. 工程门禁

| 检查 | 结果 |
|---|---|
| DeepSeek API 相关回归 | 4 files passed，50 tests passed |
| `pnpm run typecheck` | PASS |
| `oxfmt --check`（显式触及文件） | PASS |
| `oxlint --deny-warnings`（显式触及文件） | PASS |
| `git diff --check` | PASS |
| validation/agent_docs credential-like scan | 0 命中 |
| 测试结束后的目标 API/vitest 残留进程 | 0 |

## 能力边界

本轮证明的是 DeepSeek **API provider path** 的文本会话链路，不是 DSH Harness 的能力证明。

### 已由本轮/已有真实证据证明的 API 路径能力

- 官方 API `deepseek-chat`：真实 HTTPS、非流式业务结果由 streaming adapter 接收、非空正文、生命周期清理。
- 官方 API `deepseek-reasoner`：真实 HTTPS、非空正文、生命周期清理。
- API adapter 代码支持同一 Session 的 transcript、多轮消息、SSE content/reasoning delta、canonical turn/session events 和基础取消；其中未逐项取得本轮独立真实 artifact 的项目仍不能写成全面 Feature PASS。

### 明确未证明或未集成

- API tool call 不能写成 CraftStation `tool_execution` 已集成；目前 descriptor 保持 `implementation missing`。
- API `resume`、文件访问、shell、权限、MCP、Skills、子 Agent、context、compaction、完整 interrupt 语义均未被本 adapter 的真实产品路径逐项证明，保持 `implementation missing`。
- 普通 API 成功不能替代官方 DSH JSON-RPC Harness；DSH 继续按其独立边界处理。
- “所有模型都成功”不成立：本轮四个 DeepSeek API 模型为 2/4 PASS；方舟两模型的当前 blocker 是服务端认证/权限，不是可以用 synthetic 或 fallback 掩盖的代码问题。

## Findings

### P1 — 方舟两个 DeepSeek API 模型当前无法认证

真实结果：`deepseek-v4-flash` 与 `deepseek-v4-pro` 均 HTTP 401。需要用户提供/配置一个对 `ark.cn-beijing.volces.com/api/coding/v3` 有效的方舟凭据后重跑；不建议继续复用已经在聊天中暴露的旧 key。

### P1 — 本轮不能宣称全模型或全 Agentic PASS

官方 API 两模型的文本产品路径通过，但 API adapter 的高级 Agentic 能力尚未逐项真实接通和验收。历史 Command Code/AGY 的 Agentic 证据属于其它 CLI 载体，不能迁移为 CraftStation DeepSeek API 或官方 DSH 的能力结论。

### P2 — DSH 与 DeepSeek API 必须保持独立

`deepseek`（官方 DSH JSON-RPC）和 `deepseek-api`（OpenAI-compatible HTTPS）是不同 Harness。当前实现没有把 API fallback 接到 DSH 路径，符合 fail-closed 边界。

## Remaining / 下一步

1. 撤销聊天中暴露的官方 DeepSeek 与方舟 key，分别生成新凭据；不要把新 key 写入仓库或命令历史。
2. 用新凭据分别重跑四模型产品路径，目标是 artifact 中 `attempted=4 / passed=4 / failed=0 / cleanupPassed=4`。
3. 若要验收 Agentic 能力，必须在 CraftStation 的 `deepseek-api` 产品路径逐项实现并实测 tool execution、MCP、Skills、subagents、resume、interrupt 等；不能引用 Command Code、AGY 或 DSH 的结果代替。
4. 官方 DSH 仍按独立 JSON-RPC 适配器验收，不因 API 路径通过而升格。
5. 不执行 commit、push、tag、Dev/Main merge 或 promotion。

## Final verdict

**工程实现：PASS（相关门禁全绿）。**

**DeepSeek API provider path：PARTIAL（官方 2/2 PASS；方舟 0/2，真实 401）。**

**Feature-level：FAIL / PARTIAL。** 当前没有“所有模型和所有 Agentic 能力都成功”的证据。
