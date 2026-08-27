# Coder — v0.4.2 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.2`
>
> 状态：已连续执行 Debugger v0.4.1 Fix Plan，完成真实探针补测、证据更新与回归自检；等待 Debugger 独立复检。Feature 仍不可宣称 PASS。

## Fix Plan 执行结果

### F04 — 真实 Native Session 缺口补测

- 更新 [v0.4.1-native-session-probe.mjs](../validation/v0.4.1-native-session-probe.mjs) 的 probe version 为 `0.4.2`。
- 修复并保留 JSON-RPC request waiter 按 id 配对，避免 ACP/provider notification 消费其他请求响应的竞态。
- Codex 使用官方 `codex app-server --stdio`，等待真实 `turn/completed`；超时和 interrupt 错误被显式记录。
- Grok 使用官方 `grok --no-auto-update agent --no-leader stdio` ACP boundary；本轮完成真实 initialize/session 建立，prompt 因官方 usage balance exhausted 失败，session close 成功。
- Kimi Windows 使用官方 Node 入口启动 `kimi acp`，完成真实 initialize/session 建立；prompt 返回 `AUTH_REQUIRED`，cancel 显式失败，session close 成功。
- Antigravity 保持 `unprobed`，没有把 soft keyring/config signal 当作 PTY/session 证据。
- DeepSeek/DSH 保持 `unavailable`；没有启动旧 DSH、Gemini CLI、CLIProxyAPI 或 Model API fallback，也没有生成 synthetic Entity/Session。
- 完整脱敏结果见 [v0.4.2-native-session-probe.md](../validation/v0.4.2-native-session-probe.md)。

## 状态与验收边界

| Harness | 真实证据 | 生产 capability 结论 |
|---|---|---|
| Codex | initialize + thread/start；turn 超时；interrupt error；process cleanup | `implementation missing` / partial |
| Grok Build | initialize + session/new；prompt 因余额耗尽失败；session/close | `implementation missing` / error |
| Kimi Code | initialize + session/new；prompt `AUTH_REQUIRED`；cancel error；session/close | `implementation missing` / partial |
| Antigravity | 无安全 PTY probe | `unprobed` |
| DeepSeek / DSH | 无官方 executable | `unavailable` |

本轮没有任何完整 `start → turn/response → interrupt/cleanup` 的五 Harness 证据，因此没有改 capability descriptor，也没有写 Feature PASS。partial handshake、session identity、fixture、`--version` 和 auth 文件存在性均未被升格为 integrated。

## 回归自检

在 `D:\Work\CraftStation\craftstation` 执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts
pnpm typecheck
pnpm lint
git diff --check
codegraph status
```

预期/已取得结果：

- 定向 Vitest：19 个测试文件，131 tests passed。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：通过；无 whitespace error。
- CodeGraph：Index is up to date；2,890 files / 40,323 nodes / 151,327 edges。

## 工作树与边界

- 保留根仓库和 `craftstation/` 中已有用户/并行角色修改。
- 本轮未执行 reset、checkout、递归清理、commit、tag 或 push。
- 未修改并行前端专项文件；本轮新增/更新仅限 v0.4.2 探针证据、Coder 交付文档与动态状态，以及探针脚本版本标记。

## 交接

请 Debugger 读取 `PROJECT_STATUS.md`、本交付文档和 [v0.4.2-native-session-probe.md](../validation/v0.4.2-native-session-probe.md)，独立复核源码、测试、Control Plane、Recipe 路由和真实运行时边界。由于真实 session 仍不完整，复检时应继续保持 `implementation missing` / `unprobed` / `unavailable`，不要宣称 Feature PASS。
