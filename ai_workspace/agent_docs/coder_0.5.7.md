# Coder 交付：v0.5.7 F33 Grok 真实额度链路

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
状态：F33 工程修复完成；真实额度证据仍 BLOCKED，交 Debugger 独立复检

## 本轮范围

本轮只处理 F33，不重开已关闭的 F32/F34，也没有扩大到 F29 exact Token 或 v0.4 五 Harness。

## 实现

### Native billing RPC

- `src/supervisor/runtime/grokQuotaNative.ts` 保留 managed `GROK_HOME` 下官方 `grok agent stdio` 为第一路径。
- 先发送 `initialize`，再发送 `x.ai/billing`；成功时只投影脱敏 quota window metadata、`usedPercent` 和 `resetsAt`。
- JSON-RPC `-32601` / `Method not found` 通过 `NativeGrokQuotaRpcError` 标为 `unsupported-method`，不做瞬态重试，也不伪装成 `network`。
- EOF、连接重置、timeout、SSL/TLS 等瞬态错误仅做有限重试。

### Managed token billing fallback

- 新增 `src/supervisor/runtime/grokQuotaTokenFallback.ts`，读取当前 managed profile 的 OAuth access token，仅在 supervisor 内使用，Renderer 不接触 secret。
- 顺序为：managed Bearer → `cli-chat-proxy.grok.com/v1/billing?format=credits` → `v1/billing` → Grok gRPC-web `GetGrokCreditsConfig`。
- proxy 和 gRPC-web 请求均对 timeout、EOF、fetch failed、connect/reset、SSL/TLS 做最多三次有限尝试；401/403 保持 `auth`，其他 HTTP 状态保持 `http`，不把失败冒充成功窗口。
- 自实现 gRPC-web frame/protobuf quota 投影；没有可解析的真实窗口时返回 `invalid`/对应错误分类。
- 只有 managed `auth.json` 真有 cookie 时才允许旧 `collectGrok` cookie 路径；无 cookie 不假装走 cookie，也不读 host `~/.grok` 或 Codex Router oauth 池。

### Service 接线与错误可见性

- `GrokProfileService.collectQuota` 先走 native，再走 managed token fallback；成功只更新当前 account 的 quota/status。
- fallback 失败时保留 native `unsupported-method` 与 token/legacy transport 的具体诊断；timeout、HTTP、auth 不再被统一覆盖成 network。
- managed profile 的 quota 失败不会修改其他账号，也不会改变已绑定 Session。

## Regression Validation

以下检查均通过：

- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/grokProfiles.test.ts src/supervisor/runtime/grokQuotaTokenFallback.test.ts --reporter=verbose`
  - 2 个测试文件，22 个测试通过。
  - 覆盖 native 成功、managed `GROK_HOME`、unsupported-method 不重试、proxy → gRPC-web 顺序、Bearer 隔离、瞬态重试、0% 合法值、无 cookie/auth 负向，以及 service 的 account-scoped 更新和错误分类。
- `pnpm exec vitest run --configLoader runner src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx --reporter=verbose`
  - 1 个测试文件，24 个测试通过，F32/F34 回归保持通过。
- `pnpm run typecheck`
  - 通过。
- 触及文件 `oxlint --deny-warnings`
  - 通过。
- 触及文件 `oxfmt --check`
  - 通过。
- `git diff --check`
  - 通过。

## 真实 managed probe

使用已有且未列入禁止重复探测清单的 `hao` managed profile：

- account 摘要：`grok:071e94ac`
- `managedHome=true`
- `hostHomeUsed=false`
- `synthetic=false`
- 官方 native billing 仍未取得 quota window；本次生产路径结果为 `status=unavailable`、`quotaWindows=[]`、`errorClass=network`。
- 没有真实 `usedPercent`，因此不能把 F33 或 Feature v0.5.0 写成 PASS。

脱敏证据：[v0.5.7-grok-quota-probe.json](../validation/v0.5.7-grok-quota-probe.json)。证据只含 provider、截断 accountRef、maskedIdentity、managed/host/synthetic 标志、状态、窗口 metadata 和错误分类，不含 token、cookie、auth 内容或物理凭据路径。

## 结论与边界

- F33：工程路径与错误分类已修复；真实 Grok quota 仍 BLOCKED，因为本次 managed probe 没有取得数字窗口。
- F29 exact Token 真实证据仍 BLOCKED。
- v0.4 F04 五 Harness 仍 FAIL/BLOCKED。
- 不使用 CLIProxyAPI 作为 Native Grok Adapter，不导入 Codex Router `xai-*.oauth.json`，不覆盖 `~/.grok/auth.json`，不复活旧 DSH/Gemini CLI/Model API 假 Harness。
- 未 commit、tag、push 或 merge main；未宣称 Feature PASS。

请 Debugger 在 `dev` worktree 读取本交付文档与脱敏 validation 证据，执行独立 Re-review。
