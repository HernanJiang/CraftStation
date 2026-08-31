# Debugger — v0.5.4 Re-review

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506ea01fc04029a10a711ebb0a65d7248e06` + Coder 未提交 v0.5.3/v0.5.4 修改）
>
> Verdict：**FAIL / BLOCKED**
>
> Lifecycle：`FIX CYCLE v0.5.4` 工程项已复检；Feature 不得 PASS
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> Coder 交付：[coder_0.5.4.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/coder_0.5.4.md)
>
> Fix Plan：[debugger_0.5.4.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.4.md)
>
> 不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。本轮不授权 commit / push。

## Review Scope

独立复检 Coder v0.5.4 对 F28 / F29 的修复，不以 Coder 自检、191 个测试或 v0.5.2 产品路径探针代替本轮额度/Token 验收。

核对：

- 源码：`AccountUsageGrid.tsx`、`SidebarProviderAccounts.tsx`、`tokenUsageStore.ts`、`grokProfiles.ts`、`usageHttpClient.ts`、`grokCredentials.ts`、`accountStore.ts`、ACP `session.ts` / `sessionErrors.ts` / `sessionFactory.ts`、`usageLedger.ts`、`tokenUsageAdapter.ts`
- 测试：`SidebarProviderAccounts.test.tsx`、`grokProfiles.test.ts`、`session.test.ts`、`usageLedger.test.ts`
- 现场账号库只读 metadata：`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`（未读 token / auth.json / cookie）
- 现场账本只读 metadata：`C:\Users\Haona\.craftstation-dev\state.sqlite`
- 定向命令独立复跑 + typecheck / oxlint / oxfmt / `git diff --check`

## Evidence

### 独立复跑（craftstation-dev）

- 定向 Vitest：7 files / **191 passed / 9 skipped**（`usageLedger.test.ts` 因当前环境无 native SQLite binding 被 skip，与 Coder 自检数字一致，只证明接线，不证明真实额度）。
- `pnpm run typecheck`：通过。
- 本轮触及文件 type-aware oxlint、`oxfmt --check`、`git diff --check`：通过。
- CodeGraph：Index 存在（2,902 files / 40,568 nodes / 152,457 edges）；Pending Changes Modified 17；未把 `codegraph sync` 当质量门。
- 全仓 `pnpm lint` 未扩大复跑；已知预存 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` `vitest(no-conditional-expect)`。
- Git：HEAD 仍为 `7ae6506`；Coder 修改未 commit / tag / push。`git diff --stat` 18 files，+1058 / -97（含 v0.5.3 + v0.5.4）。

### 现场账号 / 账本（只读 metadata）

`accounts.json` version 2，6 个 Grok 账号：

- `grok:852862f…` / `grok:071e94a…` / `grok:e2ed391…`：`status=unavailable`，`quotaWindows=[]`，`lastError=grok billing check failed (network error)`
- `grok:0025b7a…` / `grok:9802c0c…`：`quota-exhausted`（本轮未再打这些号）
- `grok:a38a8ac…`：`available`，无 `lastQuotaAt` / 无 windows

`state.sqlite`：`usage_events` 共 17 行（message 8 / thread_started 7 / turn 2），**`tokens_v2=0`**。没有 exact accountId token 行。

Coder 本轮明确没有重复消耗额度的 chat probe，也没有宣称真实 billing 恢复。本 Debugger 复用既有 network/unavailable 证据，不把工程测试写成额度查询成功。

### F25 / F26 — 保持关闭

- `ModelUsageDialog` 仍调用 `resolveDisplayedProviders(providerOrder, [])`，不用 `usage.disabledProviders` 隐藏完整内置目录。
- 已授权 Grok 池 `ManagedAccountPool` 仍是 `data-grid-span=2` / `col-span-2`；未授权卡 `col-span-1`。

### F28 — 工程项关闭，真实 billing 仍 BLOCKED

源码与测试成立：

- `AccountUsageGrid` 只有有效 `usedPercent` 才渲染成功百分比。
- `unavailable` / `auth-expired` / `error` / 空窗口 + `lastError` 走可见错误或加载中，不再把失败画成无上下文的死 `—`。
- Dialog 打开后 `refreshAccountQuota` throw、status 失败、空窗口都会把 `quota` 标成 `error`。
- `usageHttpClient` 在 abort timer 上抛 `UsageHttpError(timeout)`。
- `GrokProfileService.collectQuota` 用 HTTP observer 区分 timeout / abort / HTTP status / auth-missing / network，并把分类后的 `lastError` 写入 AccountStore。
- `updateStatus` 在非 error 且未显式给 `lastError` 时才会删除旧错误；`unavailable` + 空 windows 路径会保留 `lastError`。
- Renderer 测试锁点：`shows an unavailable quota response instead of a successful dash`、`shows quota and token refresh failures in the account grid`。
- Supervisor 测试锁点：timeout / HTTP / auth-missing 分类与 `lastError` 保留。

当前 live her/hao 仍是 `unavailable/network`、空 windows。按本轮 UI，额度格应显示 `lastError`（timeout/HTTP/network 文案），而不是死 `—`。**这关闭 F28 的产品可见性缺陷，但不等于额度查询成功。**

残余风险（不单独升格为新的强制 Fix Cycle）：若账号同时带有旧 `usedPercent` 且本次查询失败，`AccountUsageGrid` 仍优先画百分比。现场 6 个账号目前 windows 均为空，所以当前用户路径不会踩中。

### F29 — 工程接线关闭，真实 Token 证据未关闭

生产链路源码成立：

`SupervisorRuntime.craftAgent -> accountBinding -> StructuredNativeHarnessRuntimeAdapter -> createAcpStructuredSession(usageAccountId) -> resolveAcpPromptResponseUsage(PromptResponse.usage || 顶层 _meta) -> usage.spent.accountId -> usageLedger tokens_v2.account_id`

- ACP 优先标准 `usage`，缺失时只读取官方 Grok 已观察的顶层 `_meta` 数值字段；非数值不造 estimated。
- 同一 normalized payload 同时投影 `context.updated` 与 `usage.spent`。
- Renderer 只接受 `byAccount.key === account.accountId` 且非 estimated 的数字；无 exact breakdown 显示「暂无精确用量」或可见失败，不把 provider 全局 summary 套到账号。
- 缓存格无可靠 cache 仍为 `—`。
- 测试锁点：ACP `_meta` 计数 + `accountId`、ledger `account_id` 持久化、Renderer「无 exact breakdown 不假装成功」。

但现场 `tokens_v2=0`。没有本轮真实 Grok turn 把 exact account token 写进账本。**工程接线关闭 ≠ 产品 Token 格有数字。**

## Spec Fidelity

- T05/T06 展示回归（完整厂商目录、已授权卡两列）保持。
- T07 额度：失败可见性已补上；真实 billing HTTP 仍 unavailable/network。
- T08 Token：exact accountId 投影已接到 ACP/_meta 与 ledger；现场仍无 `tokens_v2` 行。
- Official/Native Runtime First、Renderer 零 secret、不导入 Codex Router oauth、不接 CLIProxyAPI、不覆盖 `~/.grok`：本轮 diff 未破坏。

## Integration / Regression / Edge Cases

- F08/F12/F13 Grok 登录隔离与 F25/F26 布局未回退。
- v0.5.2 产品路径 / sticky / Auto skip / Round-Robin 证据仍有效；本轮未再打耗尽号 `9802c0ca…`、`0025b7ae…`。
- v0.4 F04 五 Harness 真实产品级 response 继续 FAIL/BLOCKED。
- 全仓 lint 仍被预存 Codex overlay 测试阻断，不作为本轮 F28/F29 回归失败。

## Findings

1. **F28 工程关闭，真实 Grok billing 仍 BLOCKED。** her/hao live quota 继续 `unavailable` + `grok billing check failed (network error)`。191 tests 不是额度查询成功。
2. **F29 工程关闭，真实 exact Token 仍缺失。** `usage_events.tokens_v2=0`。打开「模型与用量」后 Token 格最多到「暂无精确用量」或失败文案，不能宣称 per-account token 已验收。
3. **残余：失败查询若留下旧 usedPercent，额度格仍可能画百分比。** 当前 live windows 为空，不作为新的强制 Coder 工单。
4. **v0.4 F04 仍 FAIL/BLOCKED**，不得升格，不得进入正式 v0.5.0 tag / merge main。

## Verdict

`FAIL / BLOCKED`

- F25 / F26 / F28 工程项：**关闭**
- F29 工程接线：**关闭**；真实 Token 证据：**未关闭**
- Feature v0.5.0：**不能 PASS**
- 下一动作：不启动 v0.5.5 代码 Fix Cycle。等待可连通的官方 Grok billing 与一次真实 managed turn 后再做产品级额度/Token 复检。Coder 未授权 commit。Debugger 未 PASS，不得 closeout / push / merge main。

## 用户最短核对（不是 Feature PASS）

Debugger 已在 `D:\Work\CraftStation\craftstation-dev` 自行确认并操作现有 `pnpm dev` 窗口（`CraftStation (dev)`），不需要用户先启动服务。

请直接看已经打开的「模型与用量」：

1. 右侧仍应看到 Gemini / Cursor / Claude / Kimi Code 等默认厂商（F25）
2. 已授权 Grok 卡占两列（F26）
3. her/hao 额度格应是可见错误（本次为 `Grok quota request failed (network): grok billing check failed (network error)`），不能是死 `—`
4. Token 格应为「暂无精确用量」或失败文案（本次为 `Runtime ledger has no exact telemetry.`），不能假装查询成功后的 `—`
5. 缓存格无可靠 cache 仍可为 `—`
6. 不要打已耗尽 poi

## Live UI Evidence — 2026-08-28 Debugger Computer Use

- 工作树：`D:\Work\CraftStation\craftstation-dev`，HEAD `7ae6506`，v0.5.3+v0.5.4 未提交 dirty。
- `pnpm dev` 已在跑：concurrently/vite/electronmon；窗口标题 `CraftStation (dev)`。
- Debugger 关闭欢迎页后点击侧栏「厂商账户」，打开对话框「模型与用量」。
- F25 右侧完整目录可见：Kimi Code、ChatGPT、Claude、GitHub Copilot、Cursor、Gemini、Command Code、Droid、z.ai、Alibaba Token Plan、Antigravity、OpenCode。
- F26 源码仍是已授权卡 `data-grid-span=2` / `col-span-2`；现场已授权 Grok 卡为两列宽。
- 打开瞬间额度格为「加载中…」；约 4s 后 6 张 Grok 卡全部变为可见 network 错误：`Grok quota request failed (network): grok billing check failed (network error)`。这关闭 F28 的死 `—` 可见性缺陷，不等于 billing 查询成功。
- Token 格：`Runtime ledger has no exact telemetry.`；缓存格：`—`；状态：`unavailable`。
- 现场账号行：her / poi / poi / hao / poi / her。未点击耗尽号，未发起新 chat probe。
- Verdict 不变：`FAIL / BLOCKED`。不启动 v0.5.5 代码 Fix Cycle，不 commit / tag / push / merge main。
