# CraftStation Coder 交付 — v0.7.9 Fix Cycle

日期：2026-08-30
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
分支：`feature/v0.7-native-harnesses`
基线：`dev / 7ae6506`

## Existing

- 保持 Antigravity 官方 `agy --input-format stream-json --output-format stream-json` 产品边界，不抓取 TUI，不宣称 ACP/JSON-RPC。
- 保持 DeepSeek 官方 JSON-RPC 2.0 over stdio 边界；未配置或不可 serving 时继续 fail-closed 为 `RUNTIME_UNAVAILABLE`，没有普通 API、CLIProxyAPI、legacy APIProxy、PTY/TUI 或 synthetic fallback。
- 保持 v0.7.8 已关闭的 Windows npm `.cmd` shim 安全启动、carrier absent/unconfigured/protocol/non-serving/fixture-ready factory matrix，以及 F40/F42/F43/F44/F45/F46。
- 保持 Supervisor 只在 native Session readiness 成功后提交 Entity/Session identity 的边界。

## Fixed

- **分离 JSON-RPC 三类生命周期 deadline**：
  - `initialize` 使用独立 readiness deadline；plan 未配置时默认 `15_000ms`，只约束 readiness。
  - 正常 `session/prompt` 不再继承 `readinessTimeoutMs`，也不再有 transport-wide 固定 `15s` timeout；合法长 turn 由 provider 完成或调用方主动取消。
  - `shutdown` 使用独立 cleanup deadline；plan 可用 `cleanupTimeoutMs` 覆盖，默认 `2_000ms`，超时后仍会 dispose/kill child。
- **绑定主动取消**：`StartTurnCommand.signal` 在发送 prompt 前注册，并传入对应 pending JSON-RPC request。abort 会清除 pending request、结束 turn 为 `interrupted`，且不会伪造 `NATIVE_EXECUTION_FAILED`。
- **readiness failure 立即回收 provisional runtime**：initialize 失败不再先等待一次 graceful shutdown；直接 dispose transport、kill child、清 pending，并释放 provisional transport ownership。
- **race-safe request cleanup**：`sendRequest()` 只在调用点显式传入有效 timeout 时创建 timer；response、timeout、abort、process exit 与 dispose 都会移除 timer/listener/pending entry。
- **直接 lifecycle 可观测性**：`NdjsonProcessTransport` 增加只读 pending/process 状态；`NativeProcessHarnessRuntimeAdapter.getLifecycleSnapshot()` 直接投影 active Session、provisional transport、running process 与 pending request 计数，供生产 seam regression 验证。

## Added

- `nativeAdapter.test.ts` 新增/加强以下回归：
  - initialize 快速成功后，prompt 延迟超过 readiness deadline 仍完成；
  - fake timers 推进超过旧 15 秒边界，默认 turn 仍 pending，随后 provider response 正常完成；
  - `StartTurnCommand.signal` 取消 pending request，turn 为 `interrupted`，无 execution-failure diagnostic；
  - non-serving initialize 在短 deadline 内失败，child、pending、active Session、provisional transport 全部归零；
  - shutdown 不响应时只等待独立 cleanup deadline，随后 dispose/kill 并清空 lifecycle state。
- `runtime.test.ts` 增加 Supervisor 直接 lifecycle 断言：
  - `craftAgent()` long-lived non-serving readiness failure 后，error detail 不含 `entityId/sessionId`；
  - `resumeCraftAgent()` 代表性 readiness failure 同样不暴露 provisional identity；
  - 两条路径均直接断言 adapter lifecycle 与 Supervisor `craftedSessionsByThread`、`craftedSessionBindings`、`craftedSessionUnsubscribers`、`nativeHarnessSessions` 全部为 0。
- 新增本交付文档 `ai_workspace/agent_docs/coder_0.7.9.md`。

## Evidence

1. **原始缺陷 Red → Green**
   - 红测：`readinessTimeoutMs=20`、prompt 延迟 `60ms` 时，旧实现把 readiness 泄漏给 `session/prompt`，测试稳定以 `RUNTIME_UNAVAILABLE` 失败。
   - 修复后同一测试通过；prompt 超过 readiness 值仍返回 `completed / hello`。
2. **最终触及范围回归**
   - 命令：`pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/ src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/ src/shared/crafting/nativeRuntimeConfig.test.ts src/supervisor/runtime.test.ts`
   - 结果：`9 passed | 1 skipped (10 files)`，`117 passed | 1 skipped (118 tests)`。
   - product-path 的 skip 仅发生在未设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 的普通 focused run。
3. **真实 Antigravity product path**
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 单独运行 `nativeProductPath.integration.test.ts`：`1 passed`。
   - 最新 artifact：`synthetic=false`、`agy 1.1.22`、verdict `AUTH_REQUIRED`；观察到 `turn.started`、`error`、`turn.completed`、`session.exited` 与 `SupervisorRuntime.closeThread` cleanup。
   - 证据：`ai_workspace/validation/v0.7.0-antigravity-product-path.json`。这只证明真实单轮 product path 和 cleanup，不是 Feature PASS。
4. **真实 DeepSeek carrier 边界**
   - 本机可发现官方 npm carrier `dsh-jsonrpc-agent` 与 `dsh`；无 Cordis config 时 `dsh-jsonrpc-agent` 准确输出 usage：必须传入 `cordis.yml` 或设置 `DSH_CORDIS_CONFIG`，没有内置 fallback。
   - 当前没有已验证可 serving 的完整 Windows Cordis composition，因此保持 `RUNTIME_UNAVAILABLE`，没有伪造 initialize/session/shutdown PASS。
5. **静态门禁**
   - 对全部 21 个 v0.7 触及 TS/TSX 文件使用显式文件数组：`oxfmt --write` 后 `oxfmt --check` 通过；`oxlint --deny-warnings` 通过。
   - `pnpm run typecheck`：通过。
   - `git diff --check`：通过。
6. **工作树与 Git 边界**
   - 仅修改 `D:\Work\CraftStation\craftstation\.worktrees\v0.7`。
   - 未修改 main、共享 v0.6/dev 或 v0.8 worktree；未执行 commit、push、tag、merge 或 promotion。

## Remaining

- 真实 DeepSeek serving composition 仍不可用，Feature 必须保持 `RUNTIME_UNAVAILABLE / BLOCKED`，直到独立 Debugger 取得官方 initialize → notification/AUTH_REQUIRED → shutdown → process exit 的非 fake 证据。
- 最新真实 Antigravity 证据为 `AUTH_REQUIRED` 单轮产品路径与 close cleanup；不能据此声称多轮、resume、cancel、tool、permission、MCP、Skills、子 Agent 或 Feature 级 PASS。
- 未实测高级 capability 继续标记 `implementation missing`。
- 一次单独运行整个 `src/supervisor/runtime.test.ts` 时，70 个测试断言均通过，但测试 teardown 曾出现既有 OpenCode mock 的 `terminateProcessTree` unhandled rejection；随后本轮 Supervisor 定向 5/5 与最终合并触及范围 117/117 clean。该瞬时 teardown 现象不作为 v0.7.9 PASS 证据，也未在本 Fix Plan 范围内改动 OpenCode。
- 最终 verdict 由 v0.7 专属 Debugger 任务 `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8` 独立复检决定；Coder 自检不替代验收。
