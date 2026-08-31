# Coder 交付 — v0.5.3 Fix Cycle

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
角色：Coder

## 交付范围

本轮严格按 `debugger_0.5.3.md` 修复 F25、F26、F27。没有 commit、tag、push，也没有修改 `main`。v0.4 F04 五 Harness 真实产品级 response 仍为 `FAIL / BLOCKED`，本交付不宣称 Feature PASS。

### F25 — 恢复完整内置厂商目录

- `ModelUsageDialog` 不再使用 `usage.disabledProviders` 过滤内置 catalog；设置页的禁用列表仍只影响原有紧凑 usage rail。
- Provider 拖拽排序使用同一份完整目录。
- Renderer 测试 mock 现在真实遵守 `disabledProviders`，并验证默认禁用 Gemini/Cursor 时，模型与用量对话框仍显示完整目录。

### F26 — 已授权卡按两列布局

- `ManagedAccountPool` 改为 `data-grid-span="2"` 与 `col-span-2`。
- 左侧仍为四列栅格，因此一行最多两张已授权账号池卡；未授权 Provider 保持一列。
- 测试锁定已授权 ChatGPT/Grok 卡为两列，避免回退到 `col-span-4`。

### F27 — 打开对话框即查询额度与 Token

- `ModelUsageDialog` 打开后先读取 `listAccounts({})`，对有官方 identity 的 managed Codex/Grok 账号并行执行：
  - 每个账号 `refreshAccountQuota({ accountId })`；
  - 一次 `refreshTokenUsage({ periods: ["today", "month", "allTime"] })`；
  - 查询完成后再次 `listAccounts({})`，读取 Supervisor 已持久化的 account-scoped quota/status/error。
- 新增账号查询状态，额度和 Token 分别显示 `加载中…`、截断后的错误或可靠数据；无 exact account breakdown 时继续显示 `—`。
- `AccountUsageGrid` 只接受 `byAccount` 中精确匹配当前 `accountId` 的非 estimated Token 数据，不再把 Provider 全局 summary 套到每个账号。
- `tokenUsageStore` 增加错误状态，成功/重新开始查询会清理旧错误。
- `GrokProfileService.collectQuota` 的 scoped host：
  - 只读取当前 managed `GROK_HOME/auth.json`；
  - 用同一 managed auth path 调用 `refreshRejectedGrokToken`；
  - 从 managed auth 的已知 cookie 字段提供 `getSecret("grok", "cookie")`；
  - 不继承宿主 credential getter，不读取 Codex Router 或宿主 `~/.grok`。
- `AccountStore.updateStatus` 在账号恢复为非 error 状态且没有新错误时清理旧 `lastError`。

## 验证结果

通过：

- 定向 Vitest：5 个测试文件，69 个测试通过。
- `pnpm run typecheck`
- 本轮修改文件的普通 oxlint 与 type-aware oxlint
- 本轮修改文件的 `oxfmt --check`
- `git diff --check`

定向测试命令：

```text
pnpm exec vitest run --configLoader runner src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx src/supervisor/runtime/grokProfiles.test.ts src/supervisor/runtime/tokenUsageAdapter.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/usageService.test.ts
```

未通过但不属于本轮改动：

- `pnpm run lint` 仍被既有 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 的 `vitest(no-conditional-expect)` 阻断；本轮未修改该无关文件。
- 全仓 `fmt:check` 仍包含大量既有未格式化文件；本轮涉及文件已单独通过格式检查。

## 交接结论

F25、F26、F27 已完成工程修复并通过定向验证。请 Debugger 在当前 `dev` 工作树独立复检用户现场 UI、额度/token 查询和脱敏边界；不要将本 Coder 自检或 v0.5.2 证据替代独立验收。F04 仍保持 `FAIL / BLOCKED`。
