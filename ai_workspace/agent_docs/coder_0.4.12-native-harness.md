# Coder — v0.4.12 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.12`
>
> 日期：2026-08-27
>
> 状态：已按 `debugger_0.4.12-native-harness.md` 连续完成 F24 与 F22 剩余项，完成回归验证，等待 Debugger 独立复检。

## 输入与边界

- Fix Plan：`ai_workspace/agent_docs/debugger_0.4.12-native-harness.md`
- 上一轮交付：`ai_workspace/agent_docs/coder_0.4.11-native-harness.md`
- 本轮只修复：F24 legacy disabled Grok 账号恢复，以及 F22 侧栏紧凑账号行的选号/改名路径。
- F21/F23 已保持；F04 五 Harness 产品级真实 response 仍为 `BLOCKED`，本轮不宣称 Feature PASS。
- 未读取、复制或导入 Codex Router `xai-*.oauth.json`、cookie 或 token；未覆盖 `~/.grok/auth.json`；未接入 CLIProxyAPI；未复活旧 DSH/Gemini CLI/Model API 假 Harness。

## F24 — legacy disabled Grok 账号恢复

已完成：

- `AccountStore` 启动时执行完整元数据迁移，而不是只处理首条记录。
- 仅当账号是 Grok 且存在官方 identity 信号（`providerAccountId` 或 masked email 含 `@`），同时满足 `enabled=false` 与 `status=disabled` 时，恢复为 `enabled=true`、`status=available`。
- 不改变 `selected`、`order`、credential scope 或其他账号；已经是 `quota-exhausted` / `auth-expired` 的账号不会被强行恢复为 available。
- 修复了迁移遍历中的 `.some()` 短路缺陷：6 个账号中的每一条 legacy 记录都会被检查并持久化，避免现场只恢复第一个账号。

## F22 — 侧栏紧凑卡选号与改名

已完成：

- `ProviderCard` 中实际渲染的 compact managed account row 支持整行点击和键盘 Enter/Space。
- 点击账号行严格执行 `setAccountEnabled({ accountId, enabled: true })` → `selectAccount({ accountId })` → `listAccounts({ provider })` 刷新；不会调用 `createAndRunGrokProfileLogin`。
- 右键账号行调用 `renameAccount`；空名在 Renderer 侧拒绝，Supervisor IPC 仍执行最终校验；不会触碰 credential。
- compact 行中的“登录授权”按钮使用 `stopPropagation`，只处理未认证/过期登录，不会冒泡为选号。
- 已打开 Session 的 sticky account binding 与 F21 Auto/explicit 语义未改变。

## 诊断与 TDD 证据

本轮通过两个 red-capable seam 复现了 Debugger 的用户症状：

1. Store 重开后 5 条 `grok + official email + disabled` 记录仍为 disabled；
2. 侧栏 `provider-card-grok` 内部紧凑账号行没有触发 `enable + select`。

先补回归测试并确认上述红灯，再实现最小修复。期间发现 `.some()` 会在第一条迁移成功后提前结束，补充全量遍历后迁移测试恢复为绿。

## 相关实现与测试

实现文件：

- `craftstation/src/supervisor/runtime/accountStore.ts`
- `craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx`

验证文件：

- `craftstation/src/supervisor/runtime/accountStore.test.ts`
- `craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`

本轮回归同时覆盖：

- `craftstation/src/supervisor/runtime/accountResolver.test.ts`
- `craftstation/src/supervisor/runtime/grokProfiles.test.ts`
- `craftstation/src/supervisor/runtime.test.ts`
- `craftstation/src/supervisor/agents/acp/session.test.ts`
- `craftstation/src/renderer/actions/agentLoginActions.test.ts`

## Regression Validation

已执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/accountResolver.test.ts src/supervisor/runtime/grokProfiles.test.ts src/supervisor/runtime.test.ts src/supervisor/agents/acp/session.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx src/renderer/actions/agentLoginActions.test.ts
→ 7 files / 236 tests passed

pnpm typecheck
→ passed

pnpm lint
→ passed

pnpm exec oxfmt --check src/supervisor/runtime/accountStore.ts src/supervisor/runtime/accountStore.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx
→ passed

git diff --check
→ passed；仅报告既有 CRLF normalization warnings
```

## 验收边界

- v0.4.12 代码与回归修复已完成，但仍需 Debugger 独立复检及用户完全退出重开后的手工验收。
- F04 继续 BLOCKED：五个平级 Harness 尚未全部取得完整产品级真实 response；不得将单次 Codex 证据或测试夹具升格为 Feature PASS。
- DeepSeek/DSH 继续 `RUNTIME_UNAVAILABLE`，不创建 synthetic Entity/Session。
- 本轮未执行 commit、tag 或 push。

请 Debugger 读取本报告与 `PROJECT_STATUS.md`，独立复检 F24 与 F22 紧凑卡路径。
