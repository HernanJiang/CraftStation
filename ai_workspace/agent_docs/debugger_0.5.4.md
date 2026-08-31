# Debugger — v0.5.4 FAIL / Fix Plan

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + Coder 未提交 v0.5.3 修改）
>
> Verdict：**FAIL**
>
> Lifecycle：`FIX CYCLE v0.5.4`
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> Coder 交付：[coder_0.5.3.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/coder_0.5.3.md)
>
> 上一轮 Fix Plan：[debugger_0.5.3.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.3.md)
>
> 不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。

## Review Scope

独立复检 Coder v0.5.3 对 F25 / F26 / F27 的修复，不以 Coder 自检或 v0.5.2 产品路径探针代替本轮 UI/用量验收。

核对：

- 源码：`SidebarProviderAccounts.tsx`、`AccountUsageGrid.tsx`、`tokenUsageStore.ts`、`usageProviders.ts`、`grokProfiles.ts`、`grokCredentials.ts`、`grokTokenRefresh.ts`、`accountStore.ts`、`supervisorRuntime.refreshAccountQuota`、`tokenUsageAdapter.ts`
- 测试：`SidebarProviderAccounts.test.tsx`、`grokProfiles.test.ts`、`accountStore.test.ts`
- 现场账号库只读 metadata：`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`（未读 token / auth.json 内容）
- 真实连通性：`https://cli-chat-proxy.grok.com/v1/billing?format=credits` 无鉴权 GET 8s abort
- 定向命令独立复跑 + typecheck / oxlint / oxfmt / `git diff --check`

## Evidence

### 独立复跑（craftstation-dev）

- 定向 Vitest：5 files / 69 tests passed（与 Coder 自检数字一致，但只证明接线，不证明真实额度）。
- `pnpm run typecheck`：通过。
- 本轮修改文件 oxlint / type-aware oxlint / `oxfmt --check` / `git diff --check`：通过。
- CodeGraph：Index 存在，Pending Changes Added 1 / Modified 9；未把 `codegraph sync` 当质量门。
- 全仓 `pnpm lint` 未复跑扩大范围；已知预存 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52`。

### F25 — 关闭

- `ModelUsageDialog` 现调用 `resolveDisplayedProviders(providerOrder, [])`，不再把 `usage.disabledProviders` 当作目录过滤器。
- 默认 `DEFAULT_USAGE_DISABLED_PROVIDER_IDS` 仍只启用 claude/codex，但对话框右侧会列出 Gemini / Cursor / Copilot / Kimi / Factory / z.ai / Command Code / OpenAI 兼容账户等内置 catalog。
- 测试 mock 现接收并遵守 `disabledProviders`；生产路径用例在默认禁用 Gemini/Cursor 时仍断言对话框可见这两张卡。
- 已授权 Grok/Codex 卡出现在左栅格后，右侧不再重复同一张紧凑卡。

### F26 — 关闭

- `ManagedAccountPool` 现为 `data-grid-span="2"` / `col-span-2`；左栅格保持 `grid-cols-4`。
- 测试锁定已授权 ChatGPT/Grok 卡 `col-span-2`，禁止回退 `col-span-4`。
- `ProviderCard` 已授权走 `col-span-2`，未授权走 `col-span-1`。

### F27 — 未关闭（用户现场否掉的额度/Token 仍不成立）

接线已接上，真实产品路径仍失败：

1. 打开对话框会 `listAccounts` → 并行 `refreshAccountQuota` + `refreshTokenUsage({ periods: ["today","month","allTime"] })`。
2. 独立 live probe（her `852862f8` / hao `071e94ac`，未打耗尽号 `9802c0ca`/`0025b7ae`）后，账号库 metadata：
   - her/hao 均 `status=unavailable`，`quotaWindows=[]`，`lastErrorKind=network`。
   - 另一 her `e2ed3917` 同样 network / 空窗口。
   - 可用 poi `a38a8ace` 仍 `available` 且 `quotaWindows=[]`，本轮未再打以免扩大消耗。
3. managed `auth.json` 结构只读：her/hao 均有 email / principal / access token / refresh / client_id，**没有 cookie 字段**。token 路径失败后无法落到 cookie 路径。
4. 本机无鉴权 GET `cli-chat-proxy.grok.com/v1/billing?format=credits` 8 秒 `AbortError`。collector 把 fetch throw 一律映射成 `network error`，没有 HTTP status、没有 timeout/abort 分类。
5. UI 错误映射缺口：`ModelUsageDialog` 只在 `refreshed.status === "error"` 时标 `quota: error`。`unavailable` / `auth-expired` / 空 `quotaWindows` 被标成 `success`。`AccountUsageGrid` 仅在 `status === "error"` 时展示 `lastError`，因此 network error 仍画成死 `—`。
6. Token：`refreshTokenUsage` IPC 只是 `runtime.getTokenUsage`。生产 scanner 是 `state.sqlite` 的 `usage_events.kind='tokens_v2'`。现场账本 17 行，全是 `message/thread_started/turn`，`tokens_v2=0`，因此 `byAccount` 永远空，Token 格在 exact 规则下只能是 `—`。
7. `grokProfiles.test.ts` 的 `collectGrok` 仍是 mock，没有真实 collector fixture 断言非空 `quotaWindows` 在 live HTTP 失败时如何表现。
8. scoped host 已覆盖 `refreshOAuthToken` + managed cookie `getSecret`，且 refresh 写回该账号 `GROK_HOME/auth.json`；F09 边界保持：未读 Codex Router oauth，未覆盖 `~/.grok`。这项工程接线关闭，但不能代替真实额度成功/失败可见性。

## Spec Fidelity

- T05 厂商目录：源码与测试现已对齐用户现场否掉点。
- T06 已授权卡两列：源码与测试现已对齐。
- T07 额度/Token：打开即查询的接线存在，但验收要求是 her/hao 不再永久 `—`。当前 live 路径仍把 network/unavailable 画成空白额度，Token 无 exact account breakdown。

## Integration / Regression / Edge Cases

- v0.5.2 产品路径 / sticky / Auto skip / Round-Robin 证据仍有效，本轮不推翻。
- 不要把 F25/F26 工程关闭当成 Feature PASS。
- 不要对耗尽 poi 发会消耗额度的 chat prompt。
- Renderer 仍只消费 AccountView，零 secret。

## Findings

| ID  | 状态   | 说明                                                                                                                            |
| --- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| F25 | 关闭   | 对话框不再用 disabledProviders 隐藏内置目录。                                                                                   |
| F26 | 关闭   | 已授权账号池卡 col-span-2，未授权卡 col-span-1。                                                                                |
| F27 | 未关闭 | 真实额度 HTTP 失败；unavailable 被画成死 `—`；Token 无 exact byAccount。                                                        |
| F28 | 新开   | `collectGrokViaToken` 把 timeout/abort/DNS 一律标成 `network error`，且 `unavailable` 时仍 `updateQuota([])`，UI 当成功空数据。 |
| F29 | 新开   | 官方 Grok session 的 token 用量未写入 `usage_events.tokens_v2` / `account_id`，因此 AccountUsageGrid 的 Token 格无法显示数字。  |

## Verdict

**FAIL**。F25/F26 可关闭。F27 未关闭。进入 Fix Cycle **v0.5.4**。Requires Manager Re-plan: **No**。不进入 v0.5 Feature Closeout。

## Fix Plan

只修 F27 的产品可见性与真实查询分类，不要重开 F25/F26，不要碰 v0.4 F04，不要导入 Codex Router oauth，不要覆盖 `~/.grok`，不要对 `9802c0ca`/`0025b7ae` 发 chat prompt。

### F28 — 额度失败必须可见，禁止把 unavailable 画成死 `—`

1. `ModelUsageDialog` 打开查询后，以下情况都必须标 `quota: "error"` 并带截断后的 `quotaError`：
   - `refreshAccountQuota` throw；
   - 返回账号 `status` 为 `error` / `unavailable` / `auth-expired`；
   - 返回账号没有可用 `quotaWindows` 且存在 `lastError`。
2. 只有 `quotaWindows` 里出现 `usedPercent != null` 的窗口，才标 `quota: "success"`。
3. `AccountUsageGrid`：
   - `loading` → `加载中…`
   - `error` 或账号 `lastError` 且没有百分比 → 显示错误，不得画 `—`
   - 成功百分比仍用 monthly/weekly/session-5h 任一 `usedPercent`
   - 缓存无可靠 cache 来源仍为 `—`
4. `GrokProfileService.collectQuota`：
   - `collectGrok` 失败时保留 `snapshot.error`；
   - 区分 `timeout` / `abort` / HTTP status / auth-missing，不要所有 throw 都写成 `network error`；
   - `unavailable` 且 windows 为空时不要把旧错误清掉（`updateStatus` 在非 error 且未传 lastError 时会 `delete lastError`）。
5. 测试：
   - Renderer：refresh 返回 `status=unavailable` + `lastError` + 空 windows 时，额度格必须出现错误文案，禁止只有 `—`。
   - Supervisor：mock `collectGrok` 为 error/empty windows 时，AccountView 必须保留 lastError。
   - 可增加不读 secret 的连通性探针：记录 timeout/HTTP，不打印 token。

### F29 — Token 格要有 exact account breakdown 或明确失败

1. 确认官方 Grok native session 的真实 token 用量写入 `usage_events` 的 `kind='tokens_v2'`，并带上 immutable `account_id` = managed accountId。
2. 若当前 Grok ACP 路径还没有 tokens_v2 事件：补 runtime ledger 投影，或让 `refreshTokenUsage` 对 managed Grok 账号走已有精确来源；禁止把 provider 全局 summary 套到每个账号。
3. `AccountUsageGrid` 继续只接受 `byAccount.key === account.accountId` 且 `quality !== "estimated"` 的数字。
4. 打开对话框后：
   - 有 exact 数字 → 显示 compact token；
   - scanner unavailable / 无该 accountId → 显示错误或「暂无精确用量」，不要先标 token success 再画死 `—`。
5. 测试锁定：`refreshTokenUsage` 返回 summaries.unavailableReason 且 byAccount 为空时，Token 格不是空白成功。
6. 不要为了让格子有数字去读 Codex Router、cookie 或伪造 estimated 数据。

### 保持关闭 / 不要回退

- F25 目录过滤、F26 col-span-2。
- F09：不导入 Router oauth，不接 CLIProxyAPI，不覆盖宿主 `~/.grok`。
- v0.4 F04 仍 FAIL/BLOCKED。
- 未授权 commit/tag/push。

## Fix Acceptance Criteria

- 打开「模型与用量」：右侧仍是完整默认厂商目录（F25 保持）。
- 已授权 Grok 卡仍占两列（F26 保持）。
- 打开对话框后 her/hao 额度格不再是永久死 `—`：要么百分比，要么 `加载中…`，要么可见错误（timeout/HTTP/auth），不得把 unavailable 画成空白成功。
- Token 格：有 exact accountId 显示数字；没有 exact 数据时显示失败/暂无精确用量，而不是假装查询成功后的 `—`。
- 缓存格无可靠 cache 仍为 `—`。
- 定向测试覆盖 F28/F29；独立复跑 typecheck 与本轮文件 lint/format。
- 若官方 billing HTTP 本机持续超时：必须把该超时作为可见错误落地，并在 Debugger 文档记录 BLOCKED 原因；不得标 Feature PASS。

## Fix Execution Order

1. F28 UI 错误映射 + collectQuota lastError 保留。
2. F28 collector 错误分类（timeout/HTTP）。
3. F29 runtime ledger / exact byAccount。
4. 回归：SidebarProviderAccounts / grokProfiles / accountStore / tokenUsageAdapter。
5. 只对 her/hao 做不消耗聊天额度的 quota HTTP；不要打耗尽 poi。
