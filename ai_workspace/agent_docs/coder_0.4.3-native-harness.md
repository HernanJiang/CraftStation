# Coder — v0.4.3 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.3`
>
> 状态：已连续执行 Debugger v0.4.2 Fix Plan，修复 F06 Codex turn identity，完成真实探针补测与回归自检；等待 Debugger 独立复检。Feature 仍不可宣称 PASS。

## Fix Plan 执行结果

### F06 — Codex 探针 turn identity

- 修复 [v0.4.1-native-session-probe.mjs](../validation/v0.4.1-native-session-probe.mjs)：不再把客户端自造的 `native-probe-turn` 作为唯一 identity。
- `turn/start` 现在先等待官方 JSON-RPC result，并读取 `result.turn.id`。
- `turn/completed` 只按该 server turn id 匹配；未完成时的 `turn/interrupt` 也使用同一个 server turn id。
- 增加 `turnCompletionStatus`、`turnIdSource`、notification method 列表和 response delta/marker 证据，避免将错误匹配、空响应或 partial lifecycle 写成 PASS。
- 最新真实结果：Codex 收到匹配的 `turn/completed(status=completed)` 和 `item/agentMessage/delta`，但固定 marker 未出现，因此保持 `partial`。

### F04 — 五 Harness 真实 Native Session 补测

- Grok 官方 ACP：initialize/session/new 成功；prompt 因官方 usage balance exhausted 失败；session close 成功。
- Kimi 官方 ACP：initialize/session/new 成功；prompt 返回 `AUTH_REQUIRED`；cancel 返回 `NATIVE_EXECUTION_FAILED`；session close 成功。
- Antigravity：无安全非交互 PTY 证据，保持 `unprobed`。
- DeepSeek/DSH：未发现官方 executable，保持 `unavailable`，没有生成 synthetic Entity/Session。
- 完整脱敏证据见 [v0.4.3-native-session-probe.md](../validation/v0.4.3-native-session-probe.md)。

## 生产状态与验收边界

| Harness        | 最新真实证据                                                              | capability 结论                    |
| -------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| Codex          | server turn id 对齐；turn completed；agent message delta；marker 未观察到 | `implementation missing` / partial |
| Grok Build     | session 建立；官方 usage exhausted                                        | `implementation missing` / error   |
| Kimi Code      | session 建立；`AUTH_REQUIRED`；cancel error                               | `implementation missing` / partial |
| Antigravity    | 无安全 PTY probe                                                          | `unprobed`                         |
| DeepSeek / DSH | 无官方 executable                                                         | `unavailable`                      |

没有完整且可审计的五 Harness `start → real response → interrupt/cleanup` 证据，因此没有修改 capability descriptor，没有把 handshake/session/new/usage exhausted/AUTH_REQUIRED 升格为 `supported+integrated`，也没有写 Feature PASS。

## 回归自检

在 `D:\Work\CraftStation\craftstation` 执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts
pnpm typecheck
pnpm lint
git diff --check
codegraph status
```

本轮取得结果：

- 定向 Vitest：19 个测试文件，131 tests passed。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：无 whitespace error；仅有既存换行格式提示。
- CodeGraph：Index is up to date；2,890 files / 40,323 nodes / 151,327 edges。
- 真实 probe：`NATIVE_PROBE_TIMEOUT_MS=10000 node ai_workspace/validation/v0.4.1-native-session-probe.mjs` 完成；Codex identity 对齐并得到 partial，其他 Harness 仍保持诚实失败状态。

## 工作树与交接

- 保留根仓库和 `craftstation/` 中已有用户/并行角色修改，未修改并行前端专项文件。
- 本轮未执行 reset、checkout、递归清理、commit、tag 或 push。
- 请 Debugger 读取 `PROJECT_STATUS.md`、本交付文档和 [v0.4.3-native-session-probe.md](../validation/v0.4.3-native-session-probe.md)，独立复核 F06、F04 及 F01/F02/F03/F05 回归。Feature 仍不能宣称 PASS。
