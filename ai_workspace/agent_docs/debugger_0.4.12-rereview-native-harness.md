# Debugger — v0.4.12 Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.12` 复检
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.12-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.12-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.12-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.12-native-harness.md)
> Verdict：**FAIL / BLOCKED（F22/F24 关闭；F04 仍缺五 Harness 产品级真实 response）**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**
> Next Coder cycle: **不要开 v0.4.13。** 下一动作是用户**完全退出并重开** CraftStation，按最短路径点 Grok 号池。未出现新的生产缺陷前不派发 Coder。

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout，不得 commit / tag / push。

## Review Scope

- F24：有官方 identity 的 Grok `disabled` 是否一次性全部回启用，且不改 selected、不误伤 quota-exhausted/auth-expired
- F22：账号行点击 = enable + select；右键改名；登录授权不冒泡成选号
- 回归：F21 duck-type 402 落盘、F23 掩码/默认名、F20 sticky/explicit
- F04 五 Harness

## Evidence

### 独立源码

- [accountStore.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/accountStore.ts)
  - `migrateLegacyMetadata` 全量 `for` 遍历，不再 `.some()` 短路
  - `grok + email identity + enabled=false + status=disabled` → `enabled=true` / `status=available`
  - 不改 `selected` / `order`
- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - 已导入 Grok 时「模型与用量」走 `ManagedAccountPool` / `AccountRow`：整行 `onClick` → `setAccountEnabled(true)` + `selectAccount`；`onContextMenu` → `renameAccount`；操作按钮 `stopPropagation`
  - 无账号时的 `ProviderCard` 紧凑行同样 enable+select / 右键改名
  - 左侧栏本体仍只有「模型与用量」入口，账号名在 dialog 里。这是当前产品入口，不是漏修

### 真实账号库（脱敏，修完后再读）

6/6 Grok 均为 `enabled=true` / `status=available`。selected 仍是尾号 `24e67aba` 的 `her`。label 为 `her`/`poi`/`hao`，掩码前3后3。5 个旧 disabled 已恢复。

注意：selected 那个号上一轮官方探针是 402，但 store 仍是 `available`（用户尚未在新代码上打一轮真实 402）。F21 会在这次手工验收时落盘。

### 独立测试

- `accountStore.test.ts` + `accountResolver.test.ts` + `SidebarProviderAccounts.test.tsx`：3 files / 28 passed
- `runtime.test.ts` Grok account control plane：7 passed（含 Auto fallback、explicit 不换号、sticky、首条 402 落盘）
- CodeGraph：`codegraph sync` 完成（4 files）

## Findings

无新的 P0。F22 / F24 **关闭**。F21 / F23 保持关闭。

残留（不派发 Coder）：

1. **F04** 五 Harness 产品级真实 response 仍 BLOCKED。
2. 账号选择入口在「模型与用量」dialog，不在左侧栏空白处。验收时必须打开该 dialog 点账号行。
3. 必须完全退出重开后才能验证 Auto 填补；旧窗口仍是修前进程。

## Verdict

**FAIL / BLOCKED**

- Fix Cycle v0.4.12 的 F22 / F24：**关闭**
- Feature v0.4.0：**不得 PASS**
- 不进入 Feature Closeout
- 不 commit / tag / push
- 不进入 v0.5
- **不要开 v0.4.13**，除非用户重开后报出新的生产缺陷

## 最短人工验收路径（必须完全退出后重开）

1. 杀掉所有 CraftStation / Electron 窗口，重新打开。
2. 点左侧「模型与用量」（钥匙/账号按钮）。Grok 账号池应有 6 行短名（`her`/`poi`/`hao`），都是启用；邮箱是前3后3，例如 `her***g01@gmail.com`。
3. **不先点某行**：直接新建 Grok 对话发一句短消息。
   - 若当前首选号没额度：应出现「Grok 额度已耗尽」，然后**再新建**一句 Auto 对话，应落到下一个有额度号并回复。
   - 若直接回复了，说明当前首选正好有额度，跳到第 4 步即可。
4. 回到「模型与用量」，**点账号行的名字**（不要点「登录授权」）选一张你确认有额度的卡，再新建对话发一句 → 应回复。
5. 点一张没额度的行再发 → 「Grok 额度已耗尽」，不要偷偷换号。
6. 右键一行改名，关掉 dialog 再打开，名字还在。
7. 保持一个已打开 Session，改首选到另一张卡：旧 Session 仍走原来的号。
