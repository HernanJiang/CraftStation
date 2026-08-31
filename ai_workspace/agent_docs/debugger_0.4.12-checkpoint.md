# Debugger — v0.4.12 Checkpoint Freeze

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.12` 检查点冻结（用户授权 Git 收口，进入下一版本 Ideate）
> 日期：2026-08-28
> 角色：Debugger
> Coder 交付：[coder_0.4.12-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.12-native-harness.md)
> 上一轮复检：[debugger_0.4.12-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.12-rereview-native-harness.md)
> Verdict：**FAIL / BLOCKED — checkpoint freeze，不是 Feature PASS**
> Requires Manager Re-plan: **Yes（下一版本）**
> Requires Ideate Revision: **Yes（用户明确要求下一版本目标改由 Manager 讨论）**
> Git：**checkpoint commit + `checkpoint-v0.4.12` tag + push `origin/main`。禁止 `v0.4.0` / PASS tag。**

本文件不是 Closeout 报告，也不是 v0.4.13 Fix Plan。用户指令是：先放下额度语义核验，Git 收口当前工作树，下一版本目的交给 Manager。

## Review Scope

- 冻结 v0.4.12 工程状态，供云端/本地 Manager 接手
- 独立记录「无论选什么账号都能回复、看不到额度已耗尽」的绑定事实，不在本轮改产品语义
- 不宣称五 Harness PASS，不生成 `report_0.4.md`

## Frozen Engineering State

已关闭（工程项，不是 Feature PASS）：

| ID        | 状态           | 含义                                                                  |
| --------- | -------------- | --------------------------------------------------------------------- |
| F08       | 关闭           | Grok 登录不打开 grok.com，走官方 device-auth                          |
| F09       | 关闭           | 不导入 Router oauth、不接 CLIProxyAPI、不覆盖 `~/.grok`               |
| F12       | 关闭           | 受管 GROK_HOME 登录闭环；无 identity 不落账号行                       |
| F13       | 关闭           | spawn env 用空值覆盖宿主 API key / Router / catalog                   |
| F14       | 关闭           | Codex profile 登录测试死锁与 overlay 关闭                             |
| F15       | 关闭           | 「模型与用量」显示 Grok 账号池                                        |
| F16 / F17 | 关闭           | overlay 可点关闭；官方 identity 出现即 complete                       |
| F18 / F21 | 关闭           | 官方 402 duck-type → 「Grok 额度已耗尽」映射，并按 bound account 落盘 |
| F19 / F20 | 关闭           | sticky 绑定；Auto 新 Session 才 fallback；explicit 不换号             |
| F22       | 关闭           | 点账号行 = enable + select；右键改名；登录授权不冒泡                  |
| F23       | 关闭           | 邮箱 local 前3+***+后3；默认名前3                                     |
| F24       | 关闭           | legacy disabled Grok 全量回启用                                       |
| F04       | **仍 BLOCKED** | 五个官方 Harness 没有完整产品级 real response                         |

约束保持：Official/Native Runtime First；Renderer 零 secret；不 commit 账号库 / token / `.env`。

## Binding Finding（交给下一版本，本轮不改代码）

用户现场：选哪个 Grok 账号都能成功回复，且看不到「Grok 额度已耗尽」。用户希望「没额度就默默填补」，同时怀疑后端绑定可能是假的。

独立源码结论（未发新的耗尽号探针）：

1. 新 Session 入口 [`threadLaunchActions.ts`](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/threadLaunchActions.ts) 的 `startThreadFromCraft` **不传** `accountId` / `accountMode`。
2. [`createCraftingAdapter`](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts) 因此走 `accountMode ?? (accountId ? "explicit" : "auto")` → **auto**。
3. Auto 使用当前 `selectedAccountId`；仅当 selected 已是 `quota-exhausted` / disabled / auth-expired 才按 order 填补。
4. 点「模型与用量」账号行只改 selected，**没有**把下一句 `craftAgent` 变成 F20 的 explicit 路径。
5. 因此「指定某个号」在新产品路径上更接近 **selected + auto**，不是 immutable explicit。若 store 里 6 个号都还是 `available`，Auto 不会换号，402 也不会先被 store 跳过。
6. 「无论选哪个都能回」**不能**当成 sticky/per-account PASS。可能是：选中号本身有额度、store 尚未写成 `quota-exhausted`、或绑定/GROK_HOME 未真正按号隔离。后者必须用下一版本的真实双账号探针证明，不能用 UI 成功回复代替。

冻结语义 vs 用户新意图：

- 已冻结：`quota-exhausted` → 新 Auto Session fallback；explicit 耗尽报错不偷偷换号；已绑定 Session sticky。
- 用户新意图：不要把「Grok 额度已耗尽」挡在聊天前面，默认填补到有额度号。
- 这是产品语义变更，必须进 Manager Ideate / 下一 Feature Spec，不能静默改 F20。

## Git Closeout Scope

产品仓库 `craftstation/` → `https://github.com/HernanJiang/CraftStation.git`：

- 提交 v0.4.0 到 v0.4.12 的 Working Copy 源码、测试、治理文档
- 同步根目录 `PROJECT_STATUS.md`、`IDEA_GUIDE.md`、`ai_workspace/agent_docs/` v0.4 文档
- 不提交 `ai_workspace/validation/`、`ai_workspace/temp/`、账号库、token、`.env`
- 不打 PASS tag，不生成 `report_0.4.md`

根仓库仍无 `origin`（按 `AGENTS.md` 不吸收 `craftstation/` 源码）。云端 Manager 以 GitHub 产品仓为准。

## Next Version Handoff

Manager / Ideate 至少要拍板：

1. 选号是 selected+auto，还是真正 explicit sticky
2. 耗尽时静默填补，还是保留「额度已耗尽」给 explicit
3. F04 五 Harness 真实 response 是否仍作为下一版本质量门
4. 毛玻璃透光率等 UI 小改是否并入下一 Feature

## Verdict

**FAIL / BLOCKED / CHECKPOINT FROZEN**

v0.4.0 没有 PASS。下一动作是 Manager Ideate，不是 v0.4.13 Coder Fix。
