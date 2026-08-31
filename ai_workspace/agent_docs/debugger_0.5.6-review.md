# Debugger — v0.5.6 Re-review

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + 未提交 v0.5.3–v0.5.6）
>
> Coder 交付：[coder_0.5.6.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/coder_0.5.6.md)
>
> Fix Plan：[debugger_0.5.6.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.6.md)
>
> 真实探针：[v0.5.6-grok-quota-probe.json](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/validation/v0.5.6-grok-quota-probe.json)
>
> Verdict：**FAIL / BLOCKED**（F32 / F34 工程项关闭；F33 真实额度未关闭；Feature 不能 PASS）
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。不 commit / tag / push。

## Review Scope

独立复检 Coder v0.5.6 对 F32 / F33 / F34 的修复。不以 Coder 自检、测试绿灯或 `x.ai/billing Method not found` 升格为 Feature PASS。Computer Use 本轮不作为验收入口；F32 / F34 以源码 + 定向测试为准，F33 以真实 managed probe JSON 为准。

## Independent Validation / Evidence

- 定向 Vitest：`SidebarProviderAccounts.test.tsx` + `grokProfiles.test.ts`，**2 files / 40 passed**
- `pnpm exec tsc --noEmit -p tsconfig.json`：**通过**
- 触及文件 type-aware oxlint：**通过**
- 触及文件 `oxfmt --check`：**通过**（5 files）
- 触及已跟踪文件 `git diff --check`：**通过**
- 真实探针：`synthetic=false`，`hostHomeUsed=false`，`initialize=ok`，`billing=error`，`errorClass=method-not-found`，`windowCount=0`，`conclusion=RUNTIME_UNAVAILABLE_FOR_BILLING`
- 未读取 / 输出 token、cookie、refresh token；未覆盖 `~/.grok/auth.json`；未接 CLIProxyAPI / Router oauth

## Spec Fidelity

### F32 — 恢复 ProviderIcon：关闭

源码已把主 logo 接回 `ProviderIcon`：

- `ProviderBadge` 使用 `ProviderIcon`，`kind` 为厂商 id，不再 `label.slice(0, 2)`
- `AccountRow` 使用 `ProviderIcon kind={account.provider}`，testid `account-provider-icon-<id>`
- 右侧未授权卡同样走 `ProviderBadge`
- 测试导入 `@/renderer/components/providers/bootstrap`，断言 Grok 账号行 / Grok badge / OpenAI-compatible 走 ProviderIcon seam，且不出现 `Gr` / `Op` 两字母主 logo

本项按源码 + 测试关闭。现场窗口未再截图，不把 Computer Use 失败写成 logo 未修。

### F34 — Kimi 卡自适应高度：关闭

- `authorized-provider-grid` 现为 `grid-cols-2 items-start content-start`
- `ProviderCard` / `ManagedAccountPool` / `AccountRow` 带 `self-start h-fit`
- 测试锁定 Kimi 授权卡 `self-start h-fit`，以及 authorized grid `items-start`

本项按源码 + 测试关闭。

### F33 — 真实 Grok 额度：仍 FAIL / BLOCKED

工程接线已前进，但验收门未过：

1. 新增 `grokQuotaNative.ts`：managed `GROK_HOME` spawn 官方 `grok agent stdio`，先 `initialize` 再 `x.ai/billing`。瞬态（EOF / fetch failed / socket / timeout / SSL/TLS）可重试一次；`Method not found` **不是** transient，不会重试。这是诚实的。
2. 真实 `hao` managed probe：initialize 成功，官方 CLI 对该方法返回 `Method not found`，`windowCount=0`，没有 usedPercent / resetsAt。
3. `GrokProfileService.collectQuota` 在 native 失败后 fallback `collectGrok`。但这条 fallback 不能当 PASS：
   - `classifyGrokQuotaTransportError()` 只有 timeout / abort / http / **network**。`Method not found` 会被标成 network，于是 UI 继续显示 `--%` + network error。
   - `collectGrok` 的 cookie 路径要 grok.com session cookie；官方 CLI `auth.json` 通常只有 OIDC access/refresh，没有这条 cookie。
   - token 路径走 `cli-chat-proxy.grok.com/v1/billing`，没有 Cockpit 那种 SSL/EOF 瞬态重试。
   - Token Monitor 在 CLI RPC 失败后，用 **access token Bearer** 打 grok.com gRPC-web `GetGrokCreditsConfig`，并只对 CONNECT/reset/timeout 重试一次。CraftStation 没有这条 token-as-bearer 的 gRPC fallback。
4. 测试只 mock native RPC 成功 / 瞬态重试 / 解析；`collectQuota` 用例仍 mock `collectGrok` 返回 95%。没有锁定 `Method not found` 的诚实错误类，也没有真实 usedPercent。

对照思想（不复制源码）：

- Token Monitor `grokLimits.js`：主路径同样是 `grok agent stdio` + `x.ai/billing`；当前安装的官方 CLI 不暴露该方法时，它会落到 grok.com gRPC-web。
- Cockpit `grok_account.rs`：主路径是 `cli-chat-proxy` billing/user，并对 SSL EOF / 超时做有限重试。

因此：官方 CLI RPC 对本机 grok 不可用，不等于额度监控完成。没有真实数字，F33 不能关。

## Integration / Regression / Edge Cases

- F30 / F31 壳层保持关闭（inline workspace、已授权每行两列、长条额度）。
- F08–F13 边界保持：受管 `GROK_HOME`，不覆盖 `~/.grok`，不导入 Router oauth，不接 CLIProxyAPI。
- F29 exact Token / v0.4 F04 五 Harness 仍 BLOCKED，本轮未扩大。
- `ModelUsageWorkspace.tsx` 与 `grokQuotaNative.ts` 仍是未跟踪新文件，不影响本轮复检结论。

## Findings

1. **[F32 关闭]** ProviderIcon 已接回账号行与厂商卡，两字母主 logo 路径已删除。
2. **[F34 关闭]** 主列 grid `items-start`，Kimi / 账号卡 `self-start h-fit`。
3. **[F33 仍开]** 官方 `x.ai/billing` 对本机 CLI 返回 `Method not found`；真实 probe 无 quota window。
4. **[F33 错误语义]** native 永久失败被 `classifyGrokQuotaTransportError` 写成 network，掩盖了 “CLI 不支持 billing RPC”。
5. **[F33 fallback 不足]** 没有 Token Monitor 那种 access-token gRPC-web，也没有 Cockpit 那种 `cli-chat-proxy` 瞬态重试；现有 `collectGrok` 不能把真实 usedPercent 送到账号卡。

## Verdict

`FAIL / BLOCKED`

- F32 / F34：关闭
- F33：仍打开（无真实 usedPercent）
- Feature v0.5.0：不能 PASS
- v0.4 F04：仍 FAIL/BLOCKED
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**

下一 Fix Cycle：`v0.5.7`，范围只剩 F33 真实额度路径。F32 / F34 不要重做。

## Next Fix Plan

见 [debugger_0.5.7.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.7.md)。
