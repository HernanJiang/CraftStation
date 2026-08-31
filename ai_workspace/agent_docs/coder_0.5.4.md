# Coder 交付 — v0.5.4 Fix Cycle

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
角色：Coder

## 交付边界

本轮按 `ai_workspace/agent_docs/debugger_0.5.4.md` 连续完成 F28/F29 的工程修复。没有 commit、tag、push，没有修改 `main`，也没有读取、导入或覆盖任何 Router OAuth、Cookie、Token 或宿主 `~/.grok`。v0.4 F04 五 Harness 真实产品级 response 继续 `FAIL / BLOCKED`。

## F28 — 额度失败可见且分类保留

- `AccountUsageGrid` 只有收到有效 `usedPercent` 才显示成功百分比。
- `unavailable`、`auth-expired`、`error`、空 quota windows、`lastError` 均会显示加载中或可见错误，不再把失败画成无上下文的 `—`。
- Grok quota HTTP 观察层保留原始失败语义，并区分 timeout、abort、HTTP status、auth-missing 与普通 network。
- `usageHttpClient` 在自己的 abort timer 触发时抛出 typed timeout error；Grok profile 会把该分类持久化到 AccountStore 的 `lastError`。
- 既有 managed credential scope 保持：只从当前受管 `GROK_HOME` 读取 credential，不能回退到宿主或 Codex Router。

## F29 — exact accountId token 用量

生产链路现在是：

`Supervisor accountBinding → StructuredNativeHarnessRuntimeAdapter → ACP session → usage.spent.accountId → main usage ledger → usage_events(kind=tokens_v2, account_id)`

- ACP 会话新增 `resolveAcpPromptResponseUsage`：
  - 优先使用标准 `PromptResponse.usage`；
  - 标准 usage 缺失时，只从响应顶层 `_meta` 读取真实数值字段：`totalTokens`、`inputTokens`、`outputTokens`、`reasoningTokens`、缓存读写计数；
  - 非数值、缺失或空 metadata 不生成默认值、fixture、estimated 数据。
- 同一份规范化 usage payload 同时进入 `createAcpPromptUsageEvent` 与 `createAcpPromptUsageSpentEvent`。
- `usage.spent` 携带创建 Session 时捕获的 immutable managed `accountId`；主进程 ledger 将它写入 `tokens_v2.account_id`。
- Renderer 仍只接受 `byAccount.key === account.accountId` 且非 estimated 的数字；无 exact account breakdown 时显示“暂无精确用量”或可见失败，不把 provider 全局 summary 套给每个账号。

这修复了 Debugger 指出的真实 Grok ACP 形状：官方 probe 的 token 计数在 prompt response `_meta`，不在标准 `usage` 字段。该映射只让真实返回的计数可进入账本，不把 probe 或 fixture 变成产品成功证据。

## Regression Validation

通过：

- 定向 Vitest：7 个测试文件，191 tests passed，9 个 SQLite tests skipped（当前环境未提供 native SQLite binding）。
- 新增 ACP 行为测试覆盖官方 Grok 形状的 response-level `_meta`、context usage、`usage.spent` 与 managed `accountId`。
- `pnpm run typecheck`
- 本轮触及文件的普通 oxlint
- 本轮触及文件的 type-aware oxlint
- 本轮触及文件的 `oxfmt --check`
- `git diff --check`

定向测试命令：

```text
pnpm exec vitest run --configLoader runner src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx src/supervisor/runtime/grokProfiles.test.ts src/supervisor/agents/acp/session.test.ts src/supervisor/runtime/tokenUsageAdapter.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/usageService.test.ts src/main/profile/usageLedger.test.ts
```

全仓 `pnpm run lint` 仍被既有无关问题阻断：

```text
src/supervisor/agents/codex/codexRouterOverlay.test.ts:52
vitest(no-conditional-expect)
```

本轮未修改该文件，也没有借机扩大修复范围。

## 验收边界与交接

- Debugger 先前记录的官方 billing 连通性仍为 unavailable/network；本轮没有重复会消耗额度的 Grok chat probe，也没有把 billing unavailable 写成成功。
- exact token 数字只有在真实 managed ACP response 产生 `tokens_v2` 后才会出现；没有可靠 accountId 数据时保持失败/暂无精确用量。
- F25/F26 保持关闭，F04 仍 `FAIL / BLOCKED`，本交付不宣称 v0.5 Feature PASS。

请 Debugger 在当前 `dev` 工作树独立复检 F28/F29 与用户现场，依据真实 billing 状态决定是否继续保持 BLOCKED。
