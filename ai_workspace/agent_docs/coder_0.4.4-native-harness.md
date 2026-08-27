# Coder — v0.4.4 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.4`
>
> 状态：已连续执行 Debugger v0.4.3 Fix Plan，修复 F07 assistant 文本扫描并完成真实探针与回归自检；等待 Debugger 独立复检。Feature 仍不可宣称 PASS。

## Fix Plan 执行结果

### F07 — Codex 响应文本扫描

- 更新 [v0.4.1-native-session-probe.mjs](../validation/v0.4.1-native-session-probe.mjs)，probe version 为 `0.4.4`。
- 按生产 `eventMapping.ts` 的 assistant text 语义扫描 `item/agentMessage/delta`、`agentMessage/delta`、`content/delta`。
- 扫描 assistant `item/completed` payload，支持文本嵌套在 `text`、`delta`、`content`、`parts`、`output`、`message`、`payload` 中的官方 envelope。
- 先累计所有通道文本，再判断跨 chunk 的 `NATIVE_PROBE_OK`；不再只检查单个 `params.delta` 字段。
- 只输出 marker boolean、累计长度和 SHA-256 前 12 位，不写完整模型回复。
- F06 保持：Codex `turn/completed` 和 interrupt（如需要）都使用 `turn/start` result 的 server `turn.id`。

### F04 — 五 Harness 最小真实探针

- Codex 官方 app-server：initialize、thread/start、server turn id、turn/completed 均成功；累计 assistant 文本锁定 marker，length `15`，hash `4f624a202114`；完成后不需要 interrupt，进程清理完成。
- Grok 官方 ACP：initialize/session/new 成功；prompt 因官方 usage balance exhausted 失败；session close 成功。
- Kimi 官方 ACP：initialize/session/new 成功；prompt 返回 `AUTH_REQUIRED`；cancel 返回 `NATIVE_EXECUTION_FAILED`；session close 成功。
- Antigravity：无安全非交互 PTY 证据，保持 `unprobed`。
- DeepSeek/DSH：未发现官方 executable，保持 `unavailable`，没有生成 synthetic Entity/Session。
- 完整脱敏证据见 [v0.4.4-native-session-probe.md](../validation/v0.4.4-native-session-probe.md)。

## 生产状态与验收边界

| Harness | 最新真实证据 | capability 结论 |
|---|---|---|
| Codex | server turn identity；turn completed；assistant marker、长度和短 hash；process cleanup | `implementation missing` / probe partial |
| Grok Build | session 建立；官方 usage exhausted | `implementation missing` / error |
| Kimi Code | session 建立；`AUTH_REQUIRED`；cancel error | `implementation missing` / partial |
| Antigravity | 无安全 PTY probe | `unprobed` |
| DeepSeek / DSH | 无官方 executable | `unavailable` |

本轮只修复探针证据链，没有因 turn/completed、delta、session/new、usage exhausted 或 AUTH_REQUIRED 修改生产 descriptor，也没有把 Codex 单次 marker 结果写成五 Harness Feature PASS。

## 回归自检

在 `D:\Work\CraftStation\craftstation` 执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts
pnpm typecheck
pnpm lint
node --check ..\ai_workspace\validation\v0.4.1-native-session-probe.mjs
git diff --check
codegraph status
```

本轮取得结果：

- 定向 Vitest：19 个测试文件，131 tests passed。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- Probe `node --check`：通过。
- `git diff --check`：无 whitespace error；仅有既存换行格式提示。
- CodeGraph：Index is up to date；2,890 files / 40,323 nodes / 151,327 edges。
- 真实 probe：Codex marker 已锁定；Grok/Kimi/Antigravity/DSH 保持官方错误或不可用状态。

## 工作树与交接

- 保留根仓库和 `craftstation/` 中已有用户/并行角色修改，未修改并行前端专项文件。
- 本轮未执行 reset、checkout、递归清理、commit、tag 或 push。
- 请 Debugger 读取 `PROJECT_STATUS.md`、本交付文档和 [v0.4.4-native-session-probe.md](../validation/v0.4.4-native-session-probe.md)，独立复核 F07、F04 及 F01/F02/F03/F05/F06 回归。Feature 仍不能宣称 PASS。
