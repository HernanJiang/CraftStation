# Coder 交付：v0.5.6 Native Grok quota 与 Provider UI 修复

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
状态：F32/F34 工程修复完成；F33 已接入官方 managed billing collector，但真实额度证据仍 BLOCKED，交 Debugger 独立复检

## 本轮实现

### F32：恢复 ProviderIcon

- `ModelUsageWorkspace` 的 ProviderBadge、已授权账号行、Grok/Codex 账号池和右侧厂商卡均使用现有 `ProviderIcon` 注册表。
- 移除了以 `label.slice(0, 2)` 作为主 logo 的路径；没有注册图标时仍由现有 `ProviderIcon` 统一处理 fallback。
- 增加 renderer 回归断言，确认 Grok 账号行、Grok 卡和 OpenAI-compatible 卡通过 ProviderIcon seam 渲染。

### F34：授权卡自适应高度

- `authorized-provider-grid` 增加 `items-start`，保持主列已授权厂商每行两列。
- ProviderCard、ManagedAccountPool、AccountRow 和右侧未授权卡使用 `self-start h-fit`，Kimi 单账号卡不会被 Grok 账号池的高度拉伸。
- 增加 Kimi、Grok 账号池结构断言，锁定 `items-start` 与 `self-start h-fit`。

### F33：官方 Grok managed billing collector

- 新增 `src/supervisor/runtime/grokQuotaNative.ts`。
- 主路径在对应账号的 managed `GROK_HOME` 下启动官方 `grok agent stdio`，发送 `initialize` 后发送 `x.ai/billing`。
- 只投影 quota window 的 id、label、usedPercent、resetsAt；不投影 token、cookie、access token 或 Router oauth。
- 对 EOF、fetch failed、连接重置、socket、timeout、SSL/TLS 等瞬态错误执行有限重试；失败后回退现有 account-scoped `collectGrok`，保留真实 transport/auth/HTTP 错误。
- `managedGrokProcessEnvironment` 继续隔离宿主 `GROK_HOME`、API key、CLIProxy、Codex Router 和 Model Catalog 环境变量。
- GrokProfileService native 成功时只更新当前 account 的 quota/status，不触碰其他账号或 `~/.grok`。

## 真实 managed probe

已执行一个不重复已知耗尽账号的真实 `hao` profile 探针。结果：

- 官方 Grok runtime 在 managed profile 下成功启动并完成 `initialize`。
- `x.ai/billing` 返回官方 JSON-RPC `Method not found`。
- 未取得真实 quota window，因此没有写入虚构的百分比或 reset；F33 真实额度门保持 BLOCKED。
- 脱敏证据：[v0.5.6-grok-quota-probe.json](../validation/v0.5.6-grok-quota-probe.json)。文件只包含账号摘要、运行阶段、错误分类和窗口数量，不包含 token、cookie、auth 内容或物理凭据路径。

## Regression Validation

- `pnpm exec vitest run src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx src/supervisor/runtime/grokProfiles.test.ts --reporter=verbose`
  - 2 个测试文件、40 个测试通过。
  - 覆盖 ProviderIcon、主列两列、Kimi/Grok 自适应高度、managed `GROK_HOME`、`x.ai/billing` 顺序、native parser、瞬态重试、fallback credential seam 和错误分类。
- `pnpm run typecheck`
  - 通过。
- 触及源码的 `oxlint`
  - 通过。
- 触及文件的 `oxfmt --check`
  - 通过。
- `git diff --check`
  - 通过。
- 仓库级 lint 仍受既有 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 与工作树已有临时文件影响；未扩大范围修改或清理这些并行内容。

## 边界与状态

- F32、F34：工程修复完成，交 Debugger 独立复检。
- F33：collector 工程测试完成；真实 `x.ai/billing` 在当前官方 CLI 中不可用，真实 Grok billing/Token 证据保持 BLOCKED。
- F29、v0.4 F04 与 Feature v0.5.0：仍不能 PASS。
- 未使用 CLIProxyAPI、旧 DSH、Gemini CLI 或 Model API 假 Harness。
- 未读取或导入 Codex Router `xai-*.oauth.json`，未覆盖 `~/.grok/auth.json`，Renderer 未接触 secret。
- 未 commit、tag、push 或 merge main。

请 Debugger 在 `dev` worktree 读取本交付文档和 validation 证据，执行独立 Re-review。
