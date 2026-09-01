# CraftStation Coder 交付 — v0.7.5 Fix Cycle

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

- **F41 (Windows Safe npm shim spawn 解析)**：
  - 在 `nativeTransport.ts` 中实现 `resolveNativeSpawnTarget`，利用仓库已有的 `extractWindowsCmdShimScript` 与 `resolveExecutablePath`，在 Windows 下遇到 npm `.cmd` shim（如 `dsh.cmd` / `dsh-jsonrpc-agent.cmd`）时，安全提取其 target js entry 并转换为 `node.exe` + `[entry.js, ...args]` 启动，保持 `shell: false`，彻底消除 `child_process.spawn` 在 Windows 下直接执行 `.cmd` 抛出的 `ENOENT` 异常。
- **F41 (DSH Unconfigured Fail-Closed 边界)**：
  - 确认官方 `dsh-jsonrpc-agent` 严格要求显式 Cordis 配置文件，若未提供 `configPath` 且未设置 `DSH_CORDIS_CONFIG` 环境变量，在 `openSession` 时立即同步抛出 `CraftingError.runtimeUnavailable("Official DSH runtime requires an explicit Cordis config path.")` 并产生 `RUNTIME_UNAVAILABLE` 诊断，不创建 transport、不启动无用进程、不发挂起请求，彻底消除 false-ready 缺陷。
- **F41 (Production Factory 单元测试补齐)**：
  - 在 `nativeAdapter.test.ts` 中补充了 `createNativeHarnessRuntimeAdapter` 的生产 factory 测试，覆盖 missing carrier / unconfigured carrier 的 fail-closed 行为。
- **真实 Antigravity 产品路径在 live 账号下准确记录 AUTH_REQUIRED / closeThread 退出清理证据**：
  - 针对真实 Google 账号出现 eligibility / 认证提示的情况，在 `nativeProductPath.integration.test.ts` 中保留真实返回的 `AUTH_REQUIRED` 证据，并记录 `closeThread` 触发的 `session.exited` 清理，不伪造 PASS。

## Added

- `nativeTransport.ts`：
  - 导出 `resolveNativeSpawnTarget(command, args)`，支持 Windows 下 npm shim 的安全解包。
- `nativeAdapter.test.ts`：
  - 补充 `resolveNativeSpawnTarget` 目标提取测试。
  - 补充 DSH 缺失 cordis config 时的 fail-closed 单元测试。
  - 补充 production factory 行为测试。

## Evidence

1. **测试套件运行**：
   - Native 定向套件（9 个测试文件，35 个测试）全部 PASS。
   - `HarnessPanel.test.tsx`、`nativeAdapter.test.ts`、`runtime.test.ts` 全部 PASS（104 passed / 1 skipped）。
2. **真实 Antigravity Product-Path 门控测试**：
   - 设置 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 与 `CRAFTSTATION_AGY_EXECUTABLE` 运行 `nativeProductPath.integration.test.ts`：`1 passed`（真实 `agy 1.1.22` 执行并通过 `closeThread` 退出清理与 Supervisor IPC 转发，真实生成 `ai_workspace/validation/v0.7.0-antigravity-product-path.json`）。
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