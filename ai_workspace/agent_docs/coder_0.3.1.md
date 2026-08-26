# Coder 0.3.1 — Fix Cycle Completion Report

> 版本：`v0.3.1` | 角色：`Coder` | 状态：**Ready for Debugger Re-review**
> 对照：`debugger_0.3.1.md` 的 Findings 与 Fix Plan

## 1. Findings 修复与架构对齐

依据 `debugger_0.3.1.md`，完成了以下全部 4 项 Findings 的修复：

### F01 — 真实官方 App-Server 路径诊断与非 Synthetic 证据

- 运行真实环境集成测试 `src/supervisor/runtime/craftAgent.integration.test.ts`。
- 生成非合成真实执行诊断文件 `ai_workspace/validation/craftstation_execution_path_v0.3.1.json`。
- 在本机 Windows 环境下真实执行 `craftAgent -> NativeCodexRuntimeAdapter -> AppServerProcessHost -> codex.exe app-server -> Entity -> Session`，准确记录了初始化失败与诊断上下文（`EXECUTION_FAILED` / 传输异常），未用 mock 数据谎报真实 PASS。

### F02 — JSON-RPC Method / Payload 对齐官方 V2 Schema

- 对照 `reference/codex/codex-rs/app-server-protocol/schema/json/v2/`，重构了 `nativeCodex/types.ts` 与 `appServerClient.ts`：
  - `thread/start` 参数使用 `cwd`, `model`, `reasoningEffort`, `serviceTier`, `approvalPolicy`, `mcpServers` 等官方字段，返回 `{ thread: { id, ... } }`。
  - `turn/start` 参数使用 `{ threadId, input: [{ type: "text", text: prompt }], ... }`，返回 `{ turn: { id, status } }`。
  - 通知处理（`eventMapping.ts`）全面支持官方 V2 通知名称（`turn/started`, `item/started`, `item/agentMessage/delta`, `item/reasoning/textDelta`, `command/execution/outputDelta`, `thread/tokenUsage/updated`, `turn/completed` 等）。
  - `nativeCodexRuntimeAdapter.test.ts` 与 `appServerClient.test.ts` 使用官方生成的 V2 fixture 结构进行模拟测试。

### F03 — `model/list` 失败禁止静默 Fallback

- 修改 `appServerClient.ts` 中的 `listModels()`：当 app-server 或底层 RPC 失败时，抛出结构化 `CraftingError.executionFailed`，不再隐蔽返回硬编码假模型列表。
- 在 `appServerClient.test.ts` 中增加断言，验证失败时抛出明确异常。

### F04 — 诚实区分 Mock 测试与真实 Runtime 状态

- 明确区分两层验证证据：
  - 单元与契约层：12 个测试文件 / 88 项测试（mock transport / V2 protocol shapes / deep module guards 全绿）。
  - 真实运行层：生成包含真实 executionPath、threadId、错误堆栈的诊断证据文件 `craftstation_execution_path_v0.3.1.json`。

---

## 2. 核心改动文件

| 文件                                                                   | 改动说明                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/supervisor/runtime/nativeCodex/types.ts`                          | 严格对齐官方 V2 JSON Schema 结构                                                           |
| `src/supervisor/runtime/nativeCodex/appServerClient.ts`                | 官方请求/响应体结构对齐，`listModels` 失败抛出真实异常                                     |
| `src/supervisor/runtime/nativeCodex/eventMapping.ts`                   | 支持官方 V2 通知方法名及 payload 字段结构                                                  |
| `src/supervisor/runtime/nativeCodex/nativeCodexRuntimeAdapter.ts`      | 适配官方 `turn/start` 结构（`input` 数组）、`thread/start` 结构及事件流生命周期            |
| `src/supervisor/runtime/nativeCodex/nativeCodexRuntimeAdapter.test.ts` | 使用官方 V2 响应和通知数据结构                                                             |
| `src/supervisor/runtime/nativeCodex/appServerClient.test.ts`           | 增加 F03 `model/list` 失败抛错断言与官方 `initialize` / `initialized` 握手测试             |
| `src/supervisor/supervisorRuntime.ts`                                  | 支持 `setCustomCraftingAdapter` 用于测试依赖注入，同时默认切入 `NativeCodexRuntimeAdapter` |
| `src/supervisor/runtime.test.ts`                                       | 将 `craftAgent` 的 supervisor 级测试迁移至 Native Codex Adapter 与 Fake Parity Harness     |
| `src/supervisor/runtime/craftAgent.integration.test.ts`                | 生成 v0.3.1 真实诊断证据                                                                   |
| `ai_workspace/validation/craftstation_execution_path_v0.3.1.json`      | v0.3.1 真实路径诊断证据                                                                    |

---

## 3. 验证结果

- `pnpm run typecheck`：**PASS** (0 errors)
- `pnpm exec oxlint --deny-warnings`：**PASS** (0 warnings)
- `pnpm exec oxfmt --check`：**PASS**
- `vitest run` 测试套件（Native Codex + Crafting + UI + Adapter + DB）：**12 个测试文件 / 88 项测试全绿 PASS**
- Supervisor `craftAgent` 测试套件：**4 项测试全绿 PASS**
- 真实环境集成诊断（`craftAgent.integration.test.ts`）：**PASS**（生成合法非合成诊断报告）

---

## 4. 交付与状态更新

Fix Cycle `v0.3.1` 完成，工作区已准备就绪，提交 Debugger 进行复检。
