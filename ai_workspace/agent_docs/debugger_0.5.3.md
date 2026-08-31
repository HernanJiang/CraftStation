# Debugger — v0.5.3 FAIL / Fix Plan

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` 之后的用户现场复检）
>
> Verdict：**FAIL**
>
> Lifecycle：`FIX CYCLE v0.5.3`
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 上一轮 v0.5.2 的产品路径 / sticky / Auto skip 证据仍然有效，但用户现场 Smoke 否掉了 T05/T06/T07 的展示与查询门禁。不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。

## Review Scope

用户现场截图 + 独立源码复核，不以 v0.5.2 DEV PASS 代替 UI/用量验收。

核对：

- Manager T05 / T06 / T07：左侧 4 列已认证、右侧 1 列未认证；已授权卡占两列；Account Row 2×2 额度/Token
- 用户明确约束：厂商卡片默认每排 4 列；登录成功后该厂商卡片占两列；不得把已授权卡拉成四列；默认厂商目录不得被藏掉
- 源码：`SidebarProviderAccounts.tsx`、`AccountUsageGrid.tsx`、`usageProviders.ts`、`settings.ts`、`grokProfiles.ts`、`supervisorRuntime.refreshAccountQuota`、`tokenUsageStore`
- 现场账号库只读 metadata：`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`（未读 token / auth.json）
- 测试：`SidebarProviderAccounts.test.tsx` 把 `resolveDisplayedProviders` mock 成忽略 `disabledProviders`

## Evidence

### 用户现场（2026-08-28）

- 「模型与用量」左侧被 **Grok 账号池** 占满整行（`col-span-4`）。
- 右侧只剩 ChatGPT / OpenAI-compatible / Claude 三张未认证卡。Cursor、Copilot、Gemini、Kimi、Factory、z.ai、Command Code 等默认厂商消失。
- 每个 Grok 账号 2×2 格的「额度」「Token」「缓存」全部是 `—`。
- 账号状态有 `available` / `quota-exhausted`，但没有成功查询到官方 quota window 或 token 用量。

### 现场账号库 metadata（只读）

6 个 Grok 账号均 `quotaWindows` 为空或 `[]`。其中一个 `her` 的 `lastError` 为 `grok billing check failed (network error)`，但 UI 额度格不展示该错误。hao / 另一 her / 可用 poi 从未成功 collectQuota。

### 源码对照

1. `ManagedAccountPool` 写死 `col-span-4`，测试还锁定 `accountPoolCard.toHaveClass("col-span-4")`。v0.4.12 已授权卡是 `col-span-2`。
2. `ModelUsageDialog` 用 `resolveDisplayedProviders(providerOrder, disabledProviders)` 过滤右侧目录。默认 `DEFAULT_USAGE_ENABLED_PROVIDER_IDS = ["claude", "codex"]`，其余全部进 `disabledProviders`。Grok 有号后被抽到左侧满宽池，右侧只剩默认启用的 Claude + ChatGPT + 写死的 OpenAI-compatible。
3. 对话框 `useEffect` 只 `listAccounts`，**不** `refreshAccountQuota`、**不** `getTokenUsage`。`AccountUsageGrid` 读 `account.quotaWindows` 和 `useTokenUsageStore`；store 只在 supervisor 发出 `token-usage` 时填充，对话框从不请求。
4. `GrokProfileService.collectQuota` 把 scoped host 的 `getSecret` 固定成 `undefined`，也没有 `refreshOAuthToken`。`collectGrok` token 路径网络失败会变成 windowless error snapshot；UI 仍画 `—`。
5. `SidebarProviderAccounts.test.tsx` mock 的 `resolveDisplayedProviders` **丢掉第二个参数**，测试里 Gemini 永远可见，生产环境会被 `disabledProviders` 藏掉。这是假阴性。

## Findings

### F25 — 默认厂商目录被 disabledProviders 吞掉

- 严重程度：P0
- 规格：T05「右侧 1 列未认证 Provider」+ 用户「原来右侧有那么多默认厂商」
- 现状：生产默认只启用 Claude/Codex；Grok 有账号后不再出现在右侧紧凑卡；Cursor/Copilot/Gemini/Kimi 等从对话框消失
- 测试缺口：mock 忽略 `disabledProviders`

### F26 — 已授权厂商卡占四列，而不是两列

- 严重程度：P0
- 规格：用户反复确认「厂商卡片默认每排 4 列；登录成功以后的那个卡片每排两列」；`ProviderCard` 已有 `connected ? col-span-2 : col-span-1`
- 现状：`ManagedAccountPool` `col-span-4` 把整个左栅格吃掉，未授权厂商全部挤到右 1 列
- 正确布局：
  - 左 4 列栅格：已授权厂商卡各占 **两列**（一行两张）；账号行/2×2 用量放在这张两列卡内部
  - 右 1 列：其余未认证默认厂商，每张一列
  - 未授权厂商卡继续 `col-span-1`，一行四张（若仍在左栅格）或在右列纵向堆叠

### F27 — 打开对话框不会查询额度/Token；失败被画成 —

- 严重程度：P0
- 规格：T06 2×2 额度/Token；T07 account-scoped quota；用户「根本没有成功查询额度和token」
- 现状：
  - 打开对话框只 listAccounts
  - Token store 从未被对话框填充
  - quotaWindows 为空时永远 `—`，lastError 不可见
  - collectQuota 的 scoped host 缺 cookie / refresh 缝，网络失败无法落 window
- 缓存格无可靠数据时继续显示 `—` 合法；额度/Token 在账号已授权且查询未完成/失败时不得假装「没有数据」。

## Fix Plan

交给 Coder 一次性连续修复 F25 → F26 → F27。不要碰 CLIProxyAPI、不要导入 Codex Router oauth、不要覆盖 `~/.grok`、不要升格 v0.4 F04。

### F25 — 恢复默认厂商目录

1. 「模型与用量」对话框的厂商目录不得用 `usage.disabledProviders` 把内置厂商藏掉。设置页的启用/禁用可以继续管侧栏圆环，但本对话框必须展示完整内置 catalog（Claude / ChatGPT / Gemini / Grok / Cursor / Copilot / Kimi / Factory / z.ai / Command Code / OpenAI-compatible 等现有 `USAGE_PROVIDERS`）。
2. 已有 managed 账号的 provider 出现在左侧已授权区后，右侧不再重复同一张紧凑卡。
3. 改测试：`resolveDisplayedProviders` mock 必须传入并遵守真实 `disabledProviders` 行为；另加生产路径用例，默认 settings 下对话框仍能看到 Gemini/Cursor 等内置卡。

### F26 — 已授权卡 col-span-2，未授权卡 col-span-1

1. 删除 `ManagedAccountPool` 的 `col-span-4`。Grok/Codex 账号池必须作为该 provider 的已授权卡，`data-grid-span="2"` + `col-span-2`。
2. 左栅格保持 `grid-cols-4`。一行最多两张已授权卡。
3. 右栅格保持 `grid-cols-1`，只放未认证默认厂商。
4. 改测试：禁止 `col-span-4`；锁定已授权 Grok 卡 `col-span-2`，未授权 ChatGPT 卡 `col-span-1`。

### F27 — 真查额度与 Token

1. 对话框打开后，对当前可见 managed 账号并行 `refreshAccountQuota`；并对已授权账号调用 `getTokenUsage` / `refreshTokenUsage`，把结果写入 `tokenUsageStore`。
2. `AccountUsageGrid`：
   - 查询中显示加载态，不得先画死 `—` 当作成功空数据
   - 查询失败显示简短 lastError（可截断），不要把 network error 画成空白额度
   - 查询成功后额度用 `quotaWindows`（Grok 的 monthly/weekly 均可）；Token 用非 estimated 的 per-account 汇总
   - 缓存格无可靠 cache 来源时仍为 `—`
3. `GrokProfileService.collectQuota`：scoped host 必须提供 `refreshOAuthToken`（只写回该账号 managed `GROK_HOME/auth.json`）；若 managed auth 含 session cookie 则 `getSecret("grok","cookie")` 返回它。禁止读 Codex Router 目录，禁止覆盖 `~/.grok`。
4. 成功路径必须把 `snapshot.windows` 写入 `quotaWindows`。独立测试用真实 collector fixture/mock 断言 window 非空；Renderer 测试断言打开对话框会调用 refresh/getTokenUsage。
5. 不要对已知耗尽 poi 账号发会消耗额度的 chat prompt。quota HTTP 查询可以打可用号 her/hao。

## Fix Acceptance Criteria

- 打开「模型与用量」：右侧（或未认证列）重新出现完整默认厂商目录，不只 ChatGPT/Claude/OpenAI-compatible。
- 有 Grok 已授权账号时，Grok 卡在左 4 列栅格里占两列，不是四列。
- 未授权厂商卡仍是一列宽。
- 打开对话框后，her/hao 的额度格不再是永久 `—`：成功显示百分比，失败显示错误，查询中显示加载。
- Token 格在 getTokenUsage 返回该 accountId 后显示数字；无 exact 数据才是 `—`。
- 定向测试覆盖 F25/F26/F27；禁止再 mock 掉 `disabledProviders` 造成假绿。
- `pnpm typecheck` 通过；相关 lint 通过。不 commit/tag/push。

## Fix Execution Order

1. F25 厂商目录
2. F26 col-span-2 布局
3. F27 打开即查询 + collectQuota seam + UI 失败态
4. 改测试去假阴性
5. 交 Debugger Re-review

## Non-blocking notes

- v0.5.2 双账号产品路径证据可保留，不需要重跑耗尽号 chat。
- live `quotaWindows` 为空不再是「合法 —」，那是本轮 FAIL 的证据。
