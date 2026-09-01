# CraftStation Coder Fix Cycle 交付 — v0.7.1

日期：2026-08-29
对应 Feature：`v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
分支：`feature/v0.7-native-harnesses`
基线：`dev / 7ae6506`
Debugger Fix Plan：`ai_workspace/agent_docs/debugger_0.7.0.md`

## Existing

- v0.7.0 已有 CraftPlan → NativeProcessHarnessRuntimeAdapter → Entity → Session 产品路径。
- Antigravity 生产 transport 继续使用官方 `agy` 的 `--input-format stream-json` / `--output-format stream-json`；不使用 TUI、PTY 键盘注入，也不宣称 ACP/JSON-RPC。
- DeepSeek / DSH 继续使用已审计的官方 JSON-RPC 2.0 over stdio 边界；本机没有官方 Windows carrier。
- 原有 descriptor capability 仍按实测范围表达；没有因为单轮或本轮退出证据把未验证的 MCP、Skills、subagents、resume、多轮、context/compaction 或 tool 能力升格为 `supported+integrated`。

## Fixed

### F40 — 定向格式化

- 只对 Debugger 指定的六个文件执行 `oxfmt --write`：
  - `src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.tsx`
  - `src/supervisor/runtime/nativeHarness/descriptors.ts`
  - `src/supervisor/runtime/nativeHarness/index.ts`
  - `src/supervisor/runtime/nativeHarness/nativeAdapter.ts`
  - `src/supervisor/runtime/nativeHarness/nativeEventCanonicalizer.ts`
  - `src/supervisor/runtime/nativeHarness/nativeTransport.ts`
- 六个路径重新执行 `oxfmt --check`，全部通过。

### F38 — 真实 Antigravity 退出与 IPC 证据

- 将真实 product-path integration test 的清理动作改为显式调用 `SupervisorRuntime.closeThread({ threadId })`。
- 在真实 `agy.exe` 会话上观察 `session.exited`，证明产品控制面触发了 native session 终止并完成清理事件投影。
- 在同一真实运行中记录 Supervisor runtime event forwarding；IPC seam 收到 `turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`。
- 继续保持 `synthetic: false`，不新增第二轮 prompt，不把真实退出证据误表述为所有 Antigravity capability 已集成。

## Added

- 更新 `src/supervisor/runtime/nativeHarness/nativeProductPath.integration.test.ts`：
  - 真实测试成功后经 `SupervisorRuntime.closeThread` 结束同一 Session；
  - 断言 `session.exited`；
  - 记录并断言 `subscribeRuntimeEvents` 收到的 canonical IPC seam 事件；
  - 成功与 unavailable artifact 都记录清理和 IPC 事件摘要。
- 更新 `PROJECT_STATUS.md`：当前状态明确为 `DEBUGGER FAIL / BLOCKED — FIX CYCLE v0.7.1 READY FOR RE-REVIEW`，Next Step 指向原配对 Debugger。

## Evidence

### F40 静态证据

执行：

```text
pnpm exec oxfmt --check [Debugger 指定六个文件]
All matched files use the correct format.
```

同时验证：

```text
pnpm exec oxlint --deny-warnings [六个文件 + product-path integration test]
通过

git diff --check
通过
```

### F38 真实 product path

执行：

```text
CRAFTSTATION_REAL_NATIVE_HARNESSES=1
CRAFTSTATION_AGY_EXECUTABLE=C:\Users\Haona\AppData\Local\agy\bin\agy.exe
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/nativeProductPath.integration.test.ts
```

结果：`1 test passed`，本机 `agy --version` 为 `1.1.22`。脱敏 artifact：
`ai_workspace/validation/v0.7.0-antigravity-product-path.json`

artifact 当前包含：

- `synthetic: false`
- `verdict: PASS`（仅表示该受门控 product-path probe 成功，不是 Feature PASS）
- `executionPath: SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe stream-json -> Entity -> Session`
- `nativeTypes: init, step_update, result`
- `eventTypes` 与 `ipcEventTypes` 均包含 `turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`
- `cleanup.operation: SupervisorRuntime.closeThread`
- `cleanup.observedSessionExited: true`
- 未写入 token、cookie、authorization、API key 或完整 prompt 内容

### Native 定向回归

执行：

```text
pnpm exec vitest run --configLoader runner \
  src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts \
  src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts \
  src/supervisor/runtime/nativeHarness/nativeHarnessProviderFixtures.test.ts \
  src/supervisor/runtime/nativeHarness/controlPlane.test.ts \
  src/shared/crafting/nativeRuntimeConfig.test.ts
```

结果：`5 test files passed`，`19 tests passed`。

### F39 官方 carrier 复核

- `Get-Command` 对 `dsh-jsonrpc-agent`、`dsh`、`deepseek-harness`、`deepseek-cli` 均为 `MISSING`。
- 候选路径 `C:\Users\Haona\AppData\Local\dsh\bin\dsh-jsonrpc-agent.exe` 不存在。
- 继续使用 descriptor/factory 的 `RUNTIME_UNAVAILABLE`，不创建 synthetic Entity/Session。
- 没有使用 CLIProxyAPI、普通 OpenAI-compatible API 或其他 API fallback。

## Remaining

- F40：已关闭，等待 Debugger 独立确认。
- F38：真实退出/清理和 Supervisor IPC forwarding 证据已补；Antigravity 完整 Gate 仍未声称关闭，官方 tool、permission、MCP、Skills、subagents、resume/multi-turn、context/compaction 等未取得完整真实证据，descriptor 保持诚实状态。
- F39：仍 `BLOCKED / RUNTIME_UNAVAILABLE`，直到官方 DeepSeek / DSH Windows carrier、认证和真实 runtime 可用；当前不应修改 unavailable 设计。
- 全量 test/lint 的既有基线失败仍按 `coder_0.7.0.md` 记录，未因本 Fix Cycle 扩大到无关文件。
- 未修改 `main`、共享 `D:\Work\CraftStation\craftstation-dev` 或 v0.8 工作树；未执行 commit、push、tag、merge 或 dev→main promotion。

## Handoff

状态：`READY FOR DEBUGGER RE-REVIEW`。请由本 Feature 新建的专属 Debugger 任务读取 `PROJECT_STATUS.md` 与本文件，独立复核 F40/F38/F39。不得把单轮 marker、fixture、Coder 自检或本文件单独当作 Feature PASS。

本 Fix Cycle 的 v0.7 专属 Debugger 已新建：Codex task `01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`，模型 `grok-4.6` / 推理强度 `high`。旧的通用 `Debugger` 线程属于 v0.6，不承担本 Feature 验收。
