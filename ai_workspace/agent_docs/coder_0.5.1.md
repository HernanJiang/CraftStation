# Coder — v0.5.1 Account Pool + Quota + Token Usage Stabilization

> 当前角色：Coder
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（`dev`）
>
> 状态：F10–F15 工程修复已完成并完成回归；Feature 仍 **FAIL / BLOCKED**，未宣称 PASS。

## 交付范围

本轮按 `ai_workspace/agent_docs/debugger_0.5.0.md` 的 Fix Execution Order 完成并保留已有并行改动：

- F10：新 Session 的 Renderer launch payload 传递 `accountMode` 与可选 `accountId`；显式账号作为本次新 Session override，Auto 不再依赖旧 selected 语义；运行中 Session 保持 sticky。
- F11：模型与用量入口按认证状态形成左侧 4 列、右侧 1 列布局；Provider 展示顺序和 Runtime 账号调度分离。
- F12：账号行用量视图改为真实 2×2；quota/token 使用 account-scoped 数据；缺少可靠账号级数据时显示 `—`，不把 provider 全局值复制到每个账号。
- F14：AccountStore 迁移到 v2，持久化 provider pool scheduling；Renderer 提供 Priority / Round-Robin / Random 控件并经现有 IPC 接入。
- F15：crafted Session 在 close、terminate、退出、创建失败和首轮 prompt 失败时释放 account binding；修复 Sidebar 测试的 `HTMLElement` 类型问题。

## F13 真实产品路径验证

新增受控探针：

- [grokAccountPool.integration.test.ts](../../src/supervisor/runtime/grokAccountPool.integration.test.ts)
- [v0.5.1-grok-product-path.json](../validation/v0.5.1-grok-product-path.json)

实际执行路径：

`SupervisorRuntime.craftAgent -> AccountResolver -> native Grok adapter -> official grok agent stdio (ACP)`

探针使用 live store 中两个不同的 managed profile，未读取或输出 auth/token/cookie 内容，未使用 host `~/.grok`，未接入 CLIProxyAPI。结果：

- `synthetic: false`，`hostHomeUsed: false`。
- `priority-auto`：managed account 通过产品 `craftAgent` 绑定，返回非空 assistant response，binding reason 为 `priority`，并观察到 managed profile 的 session 目录。
- `explicit-b`：managed account 通过产品路径绑定，ACP session 建立，但 assistant response 长度为 `0`；按验收门不能记为完整 real response。
- 因第二个账号没有完整 real response，`sticky-a`、Auto quota fallback 和 Round-Robin 不再重复消耗账号额度；证据 verdict 保持 `BLOCKED`。

本轮不重复已暴露的额度耗尽账号探针。关闭 F13 仍需要用户确认两个官方 Grok managed profile 均有可用额度后，取得产品 `craftAgent` 的非空 real response，并补齐 quota、Priority、Round-Robin、explicit error/fallback 与 sticky 的可审计证据。

## Live store 状态

产品 Supervisor 使用 live data dir 启动后，现场 metadata 已迁移为：

- `version: 2`
- `pools` 键已存在
- Grok 账号数量：6
- 当前脱敏状态：4 个 `available`、2 个 `quota-exhausted`
- 本次证据只记录 metadata 和 managed session directory 是否存在，不记录 credential 内容。

## 回归验证

已执行定向回归：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/grokAccountPool.integration.test.ts src/supervisor/runtime.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/accountResolver.test.ts src/renderer/actions/threadLaunchActions.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx
```

结果：`5 passed / 1 skipped`，`127 passed / 1 skipped`。

真实探针文件默认跳过；显式设置 `CRAFTSTATION_REAL_GROK_E2E=1` 并指向 live data dir 后，真实产品探针执行 `1 passed`，但脱敏产物 verdict 仍为 `BLOCKED`。

其它验证：

- `pnpm exec tsc --noEmit -p tsconfig.json`：通过。
- `pnpm exec oxlint --deny-warnings src/supervisor/runtime/grokAccountPool.integration.test.ts`：通过。
- `git diff --check`：通过；仅有 Git 的 CRLF 转换提示。
- 全仓 lint 的既有问题 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 未扩大范围处理。

## 交接

F10–F15 的工程修复和 Regression Validation 已完成，交给 Debugger 在 dev worktree 独立复检。v0.4 五 Harness 的 F04 仍保持 FAIL / BLOCKED；本 Feature 也因 F13 缺少两个 managed profile 的完整 real response 保持 FAIL / BLOCKED。未 commit、未 tag、未 push。
