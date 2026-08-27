# Debugger — v0.5.2 Account Pool + Quota + Token Usage Stabilization

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD 收口前 `be8d8c2`，工作区随后做 DEV PASS closeout）
>
> Verdict：**PASS**
>
> Lifecycle：`DEV PASS / USER ACCEPTANCE PENDING`
>
> Main Promotion：**NOT AUTHORIZED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 未 merge main。未创建正式 `v0.5.0` tag。v0.4 五 Harness F04 仍 **FAIL / BLOCKED**。

## Review Scope

独立 Re-review，不以 Coder 自检代替质量门。核对：

- Manager：`ai_workspace/agent_docs/manager_0.5.0.md`
- Tickets：`.scratch/craftstation-0.5.0/issues/01-…10`
- 上一轮 FAIL / Fix Plan：`ai_workspace/agent_docs/debugger_0.5.1.md`
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.2.md`
- 真实探针：`ai_workspace/validation/v0.5.2-grok-product-path.json`
- 源码：threadLaunchActions、usageAccountsStore、SidebarProviderAccounts、AccountUsageGrid、supervisorRuntime、accountResolver、accountStore、grokAccountPool.integration.test.ts
- 独立测试、typecheck、定向 lint、git diff --check、CodeGraph
- 现场账号库只读 metadata，不读 token / auth.json

不在范围内：CLIProxyAPI、导入 Codex Router oauth、覆盖 `~/.grok`、v0.4 五 Harness 升格、本轮再打已知耗尽账号。

## Evidence

### Git / 工作树

- Product Git Root：`craftstation/` / `craftstation-dev/`
- 验收目录：`D:\Work\CraftStation\craftstation-dev`
- 分支：`dev` tracking `origin/dev`
- Closeout 前 HEAD：`be8d8c2cf3634c39b7a343a813f894b4d21e7d3f`
- 工作区包含 v0.5.0–v0.5.2 未提交工程与文档；main 保持 `b1af0e2`

### 独立测试（Debugger 复跑）

| 命令                                                                                                                                                                         | 结果                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| pnpm typecheck                                                                                                                                                               | 通过                                                                                                      |
| 定向 8 files：accountStore / accountResolver / grokProfiles / tokenUsageAdapter / threadLaunchActions / SidebarProviderAccounts / runtime.test / grokAccountPool.integration | 7 passed / 1 skipped，**144 passed / 1 skipped**（integration 默认跳过，需 CRAFTSTATION_REAL_GROK_E2E=1） |
| 目标文件 oxlint                                                                                                                                                              | 通过                                                                                                      |
| git diff --check                                                                                                                                                             | 无 whitespace error；仅 Git CRLF 提示                                                                     |
| codegraph status                                                                                                                                                             | 验收时 Index 基本最新；closeout 文档写入后再次 sync                                                       |

全仓既有 lint 问题 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 仍在，未当成本轮回归。

### Live store（只读 metadata）

`C:\Users\Haona\.craftstation-dev\craftstation-accounts\accounts.json`

- version: 2
- pools.grok.scheduling = priority（探针后已恢复，不再是空对象）
- 6 个 Grok managed profile，均有独立 credentialRoot / credentialScopeRef

A/B 本轮探针配对：

- A her `grok:852862f8-473d-4ef7-b1bf-605c0b52ed32` → profile-8ba0b87e-…，available，order 0
- B hao `grok:071e94ac-5fda-4611-a0c8-b529d4707c9b` → profile-911f0d5f-…，available，order 3

两个 profile 都观察到 sessions 目录。未读取 auth.json / token。

已知耗尽账号未再打真实流量：`9802c0ca…`、`0025b7ae…`。

### F13 产品路径（独立阅读 JSON + 集成测试源码）

路径：`SupervisorRuntime.craftAgent -> AccountResolver -> native Grok adapter -> official grok agent stdio (ACP)`

`synthetic: false`。JSON 声明 `hostHomeUsed: false`；绑定均为 `managed:grok:<id>`，且对应 managed profile 的 sessions 目录非空。集成测试走 `runtime.craftAgent` / `runtime.resumeCraftAgent`，explicit 耗尽账号在 resolver 失败，不进 ACP。

| 场景                                 | 绑定  | reason              | responseLength | hash12       |
| ------------------------------------ | ----- | ------------------- | -------------- | ------------ |
| priority-auto                        | A her | priority            | 29             | adf76effd1d6 |
| explicit-b                           | B hao | explicit            | 29             | 61a69dfa2718 |
| explicit-known-exhausted-no-fallback | 无    | ACCOUNT_UNAVAILABLE | 0              | —            |
| auto-skips-known-exhausted           | A her | priority            | 30             | e4740f6a5d3b |
| sticky-a-start                       | A her | explicit            | 33             | 7bd741679fe2 |
| sticky-a-after-pool-change           | A her | explicit            | 34             | 091c02743519 |
| round-robin-a                        | A her | round-robin         | 25             | e1c188dcc6c7 |
| round-robin-b                        | B hao | round-robin         | 25             | be8d029bef20 |

A/B hash 不同，不是同一段输出复制。sticky resume 在把 pool order 改成 B 优先后仍绑 A。RR 两次新 Session 分别绑 A/B。

## Spec Fidelity

| Manager / Ticket 门                                                                      | 结论            | 证据                                         |
| ---------------------------------------------------------------------------------------- | --------------- | -------------------------------------------- |
| T01–T09 账号池 / 调度 / sticky / RR / UI 4+1 / 2×2 / quota collector / Tokscale / 删除锁 | PASS            | v0.5.0–v0.5.1 源码 + 定向测试；本轮无回归    |
| T10 A/B 独立 managed profile + 非空 native response                                      | PASS            | 上表 A/B responseLength>0，sessions 目录独立 |
| Auto skip exhausted / explicit no fallback / sticky / RR                                 | PASS            | 上表                                         |
| Renderer 零 secret                                                                       | PASS            | AccountView 投影；报告未读 token             |
| 禁止 CLIProxyAPI / 假 Harness                                                            | PASS            | 产品路径为 official grok agent stdio         |
| Codex 真实双账号                                                                         | 不阻塞          | Manager 明确：Codex 双账号不在 v0.5 硬门     |
| v0.4 五 Harness F04                                                                      | 仍 FAIL/BLOCKED | 不升格                                       |

残余（不阻断 PASS）：live metadata 当前没有写入 `quotaWindows`。T07 collector / refreshAccountQuota 代码存在，UI 无可靠 per-account 数据时显示 —。用户可在「模型与用量」点刷新；本轮未再对 A/B 打 quota HTTP，避免额外耗额度。

## Findings

无阻断缺陷。

非阻断备注：

1. `hostHomeUsed: false` 是探针字段，不是 OS 级 env dump。关闭依据是 managed credentialScopeRef + 独立 profile sessions，而不是该布尔值本身。
2. live `quotaWindows` 为空；用量格允许显示 —。
3. 若干 `grok-pending-New-Grok-*` 目录仍在 data dir，属于历史 pending 登录残留，不是本轮 F13 回退。

## Verdict

**PASS**

v0.5.0 在 dev 上达到 DEV PASS / USER ACCEPTANCE PENDING。用户手工 Smoke 通过前不得 merge main，不得打正式 `v0.5.0` tag。v0.4 Native Multi-Harness 仍 NOT PASS。

## User Smoke（最短手工验收）

1. 终端进入 `D:\Work\CraftStation\craftstation-dev`
2. 运行 `pnpm dev`，等 Electron 起来
3. 欢迎页点「进入对话」
4. 打开「模型与用量」：
   - 左边已认证 4 列，右边未认证 1 列滚动
   - 没有「设为首选」
   - Grok 账号池旁有 Priority / Round-Robin / Random
5. 点 **hao** 账号行（不要点「登录/授权」），再开一个新 Grok 对话，应绑 hao，而不是旧 selected 的耗尽号
6. 再点 **her**，新开对话应绑 her；之前那个 hao 对话应仍是 hao
7. 账号行 2×2：额度 / Token / 缓存 / 状态；没可靠数据就显示 —
8. 不要对已经 quota-exhausted 的 poi 号反复发真实请求
9. 调度改 Round-Robin 后连续开两个新 Auto Grok 对话，应轮到不同可用号

常见失败：点的是「登录/授权」而不是账号行；选中了耗尽号还期望成功回复；看的是 main 工作树而不是 `craftstation-dev`。
