# Debugger — v0.4.12 Native Multi-Harness FAIL

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.12`
> 日期：2026-08-27
> 角色：Debugger
> 来源：v0.4.11 独立复检未通过
> 复检：[debugger_0.4.11-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.11-rereview-native-harness.md)
> Coder 交付：[coder_0.4.11-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.11-native-harness.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

v0.4.11 的 F21/F23 工程项关闭。用户手工失败路径还在：侧栏紧凑卡不能选号；5 个已导入 Grok 账号仍是 disabled，Auto 没有下一个号。

## Findings

### F22 — 侧栏紧凑卡仍不能指定账号（P0）

`SidebarProviderAccounts` ProviderCard 的 `managedAccounts` 列表：

- 只渲染 label 文本；
- 可选的「登录授权」只在 `CODEX_LOGIN_REQUIRED_STATUSES`；
- **没有** `onClick` → `setAccountEnabled(true)` + `selectAccount`；
- **没有** 右键改名。

用户上次「指定有额度的号」点的就是这排小卡，不是「模型与用量」大 dialog。Dialog `AccountRow` 已修好，不能算 F22 关闭。

### F24 — 旧 disabled 号池让 Auto 填补仍为空（P0）

真实 `accounts.json`：6 个 Grok 都有官方 identity，但 5 个 `enabled=false` / `status=disabled`。这是旧「设为首选就把别的关掉」留下的，不是用户现在要禁用。

Auto resolver 跳过 disabled 是对的，所以必须把这些号重新启用。否则 selected 那个耗尽号 402 之后仍然没有 fallback。

## Fix Plan

一次性连续修 F22 剩余 + F24。不要重开已关闭的 F21/F23 语义。不要 commit/tag/push。不要宣称 Feature PASS。

### F22

- 侧栏紧凑 Grok/Codex 账号行：点击整行（label）= `setAccountEnabled({enabled:true})` + `selectAccount` + 刷新。
- 右键同一行 = renameAccount（与 dialog 相同 prompt）。
- 「登录授权」继续只出现在未认证/过期，click 不冒泡成选号。
- 测试必须点 **紧凑卡行**（`provider-card-grok` 内部账号 label），断言 enable+select，且不调用 `createAndRunGrokProfileLogin`。只测 dialog 不够。

### F24

- `AccountStore.migrateLegacyMetadata`（或等价一次性迁移）：Grok 账号若有官方 identity（`providerAccountId` 含 `@` 或 masked email），且 `enabled=false` 且 `status=disabled`，改为 `enabled=true`、`status=available`。
- **不要**改 `selected`。
- **不要**把其他账号改成 disabled。
- 已是 `auth-expired` / `quota-exhausted` 的不要强行改成 available；只处理「disabled + 有 identity」这种旧独占启用残留。
- 测试：构造 6 账号（5 disabled + 1 selected available），打开 Store 后 6 个 enabled=true，selected 仍是原来那个；随后 auto resolve 在 selected 被标 quota-exhausted 后能落到下一个。

## Fix Acceptance Criteria

1. 重启后 6 个已导入 Grok 账号都是 enabled（除非用户在新 UI 里主动关掉）。
2. 不打开「模型与用量」，直接点侧栏 Grok 卡里的账号名，该账号变为首选并启用。
3. 不指定账号发一句：若当前首选 402，应落到下一个有额度号，而不是再报耗尽且无处可去。
4. 点有额度的紧凑行后再发：绑这个号。
5. 右键紧凑行能改名。
6. 定向测试含紧凑卡点击 + disabled 迁移；typecheck/lint 通过。

## Fix Execution Order

1. F24 legacy re-enable
2. F22 compact row select/rename
3. 回归 F21 duck-type 落盘、F23 掩码/默认名、F20 sticky/explicit

## 最短复测路径（Coder 修完后，用户必须完全退出重开）

1. 杀掉所有 CraftStation 窗口，重新打开。
2. 侧栏 Grok 卡应列出 6 个短名（her/poi/hao），邮箱在用量 dialog 里是前3后3。
3. **不要先开 dialog**：直接点一张有额度的短名 → 再新建 Grok 对话发一句，应回复。
4. 不点账号、再新建一句 Auto：若上一号刚 402，应换到下一个有额度号。
5. 右键短名改名，刷新仍在。
