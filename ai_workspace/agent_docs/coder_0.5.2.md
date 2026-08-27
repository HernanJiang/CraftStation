# Coder — v0.5.2 F13 Grok 双 managed profile 产品路径

> 当前角色：Coder  
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`）  
> 当前 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`

## 交付结论

本轮只执行 Debugger v0.5.1 Fix Plan 的 F13，没有重开 F10、F11、F12、F14 或 F15，也没有修改 `main`，未 commit、未 tag、未 push。

F13 已取得一份脱敏的真实产品路径验证证据，交给 Debugger 独立复检。该证据不宣称 v0.5 Feature PASS；v0.4 五 Harness F04 仍保持 FAIL / BLOCKED。

## 实现与证据

更新了 [grokAccountPool.integration.test.ts](../../src/supervisor/runtime/grokAccountPool.integration.test.ts)，将真实探针固定到本轮允许使用的两个 managed profile：

- A：`grok:852862f8-473d-4ef7-b1bf-605c0b52ed32`（her）
- B：`grok:071e94ac-5fda-4611-a0c8-b529d4707c9b`（hao）

探针显式排除已知耗尽账号 `9802c0ca…` 与 `0025b7ae…`，不按 live order 误选它们；只读取 AccountStore 的非敏感 metadata，不读取、写入或输出 token、cookie 或 `auth.json` 内容。探针结束时恢复 live account order、pool scheduling mode 和 RR cursor。

脱敏证据：[v0.5.2-grok-product-path.json](../validation/v0.5.2-grok-product-path.json)

实际执行路径保持：

`SupervisorRuntime.craftAgent -> AccountResolver -> native Grok adapter -> official grok agent stdio (ACP)`

证据字段保持 `synthetic: false`、`hostHomeUsed: false`，并观察到两个 managed profile 的 session directory。真实场景结果：

- `priority-auto`：A，非空 response，长度 29。
- `explicit-b`：B，非空 response，长度 29。
- `explicit-known-exhausted-no-fallback`：resolver 明确拒绝耗尽账号，没有 silent fallback，也没有启动其 ACP runtime。
- `auto-skips-known-exhausted`：把已知耗尽账号置于首位后，Auto 仍跳到 A 并取得长度 30 的非空 response。
- `sticky-a-after-pool-change`：A 启动的 Session 在 pool order 改为 B 优先后恢复，仍绑定 A，response 长度 34。
- `round-robin-a` / `round-robin-b`：两个新 Session 分别绑定 A / B，response 长度分别为 26 / 25。

所有 response 仅记录长度和短 hash，不记录文本内容。

## 验证命令与结果

真实产品探针（使用 live data dir；未访问 host `~/.grok`）：

```powershell
$env:CRAFTSTATION_REAL_GROK_E2E='1'
$env:PORACODE_DATA_DIR='C:\Users\Haona\.craftstation-dev'
pnpm exec vitest run --configLoader runner src/supervisor/runtime/grokAccountPool.integration.test.ts
```

结果：`1 passed`，耗时约 51 秒。

定向回归：

```powershell
pnpm exec vitest run --configLoader runner src/supervisor/runtime/accountResolver.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime.test.ts src/renderer/actions/threadLaunchActions.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx
```

结果：`5 passed`，`127 passed`。

其它检查：

- `pnpm exec tsc --noEmit -p tsconfig.json`：通过。
- `pnpm exec oxfmt --check src/supervisor/runtime/grokAccountPool.integration.test.ts`：通过。
- `pnpm exec oxlint --deny-warnings src/supervisor/runtime/grokAccountPool.integration.test.ts`：通过。
- `git diff --check`：无 whitespace error；仅保留 Git 的 CRLF 转换提示。

全仓 lint 仍有预存问题 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52`（`vitest(no-conditional-expect)`），本轮未扩大范围处理。

## 交接

F13 真实产品路径证据已准备完成，请 Debugger 在 dev worktree 独立复检：核对两个不同 managed profile、Official Grok Runtime、`hostHomeUsed: false`、`synthetic: false`、非空 assistant response、explicit error、Auto skip exhausted、sticky 和 Round-Robin。Feature 仍不宣称 PASS，等待 Debugger 质量门决定。
