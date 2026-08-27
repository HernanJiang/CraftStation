# Coder — v0.4.11 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.11`
>
> 日期：2026-08-27
>
> 状态：已按 `debugger_0.4.11-native-harness.md` 连续完成 F21、F22、F23，完成回归验证，等待 Debugger 独立复检。

## 输入与边界

- Fix Plan：`ai_workspace/agent_docs/debugger_0.4.11-native-harness.md`
- 本轮只处理 F21（额度耗尽落盘与 Auto 填补）、F22（点选账号与 Session 绑定）和 F23（掩码、默认名、重命名）。
- F04 五 Harness 产品级真实 response 仍为 `BLOCKED`，本轮不宣称 Feature PASS。
- 未读取、复制或导入 Codex Router 的 `xai-*.oauth.json`、cookie 或 token；未覆盖 `~/.grok/auth.json`；未接入 CLIProxyAPI；未复活旧 DSH/Gemini CLI/Model API 假 Harness。

## F21 — 额度错误、状态落盘与 Auto 填补

已完成：

- ACP 额度错误改为 duck-type 识别，不依赖可能跨 Electron bundle 的 `RequestError instanceof`：
  - 读取 `error.data.http_status`；
  - 读取 `error.data.message`；
  - 官方 Grok `402` + `usage balance exhausted` 映射为 `Grok 额度已耗尽`，不再显示泛化的 `Internal error`。
- `AcpStructuredSession` 增加 raw prompt error observer；`craftAgent`/`resumeCraftAgent` 另保留 Supervisor 防御性 catch，覆盖首条 `sendPrompt` 直接抛错的路径。
- 状态更新绑定到 Session 创建时的 immutable `accountBinding.accountId`，仅将对应 Grok 账号写为 `quota-exhausted`，同时原子记录 `lastQuotaAt` 与脱敏 `lastError`，并发出账号刷新事件。
- Auto resolver 跳过 `disabled`、`quota-exhausted`、`auth-expired`、`unavailable`，按持久化 `order` 选择下一个 enabled 的 `available`/`quota-low` 账号。
- selected 账号耗尽时，新的 Auto Session 可按顺序回退；explicit 账号耗尽时直接报错，不偷偷切换；已有 Session 的绑定不变。
- Grok 官方身份导入成功后默认 `enabled=true`，不会因设置首选而批量禁用其他账号。

## F22 — 点选账号与登录授权分离

已完成：

- 紧凑账号行点击现在先调用 `setAccountEnabled({ accountId, enabled: true })`，再调用 `selectAccount({ accountId })`，并刷新账号列表。
- “登录授权”只处理未认证/过期账号；不会承担选号职责，也不会调用普通 usage browser login。
- 新建 Auto Session 使用最新 selected/ordered resolver，返回并保留 account binding；已启动 Session 继续 sticky 到原账号，即使之后改变 selected。

## F23 — 身份掩码、默认名与重命名

已完成：

- 邮箱 local-part 显示为前 3 位 + `***` + 后 3 位；local-part 不足 6 位时完整显示 local-part。
- Grok 导入默认 label 使用邮箱前缀前三位；已存在的 `New Grok` 记录在重新读取 Store 时按官方身份重算。
- 新增安全 `renameAccount` IPC，空名称拒绝，不修改 credential；Renderer 仅使用 `AccountView`，不暴露 secret。
- 账号行支持右键重命名；改名后通过 IPC 和账号列表刷新保持持久化。

## 相关实现与测试

本轮关键生产文件：

- `craftstation/src/supervisor/agents/acp/sessionErrors.ts`
- `craftstation/src/supervisor/agents/acp/session.ts`
- `craftstation/src/supervisor/agents/acp/sessionFactory.ts`
- `craftstation/src/supervisor/runtime/accountResolver.ts`
- `craftstation/src/supervisor/runtime/accountStore.ts`
- `craftstation/src/supervisor/runtime/grokProfiles.ts`
- `craftstation/src/supervisor/runtime/nativeHarness/index.ts`
- `craftstation/src/supervisor/runtime/nativeHarness/structuredAdapter.ts`
- `craftstation/src/supervisor/supervisorRuntime.ts`
- `craftstation/src/shared/contracts/accounts.ts`
- `craftstation/src/shared/ipc/procedures/usage.ts`
- `craftstation/src/renderer/actions/agentLoginActions.ts`
- `craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx`

本轮关键验证文件：

- `craftstation/src/supervisor/runtime.test.ts`
- `craftstation/src/supervisor/runtime/accountResolver.test.ts`
- `craftstation/src/supervisor/runtime/accountStore.test.ts`
- `craftstation/src/supervisor/runtime/grokProfiles.test.ts`
- `craftstation/src/supervisor/agents/acp/session.test.ts`
- `craftstation/src/renderer/actions/agentLoginActions.test.ts`
- `craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`

## Regression Validation

已执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/agents/acp/session.test.ts src/supervisor/runtime/nativeHarness/nativeHarness.test.ts src/supervisor/runtime.test.ts src/supervisor/runtime/accountResolver.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/grokProfiles.test.ts src/renderer/actions/agentLoginActions.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx
→ 8 files / 239 tests passed

pnpm typecheck
→ passed

pnpm lint
→ passed

git diff --check
→ passed；仅保留既有 CRLF normalization warnings
```

覆盖重点：

- 官方 Grok `data.message` + `http_status=402` 文案与状态落盘；
- `craftAgent` 首条 prompt rejection；
- Auto fallback、selected exhausted fallback、explicit no-fallback、Session sticky；
- 账号行 `enable + select`；
- 邮箱掩码、默认名、右键重命名与空名拒绝；
- F08 Grok device-auth 路径仍不导航 `grok.com`；
- F12/F14 隔离登录回归保持通过。

## 交付边界

- 本轮没有 commit、tag 或 push。
- F04 仍不得关闭：Codex 单次可审计证据不等于五 Harness 产品级 PASS；Kimi、Antigravity、DeepSeek/DSH 的外部条件/真实 session 缺口保持原状态。
- `DeepSeek/DSH` 继续 `RUNTIME_UNAVAILABLE`，不创建 synthetic Entity/Session。

请 Debugger 读取本报告与 `PROJECT_STATUS.md`，对 F21/F22/F23 进行独立复检；F04 的 BLOCKED 条件保持不变。
