# Debugger — v0.5.7 Fix Plan

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + 未提交 v0.5.3–v0.5.6）
>
> 上一轮复检：[debugger_0.5.6-review.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.6-review.md)
>
> Verdict：**FAIL**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

v0.5.6 已关闭 F32 / F34。本轮只修 **F33 真实 Grok 额度**。不要重做 logo，不要重做 Kimi 高度，不要扩大到 Token exact / 五 Harness。

## Evidence

- 真实 managed probe：官方 `grok agent stdio` `initialize=ok`，`x.ai/billing` = `Method not found`，`windowCount=0`。见 [v0.5.6-grok-quota-probe.json](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/validation/v0.5.6-grok-quota-probe.json)。
- `classifyGrokQuotaTransportError()` 把该错误标成 `network`。
- Token Monitor 思想：CLI RPC 失败后，用 managed `auth.json` 的 access token 作为 Bearer，请求 grok.com gRPC-web `GetGrokCreditsConfig`，并对 CONNECT/reset/timeout 做一次重试。
- Cockpit 思想：`cli-chat-proxy.grok.com/v1/billing?format=credits` + SSL/EOF/timeout 有限重试。
- 禁止：复制参考源码；导入 Codex Router oauth/cookie；覆盖 `~/.grok/auth.json`；CLIProxyAPI；第三方 Grok API；把 `Method not found` 或测试绿灯写成 PASS。

## Findings

### F33 — 真实额度仍是 `--%`，CLI billing RPC 对本机不可用

- Evidence：用户现场 `--%` + network error；v0.5.6 probe `errorClass=method-not-found`。
- Impact：账号池能登录、能聊天，但用量页没有可操作的周/5h 数字和恢复时间。
- Root Cause：当前安装的官方 Grok CLI 不暴露 `x.ai/billing`。CraftStation 把它当网络失败，且 fallback 没有走到 Token Monitor / Cockpit 那种 **token billing** 路径。
- Fix：
  1. **诚实分类**：`Method not found` / `-32601` 记为 `unsupported-method`，UI 不得显示 “network error”。在 fallback 成功前，文案应说明官方 CLI 不支持 billing RPC，正在走 token billing。
  2. **保留 native 主路径**：managed `GROK_HOME` + 官方 `grok agent stdio` + `x.ai/billing`。成功则直接投影 window。该方法永久失败时不要重试。
  3. **token fallback（必须自己实现，禁止贴源码）**：
     - 先用 managed `auth.json` 的 access token 打 `cli-chat-proxy` credits/billing；对 SSL/EOF/CONNECT reset/timeout 做有限重试（建议 2–3 次）。
     - 若仍无 window，再用同一 access token Bearer 打 grok.com gRPC-web credits config；同样只重试瞬态错误。
     - cookie 路径仅在 `auth.json` 真有 grok.com cookie 时使用；没有 cookie 不要假装走了 cookie。
  4. **窗口映射**：有 5h / 周 / 月就填长条；没有 5h 不要用 `--%` + network 假装。失败账号保留该账号自己的诚实错误类，不要把全池打成同一句 network error。
  5. **真实门**：至少一个已导入且能聊天的 managed Grok 账号必须出现真实 `usedPercent`（0 也算数字，`--` 不算）。写入 `ai_workspace/validation/v0.5.7-grok-quota-probe.json`，只记录 metadata / percent / reset / errorClass，禁止 token/cookie。

## Verdict

`FAIL`

- F32 / F34：保持关闭，不要重做
- F33：打开
- Feature v0.5.0：不能 PASS
- v0.4 F04：仍 FAIL/BLOCKED
- Requires Manager Re-plan: **No**

## Fix Plan

只修 F33。完成后回归 F32 / F34 定向测试，确认 logo 与高度没有回退。不宣称 PASS。不 commit/tag/push。

## Fix Acceptance Criteria

1. native `x.ai/billing` 仍是第一路径；`Method not found` 不重试、不标 network。
2. fallback 使用 managed profile 的 access token（可刷新），覆盖 `cli-chat-proxy` 与 grok.com gRPC-web 两条 token billing，并带瞬态重试。
3. 至少一个真实 managed 账号 probe 出非空 quota window / usedPercent，写入 v0.5.7 validation JSON。
4. Renderer 对有数字的窗口显示百分比和恢复时间；对无数字的账号显示诚实错误类。
5. 定向测试：native 成功、method-not-found 不重试、token fallback 成功、瞬态重试、无 identity/无 cookie 负向。typecheck + 触及文件 lint/fmt。测试绿灯不能替代真实 probe。
6. 不复制 Cockpit / Token Monitor 源码；不导入 Router oauth；不覆盖 `~/.grok/auth.json`。

## Fix Execution Order

1. 错误分类：把 CLI `Method not found` 从 network 里拆出来。
2. 实现 managed-home token billing fallback（proxy → gRPC-web），带瞬态重试和 refresh lock。
3. 把真实 window 写回该账号 `quota` / status；失败只更新该账号 `lastError`。
4. 用一个有额度、一个无额度的真实账号做 probe；有额度的必须出数字。
5. 回归 F32 / F34 测试与 typecheck/lint/fmt。
6. 更新 `coder_0.5.7.md` 后通知 Debugger 复检。
