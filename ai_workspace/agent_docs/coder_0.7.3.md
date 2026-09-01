# CraftStation Coder 交付 — v0.7.3 Fix Cycle

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

- **F41 (DeepSeek Harness 保持诚实 RUNTIME_UNAVAILABLE)**：
  - 确认当前 Windows npm 包 `@deepseek-ai/dsh@0.1.1-rc.2` 尚未 bundle 官方 stdio `sdk` profile，且 npm cmd/ps1 shim 不应作为 machine-facing binary 启动。`index.ts` 恢复为仅在发现受支持的独立 `dsh-jsonrpc-agent` 可执行文件时才启动原生进程，当前 Windows 环境下诚实返回 `UnavailableNativeHarnessRuntimeAdapter`，产生准确的 `RUNTIME_UNAVAILABLE` 诊断，不使用 API proxy / CLIProxyAPI / synthetic fallback。
- **F44 (Interrupt 补齐 canonical turn.completed 与 session.exited)**：
  - 修正了 `NativeProcessCraftSession.interrupt()`：在 Windows 下当进程终止时，补齐发出 `turn.completed` (state: "interrupted") 与 `session.exited` (reason: "interrupted")，并将 session status 置为 `terminated`。
  - 通过 Supervisor 的 `session.subscribe` 机制，`session.exited` 事件会自动触发 `this.releaseCraftedSession(threadId)`，确保中断后 session 自动从 Supervisor map 中释放清理，不发生状态残留。
- **F40 (Focused oxfmt 全绿)**：
  - 完成了 `src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts` 的 `oxfmt --write` 格式化，触及的全部 13 个文件 `oxfmt --check` 全部 100% 格式对齐。
- **F42 (生产 Crafting UI 接入 `startThreadFromCraft`)**：
  - `HarnessPanel.tsx` 传入生产 `onCraft` 回调与 `workspace` 路径，点击合成启动真实 Agent 线程。
- **F43 (crafted Session 的 interrupt IPC 路由)**：
  - `SupervisorRuntime.interruptThread` 优先路由至 `craftedSessionsByThread` 并调用 `craftedSession.interrupt()`。
- **F45 (Capability Matrix 状态修正)**：
  - Antigravity 与 DeepSeek 的未实测高级能力统一标注为 `implementation missing`，不再列为 `native unsupported`。
- **F46 (nativeEnvelope 脱敏正则增强)**：
  - `CONTENT_KEY` 覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta` 等字段，安全脱敏。

## Added

- `nativeAdapter.test.ts`：
  - 覆盖 Windows interrupt 后的 session status 与 `turn.completed` / `session.exited`。
  - 覆盖 `redactNativePayload` 针对 `text_delta`、`reasoning_delta`、`output_text` 等字段的脱敏单测。
- `HarnessPanel.test.tsx`：
  - 覆盖 `CraftingGrid` 接收到 `onCraft` 并路由至 `startThreadFromCraft`。
- `runtime.test.ts`：
  - 覆盖 `SupervisorRuntime.interruptThread` 路由到 `craftedSessionsByThread`。

## Evidence

1. **测试套件运行**：
   - Native 定向套件（9 个测试文件，35 个测试）全部 PASS。
   - `HarnessPanel.test.tsx`、`nativeAdapter.test.ts`、`runtime.test.ts` 全部 PASS。
2. **真实 Antigravity Product-Path 门控测试**：
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 与 `CRAFTSTATION_AGY_EXECUTABLE` 运行 `nativeProductPath.integration.test.ts`：`1 passed`（真实 `agy 1.1.22` 执行并通过 `closeThread` 退出清理与 Supervisor IPC 转发）。
3. **静态检查门禁**：
   - `pnpm run typecheck`：通过（TypeScript 7 零错误）。
   - `pnpm exec oxlint --deny-warnings <touched_files>`：通过（零警告零错误）。
   - `pnpm exec oxfmt --check <touched_files>`：通过（13 个触及文件全部通过）。
   - `git diff --check`：通过（无空白/格式残留）。
4. **工作树隔离验证**：
   - `main`、共享 `D:\Work\CraftStation\craftstation-dev`（v0.6）以及 `D:\Work\CraftStation\craftstation\.worktrees\v0.8` 均未修改。
   - 本工作树未执行 `git commit`、`git push`、`git tag`、`git merge` 或 `dev→main` promotion。

## Remaining

- 官方 Antigravity 与 DeepSeek 的高级能力（MCP、Skills、子 Agent、上下文压缩、工具调用等）目前处于 `implementation missing` / 未实测状态，待后续专项 probe 闭环。
- 本 Feature 的独立验收结论以专属 Debugger（Task ID: `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`）的复检结果为准。
