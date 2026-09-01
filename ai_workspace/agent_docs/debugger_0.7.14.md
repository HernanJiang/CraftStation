# Debugger v0.7.14 独立复检与直接修复报告

- Feature：v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters
- 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 分支：`feature/v0.7-native-harnesses`
- 角色：Debugger（按用户授权直接修复，不回派 Coder）
- 日期：2026-08-31
- Verdict：**FAIL / PARTIAL（Engineering PASS）**

## 结论

本轮没有把“代码绿测”“模型文本回复”“某个 CLI 的 Agentic 能力”混成同一个 PASS：

1. **工程门禁 PASS**。本轮修复了 DeepSeek API selected MCP 的 canonical server/tool identity、DSH 未配置测试的环境隔离、真实 Agentic 测试的 Windows 清理和定向重试能力。
2. **AGY、Grok、Kimi 的最新真实 Agentic 产品路径 PASS**。
3. **Codex 核心 Agentic 路径 PASS，但 provider-native 子 Agent identity 未证明，整体 PARTIAL**。
4. **官方 DSH 仍为 AUTH_REQUIRED**：carrier 与真实 JSON-RPC 产品路径存在，cleanup 成立，但没有真实 assistant response，高级能力不能升格。
5. **官方 DeepSeek API 与第三方 Router API 均被当前凭据认证阻塞**。API adapter 的 MCP/Skill/multi-turn/context/interrupt 实现与回归存在，但真实 API Agentic artifact 为 AUTH_REQUIRED，不能宣称真实成功。
6. 最新 14 模型动态目录全量矩阵为 9/14 strict PASS；定向重试恢复 DeepSeek Flash 与 Pro 0813，最终 11/14。Kimi K3 超时，Muse 与 Z-AI/GLM 为 Provider failure。

因此 Feature 仍是 **FAIL / PARTIAL**，不得 merge Dev/main、commit、push、tag 或 promotion。

## 本轮直接修复

### 1. DeepSeek API selected MCP canonical identity

修改：

- `src/supervisor/runtime/nativeHarness/deepSeekApiMcp.ts`
- `src/supervisor/runtime/nativeHarness/deepSeekApiAdapter.ts`
- `src/supervisor/runtime/nativeHarness/deepSeekApiAdapter.test.ts`

修复内容：

- MCP 工具定义在 CraftStation 本地保留 `mcpServerName` / `mcpToolName`。
- OpenAI-compatible provider wire payload只发送标准 `type/function`，不泄露 CraftStation 私有字段。
- canonical `item.started/item.completed` 事件投影 selected MCP server 与原生 tool identity。
- 单测直接断言 provider body 不含私有字段，同时 canonical 事件包含身份。

### 2. DeepSeek API 真实 Agentic 验收入口

新增：

- `src/supervisor/runtime/nativeHarness/deepSeekApiAgenticProductPath.integration.test.ts`

真实验收范围：streaming、selected stdio MCP、Skill、同 Session 多轮、context、interrupt、cleanup。跨 Runtime resume、provider-native 子 Agent、文件/shell、AGENTS 自动读取、compaction明确不由该 API adapter伪造。

最新真实结果：官方 API 当前凭据返回 `AUTH_REQUIRED`；Ark key 未配置。artifact：`ai_workspace/validation/v0.7.14-deepseek-api-agentic-product-path.json`。

### 3. DSH 未配置测试隔离

本机存在合法 `DSH_CORDIS_CONFIG`。三个“未配置时必须在 Entity 前 fail-closed”的测试此前会继承宿主变量，造成假红。修复为测试期间临时清除并在 `finally` 精确恢复，不改变生产逻辑允许显式环境配置的语义。

### 4. 真实 Harness 测试稳定收口

- Windows 临时 workspace 清理增加重试并避免 cleanup 异常覆盖能力 verdict。
- Grok/Kimi 测试支持按 Harness 定向重试和独立 artifact。
- Kimi 子 Agent验收同时检查 provider-native canonical identity 与子 Agent事件结果，不再只依赖父 Agent复述 marker。
- Codex Agentic 测试可固定稳定的已发现模型，避免目录顺序导致不受控模型变化。

## 真实 Evidence

### Harness Agentic

| Harness / Path             | 最新结果      | 已真实证明                                                                                                                  | 未证明/排除                                           |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Antigravity `agy 1.1.22`   | PASS          | 工具、网络搜索、selected MCP identity、Skill、provider-native 子 Agent、AGENTS、同 Runtime 多轮、跨 Runtime resume、cleanup | compaction 按用户本轮要求不验                         |
| Grok ACP                   | PASS          | selected MCP、Skill、provider-native 子 Agent、resume、cleanup                                                              | 本轮未扩大到 compaction                               |
| Kimi ACP                   | PASS          | selected MCP、Skill、provider-native 子 Agent identity/result、context、resume、cleanup                                     | 本轮未扩大到 compaction                               |
| Codex app-server           | PARTIAL       | selected MCP、Skill、context、resume、cleanup                                                                               | provider-native/canonical 子 Agent identity 未观察到  |
| 官方 DSH JSON-RPC          | AUTH_REQUIRED | carrier、真实 initialize/session/shutdown 边界、session.exited cleanup                                                      | assistant response 与全部高级能力未证明               |
| 官方 DeepSeek API          | AUTH_REQUIRED | 真实 HTTPS 到达 Provider、错误分类与 cleanup                                                                                | MCP/Skill/多轮/context/interrupt 的真实 API成功未取得 |
| 第三方 Router DeepSeek API | AUTH_REQUIRED | 真实 OpenAI-compatible请求到达本机 Router并返回 HTTP 401                                                                    | 文本与 Agentic 能力均未取得                           |

主要 artifacts：

- `ai_workspace/validation/v0.7.13-antigravity-agentic-product-path.json`
- `ai_workspace/validation/v0.7.13-structured-agentic-product-path.json`
- `ai_workspace/validation/v0.7.14-kimi-agentic-retry.json`
- `ai_workspace/validation/v0.7.13-codex-agentic-product-path.json`
- `ai_workspace/validation/v0.7.9-deepseek-product-path.json`
- `ai_workspace/validation/v0.7.14-deepseek-api-agentic-product-path.json`
- `ai_workspace/validation/v0.7.14-router-deepseek-api-probe.json`

### 动态 14 模型真实流量

- 最新全量：14 discovered / 14 attempted / 9 strict marker PASS。
- 定向恢复：
  - `deepseek-v4-flash`：PASS
  - `deepseek-v4-pro-0813`：PASS
- 仍失败：
  - `kimi-k3`：180 秒 TIMEOUT
  - `meta/muse-spark-1.2-contributor`：PROVIDER_FAILURE
  - `z-ai/glm-5.3-flash`：PROVIDER_FAILURE
- 最终按“全量最新结果 + 本轮对应定向重试”计为 **11/14 strict PASS**。

这只证明 Codex app-server / Router 的模型文本流量，不是对应模型厂商原生 Harness 的 Agentic 能力。

### 宿主快速自测

| 项目                   | 结果 | 说明                                                         |
| ---------------------- | ---- | ------------------------------------------------------------ |
| 原生工具               | PASS | `exec_command` 返回真实 Git/文件/测试结果                    |
| Skill                  | PASS | 读取 `my-workflow` 与 `diagnosing-bugs` 的 SKILL.md          |
| 网络搜索               | PASS | GitHub API 与仓库页均 HTTP 200                               |
| MCP                    | PASS | Codex app thread MCP 工具返回结构化结果                      |
| AGENTS.md              | PASS | 项目 AGENTS 指令自动进入任务上下文                           |
| 上下文 checkpoint 续跑 | PASS | 从压缩 checkpoint 接管后继续执行并接受后续消息               |
| 后台子 Agent           | FAIL | 首次路由到无效模型 `first`；显式重试触发 Router `CR-UP-0001` |
| 跨线程消息返回         | FAIL | dispatch 成功，但子任务两次均未返回 marker                   |

## Regression Validation

| 门禁                                          | 结果                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| 最终 focused                                  | 4 files / 114 tests PASS                                 |
| nativeAdapter + Supervisor                    | 2 files / 108 tests PASS                                 |
| 更宽 native set                               | 11 passed / 5 skipped files；71 passed / 8 skipped tests |
| 52 个触及 TS/TSX `oxfmt --check`              | PASS                                                     |
| 52 个触及 TS/TSX `oxlint --deny-warnings`     | PASS                                                     |
| `pnpm run typecheck`                          | PASS                                                     |
| `git diff --check`                            | PASS                                                     |
| validation/agent_docs/PROJECT_STATUS 凭据扫描 | 0 命中                                                   |
| 目标 Agent/MCP 测试残留进程                   | 0                                                        |

## Findings / Remaining

1. **P1：DeepSeek API 当前凭据不可用。** 当前进程已有官方 key真实返回 401/AUTH_REQUIRED；Ark key未配置；Router OpenAI-compatible probe也返回 401。认证无法通过代码绕过。
2. **P1：官方 DSH 无 assistant response。** 不能用 DeepSeek普通 API、Command Code、Codex Router模型流量或 synthetic fallback替代。
3. **P1：Codex 子 Agent identity 未闭环。** 文本 marker出现，但没有 canonical/provider-native子 Agent事件，因此不能标支持。
4. **P1：动态模型仍有 3 个实时失败。** Kimi K3 timeout；Muse与Z-AI/GLM provider failure。
5. **P2：宿主子任务 Router协议故障。** `fork/send` seam可达，但子任务未成功返回；需修复 Router模型默认值 `first` 与 `CR-UP-0001` function-call output映射。
6. 聊天中曾发送过官方 DeepSeek与Ark凭据。即使当前已失效，也必须在服务端撤销并轮换；新凭据只通过本机环境/密钥存储注入，不再发到聊天。

## 下一步

1. 用户轮换凭据后，仅设置本机环境变量，重跑两个 DeepSeek API product-path测试；不得把 key写入命令、artifact或仓库。
2. 官方 DSH若要继续，必须取得真实 assistant response后再逐项测 tool/MCP/Skill/subagent/resume/context/compaction。
3. 修复 Codex Router子任务的默认模型与 `CR-UP-0001`，再重跑宿主后台子 Agent/跨线程返回。
4. 对 Kimi K3、Muse、Z-AI/GLM 等待 Provider恢复后生成新 artifact重试。
5. 当前不得 commit、push、tag、merge Dev/main或promotion。

## Final Verdict

**Engineering：PASS。**

**Real Harness Agentic：AGY/Grok/Kimi PASS；Codex PARTIAL；官方 DSH与DeepSeek API AUTH/BLOCKED。**

**Feature-level：FAIL / PARTIAL。**
