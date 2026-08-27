# Debugger — v0.5.0 Account Pool + Quota + Token Usage Stabilization

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `be8d8c2`，工作区未提交）
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 未 commit / tag / push。未宣称 Feature PASS。未进入 v0.4 五 Harness PASS。不得 merge main。

## Review Scope

独立 Feature Review，不以 Coder 自检代替质量门。核对：

- Manager Part I / Part II：`ai_workspace/agent_docs/manager_0.5.0.md`
- Tickets：`.scratch/craftstation-0.5.0/issues/01-…10`
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.0.md`
- 未提交 diff vs `be8d8c2`
- 源码：AccountStore / AccountResolver / SupervisorRuntime / threadLaunchActions / SidebarProviderAccounts / AccountUsageGrid / tokenUsageAdapter / grokProfiles
- 独立测试、typecheck、lint、CodeGraph
- 现场账号库（只读 metadata，不读 token）
- Coder host probe 与 Debugger 双 managed GROK_HOME 官方 ACP probe

不在范围内：CLIProxyAPI、导入 Codex Router oauth、覆盖 `~/.grok`、v0.4 五 Harness 升格。

## Evidence

### Git / 工作树

- Product Git Root：`craftstation/` / `craftstation-dev/`
- 验收目录：`D:\Work\CraftStation\craftstation-dev`
- 分支：`dev` tracking `origin/dev`
- HEAD：`be8d8c2cf3634c39b7a343a813f894b4d21e7d3f`（`docs(v0.5): plan: account pool quota and token usage`）
- 工作区未提交：20 个已跟踪文件 + 未跟踪 `coder_0.5.0.md`、`AccountUsageGrid.tsx`、`ai_workspace/validation/`
- main 保持 `b1af0e2`；未在 main 验收

### 独立测试（Debugger 复跑，不是 Coder 自检）

Coder 文档写「相关 7 个测试文件 122 passed」，同时又出现 122/145 口径，不一致。Debugger 独立复跑实际相关文件：

| 文件                                             | 结果                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| accountStore.test.ts + accountResolver.test.ts   | 2 files / **22 passed**                                             |
| grokProfiles.test.ts + tokenUsageAdapter.test.ts | 2 files / **17 passed**                                             |
| SidebarProviderAccounts.test.tsx                 | 1 file / **15 passed**                                              |
| runtime.test.ts                                  | 1 file / **64 passed**（含 Grok control plane 9 + profile login 6） |
| **合计**                                         | **6 files / 118 passed**                                            |

- 无 AccountUsageGrid.test.tsx
- `pnpm typecheck`：**失败**（本轮引入，见 Finding F05）
- `pnpm lint`：仅预存 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` vitest(no-conditional-expect)；`git show HEAD` 确认非本轮改动
- `git diff --check`：无 whitespace error（仅 CRLF 提示）
- CodeGraph：验收前 pending 1 added / 19 modified；已 `codegraph sync`，Synced 22 changed files

绿测只证明 resolver/store 单测级契约，不能替代产品路径与双账号 E2E。

### 现场账号库（只读）

路径：`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`

- 仍是 **version 1**，没有 pools
- **6 个 Grok 账号**，每个 managed profile 都有 `auth.json` + `environment.json`，**不是空壳**
- Coder 文档「本机仅 1 个官方 Grok host 身份、managed profiles 为空壳」**与现场不符**

脱敏清单（不打印 token）：

| label | id tail    | mask      | selected | order |
| ----- | ---------- | --------- | -------- | ----- |
| her   | `0b52ed32` | her***g01 | false    | 0     |
| poi   | `8eaff924` | poi***son | false    | 1     |
| poi   | `1890b433` | poi***nan | **true** | 2     |
| hao   | `d4707c9b` | hao***ise | false    | 3     |
| poi   | `b0e5d69e` | poi***nan | false    | 4     |
| her   | `24e67aba` | her***g01 | false    | 5     |

另有多个 `grok-pending-New-Grok-*` 残留目录。两个 her 行共用同一邮箱。

### 真实 probe

1. **Coder T10** `ai_workspace/validation/v0.5.0-grok-real-probe.json`
   `ok=true`，`hostIdentity="host ~/.grok"`，`authMethods.cached_token from ~/.grok/auth.json`，`grok-4.6`，`stopReason=end_turn`，tokens ~18207，`assistantTextLength=0`。
   这是 **host 单账号官方 ACP**，不是 managed A/B，也不是产品 `craftAgent` 路径。

2. **Debugger 独立 managed probe**（官方 `grok 1.0.5`，`GROK_HOME=<managed profile>`，未覆盖 host `~/.grok`）：
   - A `profile-8ba0b87e…`（her***g01）：`v0.5.0-debugger-managed-grok-A.json`，`ok=true`，`hostIdentity=managed`，`end_turn`，tokens 18774；该 profile 的 `sessions/` 于 03:36:33 更新
   - B `profile-911f0d5f…`（hao***ise）：`v0.5.0-debugger-managed-grok-B.json`，`ok=true`，`hostIdentity=managed`，`end_turn`，tokens 16025；该 profile 的 `sessions/` 于 03:38:09 更新
   - host `~/.grok/sessions` 仍停在 03:14:50（Coder host probe 时间），本轮 managed probe **没有写回 host home**
   - 协议 `authMethods` 文案仍写 `Cached token from ~/.grok/auth.json`，这是官方 CLI 描述字符串，不能单独当泄漏证据；隔离证据是 session 目录写在对应 managed home
   - `assistantTextLength=0`，且 **未走产品 craftAgent / sticky / Priority / RR / explicit**

结论：现场有多个可用 managed Grok identity；阻塞不是「没有第二个身份」，而是 **没有用两个 managed profile 跑产品路径 E2E**。

## Spec Fidelity

| Acceptance Intent                                       | 状态                                        | 证据                                                                            |
| ------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| AccountFile v1→v2 + pools                               | 工程落地，**live store 未迁移**             | 代码 writeUnlocked 写 v2；现场 accounts.json 仍 v1 / 无 pools                   |
| 去掉 selected / 「设为首选」                            | **未完成**                                  | UI 仍有「设为首选」「首选账号与自动回退顺序」；点击行仍 selectAccount           |
| Pool scheduling priority/RR/random                      | 后端+IPC 有，**无 UI**                      | setAccountPoolScheduling 未在 renderer 出现                                     |
| explicit 不 silent fallback                             | 单测通过，**产品新 Session 不传 accountId** | threadLaunchActions.ts 只传 craftPlan/projectLocation/prompt                    |
| Session sticky                                          | 单测通过；resume 传 binding                 | 新 Session 无法从 UI 建立 explicit binding                                      |
| T05 左 4 / 右 1                                         | **未做**                                    | grid-cols-4 + 已登录 col-span-2                                                 |
| T06 identity 主 / alias 副 + 2×2                        | 部分；**2×2 名不副实**                      | AccountUsageGrid 为 grid-cols-4 一行四格；quota/token 用 provider 全局 snapshot |
| T07 provider-aware quota                                | 工程落地                                    | refreshAccountQuota 按 provider 走 collectGrok                                  |
| T08 Tokscale capabilities                               | 工程落地                                    | inspectCapabilities()                                                           |
| T09 ACCOUNT_LOCKED + refresh lock                       | 部分                                        | 绑定集合只在 removeAccount 删除，会话结束不释放                                 |
| T10 双真实 Grok official E2E                            | **FAIL**                                    | 缺产品路径；Coder 空壳说法不成立                                                |
| Renderer 零 secret                                      | 测试级通过                                  | AccountView 负向测试；现场审查未读 token                                        |
| 不接 CLIProxyAPI / 不导入 Router oauth / 不覆盖 ~/.grok | 遵守                                        | 源码与 probe 均未违反                                                           |

## Integration / Regression / Edge Cases

- craftAgentPayloadSchema 已支持 accountId + accountMode；Renderer 新 Session 未接线。createCraftingAdapter 因此 accountMode=auto。点账号行不能决定下一 Session 的 explicit override。
- handleProviderDrop 把 codex/grok 从展示顺序里剔除，注释写 presentation-only；但 4/1 布局本身没做。
- AccountUsageGrid 用 useProviderUsage(account.provider) 把同一 provider snapshot 套到每个账号。Token byAccount 为空时 return true，全局 summary 会显示在每一行。
- 默认 alias：AccountStore.add() 会把 placeholder 写成 Provider Account N；GrokProfileService.importAuthJson 仍先传 New Grok，依赖 store rewrite。现场 6 个账号仍是 her/poi/hao 三字母，没有迁到 Grok Account N。
- activeAccountBindings：craftAgent/resumeCraftAgent add，只有 removeAccount delete。Session 结束后再删号会误报 ACCOUNT_LOCKED。
- Round-robin cursor 会写入 v2 pools；live 文件还是 v1，产品首次成功 read() 才会迁移。不能把未发生的迁移当已验收。
- v0.4 F04 五 Harness 仍 BLOCKED，本轮不升格。

## Findings

### F01 — 新 Session 不传账号，产品仍是 preferred/selected

- 文件：`src/renderer/actions/threadLaunchActions.ts` ~614；`SidebarProviderAccounts.tsx` selectAccount / 「首选账号与自动回退顺序」/ 「设为首选」
- 严重度：P0（直接打 Acceptance Intent 5/6/7）
- 说明：IPC 能传 accountId/accountMode，启动路径没用。点击账号行只改 store selected，新对话仍 auto。这会让用户以为「点了哪个号就用哪个号」，后端却按 pool auto 选。

### F02 — T05 4/1 布局未实现

- 文件：`SidebarProviderAccounts.tsx` ModelUsageDialog `grid grid-cols-4`；已登录池 `col-span-2`
- 严重度：P1
- 说明：Ticket 要求已认证 Pool 左 4 列、未认证 Provider 右 1 列滚动区。当前仍是全宽 4 列网格 + 已登录卡跨两列。

### F03 — T06 2×2 与 per-account 用量未落地

- 文件：`AccountUsageGrid.tsx`
- 严重度：P1
- 说明：组件是一行四格 grid-cols-4（额度/Token/缓存/状态），不是 2×2。Quota 读 provider 级 snapshot。无 byAccount 时把全局 token summary 套到每个账号。cache 无可靠数据显示 — 这一条成立。

### F04 — T10 产品路径双账号 E2E 缺失；Coder「空壳」不成立

- 严重度：P0（Feature 硬门）
- 说明：现场 6 个 managed Grok profile 均有 auth。Coder host ~/.grok probe 不能替代。Debugger 已用两个 managed GROK_HOME 跑通官方 ACP end_turn，但这仍不是 craftAgent + Priority/RR/explicit/sticky。不得 PASS。

### F05 — pnpm typecheck 本轮失败

- 文件：`SidebarProviderAccounts.test.tsx:180` 与 `:281`
- 严重度：P1
- 说明：closest('[data-testid=...]') 得到 Element，within() 需要 HTMLElement。Coder 自检写 typecheck 通过，与独立复跑不符。

### F06 — live AccountStore 仍是 v1，pools 未出现

- 严重度：P1
- 说明：新代码的 v1→v2 迁移没有对现场文件执行过。调度 cursor / mode 持久化无法在当前用户数据上验证。

### F07 — 调度模式无 UI

- 严重度：P1
- 说明：Supervisor/IPC 有 setAccountPoolScheduling / getAccountPoolScheduling，renderer 搜不到调用。用户无法改 Priority/RR/Random。

### F08 — activeAccountBindings 会话结束不释放

- 文件：`supervisorRuntime.ts`
- 严重度：P1
- 说明：只在 removeAccount 里 delete。活 Session 结束后集合仍持有 id，后续删除会被 ACCOUNT_LOCKED 挡住。

### F09 — v0.4 F04 仍 BLOCKED

- 不在本 Fix 范围宣称完成。不得把 Grok ACP probe 写成五 Harness PASS。

## Verdict

**FAIL / BLOCKED**

工程层有可复用的 store/resolver/IPC/quota 路由，但 Manager Acceptance Intent 的硬门未满足：

1. 产品新 Session 仍不传 explicit/auto 账号选择。
2. 4/1 布局与 2×2 per-account 用量未按票实现。
3. 双真实 Grok 的 **产品路径** official E2E 不存在。
4. typecheck 本轮失败。
5. Coder 对「managed 空壳 / 只有 1 个身份」的陈述与现场 6 账号矛盾。

不得 Feature PASS，不得 Closeout，不得 merge main，不得打 `v0.5.0` tag。

## Fix Plan

范围只修本轮 Findings。连续执行，完成后通知 Debugger 复检。不要 commit/tag/push。不要复活 CLIProxyAPI / Router oauth / 覆盖 ~/.grok。不要用 fixture 冒充双账号 E2E。

### F10 — 产品启动路径接上 explicit / auto（对应 F01）

- 新 Session 从 UI 决定 accountMode + 可选 accountId，传入 bridge.craftAgent
- 账号行点击 = 下一新 Session 的 **explicit override**，或提供明确的 Auto / 指定账号控件；禁止再把 selectAccount 当「首选」
- 删除「设为首选」「首选账号与自动回退顺序」文案
- 已运行 Session 保持 sticky，不因点击另一行而换号
- 测试：Renderer launch 断言 payload 含 accountId/accountMode；explicit 耗尽不 fallback

### F11 — T05 4/1 布局（对应 F02）

- 已认证 Pool：左侧最多 4 列
- 未认证 Provider：右侧 1 列滚动区
- Provider DnD 只改 providerOrder，不改 runtime 选号
- 测试锁定左右分区，而不是 col-span-2 冒充 4/1

### F12 — 真正的 2×2 + per-account 用量（对应 F03）

- Account Row 用量区改为 2×2（额度 / Token / 缓存 / 状态）
- Quota、Token 必须按 accountId 取数；没有 per-account 数据就显示 —，禁止套 provider 全局 snapshot
- 新账号默认 alias `<Provider> Account N`；现场三字母用户改名可保留
- 无可靠 cache 继续显示 —

### F13 — 双 managed profile 产品路径 E2E（对应 F04）

- **不要再写 managed 空壳。** 使用现有至少两个不同身份的 managed GROK_HOME（例如 her***g01 与 hao***ise，或两个不同 poi principal）
- 必须走产品 adapter：craftAgent + managed GROK_HOME 注入，而不是 host ~/.grok 脚本
- 最低证据（脱敏 JSON，不写 token）：
  1. Auto/priority：新 Session 绑 order 中第一个 usable，进程 GROK_HOME 指向该 profile
  2. Explicit A：新 Session 绑 A；A exhausted 时报错，不落到 B
  3. Auto + A exhausted：新 Session 落到 B
  4. Sticky：已绑定 A 的 Session 在 selected/order 改成 B 后仍是 A
  5. Round-robin cursor 若 UI 已接上，给一条 A→B 的新 Session 证据
- 现有 Debugger managed ACP probe 只能当「profile 能独立启动官方 grok」的旁证，**不能**当作本项完成

### F14 — live v1→v2 与调度 UI（对应 F06/F07）

- 产品启动后 live accounts.json 必须变成 version 2 且含 pools
- Renderer 提供 per-provider scheduling 控件并走现有 IPC
- 重启后 mode + RR cursor 仍在

### F15 — 绑定释放与 typecheck（对应 F05/F08）

- Session 结束 / terminate / 失败清理时从 activeAccountBindings 删除对应 accountId
- 修复 Sidebar 测试 within(HTMLElement) typecheck
- 定向回归 + pnpm typecheck 必须通过
- lint 预存 overlay 用例仍不要借机大改，除非不影响范围

## Fix Acceptance Criteria

1. pnpm typecheck 通过。
2. 定向测试至少覆盖 launch payload、resolver explicit/auto/RR、AccountUsageGrid per-account 缺数据显示 —、Sidebar 4/1、binding 释放；独立复跑通过。
3. 现场 live store 经产品路径迁移为 v2（只记录 version/pools 键，不贴 secret）。
4. 用户点某个 Grok 账号后新建对话，返回的 accountBinding.accountId 就是该账号；点 Auto 则按 pool，不再依赖 selected。
5. 至少两个真实 managed Grok profile 的产品路径证据满足 F13，脱敏落在 `ai_workspace/validation/`。
6. 不宣称 v0.4 五 Harness PASS。
7. 不 commit / tag / push，除非 Debugger 复检 PASS 后再按 closeout 规则处理 origin/dev。

## Fix Execution Order

1. F15 typecheck + binding 释放（先让质量门可复跑）
2. F10 产品 launch 接线（否则后续 E2E 仍会全部走 auto）
3. F14 live v2 + scheduling UI
4. F11 4/1 布局
5. F12 2×2 per-account 用量
6. F13 双账号产品路径真实探针
7. 回归 + 更新 coder_0.5.1.md 后通知 Debugger

## Next Step

Coder 按 Fix Plan 连续修复。Debugger 等待复检。用户可按最短路径看当前缺口，但当前构建 **不能** 当 v0.5 完成。
