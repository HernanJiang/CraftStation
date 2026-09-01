# Debugger v0.7.15 独立复检与直接修复报告

- Feature：v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters
- 工作树：`D:\Work\CraftStation\dev\.worktrees\v0.7-native-harnesses`
- 分支：`feature/v0.7-native-harnesses`
- 角色：Debugger（按用户授权直接修复，不回派 Coder）
- 日期：2026-08-31
- Verdict：**FAIL / PARTIAL（Engineering PASS）**
- Requires Manager Re-plan：**No**
- Requires Ideate Revision：**No**

## Review Scope

本轮在同一 Feature worktree 复核 v0.7.14 Remaining，并直接关闭 Codex Native provider-native 子 Agent identity 缺口。复检覆盖：

1. Codex app-server initialize/turn 协议、官方 collaboration item 映射、子 Agent lifecycle 与 capability descriptor。
2. 真实非 synthetic Codex 产品路径：selected MCP、Skill、provider-native 子 Agent、child thread identity、wait completion、parent exactly-once、resume、context 与 cleanup。
3. AGY、Grok、Kimi、官方 DSH、官方/第三方 DeepSeek API 的既有真实 artifact 边界。
4. 14 项动态模型流量的最新全量和定向重试结果。
5. 宿主原生工具、Skill、网络、MCP、AGENTS、上下文 checkpoint、后台子任务及跨任务消息。
6. focused/wider tests、58 个触及 TS/TSX 的 format/lint、typecheck、diff、凭据和进程残留。

CodeGraph 降级说明：`codegraph status` 当前报告的 Project 为 `D:\Work\CraftStation`，没有证明索引对应本 Feature worktree；本轮不把该索引作为 v0.7.15 源码证据，改用当前 worktree 的源码、Git diff、测试和 artifact 直接审查。

## Direct Fixes

### 1. Codex experimental collaboration negotiation

- `appServerClient.ts` 的 initialize 请求显式启用 `experimentalApi: true` 并关闭本地不需要的 attestation 请求。
- `types.ts` 补齐 initialize capability 与 `turn/start.collaborationMode` 协议类型。
- `nativeCodexRuntimeAdapter.ts` 每轮向官方 app-server 发送 collaboration mode；仍由官方 Codex Runtime 拥有子 Agent 执行，不创建 synthetic child Entity/Session。

### 2. Provider-native 子 Agent canonical mapping

- `eventMapping.ts` 识别官方 `collabAgentToolCall`；只有 `spawnAgent` / `spawn_agent` 标记 `isSubAgent: true`，`wait`、`sendInput`、`resumeAgent` 不被误标。
- 新增 `NativeCodexSubAgentRouter`，把 provider parent item、child thread、child completion 和 wait result映射到稳定 canonical lifecycle。
- parent `item.started` / `item.completed` 分别保持恰好一次；重复 wait 不重复完成 parent。
- descriptor 的 Codex `subagents` 仅在上述真实产品证据成立后升级为 `supported + integrated`。

### 3. 真实 Codex Agentic acceptance

- 扩展 `codexAgenticProductPath.integration.test.ts`，使用 `gpt-5.6-sol` 真实运行官方 app-server。
- artifact 直接记录 provider child thread identity、provider completion result、parent started/completed count、resume/context 和两次 session.exited。

## Evidence

### Codex Native

真实 artifact：`ai_workspace/validation/v0.7.15-codex-agentic-product-path.json`

| 断言 | 结果 |
|---|---|
| synthetic | `false` |
| corePass / subagentPass | `true / true` |
| Model | `gpt-5.6-sol` |
| selected MCP | 4 个原生 tool lifecycle events |
| Skill marker | observed |
| provider child thread identity | observed |
| provider wait completion result | observed |
| parent lifecycle | started 1 / completed 1 / exactly-once |
| resume + remembered context | observed |
| context event | observed |
| first/resumed cleanup | 两次 `session.exited` observed |

真实命令结果：Codex Agentic product path `1 file / 1 test PASS`；运行约 123 秒。

独立 focused：

- `appServerClient.test.ts`
- `nativeCodexRuntimeAdapter.test.ts`
- `nativeCodexBaselineGuard.test.ts`
- `subAgentMapping.test.ts`

结果：**4 files / 22 tests PASS**。

### Full Harness Agentic matrix

统一 artifact：`ai_workspace/validation/v0.7.15-full-harness-agentic-matrix.json`

| Harness / Path | Verdict | 真实边界 |
|---|---|---|
| Antigravity `agy 1.1.22` | PASS | 工具、网络、MCP、Skill、provider-native 子 Agent、AGENTS、多轮、resume、cleanup；compaction 排除 |
| Grok ACP | PASS | selected MCP、Skill、provider-native 子 Agent、resume、cleanup |
| Kimi ACP | PASS | selected MCP、Skill、provider-native 子 Agent identity/result、context、resume、cleanup |
| Codex app-server | PASS | selected MCP、Skill、provider-native 子 Agent child identity/wait/exactly-once、context、resume、cleanup |
| 官方 DSH | AUTH_REQUIRED | carrier 与 cleanup 成立；无 assistant response，高级能力未证明 |
| 官方 DeepSeek API | AUTH_REQUIRED | 最新真实 Agentic请求认证失败；实现回归或历史文本流量不能替代当前 Agentic成功 |
| 第三方 Router DeepSeek API | AUTH_REQUIRED | 最新真实请求 HTTP 401；文本与 Agentic均未取得 |

### 动态模型流量

- 最新全量：14 discovered / 14 attempted / 9 strict marker PASS。
- 定向重试恢复：`deepseek-v4-flash`、`deepseek-v4-pro-0813`。
- 最终：**11/14 strict PASS**。
- 仍失败：`kimi-k3` TIMEOUT；`meta/muse-spark-1.2-contributor`、`z-ai/glm-5.3-flash` PROVIDER_FAILURE。

该矩阵只证明 Codex app-server/Router 的模型文本流量，不是每个模型厂商原生 Harness 的 Agentic PASS。

### 宿主能力

| 项目 | 结果 | 说明 |
|---|---|---|
| 原生工具 | PASS | `exec_command` 返回真实 Git、文件、测试和进程结果 |
| Skill | PASS | 已读取 `my-workflow`、Debugger 与 code-review 指令 |
| 网络 | PASS | GitHub API/仓库页曾返回 HTTP 200 |
| MCP | PASS | Codex app task MCP工具返回结构化结果 |
| AGENTS.md | PASS | 项目指令自动进入任务上下文 |
| 上下文 checkpoint | PASS | 压缩摘要后可继续处理消息与执行工具 |
| 后台子任务 | PARTIAL / NOT OBSERVABLE | 最新子任务 status completed / error null，但 `items=[]`，没有可观察 assistant marker/body |
| 跨任务消息 | PARTIAL / NOT OBSERVABLE | dispatch 和完成可观察，但请求的返回正文不可观察；不能标 PASS |

## Regression Validation

| 门禁 | 结果 |
|---|---|
| Codex focused | 4 files / 22 tests PASS |
| 更宽 Feature set | 8 passed / 1 skipped files；143 passed / 1 skipped tests |
| 58 个触及 TS/TSX `oxfmt --check` | PASS |
| 58 个触及 TS/TSX `oxlint --deny-warnings` | PASS |
| `pnpm run typecheck` | PASS |
| `git diff --check` | PASS |
| validation/agent_docs/status 凭据扫描 | 0 命中 |
| v0.7 目标测试残留进程 | 0 |
| `package.json` / `pnpm-lock.yaml` | 未修改 |

本轮验证前发现 pnpm store 的工作区依赖被外部清理，仅在当前 Feature worktree 执行 `pnpm install --frozen-lockfile --force` 恢复依赖；产品 manifest 与 lockfile 均未改变。

## Findings

1. **P1 — 官方 DSH仍未取得真实 assistant response。** 当前只有官方 Windows carrier、真实 initialize/session/shutdown 和 cleanup 证据；tool/MCP/Skills/subagents/resume/multi-turn/context/compaction 均不能升级。
2. **P1 — 两条 DeepSeek API最新 Agentic流量仍被认证阻塞。** 官方路径为 AUTH_REQUIRED，第三方 Router为 HTTP 401。实现单测和历史 API正文不能替代当前真实 Agentic成功。
3. **P1 — 14 个动态模型仍有 3 项实时失败。** Kimi K3超时；Muse与Z-AI/GLM为 Provider failure。
4. **P2 — 宿主后台子任务返回正文不可观察。** 任务可 dispatch并完成，但调用方没有可观察 marker/body，因此跨任务消息的端到端返回不能标 PASS。
5. 聊天中曾暴露 DeepSeek/Ark凭据。报告和 artifacts未保留凭据，但用户仍必须在服务端撤销并轮换。

## Remaining

- 取得官方 DSH真实 assistant response后，才能在同一 DSH产品路径逐项验 tool/MCP/Skill/subagent/resume/context/compaction。
- 使用轮换后的官方与第三方 DeepSeek凭据，在本机环境变量或安全密钥存储中注入，重跑真实 API Agentic产品路径。
- Provider恢复后重跑 Kimi K3、Muse、Z-AI/GLM定向流量。
- 修复或澄清宿主任务结果传播，使 child assistant marker/body可由调用方观察。

## Fix Plan

1. **认证外部项**：凭据轮换后仅通过临时环境注入重跑 DSH/两条 API产品路径；不得将 key写入命令历史、仓库或 artifact。
2. **DSH能力项**：先要求真实非空 assistant response，再逐项增加原生协议证据；禁止普通 API、Command Code、CLIProxyAPI或 synthetic fallback代替。
3. **动态模型项**：按失败模型单独重试并保留分类，不用其它模型 PASS覆盖失败项。
4. **宿主任务项**：修复 Router默认模型/function-call结果传播后，重跑“后台子任务返回 marker”和“跨任务消息正文返回”。

## Fix Acceptance Criteria

1. DSH artifact 为 `synthetic=false`、真实 assistant response非空、cleanup成立；每项高级能力都有 DSH自身原生事件或结果证据。
2. 官方与第三方 DeepSeek API均产生非空精确 marker，并在同一真实产品路径逐项证明声明的 Agentic能力与 cleanup。
3. 14/14 动态模型在最新一轮或各自最新定向重试中 strict marker PASS。
4. 后台子任务和跨任务调用方能读取指定 assistant marker/body，而不只是 status completed。
5. 凭据扫描0命中、目标残留进程0、工程门禁保持全绿。

## Fix Execution Order

1. 撤销/轮换已暴露凭据并安全注入。
2. 重跑官方 DSH与两条 DeepSeek API真实产品路径。
3. 重跑三项动态模型。
4. 关闭宿主返回正文问题并复测。
5. 统一更新矩阵和 Debugger verdict；只有全部验收项成立才允许 Feature PASS。

## Final Verdict

**Engineering：PASS。**

**Real Harness Agentic：AGY / Grok / Kimi / Codex Native PASS；官方 DSH与两条 DeepSeek API路径 AUTH/BLOCKED。**

**Feature-level：FAIL / PARTIAL。不得 commit、push、tag、merge Dev/main或promotion。**
