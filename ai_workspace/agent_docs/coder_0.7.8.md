# CraftStation Coder 交付 — v0.7.8 Fix Cycle

日期：2026-08-30  
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
分支：`feature/v0.7-native-harnesses`  
基线：`dev / 7ae6506`

## Existing

- 复用既有 `crafting`、`registry`、`HarnessRuntimeAdapter`、canonical `RuntimeEvent`、Supervisor `craftAgent` / `resumeCraftAgent` 以及 UI/IPC seam。
- 保持 Codex、Grok、Kimi native runtime 的已有 provider boundary。
- 保持官方 Antigravity `--input-format stream-json` / `--output-format stream-json` 的非 PTY/非 TUI 驱动方式。
- 保持 F40（静态门禁）、F42（HarnessPanel onCraft / Lingui 本地化 / React Compiler 规则）、F43（interrupt IPC session 优先路由）、F44（interrupt canonical lifecycle / session auto-release / retention 清理）、F45（capability 真实性声明，未验证能力保持 implementation missing）、F46（nativeEnvelope 深度脱敏与 nested event 扁平展开）。
- 保持 F41 Windows npm `.cmd` shim 安全解析与未配置时前置 fail-closed（不产生 synthetic identity）。

## Fixed

- **F41 (JSON-RPC 请求有界超时与进程/Session 自动清理 — Non-Serving Timeout & Process Cleanup)**：
  - 在 `NdjsonProcessTransport.sendRequest()` 中增加了请求 deadline 超时机制（支持 options `timeoutMs` 及 transport options `requestTimeoutMs`，默认 15000ms）与 `AbortSignal` 监听，具备完备的 timer 与 abort listener 清理。
  - 当子进程长期存活但未在 deadline 内响应 `initialize`（如使用有效但无 JSON-RPC server 的 Cordis composition 时），`sendRequest` 自动超时、清理 `pendingRequests` 映射、发出 `RUNTIME_UNAVAILABLE` 诊断，并抛出具有明确超时信息的异常。
  - `NativeProcessCraftSession.initializeDeepSeek()` 支持通过 plan options `readinessTimeoutMs` 精确控制超时时间；在初始化失败时，`openSession` 捕获异常触发 `session.terminate()`，立即调用 `transport.dispose()` 强制终止/kill 子进程，将 session 从 adapter 集合中移除，确保无孤儿子进程、无挂起 pending promise、无 active session 残留。
- **F41 (Supervisor 与 Adapter Readiness 失败下的 Identity Commit Boundary 隔离)**：
  - 在 `SupervisorRuntime.craftAgent()` 与 `resumeCraftAgent()` 中，重构了 identity commit 边界：只有在 `adapter.createSession(entity)` / `resumeSession` 完全就绪（包括 `initialize` 协议握手）成功后，才向外 commit/expose `entityId` 与 `sessionId`。
  - 当 readiness 阶段发生任何失败（未配置 unconfigured、进程启动非 0 崩溃退出 invalid exit、协议畸形 protocol mismatch、长期存活无响应 non-serving timeout 等），Supervisor `enrichCraftingError()` 均不会在 error detail 的 `details` 中包含 `entityId` 或 `sessionId`，彻底闭环“readiness 失败分支无 provisional Entity/Session identity”的要求。
- **F41 (Production Factory 6 场景完整测试矩阵覆盖)**：
  - 在 `src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts` 中构建并完整验证 6 个场景：
    1. **absent**: 未发现 carrier 时返回 `UnavailableNativeHarnessRuntimeAdapter`，诊断为 `RUNTIME_UNAVAILABLE`，`spawnEntity` 同步拒绝，不产生 Entity。
    2. **installed-unconfigured**: 发现 carrier 但 plan 缺少 `configPath` 时，`spawnEntity` 阶段前置拒绝，产生 `Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created)` 错误与 `RUNTIME_UNAVAILABLE` 诊断，不创建 Entity，无 session 残留。
    3. **invalid/crashing exit**: 模拟进程启动后因无效配置立即非 0 崩溃退出，`createSession` 捕获异常，产生 `RUNTIME_UNAVAILABLE` / `NATIVE_PROCESS_CRASHED` 诊断，子进程被清理，无 session 残留。
    4. **protocol mismatch**: 模拟子进程 stdout 输出畸形非 JSON-RPC 文本，捕获 `PROTOCOL_MISMATCH` 诊断，子进程被清理，无 session 残留。
    5. **long-lived non-serving timeout**: 模拟子进程长期存活但不响应 `initialize`，在 50ms 测试 deadline 内拒绝，子进程被 kill 清理，pending requests 清空，`getActiveSessions()` 为 0。
    6. **ready (fixture only)**: 模拟合法 JSON-RPC server 流程（`initialize` -> `session/prompt` -> `session.event` -> `turn.completed` -> `shutdown`），完整验证 `spawnEntity -> createSession -> startTurn -> terminate` 流程，终态后 `getActiveSessions()` 自动为 0（明确标记为 fixture 测试）。
- **F41 (Supervisor 级失败错误隔离回归测试)**：
  - 在 `src/supervisor/runtime.test.ts` 中新增 4 个针对 `SupervisorRuntime.craftAgent()` 的完整链路测试，分别断言在 unconfigured、crashing exit、protocol mismatch、long-lived non-serving timeout 时，`craftAgent` 均抛出错误且 error detail 的 `details.entityId` 与 `details.sessionId` 均为 `undefined`，且 long-lived 进程被正确 killed。

## Added

- `ai_workspace/agent_docs/coder_0.7.8.md`。
- `src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts`：新增 `terminates child process and clears pending requests on long-lived non-serving timeout` 场景。
- `src/supervisor/runtime.test.ts`：新增 3 个针对 Supervisor 级 readiness 失败（crash, protocol mismatch, timeout）下 `entityId/sessionId` 隔离与进程清理断言的测试。

## Evidence

1. **定向 Native Harness 回归测试**：
   - `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/ src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/ src/shared/crafting/nativeRuntimeConfig.test.ts src/supervisor/runtime.test.ts`
   - 结果：`9 passed | 1 skipped (10 files), 112 passed | 1 skipped (113 tests)`。
2. **真实 Antigravity 产品路径测试**：
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 与 `CRAFTSTATION_AGY_EXECUTABLE` 运行 `nativeProductPath.integration.test.ts`：`1 passed`（真实 `agy 1.1.22` 执行并通过 `closeThread` 退出清理与 Supervisor IPC 转发，真实生成 `ai_workspace/validation/v0.7.0-antigravity-product-path.json`，verdict: `AUTH_REQUIRED`）。
3. **静态检查门禁**：
   - `pnpm run typecheck`：通过（TypeScript 7 零错误）。
   - `pnpm exec oxlint --deny-warnings <21_files>`：通过（零警告零错误）。
   - `pnpm exec oxfmt --check <21_files>`：通过（全部 21 个触及 TS/TSX 文件 100% 格式对齐）。
   - `git diff --check`：通过（无空白/格式残留）。
4. **工作树隔离验证**：
   - `main`、共享 `D:\Work\CraftStation\craftstation-dev`（v0.6）以及 `D:\Work\CraftStation\craftstation\.worktrees\v0.8` 均未修改。
   - 本工作树未执行 `git commit`、`git push`、`git tag`、`git merge` 或 `dev→main` promotion。

## Remaining

- 官方 Antigravity 与 DeepSeek 的高级能力（MCP、Skills、子 Agent、上下文压缩、工具调用等）目前处于 `implementation missing` / 未实测状态，待后续专项 probe 闭环。
- 真实机器环境下 DeepSeek 缺少完整可 serving 的 Windows Cordis composition，保持诚实的 `RUNTIME_UNAVAILABLE`。
- 本 Feature 的独立验收结论以专属 Debugger（Task ID: `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`）的复检结果为准。