# Debugger 验收 — v0.6.0 Native Provider Authentication & Ark Token Plan

> 对应 Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface`
>
> 角色：Debugger
>
> 日期：2026-08-29
>
> 工作树：`D:\\Work\\CraftStation\\craftstation-dev`，分支 `dev`
>
> HEAD：`7ae6506` + 未提交 v0.5.x / v0.6 改动
>
> Coder 交付：[coder_0.6.0.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/coder_0.6.0.md)
>
> Manager Plan：[manager_0.6.0.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/manager_0.6.0.md)
>
> 脱敏 UI smoke：[cdp-smoke.json](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/validation/v0.6.0-runtime/cdp-smoke.json)
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

本线程只验收 **v0.6.0**，工作树仅 `craftstation-dev`。不验收、不修改 v0.7 / v0.8。不以 Coder 自检、fixture 或 CDP 结构 smoke 冒充真实 Google OAuth / Ark 线上凭据 E2E。未执行 commit / push / tag / merge main。

对照 Manager Acceptance：

1. Antigravity 系统默认浏览器 OAuth：loopback / state / PKCE、主进程 exchange / refresh、安全存储、脱敏 IPC。
2. 独立 Gemini usage surface 移除；Gemini CLI / runtime、模型 / MCP / Skills / session 与 Antigravity 内部 Gemini quota group 保留。
3. Volcengine Ark parser：API Key / AK-SK V4、Coding / Agent Plan、window / error mapping。
4. titlebar CLI 更新按钮在最小化按钮左侧；输入框旧入口消失。
5. provider / account UI 与脱敏运行 smoke。
6. 既有质量门不得升格：Grok 真实额度、F29 exact Token、v0.5.0 Feature、v0.4 F04。

本轮没有启动真实 Google 登录，也没有向 `open.volcengineapi.com` 发送真实 Ark 凭据。

## Evidence

### 独立复跑（本 Debugger，2026-08-29 18:00）

- 定向 Vitest：**11 files / 110 passed**
  - `packages/agents-usage/src/collectors/volcengine.test.ts`
  - `packages/agents-usage/src/collectors/antigravity.test.ts`
  - `src/main/usageLogin/AntigravityOAuthManager.test.ts`
  - `src/main/usageLogin/UsageLoginManager.test.ts`
  - `src/supervisor/runtime/antigravityCredentials.test.ts`
  - `src/supervisor/runtime/usageService.test.ts`
  - `src/renderer/views/MainView/parts/MainTitlebar.test.tsx`
  - `src/renderer/components/providers/useUsageProviderLogin.test.ts`
  - `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`
  - `src/renderer/components/providers/usageProviders.test.ts`
  - `src/renderer/components/thread/ThreadAgentUpdateDock.test.tsx`
- 触及路径 `git diff --check`：**通过**。
- 真实 Google OAuth E2E：**未执行**（无授权的可复现真人授权会话）。
- 真实 Ark 线上凭据 smoke：**未执行**（本机无可用 Ark API Key / AK-SK）。

### 脱敏 CDP smoke（已有产物，未重跑）

[cdp-smoke.json](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/validation/v0.6.0-runtime/cdp-smoke.json)

- `titlebarUpdateButton: true`
- `windowControlsSpacer: true`
- `updateBeforeControls: true`
- `inputUpdateDock: false`
- 打开用量工作区后：`authorizedProviderGrid` / `unauthorizedProviderGrid` / `volcengineArkCard` 为 true，`providerCardCount: 14`
- JSON **不含** token / cookie / authorization code / API key

这只证明桌面结构，**不是** Google OAuth 成功或 Ark billing 成功。

### Antigravity OAuth broker（源码）

`src/main/usageLogin/AntigravityOAuthManager.ts`：

- `shell.openExternal` 打开 Google 授权 URL（系统默认浏览器，不是嵌入页）。
- 本机 `127.0.0.1` 临时 HTTP listener，路径 `/oauth-callback`。
- `state` 校验；mismatch → `state_mismatch`。
- 缺 code → `missing_code`；provider `error` → `provider_denied`。
- PKCE：`code_challenge` S256 + `code_verifier` 参与 token exchange。
- 主进程 `exchangeCode` 对 `oauth2.googleapis.com/token` 换 access/refresh；再拉 userinfo / loadCodeAssist project。
- 成功后 `setUsageSecret` 写入 cacheDir，IPC 结果类型 `UsageLoginResult` 只有 `ok / cancelled / code / error`，**不含** token / code / raw body。

`src/supervisor/runtime/antigravityCredentials.ts`：

- 过期 access token 走 refresh。
- `refreshInFlight` 按 cacheDir 合并并发 refresh，避免同一目录重复打 token endpoint。
- 刷新后仍写回 usage secret store。

### Gemini usage surface

- `packages/agents-usage/src/providers.ts` 的内置 catalog **没有**独立 `gemini` provider；有 `volcengine` 与 `antigravity`。
- `packages/agents-usage/src/registry.ts` **未注册** Gemini collector。
- `packages/agents-usage/src/index.ts` **不导出** `collectGemini`。
- `src/supervisor/agents/registry.ts` 仍有 `createGeminiAdapter`：这是 Gemini CLI **runtime**，符合“移除 usage surface、保留 runtime”的边界。
- Renderer `usageProviders.ts` 的 Antigravity ring group 仍包含内部 Gemini / Claude+GPT quota group，符合保留 Antigravity 内部 Gemini 配额组。
- 遗留文件 `packages/agents-usage/src/collectors/gemini.ts` 仍在仓库，但未进入 catalog/registry。记为残留，**不作为本轮必须立刻删文件的打开 Finding**。

### Volcengine Ark

- Collector：`packages/agents-usage/src/collectors/volcengine.ts`
- 官方 Action URL：`GetCodingPlanUsage` / `GetAFPUsage`；Ark chat completions 用于 request-limit header。
- 默认 region `cn-beijing`，service `ark`，HMAC-SHA256 V4 signed headers。
- 本轮定向测试用 fake host / 固定签名，**没有**真实凭据打到线上。
- Renderer / IPC：`submitVolcengineCredentials` 走 main `UsageLoginManager`，不把 secret 回传到 Renderer 结果类型。

### Titlebar / 旧入口

- `MainTitlebar.tsx`：`<CliUpdateMenu />` 在 `titlebar-window-controls-spacer` 之前。
- 测试断言 `titlebar-cli-update-button` 与 window-controls spacer。
- `ThreadDraftView.tsx` **不再渲染** `ThreadAgentUpdateDock`；测试明确 `not.toContain("ThreadAgentUpdateDock")`。
- 组件文件 `ThreadAgentUpdateDock.tsx` 仍存在，仅测试引用。结构 smoke 中 `inputUpdateDock: false`。

### 既有质量门（本轮不重判、不升格）

- Grok 真实额度 / F33：继续 BLOCKED（v0.5.7）。
- F29 exact Token：继续 BLOCKED。
- Feature v0.5.0：继续 FAIL / BLOCKED。
- v0.4 F04：继续 FAIL / BLOCKED。

## Spec Fidelity

Manager 要求真实系统浏览器登录一次、loopback 成功、主进程换票、脱敏 IPC、quota refresh 可观察。当前 broker **合同与单测**满足，**真实 Google 授权会话没有**。

独立 Gemini usage provider 已从 catalog 移除，Antigravity 内部 Gemini group 与 Gemini CLI runtime 仍在：符合 spec。

Ark parser / 签名 / plan URL / fail-closed 有单元证据，**没有**真实 HTTP 成功或真实 401/403。

titlebar 位置与输入框旧入口移除：源码 + 单测 + 既有 CDP smoke 一致。

## Integration / Regression / Edge Cases

- OAuth 稳定错误码覆盖 state mismatch / missing code / denied / exchange failed / timeout / cancelled / listener failed。
- refresh 合并按 cacheDir，不是全局一把锁。
- Gemini collector 源文件残留，但生产 registry 不调用。
- CDP smoke 是已保存结构快照；本轮未再启动 Electron 以免把结构绿灯写成 E2E。
- 未把 110 passed 或 cdp-smoke 写成 Feature PASS。

## Findings

### F35 — 真实 Antigravity Google OAuth E2E 未完成（保持打开）

- Evidence：本轮只有 broker 源码与 fixture；无系统浏览器授权 → loopback code → 主进程 exchange → secret store → quota refresh 的真实回环。既有 `cdp-smoke.json` 只证明按钮/工作区结构。
- Impact：不能证明用户点 Antigravity 登录后能拿到可刷新额度。
- Root Cause：缺少安全、可复现的真实 Google 账号授权，不是当前 broker 合同缺失。
- Fix：**不要伪造 PASS**。用户授权真实 Google 账号后，走系统默认浏览器完成一次 login，确认 stored session 与 Antigravity Gemini / Claude+GPT group refresh。证据只记 ok/code、是否 stored、quota window 是否存在；禁止 token / cookie / authorization code。
- Acceptance：一次真实成功登录 + 一次可观察 quota refresh；否则继续 BLOCKED。

### F36 — 真实 Volcengine Ark 线上凭据 smoke 未完成（保持打开）

- Evidence：`volcengine.test.ts` 使用 fake host / 固定签名；本机无真实 API Key 或 AK/SK 打 `open.volcengineapi.com` / Ark chat completions。
- Impact：不能证明 Coding / Agent Plan 或 401/403/429 映射在线上成立。
- Root Cause：环境无可用 Ark 凭据。
- Fix：不要用 fixture 冒充。用户提供最小只读测试凭据后，分别对 API Key 与 AK/SK 做一次 collect；失败也记录稳定 `auth-missing` / `quota-hit` / `unsupported`。
- Acceptance：至少一次真实 HTTP 成功，或一次真实权限类错误；凭据不进仓库、不写进 Debugger 文档。

### 既有打开的继承门（不进入本轮 Fix Execution Order）

- F33 真实 Grok billing / usedPercent：继续 BLOCKED。
- F29 exact Token：继续 BLOCKED。
- Feature v0.5.0：继续 FAIL / BLOCKED。
- v0.4 F04 五 Harness：继续 FAIL / BLOCKED。

工程项（OAuth broker 合同、Gemini usage 移除、Ark parser、titlebar 位置）保持关闭。不要让 Coder 为凑 PASS 重写这些已关闭项。

## Verdict

**FAIL / BLOCKED**

- 关闭：OAuth broker 合同、Gemini 独立 usage 移除、Ark parser/V4/window mapping、titlebar CLI 更新位置、输入框旧入口移除、脱敏 IPC 类型、脱敏 CDP 结构 smoke。
- 打开：F35 真实 Google OAuth E2E；F36 真实 Ark 线上凭据。
- Feature `v0.6.0`：**不能 PASS**，也不能写成 `DEV PASS / USER ACCEPTANCE PENDING`。
- Main promotion：`NOT AUTHORIZED`。
- 禁止 commit / push / tag / merge main。

## Fix Plan

Coder **停止空转**。已关闭工程项不要重做。

1. **F35**：仅在用户明确授权真实 Google 账号时执行一次系统浏览器 Antigravity 登录 + 可观察 quota refresh。证据脱敏。无法授权则保持 BLOCKED。
2. **F36**：仅在用户提供最小 Ark 测试凭据时执行真实 collect。失败也按稳定错误码记录。无凭据则保持 BLOCKED。
3. **不要**用 CDP 结构、unit/fixture 或 Gemini collector 残留文件争论 Feature PASS。
4. **不要**升格 v0.4 F04 / v0.5.0 / F29 / F33。
5. **不要** commit / push / tag / merge main。

## Fix Acceptance Criteria

- F35：真实系统浏览器闭环，IPC 仍只有 ok/code，secret 不进 Renderer。
- F36：真实 Ark HTTP 成功或真实权限错误；禁止把 fake host 测试当线上证据。
- 两项都缺时 Feature 继续 FAIL / BLOCKED。

## Fix Execution Order

1. Coder 停止。
2. 等待用户提供 Google 授权和/或 Ark 只读凭据。
3. 有凭据后再做对应真实探针，通知本 Debugger 复检 F35/F36。

## Requires Manager Re-plan

**No**。产品意图没有变化；阻塞是真实凭据环境，不是 Spec 错误。

## Requires Ideate Revision

**No**。
