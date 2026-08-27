# Debugger — v0.4.11 Native Multi-Harness FAIL

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.11`
> 日期：2026-08-27
> 角色：Debugger
> 来源：用户手工验收（全部 Grok 号已导入）
> 上一轮复检：[debugger_0.4.10-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.10-rereview-native-harness.md)
> Coder 交付：[coder_0.4.10-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.10-native-harness.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

用户现场：不指定账号 → 「Grok 额度已耗尽」，没有排到有额度的号；指定有额度的号仍然额度耗尽。Debugger 独立读了受管账号库（只看 metadata，不读 token）。

## Review Scope

- 用户现场：Auto 新 Session 未填补
- 用户现场：指定有额度账号仍走耗尽号
- 邮箱掩码 / 默认名 / 右键改名
- F18–F20 工程修复在生产接线后是否真正生效

## Evidence

独立读取 `craftstation-accounts/accounts.json`（脱敏）：

| order | masked（当前实现） | enabled | selected | status | lastError / lastQuotaAt |
|---|---|---|---|---|---|
| 0 | `he***@gmail.com` | false | false | disabled | 空 |
| 1 | `po***@gmail.com` | false | false | disabled | 空 |
| 2 | `po***@gmail.com` | false | false | disabled | 空 |
| 3 | `ha***@gmail.com` | false | false | disabled | 空 |
| 4 | `po***@gmail.com` | false | false | disabled | 空 |
| 5 | `he***@gmail.com` | true | true | **available** | 空 |

- 6 个 label 全是 `New Grok`。
- 没有任何一行是 `quota-exhausted`。F19 声称会把绑定账号写成耗尽并刷新列表，**生产落盘没有发生**。
- 上一轮官方探针：order 0 / 2 / 4 有额度，1 / 3 / 5 402。当前唯一启用且 selected 的是 order 5（尾号 `24e67aba`），对应探针里的耗尽号。
- Auto fallback 只看 `enabled && (available|quota-low)`。5 个号 `disabled` 后，号池实际只剩 1 个；这个号若 402，Auto **没有下一个可填补对象**。
- 紧凑 Grok 卡每一行只有「label + 登录授权」。`登录授权` 走 `createAndRunGrokProfileLogin({ label })`，**不** `selectAccount`，也**不**把 `accountId` 传给 `craftAgent`。用户以为在指定账号，实际仍用 selected=order5。
- `craftAgent` 首条 prompt 不带 `accountId` 时 mode=`auto`；`resumeCraftAgent` 若带 binding 则变成 **explicit sticky**。新对话从未绑到用户点的那张卡。
- 邮箱掩码是 local **前 2 位** + `***`，不是用户要的前 3 + 后 3。默认名写死 `New Grok`（`agentLoginActions.ts`）。没有 rename IPC / 右键改名。

## Findings

### F21 — Auto 填补在生产号池上不可用（P0）

`AccountResolver` 的 auto 会跳过 `quota-exhausted`，但：

1. F19 没有把 402 账号写成 `quota-exhausted`（status 仍 `available`，无 `lastQuotaAt`）。新 Auto Session 会再次绑到同一个 selected 号，于是连续「额度已耗尽」。
2. 即便 F19 写成功，当前 5/6 账号 `enabled=false` / `status=disabled`，resolver 也找不到 fallback。
3. `craftAgent` 第一条 `sendPrompt` 若直接 throw，必须仍走 `onPromptError` 并 **atomic 落盘**。只测 adapter observer 不够。`isAcpPromptQuotaExhaustedError` 不要只靠 `instanceof RequestError`（Electron 打包可能有多份 SDK class）；按 `code` / `data.message` / `data.http_status` duck-type。

### F22 — 「指定账号」没有接到新 Session（P0）

用户点的是紧凑卡「登录授权」，不是「设为首选」。

- 点账号行必须：`setAccountEnabled(true)` + `selectAccount`，并让**下一句新 Auto Session**绑定该 `accountId`。
- 「登录授权」只用于 `auth-expired` / 未认证，禁止当成选号。
- 禁用账号仍可点选；点选后自动启用，**不要**把其他账号改成 disabled。
- 已打开 Session 保持 sticky（F20 语义不变）。

### F23 — 掩码 / 默认名 / 右键改名（P1，用户明确要求）

- 邮箱显示：`@` 前 local 保留**前 3 + 后 3**，中间 `***`；local 不足 6 位则全显示 local（不要把整个邮箱挡住）。例：`hernanjiang` → `her***ang@domain`。
- 默认 `label`：邮箱前缀的前 3 位（如 `her`），不要 `New Grok`。已存在且仍叫 `New Grok` 的行，按 `providerAccountId` / 邮箱重算一次。
- 用户可右键账号行改名；新 IPC `renameAccount({ accountId, label })`；空名拒绝；不改 credential。
- Renderer 继续零 secret；不要把完整邮箱当 label 以外的明文刷到 UI。`providerAccountId` 若已是完整邮箱，只给 supervisor 重算掩码/默认名，不要在卡片上展示全文。

## Fix Plan

一次性连续修 F21 → F22 → F23。不要重开 F08–F17。不要 commit/tag/push。不要宣称 Feature PASS。

### F21

- `isAcpPromptQuotaExhaustedError` / `resolveAcpPromptRpcErrorMessage`：duck-type 官方 402 形状。
- 覆盖路径：ACP `session.prompt` catch、`craftAgent` 第一条 `sendPrompt` throw、后续 turn。402 后 `updateStatus(boundId, "quota-exhausted")` 必须能在 `accounts.json` 读到。
- Auto：跳过 disabled / quota-exhausted / auth-expired / unavailable；按 order 选下一个 enabled 的 available/quota-low。
- 导入成功的 Grok 账号默认 `enabled=true`。禁止「设为首选」把其余账号批量 disable。
- 测试：6 账号（3 exhausted 或 disabled + 3 available）auto 落到第一个 available；selected 是 exhausted 时同样 fallback；explicit exhausted 仍 error。

### F22

- 紧凑 Grok 卡：点击账号行 = enable + select，并刷新列表。
- 「登录授权」与选号分离。
- 新 Auto `craftAgent` 不传 explicit 时使用 selected/auto resolver，不得忽略刚设的首选。
- 测试：点击账号行调用 `selectAccount` + `setAccountEnabled(true)`；不调用 `createAndRunGrokProfileLogin`。crafts 新 session 的 binding 等于该 accountId。

### F23

- `maskIdentity('alicebob@x.com')` → `ali***bob@x.com`（local 前 3 后 3）。
- 默认 label = local 前 3。
- `renameAccount` IPC + 右键菜单。
- 测试覆盖掩码、默认名、rename、拒绝空名。

## Fix Acceptance Criteria

1. 6 个已导入 Grok 账号在启用状态下，Auto 新对话落到有额度账号，而不是连续 402。
2. 点选有额度账号后，新对话绑定该账号且能回复；点选耗尽账号则报「Grok 额度已耗尽」，不偷换号。
3. 402 后该账号 `status=quota-exhausted` 且有 `lastQuotaAt`；其他账号不被改成 disabled。
4. 卡片邮箱为 local 前 3 + `***` + 后 3；默认名是前缀前 3 位；右键能改名。
5. 定向测试 + typecheck + lint 通过。不读 / 不复制 Codex Router oauth。不覆盖 `~/.grok`。

## Fix Execution Order

1. F21 状态落盘 + duck-type 402 + Auto 跳过 disabled/exhausted
2. F22 点选 = enable + select，与登录授权分离
3. F23 掩码 / 默认名 / rename
4. 回归 F18 文案、F20 sticky/explicit

## 最短复测路径（Coder 修完、用户重开后）

1. 完全退出 CraftStation 再打开。
2. 模型与用量：6 张 Grok 卡应都是启用；名字是邮箱前缀前 3 位，不是 New Grok；邮箱能看出前 3 后 3。
3. 不指定账号，新建 Grok 对话发一句：应落到有额度号并回复。
4. 点一张有额度的卡（点行，不是「登录授权」），再新建对话：绑这张卡并能回复。
5. 点一张耗尽卡再发：额度已耗尽，不换号。
6. 右键改名后刷新仍在。

## Verdict

**FAIL + Fix Plan v0.4.11**。F18 文案映射可保留；F19/F20 在生产号池上未闭环。不进入 v0.5。不 commit/tag/push。
