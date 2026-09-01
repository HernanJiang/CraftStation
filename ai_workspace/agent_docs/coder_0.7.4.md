# CraftStation Coder 交付 — v0.7.4 Fix Cycle

日期：2026-08-30  
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
分支：`feature/v0.7-native-harnesses`  
基线：`dev / 7ae6506`

## Existing

- 复用既有 `crafting`、`registry`、`HarnessRuntimeAdapter`、canonical `RuntimeEvent`、Supervisor `craftAgent` / `resumeCraftAgent` 以及 UI/IPC seam。
- 保持 Codex、Grok、Kimi native runtime 的已有 provider boundary。
- 保持官方 Antigravity `--input-format stream-json` / `--output-format stream-json` 的非 PTY/非 TUI 驱动方式。
- 保留 `ai_workspace/validation/v0.7.0-antigravity-product-path.json` 的真实单轮与 `closeThread` 退出清理证据，不伪造全能力已验证。

## Fixed

- **F40 (全部 21 个触及 TS/TSX 文件 oxfmt 格式全绿)**：
  - 针对工作树中全部 21 个触及的 TypeScript / TSX 文件逐一执行 `oxfmt --write`，并通过显式文件路径列表进行 `oxfmt --check`，确认全部 21 个文件 100% 格式对齐：
    - `src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.test.tsx`
    - `src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.tsx`
    - `src/shared/crafting/nativeHarness.ts`
    - `src/shared/crafting/registry.ts`
    - `src/shared/crafting/runtimeInterface.ts`
    - `src/shared/crafting/types.ts`
    - `src/shared/crafting/nativeRuntimeConfig.test.ts`
    - `src/supervisor/agents/base/types.ts`
    - `src/supervisor/ipcHandlers.ts`
    - `src/supervisor/runtime.test.ts`
    - `src/supervisor/runtime/nativeHarness/controlPlane.ts`
    - `src/supervisor/runtime/nativeHarness/descriptors.ts`
    - `src/supervisor/runtime/nativeHarness/index.ts`
    - `src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts`
    - `src/supervisor/runtime/nativeHarness/structuredAdapter.ts`
    - `src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts`
    - `src/supervisor/runtime/nativeHarness/nativeAdapter.ts`
    - `src/supervisor/runtime/nativeHarness/nativeEventCanonicalizer.ts`
    - `src/supervisor/runtime/nativeHarness/nativeProductPath.integration.test.ts`
    - `src/supervisor/runtime/nativeHarness/nativeTransport.ts`
    - `src/supervisor/supervisorRuntime.ts`
- **F44 (Interrupt 直接断言测试补齐与事件唯一性)**：
  - 在 `nativeAdapter.test.ts` 中直接断言 Windows interrupt 产生的事件流：
    - `turn.completed` (state: "interrupted") 恰好 1 个；
    - `session.exited` (reason: "interrupted") 恰好 1 个；
    - `adapter.getActiveSessions()` 从 1 变 0（adapter 级自动释放）。
  - 在 `runtime.test.ts` 中补充针对 Supervisor `interruptThread` 的直接回归：
    - 断言 Supervisor runtime event forwarding 收到 `turn.completed(state: "interrupted")` 与 `session.exited(reason: "interrupted")`；
    - 断言在收到 `session.exited` 事件后，`craftedSessionsByThread` 自动被 release，后续调用不再残留路由至已退出的 Session。
- **F42 (i18n 本地化与 React Compiler 规范清理)**：
  - 在 `HarnessPanel.tsx` 中使用 `t(msg`No project selected to launch crafted Agent.`)` 对用户错误提示进行 Lingui 本地化包裹。
  - 清理了非必要的 `useCallback` / `useMemo`，遵循 React 19 + React Compiler 默认自动记忆机制，消除不必要的 escape。
- **NativeProcessHarnessRuntimeAdapter 终态 Session Retention 审计与清理**：
  - 在 `NativeProcessHarnessRuntimeAdapter` 中建立终态回调通道：当 Session 触发 `terminate()`、`session.exited` 或 Windows `interrupt()` 导致终止时，自动从 adapter 的 `this.sessions` 集合中删除（`this.sessions.delete(session)`），避免内存泄漏。
  - 在 adapter 上公开 `getActiveSessions(): readonly CraftSession[]` 方法，并在测试中验证生命周期的准入与清理。
- **F41 (DeepSeek Harness 保持诚实 RUNTIME_UNAVAILABLE)**：
  - 确认当前 npm 0.1.1-rc.2 缺少 sdk profile 且 npm shim 不应作为 machine-facing binary 驱动，在缺失独立 `dsh-jsonrpc-agent` 可执行文件时诚实返回 `UnavailableNativeHarnessRuntimeAdapter`，产生准确的 `RUNTIME_UNAVAILABLE` 诊断，不使用 API proxy / CLIProxyAPI / synthetic fallback。

## Added

- `nativeAdapter.test.ts`：
  - 新增 Windows interrupt 下事件唯一性（`turn.completed` 与 `session.exited` 各 1 个）与 adapter 自动 release 的直接断言。
  - 新增 `dsh` CLI 参数构造测试及 `redactNativePayload` 增强脱敏测试。
- `runtime.test.ts`：
  - 新增 Supervisor `interruptThread` 触发 canonical events 转发及 `craftedSessionsByThread` 自动释放的完整集成单测。
- `HarnessPanel.test.tsx`：
  - 覆盖 `CraftingGrid` 接收到 `onCraft` 并路由至 `startThreadFromCraft`。

## Evidence

1. **测试套件运行**：
   - Native 定向套件（9 个测试文件，35 个测试）全部 PASS。
   - `HarnessPanel.test.tsx`、`nativeAdapter.test.ts`、`runtime.test.ts` 全部 PASS。
2. **真实 Antigravity Product-Path 门控测试**：
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 与 `CRAFTSTATION_AGY_EXECUTABLE` 运行 `nativeProductPath.integration.test.ts`：`1 passed`（真实 `agy 1.1.22` 执行并通过 `closeThread` 退出清理与 Supervisor IPC 转发）。
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
- 本 Feature 的独立验收结论以专属 Debugger（Task ID: `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`）的复检结果为准。