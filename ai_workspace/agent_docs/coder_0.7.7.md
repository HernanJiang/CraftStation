# CraftStation Coder 交付 — v0.7.7 Fix Cycle

日期：2026-08-30
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
分支：`feature/v0.7-native-harnesses`
基线：`dev / 7ae6506`

## Existing

- 复用既有 `crafting`、`registry`、`HarnessRuntimeAdapter`、canonical `RuntimeEvent`、Supervisor `craftAgent` / `resumeCraftAgent` 以及 UI/IPC seam。
- 保持 Codex、Grok、Kimi native runtime 的已有 provider boundary。
- 保持官方 Antigravity `--input-format stream-json` / `--output-format stream-json` 的非 PTY/非 TUI 驱动方式。
- 保留 F40、F42、F43、F44、F45、F46 的全部已闭环修复与回归单测。

## Fixed

- **F41 (可注入的 Production Factory Discovery/Readiness Seam)**：
  - 在 `createNativeHarnessRuntimeAdapter` 的 options 中注入 `resolveExecutable` 与 `spawnProcess`，使生产 factory 能够完全可控地覆盖各种 carrier/discovery 边界。
- **F41 (Production Factory 完整行为测试矩阵)**：
  - 在 `nativeAdapter.test.ts` 中构建了 `DeepSeek production factory behavior matrix`，完整覆盖 5 种场景：
    1. **absent**: 未发现 carrier 时返回 `UnavailableNativeHarnessRuntimeAdapter`，诊断为 `RUNTIME_UNAVAILABLE`，`spawnEntity` 同步拒绝，不产生 Entity。
    2. **installed-unconfigured**: 发现 carrier 但 plan 缺少 `configPath` 时，`spawnEntity` 阶段前置拒绝，产生 `Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created)` 错误与 `RUNTIME_UNAVAILABLE` 诊断，不创建 Entity，无 session 残留。
    3. **invalid/non-serving exit**: 模拟进程启动后因无效配置立即非 0 崩溃退出，`createSession` 捕获异常，产生 `RUNTIME_UNAVAILABLE` / `NATIVE_PROCESS_CRASHED` 诊断，无 session 残留。
    4. **protocol failure**: 模拟子进程 stdout 输出畸形非 JSON-RPC 文本，捕获 `PROTOCOL_MISMATCH` 诊断，clean exit，无 session 残留。
    5. **ready**: 模拟合法 JSON-RPC server 流程（`initialize` -> `session/prompt` -> `session.event` -> `turn.completed` -> `shutdown`），完整验证 `spawnEntity -> createSession -> startTurn -> terminate` 流程，终态后 `getActiveSessions()` 自动为 0。
- **F41 (真实 Windows DSH Carrier 探针与事实更新)**：
  - 确认本机安装的 `@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5` 的 `dsh-jsonrpc-agent` 在未提供 config 时输出 usage 退出 1；在提供外部 config 时因 npm 包缺失依赖模块（缺少 `@deepseek-ai/dsh-sdk-jsonrpc-server` 等）而导致 Node loader 报错退出 1。
  - 在 `ai_workspace/validation/v0.7.0-native-runtime-audit.md` 中完整记录了该探针事实，确认由于外部官方 Windows carrier 尚未提供完整的 serving composition，产品层严格保持 `RUNTIME_UNAVAILABLE`，禁止普通 API、CLIProxyAPI 或 synthetic fallback。
- **治理与交付状态对齐**：
  - 补充持久化 `coder_0.7.6.md` 与 `coder_0.7.7.md`，更新 `PROJECT_STATUS.md` 到 Fix Cycle v0.7.7。

## Added

- `src/supervisor/runtime/nativeHarness/index.ts`：
  - `NativeHarnessAdapterFactoryOptions` 支持可选 `resolveExecutable` 与 `spawnProcess`。
- `src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts`：
  - 新增 `DeepSeek production factory behavior matrix` 5 个场景的完整单测（absent, installed-unconfigured, invalid exit, protocol mismatch, ready）。
- `ai_workspace/validation/v0.7.0-native-runtime-audit.md`：
  - 更新真实 Windows carrier 探针细节与运行决策。

## Evidence

1. **测试套件运行**：
   - Native 定向套件（9 个测试文件，35 个测试）全部 PASS。
   - `HarnessPanel.test.tsx`、`nativeAdapter.test.ts`、`runtime.test.ts` 全部 PASS（108 passed / 1 skipped）。
2. **真实 Antigravity Product-Path 门控测试**：
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
- 本 Feature 的独立验收结论以专属 Debugger（Task ID: `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`）的复检结果为准。
