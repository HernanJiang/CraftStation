# Coder — v0.3.2

## 角色与范围

本报告对应 `v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane` 的 Debugger Fix Cycle `v0.3.2`。依据 `debugger_0.3.2.md` 执行，`Requires Manager Re-plan: No`。

Coder 已完成本轮 Fix Plan 与自检，并将结果交给 Debugger re-review；本报告不把 Coder 自检等同于 Feature 最终 PASS。

## 修复结果

### F01 — 真实官方 Runtime 路径与诊断证据

- 真实集成测试现在通过 `SupervisorRuntime.craftAgent` 产品 seam 执行：
  `SupervisorRuntime.craftAgent -> NativeCodexRuntimeAdapter -> AppServerProcessHost -> official codex app-server -> Entity -> Session`。
- 真实测试复用同一个官方 app-server 连接完成 model discovery、thread/start、第一轮 turn 和同一 Thread 的第二轮 turn。
- `AppServerProcessHost.stop()` 等待子进程退出或受控超时后再返回，使 `stderrTail`、`lastExitCode`、`lastExitSignal` 可被稳定写入 evidence。
- `SupervisorRuntime.craftAgent`/`resumeCraftAgent` 优先返回官方 app-server 创建的 session thread id，不再返回可能与官方 UUID 不同的 CraftPlan request id。

真实证据：[craftstation_execution_path_v0.3.2.json](../validation/craftstation_execution_path_v0.3.2.json)

证据事实：

- `synthetic: false`，`verdict: PASS`
- binary：`codex-cli 0.150.0-alpha.8`
- `initializeResult` 成功，动态发现 13 个模型
- `threadId` 与 session events 中的官方 Thread UUID 一致
- 第一轮：`CRAFTSTATION_REAL_ROUNDTRIP_OK`
- 第二轮：`CRAFTSTATION_SECONDTURN_OK`
- `spawnArgs: ["app-server", "--stdio"]`
- `stderrTail` 已记录；内容为官方插件资源路径和 PowerShell shell snapshot warning，无认证或协议失败
- 正常清理记录为 `exitCode: null`、`exitSignal: "SIGTERM"`

### F02 — 官方 JSONL wire framing

- `JsonRpcTransport` 发出的 request、notification、response 省略 wire 上的 `jsonrpc` 字段，符合官方 Codex app-server stdio JSONL 约定。
- 内部类型中的 `jsonrpc` 保持可选，以兼容官方响应和测试 fixture。
- Native mock fixture 与断言同步官方 V2：`thread/start` 使用 `{ thread: { id } }`，`turn/start` 使用 `input` 数组，`turn/steer` 使用 `input` 数组。

### F03 — `model/list` 不静默 fallback

- `AppServerClient.listModels()` 失败时继续抛出结构化 `CraftingError.executionFailed`，不生成硬编码假模型。
- 真实 evidence 保存实际发现的 13 个模型 ID。

## 验证结果

以下命令均已在 `D:\Work\CraftStation\craftstation` 串行执行：

- `pnpm run typecheck`：PASS
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeCodex src/shared/crafting src/supervisor/runtime.test.ts`：PASS，8 个测试文件 / 76 个测试
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/craftAgent.integration.test.ts`（`CRAFTSTATION_REAL_RUNTIME=1`）：PASS，真实官方运行证据生成
- `pnpm exec vitest run --configLoader runner src/shared/crafting/boundaryGuard.test.ts ...`：PASS，Native/legacy boundary 与 Supervisor craftAgent 目标测试通过
- touched-file `oxlint --deny-warnings`：PASS
- touched-file `oxfmt --check`：PASS

本轮验证期间曾因并行启动多个 `pnpm` 命令触发 Windows workspace postinstall 的 generated directory 竞争；随后使用仓库已有脚本串行恢复 `packages/codex-protocol/generated`，再执行 typecheck 并通过。该环境问题不作为产品失败证据。

## 当前状态

- F01：Coder 修复完成，已有真实双轮 PASS 证据，交 Debugger 复核。
- F02：Coder 修复完成，wire framing 与官方 JSONL 对齐，交 Debugger 复核。
- F03：保持关闭。
- Feature：未由 Coder 宣布最终 PASS；等待 Debugger 独立 re-review。
- Next：Debugger 读取本报告和 v0.3.2 evidence，按 Fix Acceptance Criteria 复核。
