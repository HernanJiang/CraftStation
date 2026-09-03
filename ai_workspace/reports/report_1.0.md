# v1.0.1 Native CLI Multi-Account Profile Runtime — Feature Report

- Candidate：`66ba9eb`（Fix #2）/ 分支 `dev/v1.0.1-native-profile-runtime` / 基线 `main@f5a4bb2`
- Verdict：**PASS (DEV)** — Debugger Re-review #2（`b2edbde`，见 `ai_workspace/agent_docs/debugger_1.0.1.md`）
- 日期：2026-09-04

## 交付范围

- Account Resolver → `NativeProfileSpec` → Supervisor → Native Harness Adapter → 官方 CLI/app-server/ACP 全链路。
- 多账号 profile runtime：Grok / Codex / Kimi 统一 fail-closed credential identity verifier（`PROFILE_IDENTITY_MISMATCH` / `ACCOUNT_IDENTITY_UNAVAILABLE`）。
- Codex managed runtime 账号门禁：Entity 暴露前真实执行 `account/read` + `account/rateLimits/read`，missing / mismatch / RPC error / rate-limit mismatch 全部 fail-closed。
- Renderer/持久化 secret boundary：IPC 仅暴露 `providerAccountId` / `maskedIdentity`；env、credential path、runtime isolation 仅存于 Supervisor 侧。
- Kimi 账号级控制面：create / import / managed login / complete、Supervisor service、IPC、renderer、`KIMI_CODE_HOME` 隔离。

## 真实运行证据

| 项                                                                            | 结果                                                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Grok 官方 CLI 1.0.13 真实双账号 / 双 Leader socket 隔离                       | PASS（Re-review #1 探针，identity hash 匹配）                                                           |
| 官方 codex app-server `account/read` + `account/rateLimits/read` 真实 receipt | PASS（Re-review #2 探针：生产 `AppServerProcessHost` 路径，真实 email 身份 + 真实额度上下文；掩码记录） |
| Managed Codex profile receipt                                                 | **BLOCKED**（账号池 3 个 codex 账号均 metadata-only；真实 managed login 需用户交互式 device-auth）      |
| Kimi managed profile receipt                                                  | **BLOCKED**（本机无 managed Kimi profile / 凭据）                                                       |

BLOCKED 两腿属外部凭据依赖：运行时门禁对缺失凭据诚实返回 `UNVERIFIED/BLOCKED`，不产生 overclaim；managed 身份匹配 leg 由可注入 transport 正反测试覆盖。

## 自动化验证

- `pnpm typecheck` PASS；`pnpm lint` 0/0；`pnpm build` PASS（既有 Vite/CSS/sourcemap/chunk warnings 保留）。
- Focused suite 7 文件 159 测试 PASS（secret boundary、kimiProfiles、grokProfileIsolation、nativeCodexRuntimeAdapter、nativeProfile、agentLoginActions、runtime）。
- Commit hooks（oxlint --type-aware --deny-warnings + tsc）每提交强制通过。

## 边界与后续

- merge `main` / 正式 tag / push：未授权，需用户明确批准。
- 用户可用真实凭据补齐 managed Codex/Kimi receipt 后，本报告无需改版（runtime 行为已定义）。
