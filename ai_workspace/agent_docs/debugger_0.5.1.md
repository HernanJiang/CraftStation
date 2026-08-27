# Debugger — v0.5.1 Account Pool + Quota + Token Usage Stabilization

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

独立 Re-review，不以 Coder 自检代替质量门。核对：

- Manager：`ai_workspace/agent_docs/manager_0.5.0.md`
- 上一轮 FAIL / Fix Plan：`ai_workspace/agent_docs/debugger_0.5.0.md`
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.1.md`
- 真实探针：`ai_workspace/validation/v0.5.1-grok-product-path.json`
- 未提交 diff vs `be8d8c2`
- 源码：threadLaunchActions、usageAccountsStore、SidebarProviderAccounts、AccountUsageGrid、supervisorRuntime、accountResolver、accountStore、grokAccountPool.integration.test.ts
- 独立测试、typecheck、定向 lint、git diff --check、CodeGraph
- 现场账号库只读 metadata，不读 token / auth.json

不在范围内：CLIProxyAPI、导入 Codex Router oauth、覆盖 `~/.grok`、v0.4 五 Harness 升格、本轮再对已知耗尽账号打真实流量。

## Evidence

### Git / 工作树

- Product Git Root：`craftstation/` / `craftstation-dev/`
- 验收目录：`D:\Work\CraftStation\craftstation-dev`
- 分支：`dev` tracking `origin/dev`
- HEAD：`be8d8c2cf3634c39b7a343a813f894b4d21e7d3f`（docs(v0.5): plan: account pool quota and token usage）
- 工作区未提交：v0.5.0 + v0.5.1 工程改动仍在 working tree；新增 coder_0.5.1.md、grokAccountPool.integration.test.ts、v0.5.1-grok-product-path.json
- main 保持 `b1af0e2`；未在 main 验收；未 commit / tag / push

### 独立测试（Debugger 复跑）

| 命令                                                                                                                                                          | 结果                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| pnpm typecheck                                                                                                                                                | 通过                                                                                                 |
| 定向 7 files：accountStore / accountResolver / grokProfiles / tokenUsageAdapter / threadLaunchActions / SidebarProviderAccounts / grokAccountPool.integration | 6 passed / 1 skipped，79 passed / 1 skipped（integration 默认跳过，需 CRAFTSTATION_REAL_GROK_E2E=1） |
| src/supervisor/runtime.test.ts                                                                                                                                | 1 file / 65 passed（含 sticky、live Session 删除防护、Grok control plane）                           |
| 合计                                                                                                                                                          | 8 files / 144 passed / 1 skipped                                                                     |
| 目标文件 oxlint                                                                                                                                               | 通过                                                                                                 |
| git diff --check                                                                                                                                              | 无 whitespace error；仅 Git CRLF 提示                                                                |
| codegraph status                                                                                                                                              | Index is up to date（2,902 files / 40,564 nodes / 152,421 edges）                                    |

全仓既有 lint 问题 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 仍在，未当成本轮回归。

### Live store（只读 metadata）

`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`

- version: 2，存在 pools 键，但 pools == {}（调度尚未被 UI 写入，不等于迁移失败）
- 6 个 Grok managed profile，均有 credentialScopeRef=managed:grok:...

| label | accountId tail    | mask      | status          | selected | order |
| ----- | ----------------- | --------- | --------------- | -------- | ----- |
| her   | 852862f8…0b52ed32 | her***g01 | available       | false    | 0     |
| poi   | 0025b7ae…8eaff924 | poi***son | quota-exhausted | false    | 1     |
| poi   | 9802c0ca…1890b433 | poi***nan | quota-exhausted | true     | 2     |
| hao   | 071e94ac…d4707c9b | hao***ise | available       | false    | 3     |
| poi   | a38a8ace…b0e5d69e | poi***nan | available       | false    | 4     |
| her   | e2ed3917…24e67aba | her***g01 | available       | false    | 5     |

未读取 / 未打印 token。两个 her 邮箱相同，这是现场事实，不是本轮新增缺陷。

### F13 产品路径探针（Coder 文件，独立阅读）

`ai_workspace/validation/v0.5.1-grok-product-path.json`

- synthetic: false，hostHomeUsed: false，verdict: BLOCKED
- 路径：SupervisorRuntime.craftAgent -> AccountResolver -> native Grok adapter -> official grok agent stdio (ACP)
- priority-auto：account grok:852862f8-473d-4ef7-b1bf-605c0b52ed32（her order 0），reason=priority，responseLength=29，hash adf76effd1d6，managed session dir observed
- explicit-b：account grok:9802c0ca-9dde-4f23-8650-81721890b433（poi***nan order 2，现已 quota-exhausted），reason=explicit，responseLength=0
- sticky / Auto quota fallback / Round-Robin 没有跑
- grokAccountPool.integration.test.ts 确认走 runtime.craftAgent(...)，不是 host ~/.grok

不能把单次 non-empty handshake 或 responseLength=0 升格为 Feature PASS。

## Spec Fidelity

对照 Manager Part I Acceptance Intent 与上一轮 F10-F15：

| 项                                                           | 结论            | 证据                                                                                                                                                     |
| ------------------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F10 新 Session 传 accountMode / 可选 accountId               | 关闭            | threadLaunchActions.ts 读 nextSessionAccountId；无 pending 时 auto 且不带 accountId；账号行 setNextSessionAccount，不再 selectAccount 当首选             |
| F11 已认证 4 列 / 未认证 1 列                                | 关闭            | provider-grid = grid-cols-[minmax(0,4fr)_minmax(190px,1fr)]；testid authorized-provider-grid / unauthorized-provider-grid；测试锁定 4/1                  |
| F12 账号行 2x2 且 per-account                                | 关闭            | AccountUsageGrid grid-cols-2；quota 用 account.quotaWindows；token 仅 byAccount 精确匹配且 quality 不是 estimated，否则显示 —                            |
| F14 v2 pools + 调度 UI                                       | 关闭（工程）    | AccountStore 迁移写 pools；Renderer setAccountPoolScheduling；live file 已 v2。pools=={} 只说明用户还没保存过调度                                        |
| F15 close/terminate/失败释放 binding                         | 关闭            | craftedSessionBindings；closeThread / session.exited / 首轮失败 / spawn 失败都 releaseCraftedSession 或 releaseCraftedBinding；removeAccount 查 live map |
| F13 双 managed 非空 real response + sticky/RR/explicit-error | 仍 BLOCKED      | 见探针；质量门未满足                                                                                                                                     |
| v0.4 F04 五 Harness                                          | 仍 FAIL/BLOCKED | 不在本轮升格范围                                                                                                                                         |

「设为首选」「首选账号与自动回退顺序」文案已从 Sidebar 删除。账号行点击只设 next-session override。ManagedAccountPool 外层 col-span-4；ProviderCard 内部 connected 仍 col-span-2，那是卡内紧凑行，不是外层 4/1 回归。

## Integration / Regression / Edge Cases

- Auto launch：无 pending account 时 accountMode=auto，payload 不含 accountId。测试锁定。
- Explicit launch：账号行写入 nextSessionAccountId 后，下一次 startThreadFromCraft 走 explicit；用过后 clearNextSessionAccount。
- Sticky：resumeCraftAgent 传已绑定 accountId，不重新走 UI selected。fixture 测试：Session A 保持 A，新 Session 可绑 B。
- 删除防护：live crafted session 时 removeAccount 抛 live Session binding；关闭后可删。
- 隔离：integration / 探针声明 hostHomeUsed: false；未读 Router oauth；未接 CLIProxyAPI。
- 调度空对象：v2 迁移成功，但 Priority/RR/Random 要用户在 UI 改一次才会写入 pools.grok。这不是 F14 回退。
- 风险：Coder 把当前 selected 且已耗尽的 9802c0ca 当 explicit B。现场仍有 available 的 hao / 另一个 poi / 第二个 her。这解释了 responseLength=0，但不能改写质量门。

## Findings

### F13 — 产品路径仍缺第二个非空 real response（P0，Feature 硬门）

- 文件：ai_workspace/validation/v0.5.1-grok-product-path.json、src/supervisor/runtime/grokAccountPool.integration.test.ts
- 说明：一条 priority-auto 非空回复成立，但不能关闭 T10。explicit B 只有 ACP 建立、responseLength=0；sticky、Auto exhausted fallback、Round-Robin、explicit 报错都不存在可审计产品路径证据。
- 不要把 host ~/.grok、fixture、空回复、session identity 或单账号 probe 当成 PASS。

### 已关闭的上一轮项（本轮不再作为新缺陷）

- F10 / F11 / F12 / F14 / F15 工程项已在源码与定向测试中落地。
- 上一轮 F05 typecheck within(Element) 已修复；本轮 pnpm typecheck 通过。

无新的产品意图冲突。不需要 Manager Re-plan。

## Verdict

**FAIL / BLOCKED**

工程修复可进入下一轮只补 F13 的真实产品路径证据。Feature 本身不得 PASS，不得 Closeout，不得 push origin/dev，不得 merge main，不得打 v0.5.0 tag。

## Fix Plan

只修 / 只补 F13。不要重开已关闭的 F10-F12 / F14 / F15，除非复检时发现回归。

### F13 — 两个 available managed Grok 的完整产品路径证据

1. 禁止再打已知耗尽账号：
   - grok:9802c0ca-9dde-4f23-8650-81721890b433
   - grok:0025b7ae-9947-4034-b52a-ce308eaff924
2. 使用 live store 中 available managed profile。优先配对：
   - A：已有非空回复的 grok:852862f8-473d-4ef7-b1bf-605c0b52ed32（her order 0），或另一个 available her
   - B：grok:071e94ac-5fda-4611-a0c8-b529d4707c9b（hao）或 grok:a38a8ace-6ee4-44c9-bf91-2e5db0e5d69e（poi available）
3. 必须走 SupervisorRuntime.craftAgent，GROK_HOME=<managed home>，hostHomeUsed=false，synthetic=false。
4. 最低关闭证据（脱敏 JSON，只记 accountId / reason / responseLength / hash12 / managedSessionDirectoryObserved）：
   - 两个不同 managed account 都有非空 assistant response
   - sticky：已绑定 Session A 在 selected/next 改成 B 后仍是 A
   - explicit 不可用账号：明确错误，不 silent fallback
   - Auto：跳过 quota-exhausted，按 order 选下一个 available/quota-low
   - 若额度仍够：Round-Robin 两次新 Session 绑定不同 usable 账号
5. 停止条件：第二个 available 账号也出现空回复、timeout、AUTH_REQUIRED 或 402 时，保持 BLOCKED，不要继续扫号耗额度。
6. 不读取 / 不写入报告 token、cookie、auth.json 内容。

## Fix Acceptance Criteria

- 两个 managed Grok account 的产品路径 responseLength > 0
- sticky / explicit-error / Auto skip exhausted 至少有可审计 JSON
- 生产 capability 不因单次 probe 升格为五 Harness PASS
- 定向测试 + typecheck 不回退
- 仍不 commit / tag / push，除非用户另授

## Fix Execution Order

1. 只读确认 live metadata 哪些账号仍 available
2. 改探针选号，避开 exhausted
3. 跑 CRAFTSTATION_REAL_GROK_E2E=1 产品路径，写新的脱敏 JSON（可覆盖 v0.5.1 或新增 v0.5.2）
4. 额度不够就停，更新 Coder 文档为继续 BLOCKED
5. 通知 Debugger 复检

## User Smoke（最短手工验收，不能单独当 PASS）

工程项可先看，F13 仍要等第二条非空回复。

1. 终端进入 D:\Work\CraftStation\craftstation-dev
2. 运行 pnpm dev，等 Electron 起来
3. 欢迎页点进入对话
4. 打开「模型与用量」：
   - 左侧已认证区应是 4 列（authorized-provider-grid）
   - 右侧未认证区 1 列滚动（unauthorized-provider-grid）
   - Grok 账号池能看到已导入账号；没有「设为首选」
   - 账号池标题旁有 Priority / Round-Robin / Random
5. 点某个 available Grok 账号行（不要点「登录/授权」），再开一个新 Grok 对话；应绑定该账号，而不是旧 selected
6. 账号行 2x2：额度 / Token / 缓存 / 状态；没有可靠 per-account 数据时应显示 —，不要把全厂总量复制到每个号
7. 不要对已经 quota-exhausted 的号反复发真实请求

## 交接

Coder 线程已校验：标题 Coder，同一 projectId 16cc8579-4db8-4ce6-89c3-a12a48187705，id 01a02cf3-7ca0-7f92-9843-848ed2638cb9。
