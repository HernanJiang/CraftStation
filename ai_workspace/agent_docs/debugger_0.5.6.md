# Debugger — v0.5.6 Fix Plan

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + 未提交 v0.5.3–v0.5.5）
>
> 用户现场证据：点左下角「模型与用量」后的 inline workspace 截图
>
> 上一轮：[debugger_0.5.5-review.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.5-review.md)
>
> Verdict：**FAIL**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

F30/F31 壳层已关闭之后，用户用现场 UI 指出三个产品缺口：账号/厂商 logo 消失、Grok 额度仍是 network error、Kimi 卡被主列 grid 拉高且底下没有模型。本轮按源码 + 现场截图 + Cockpit / Token Monitor 的额度路径思想独立复检。不直接复制参考源码。

## Evidence

### 现场 UI

- 左下角进入 inline workspace（F30 保持）。
- Grok 账号行没有厂商 logo，只剩邮箱/别名与按钮。
- 右栏未授权厂商卡也是两字母圆圈（Ch / Op / Cl），不是 `ProviderIcon`。
- 每个 Grok 账号：5h / 周月限额 `--%`，`unavailable`，黄字 `ledger has no exact telemetry` + `Grok quota request failed (network): grok billing check failed (network error)`。
- Kimi Code 能读出 5h 0% / 周月 100% 与恢复时间，但卡被拉到跟右侧 Grok 账号池一样高，底部是空白，没有模型。

### 源码

- `ProviderBadge` 只 `label.slice(0, 2)`，不调 `ProviderIcon`。
- `AccountRow` 左侧只有拖拽点，没有厂商图标。
- `GrokProfileService.collectQuota` 走 `@poracode/agents-usage` 的 `collectGrok`：先 `https://cli-chat-proxy.grok.com/v1/billing`，再 cookie gRPC。没有 Token Monitor 的 official `grok agent stdio` + `x.ai/billing` RPC，也没有 Cockpit 的瞬态 SSL/EOF 重试。
- `classifyGrokQuotaTransportError` 把非 timeout/abort 的异常全部归类为 `network`。
- 主列 `authorized-provider-grid` 是 `grid-cols-2 content-start`，**没有 `items-start`**；CSS Grid 默认 `align-items: stretch`，Kimi `ProviderCard` 被拉到 Grok 账号池高度。

### 参考路径（只参考思想，禁止复制源码）

- Token Monitor `grokLimits.js`：**主路径**在 managed `GROK_HOME` 下 spawn 官方 `grok agent stdio`，JSON-RPC `x.ai/billing`；失败再 fallback grok.com gRPC-web，并对 CONNECT/SSL 做一次重试。
- Cockpit `grok_account.rs`：`cli-chat-proxy.grok.com/v1/billing?format=credits` + `user?include=subscription` + `grok.com/rest/tasks/usage`，对 SSL EOF/断连/超时重试。
- 产品聊天已能走 official Grok ACP，说明 managed `GROK_HOME` + 官方 CLI 可用。额度还只打反向代理 HTTP就失败，是 collector 路径错了，不是用户没有号。

## Spec Fidelity

- F30/F31 壳层仍成立：inline workspace、主列两列、长条 5h+周月。
- 用户要的是真实额度数字和厂商 logo，不是 `--%` + network error 占位。
- Feature 仍不能 PASS；v0.4 F04 仍 FAIL/BLOCKED。

## Findings

### F32 — 账号与厂商卡丢失 logo

- Evidence：现场截图；`ProviderBadge` 只渲染两字母；`AccountRow` 无 `ProviderIcon`。
- Impact：右栏 ChatGPT/OpenAI/Claude/GitHub/Cursor 等看不清是谁；Grok 账号池也没有品牌图标。
- Root Cause：v0.5.5 workspace 用最小徽章替代原先的 `ProviderIcon`。
- Fix：主列账号池标题、每个 `AccountRow`、已授权 `ProviderCard`、右栏紧凑卡全部用现有 `ProviderIcon`（按 `provider`/`id` 查 registry）。禁止再用 `slice(0,2)` 当主 logo。
- Acceptance：测试能在 Grok 账号行与右栏 Grok/其他厂商卡找到 `ProviderIcon`（`data-testid` 或 role/img）；不得出现 `Ch`/`Op`/`Cl` 这种两字母主图标。

### F33 — Grok 额度没有按官方 CLI/Cockpit 路径采集

- Evidence：四个已导入 Grok 账号全是 `Grok quota request failed (network)`；Kimi 同一页面有真实 5h/ 周月百分比。
- Impact：用户要求的号池额度监控没有数字；不能用测试绿灯冒充。
- Root Cause：`collectQuota` 只走 `collectGrok` HTTP/gRPC，没有先用 managed `GROK_HOME` 下官方 `grok agent stdio` 的 `x.ai/billing`；HTTP 路径无 Cockpit 式瞬态重试，一次 TLS/EOF 就全部 `unavailable`。
- Fix：自实现 CraftStation Grok quota collector（不复制参考源码）：
  1. **Primary**：在该账号 managed `GROK_HOME` 下 spawn 官方 `grok agent stdio`，JSON-RPC `x.ai/billing`（与 Token Monitor 主路径同思想，与已验证的 ACP 聊天同 CLI）。
  2. **Retry**：对 SSL EOF / `fetch failed` / CONNECT reset / timeout 做有限重试（Cockpit 思想）。
  3. **Fallback**：RPC 失败再走现有 `collectGrok` / `cli-chat-proxy` / gRPC-web，同样重试。
  4. **窗口映射**：官方 payload 有 5h / 周 / 月就填长条；没有 5h 不得用 `--%` + network error 假装。可以读官方 `tasks/usage` 补短窗口，但禁止 CLIProxyAPI / Router oauth / 第三方 Grok API。
  5. 至少一个已导入且能聊天的 Grok 账号必须出现**真实 usedPercent**（不是 `--%`）。若某账号确实失败，保留该账号的诚实错误，不要把全池打成 network error。
- Acceptance：自实现 collector 测试（mock stdio RPC 成功 / 瞬态失败重试 / 全失败保留诚实错误）；**真实 managed GROK_HOME probe** 至少一个账号拿到非空 billing window，写入 `ai_workspace/validation/v0.5.6-grok-quota-probe.json`（只 metadata / percent / reset，禁 token/cookie）。没有真实数字不得称 F33 关闭。

### F34 — Kimi 卡被主列 grid 拉高，不自适应

- Evidence：截图 2；主列 `grid-cols-2` 无 `items-start`。
- Impact：Kimi 卡底部大块空白，看起来没有模型、也不跟 Grok 池对齐。
- Root Cause：CSS Grid 默认 stretch；已授权 `ProviderCard` 还带 `min-h-[170px]`。
- Fix：`authorized-provider-grid` 加 `items-start`；`ManagedAccountPool` / `ProviderCard` 加 `self-start h-fit`。Kimi 卡高度跟内容；若 snapshot 有 models 就紧凑展示，没有就别留空白、别造假模型。
- Acceptance：测试锁 `data-testid=authorized-provider-grid` 含 `items-start`；Kimi 卡 `self-start` / `h-fit`；布局测试里 Grok 池再高也不能让 Kimi 卡 `offsetHeight` 跟它拉齐。

## Verdict

`FAIL`

- F30/F31 壳层：仍关闭
- F32 / F33 / F34：打开
- Feature v0.5.0：不能 PASS
- v0.4 F04：仍 FAIL/BLOCKED
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**

## Fix Plan

修复 F32 / F33 / F34。不扩大到新 Feature。不宣称 PASS。不 commit/tag/push。

## Fix Acceptance Criteria

1. 账号行与右栏厂商卡使用 `ProviderIcon`，不再以两字母圆圈为主图标。
2. Grok 额度 collector 以 managed `GROK_HOME` + 官方 CLI `x.ai/billing` 为主路径；至少一个真实账号 probe 出 usedPercent；写入脱敏 validation JSON。
3. Kimi/其它单账号卡自适应高度，不被右列 Grok 池拉高。
4. 不复制 Cockpit / Token Monitor 源码；不导入 Router oauth；不覆盖 `~/.grok/auth.json`。
5. 定向测试 + typecheck + 触及文件 lint/fmt。不要用测试绿灯替代 F33 真实 probe。

## Fix Execution Order

1. F32 logo：`ProviderIcon` 接回 workspace / AccountRow / 右栏卡。
2. F34 layout：`items-start` + `self-start h-fit`，再补模型 chips。
3. F33 quota：official CLI billing RPC + retry + 真实 probe。
4. 回归 `SidebarProviderAccounts.test.tsx` 与 Grok quota 单测。
5. 交付 `coder_0.5.6.md` + validation JSON，通知 Debugger 复检。

下一步：Coder 在 `D:\Work\CraftStation\craftstation-dev` 一次性执行本 Fix Plan。
