# Debugger — v0.8.7 独立复检

> Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> 基线 / HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06`
>
> Verdict：**DEV PASS / USER ACCEPTANCE PENDING**

## 1. Independent Review Scope

本轮没有用旧 Coder 绿测替代验收。独立复核并运行了 F38 readiness、F40 private root/credential projection/server pool、F42 production IPC/SDK v2/question semantics、F44 diagnostic redaction，以及官方 carrier、真实 Provider assistant response、静态检查和仓库卫生。

## 2. Engineering Findings Closed

### F40 — PASS

- AccountStore projection 与读取边界均阻断 8 个 private-root reserved keys。
- Transport 最终值始终由当前 private runtime root 派生；account env 无法覆盖。
- 受管 `auth.json` 只进入当前账户 private OpenCode data root；auth-only binding 不向 adapter/renderer 返回 raw credential。
- 当前 binding env、host marker isolation、pool reuse/isolation/child-exit eviction/restart 均保持通过。

### F42 — PASS

- raw array 与 answers map 使用同一 normalize/validate 路径。
- question count/identity、非空字符串、single/multiple、custom/options allowlist 均执行。
- production IPC crafted/legacy 分流、permission allow/deny、question answer/reject、unknown/expired fail-closed 保持通过。
- SDK v2 `permission.v2.*` / `question.v2.*` canonical mapping 与 request resolved 闭环保持通过。

### F44 — PASS

- 普通与 escaped `apiKey/accessToken/refreshToken`、Authorization Basic/Bearer、query、nested auth/oauth/credential 均不泄漏原 secret。
- replacement 无 `$1` 污染。
- phase/code/operation/correlation 保持规范。
- 新增 SDK v2 nested error message 诊断，同时拒绝 response body/headers/metadata 外泄。

### F38 — PASS

Compile 与 spawn/create/resume 双层 route-specific executable readiness 继续 fail-closed；未验证 route 不进入可执行路径。

## 3. Real Provider Evidence

### Verified route

`kimi-for-coding/kimi-for-coding`：

- 使用 Dev 中官方 OpenCode auth store 的单条 Kimi credential，投影到临时 AccountStore。
- 正式路径：`AccountStore -> AccountStoreOpenCodeRuntimeBindingResolver -> private OpenCodeNativeServerPool -> OpenCodeNativeSession`。
- 第一轮返回 `CRAFTSTATION_OPENCODE_KIMI_OK`。
- 第二轮返回 `CRAFTSTATION_OPENCODE_KIMI_TURN2_OK`。
- 两轮均 completed/idle；Session terminated；无残留进程。

### Still unverified

- OpenAI `gpt-5.4`：真实 OAuth refresh 返回 HTTP 403。
- DeepSeek `deepseek-v4-flash`：Dev 中现有 API key 被 Provider 判定 invalid。
- xAI、Google、OpenAI-compatible Kimi：没有取得对应真实 assistant response。

因此 compatibility 只升级 Kimi native 一条，不能表述为 6-Route E2E PASS。

## 4. Validation Matrix

| Gate                                                  | Result                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| Focused F38/F40/F42/F44                               | `10 files / 100 tests PASS`                                   |
| 用户定向 suite                                        | `15 files / 107 tests PASS`；1 个 explicit live 文件默认 skip |
| Broader Crafting/OpenCode/IPC/AccountStore/Supervisor | `19 files / 223 tests PASS`；1 个 explicit live 文件默认 skip |
| 官方 carrier smoke                                    | `2 files / 8 tests PASS`                                      |
| 真实 Provider smoke                                   | `1 file / 1 test PASS`；包含两轮 Kimi 回复                    |
| TypeScript                                            | PASS                                                          |
| Feature 45 source files oxlint/oxfmt                  | PASS                                                          |
| diff/package-lock hygiene                             | PASS                                                          |
| residual OpenCode process                             | `0`                                                           |

## 5. Compatibility Boundary

```text
records=6
available=1
unverified=5
providerAssistantResponse verified=1 / unverified=5
successfulFollowUpTurn verified=1
```

Feature 工程路径和 fail-closed compatibility gate 已满足当前开发质量门；剩余五路只是未验证能力，不会被暴露为 executable-ready。

## 6. Verdict

```text
DEV PASS / USER ACCEPTANCE PENDING
```

## 7. Feature → Dev Integration（2026-08-31）

- 用户明确要求将 v0.8 合入 `dev`。
- Feature commit：`20be0e1a28056a8103a4f49b65be61cece5ad797`。
- Dev merge commit：`e74808cdc649fdf37b1e23aa9edc810f3467e8fb`。
- 合并冲突：2 个源码文件；已保留现有 Codex/OpenAI-compatible 账号路由并加入 OpenCode provider 路由，同时补齐 OpenCode adapter imports。
- 合并后回归：`19 files / 225 tests PASS`；TypeScript PASS；44 个触及源码文件 oxlint/oxfmt PASS；diff check PASS。
- `.scratch/`、`ai_workspace/validation/` 与凭据未进入提交。
- 未执行 Dev→Main merge、正式 tag 或 push。

最终状态：

```text
MERGED TO DEV / USER ACCEPTANCE PENDING
```
