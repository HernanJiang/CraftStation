# v1.1.0 Compatibility Bridge & Model × Harness Composition — Feature Report

- Candidate：`dd0d0e1`（v1.1.3）/ 分支 `dev/v1.1.0-compatibility-bridge` / 基线 `main@f5a4bb2`
- Verdict：**PASS (DEV)** — Debugger Re-review（`ai_workspace/agent_docs/debugger_1.1.3.md`）
- 日期：2026-09-04
- 历史：初版 T01–T13 + Fix v1.1.1/v1.1.2 + takeover 加固（`fde6c87`）曾判 FAIL/BLOCKED（`debugger_1.1.2.md`、原 `report_1.1.md`）；经 `manager_1.1.0-replan.md` 重受理后由 v1.1.3 以真实运行证据关闭全部阻塞。本报告取代原 FAIL 结论。

## 交付范围

- CompatibilityBridgeService：真实 CLIProxyAPI sidecar 生命周期（官方 release v7.2.149，`.tools/` 本地工具不提交）、`/healthz` 鉴权 readiness、配置文件契约（host/port/auth-dir/api-keys/proxy-url，Windows 正斜杠修正）、pinAccount 账号 credential namespace 绑定。
- 独立 CompatibilityRuntimeAdapter + CompatibilitySession：模型契约轮询验证（fail-closed `RUNTIME_UNAVAILABLE`）、隔离 OpenCode provider 配置导出、官方 `opencode run --format json` 无头 Agent Loop、sessionID→native sessionRef、`-s` resume、stdin-ignore/cwd 隔离。
- supervisor 兼容围栏：兼容计划在 native adapter 选择前分流到兼容工厂；native Codex 路径零改动（baseline guard 架构断言）。
- executionRoute fail-closed、CompatibilityBridgeRecipe、五 Harness exporter（真实消费按 re-plan 范围以 OpenCode tracer 成立，其余为 DTO）。

## 真实运行证据

| 项                          | 结果                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| sidecar 启动/配置/健康/关闭 | PASS（`/healthz` 200、模型目录 26 个、优雅退出）                             |
| 自动化 tracer E2E           | PASS：断言真实回包含 `CRAFTSTATION_E2E_OK`、`ses_*` sessionRef               |
| 会话连续性                  | PASS：turn1 暗号 `BANANA42` → resumeSession → turn2 真实模型答出暗号         |
| 手动交叉                    | curl→CPA→grok-4.3 `CRAFTSTATION_BRIDGE_OK`；OpenCode→CPA `OPCODE_VIA_CPA_OK` |
| 真实上游错误路径            | ChatGPT 账号 `usage_limit_reached`（真实上游响应,plus 额度门）               |

## 自动化验证

- typecheck PASS；lint 0/0；compat 套件 12/12；crafting/runtime 回归 176/176；全量 vitest exit 0（10188 测试）。

## 边界

- fixture 凭据（xai OAuth）用于 tracer；正式发布需用户在 UI 完成真实 provider 登录。
- 其余四 Harness（Codex/Kimi/Grok/Antigravity）的 Compatibility 消费为 `implementation available`（DTO exporter），不冒充 PASS。
- merge `main` / tag / push 需用户明确授权。
