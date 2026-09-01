# CraftStation Coder 交付 — v0.7.2 Fix Cycle

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

- **F41 (DeepSeek 官方 Windows carrier 适配)**：
  - 修正了 `index.ts`、`descriptors.ts` 与 `nativeAdapter.ts` 对可执行文件的查找逻辑，支持解析当前 Windows 环境中真实安装的官方 `@deepseek-ai/dsh`（`dsh.cmd` / `dsh.ps1` / `dsh.exe`），同时向下兼容独立 binary `dsh-jsonrpc-agent`。
  - 当启动命令为 `dsh` 时，自动生成官方 `--profile sdk`（或根据 `profileRef` 配置 `--profile <name>`），并支持通过 `--patch <configPath>` / `DSH_CORDIS_CONFIG` 传递配置，驱动 stdio JSON-RPC 2.0，不使用 API proxy 或 CLIProxyAPI。
- **F42 (生产 Crafting UI 接入 `startThreadFromCraft`)**：
  - 在 `HarnessPanel.tsx` 中为 `<CraftingGrid />` 提供了生产 `onCraft` 回调与 `workspace` 路径，当用户点击合成并启动时，通过 `startThreadFromCraft(currentProject, result, prompt)` 真实启动 Agent 线程。
- **F43 (crafted Session 的 interrupt IPC 路由)**：
  - 在 `SupervisorRuntime` 上实现了 `interruptThread(payload: { threadId: string })`，优先检查 `this.craftedSessionsByThread`，将中断信号精确分发给对应的 `craftedSession.interrupt()`；在 `ipcHandlers.ts` 中将 `interruptThread` 映射到 `runtime.interruptThread`。
- **F44 (Windows interrupt 状态修正)**：
  - 修正了 `NativeProcessCraftSession.interrupt()` 在 Windows 平台上的状态转换：由于 Windows 下 `child.kill()` 会直接终止子进程，Session 在中断后立即将状态置为 `terminated`（并在收到 `session.exited` 事件时保持终态），避免后续 turn 试图向已死亡进程的 stdin 写入；后续 `startTurn` 会明确拒绝。
- **F45 (Capability Matrix 状态修正)**：
  - 修正了 `descriptors.ts`：将 Antigravity descriptor 中未验证的 `mcp`、`subagents`、`context`、`compaction` 从 `native unsupported` 纠正为 `implementation missing`；DeepSeek descriptor 中的能力矩阵也统一通过 `capabilityMap` 标注为 `implementation missing`，真实反映“接口已接入、高级能力未实测”的客观事实。
- **F46 (nativeEnvelope 脱敏正则增强)**：
  - 扩展了 `nativeTransport.ts` 中的 `CONTENT_KEY`，覆盖 `text_delta`、`reasoning_delta`、`thought_delta`、`output_text`、`raw_output`、`delta`、`user_message`、`assistant_message`、`instruction`、`instructions`、`query`、`completion` 等文本字段，确保不会将用户或模型正文原文（即使 500 字符内）泄露到安全诊断信封中。
- **DSH 事件规范化解析修复**：
  - 修复了 `nativeEventCanonicalizer.ts` 中解析 `session.event` 时由于双重读取 `.params` 导致 `turn/end` 被吞没超时的缺陷，确保 DSH `turn.completed` 正常派发。

## Added

- `nativeAdapter.test.ts`：
  - 新增 `dsh` CLI 参数构造与 `--profile sdk` 启动验证测试。
  - 新增 `interrupt()` 在 Windows 下将 session status 标记为 `terminated` 的测试（`it.runIf(process.platform === "win32")`）。
  - 新增 `redactNativePayload` 针对 `text_delta`、`reasoning_delta`、`output_text`、`delta`、`query` 的脱敏单测断言。
- `HarnessPanel.test.tsx`：
  - 新增 `CraftingGrid` 接收到 `onCraft` 并路由至 `startThreadFromCraft` 的完整组件测试。
- `runtime.test.ts`：
  - 新增 `SupervisorRuntime.interruptThread` 路由到 `craftedSessionsByThread` 的单元测试。

## Evidence

1. **测试套件运行**：
   - Native 定向套件（8 个测试文件，35 个测试）全部 PASS（1 个真实门控测试在未显式开启时按设计跳过）。
   - `HarnessPanel.test.tsx`、`nativeAdapter.test.ts`、`runtime.test.ts` 全部 PASS。
2. **真实 Antigravity Product-Path 门控测试**：
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 与 `CRAFTSTATION_AGY_EXECUTABLE` 运行 `nativeProductPath.integration.test.ts`：`1 passed`（真实 `agy 1.1.22` 执行并通过 `closeThread` 退出清理与 Supervisor IPC 转发）。
3. **静态检查门禁**：
   - `pnpm run typecheck`：通过（TypeScript 7 零错误）。
   - `pnpm exec oxlint --deny-warnings <touched_files>`：通过（零警告零错误）。
   - `pnpm exec oxfmt --check <touched_files>`：通过（12 个触及文件格式全部对齐）。
   - `git diff --check`：通过（无空白/格式残留）。
4. **工作树隔离验证**：
   - `main`、共享 `D:\Work\CraftStation\craftstation-dev`（v0.6）以及 `D:\Work\CraftStation\craftstation\.worktrees\v0.8` 均未修改。
   - 本工作树未执行 `git commit`、`git push`、`git tag`、`git merge` 或 `dev→main` promotion。

## Remaining

- 官方 Antigravity 与 DeepSeek 的高级能力（MCP、Skills、子 Agent、上下文压缩、工具调用等）目前处于 `implementation missing` / 未实测状态，待后续专项 probe 闭环。
- 本 Feature 的独立验收结论以专属 Debugger（Task ID: `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`）的复检结果为准。
