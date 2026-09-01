# Debugger 复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> 对应 Feature：`v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`
>
> 角色：Debugger
>
> 日期：2026-08-29
>
> 工作树：`D:\\Work\\CraftStation\\craftstation\\.worktrees\\v0.7`
>
> 分支：`feature/v0.7-native-harnesses`
>
> HEAD：`7ae6506` + 未提交 v0.7 改动
>
> Coder 交付：[coder_0.7.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.7/ai_workspace/agent_docs/coder_0.7.0.md)
>
> Manager Plan：[manager_0.7.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.7/ai_workspace/agent_docs/manager_0.7.0.md)
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

独立验收 T01→T09。不以 Coder 自检、unit/fixture、或单一 Harness 单轮 marker 替代 Feature PASS。核对：

1. Antigravity 官方 `agy --input-format stream-json --output-format stream-json`，不宣称 ACP/JSON-RPC，不走 TUI/PTY 生产路径。
2. DeepSeek/DSH 官方 JSON-RPC stdio 边界；无 Windows carrier 时 `RUNTIME_UNAVAILABLE`，禁止 synthetic Entity/Session。
3. CraftPlan → Entity → Session → canonical events / IPC 脱敏。
4. Capability 诚实：未用 fixture 升格 supported+integrated。
5. 全量 test/lint 基线失败归属。

未执行 commit / push / tag / merge main。未改 v0.6 `craftstation-dev` 或 v0.8 工作树。

## Evidence

### 独立复跑（本轮 Debugger）

- 定向 Vitest：7 passed / 1 skipped（product-path 因 `CRAFTSTATION_REAL_NATIVE_HARNESSES` 未置 1 而 skip），28 passed / 1 skipped。证据：[v0.7.0-debugger-targeted-test.txt](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.7/ai_workspace/validation/v0.7.0-debugger-targeted-test.txt)
- 触及文件 `oxlint --deny-warnings`：通过。
- 触及文件 `oxfmt --check`：**失败**（6 files，见 F40）。
- `git diff --check`（触及 nativeHarness / registry / HarnessPanel）：通过。
- 本轮未把全仓 17 个既有失败算进 v0.7 回归；抽样方向与 v0.8 相同的品牌路径 `.craftstation` vs `.craftstation` 属基线，不要求 Coder 为全绿改无关测试。

### 真实 Antigravity 边界

- 本机独立确认：`C:\\Users\\Haona\\AppData\\Local\\agy\\bin\\agy.exe --version` → `1.1.22`，与 artifact 一致。
- Coder 产物：[v0.7.0-antigravity-product-path.json](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.7/ai_workspace/validation/v0.7.0-antigravity-product-path.json)
  - synthetic=false
  - path=`SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe stream-json -> Entity -> Session`
  - response=`CRAFTSTATION_AGY_PRODUCT_PATH_OK`
  - events=`turn.started, session.started, content.delta, turn.completed`
  - nativeTypes=`init, step_update, result`
- 本轮 Debugger **没有**再跑 `CRAFTSTATION_REAL_NATIVE_HARNESSES=1` 以免重复消耗官方额度。单轮 marker **不能**关闭 Manager 的 UI 实时事件、退出/取消、以及官方自管 tool/MCP/Skills/subagent 门。

### DeepSeek / DSH

- 本机 `Get-Command` / `where`：`dsh-jsonrpc-agent` / `dsh` / `deepseek-harness` / `deepseek-cli` 均无。
- Factory：无 executable 时 `UnavailableNativeHarnessRuntimeAdapter`，descriptor capabilities 全 `unavailable`。
- Lifecycle 测试锁定：unavailable 不创建 synthetic lifecycle。
- 这是可复现阻塞证据，不是 PASS。禁止 CLIProxyAPI / Model API fallback。

### 源码事实

- Transport：`createAntigravityStreamTransport` 固定 `--print= --input-format stream-json --output-format stream-json`；secret/content redact。
- Canonicalizer：嵌套 `step_update`/`result` payload；`user_input DONE` 不结束 turn；权威 boundary 是 `result`。
- Recipe：`recipe:google-antigravity-native` / `recipe:deepseek-native`。
- IPC：`SupervisorRuntime` 仍 emit `thread-runtime-event`；HarnessPanel 对 deepseek 显示 Unavailable / RUNTIME_UNAVAILABLE。
- Antigravity capabilities 为 `implementation missing`（mcp/subagents/context/compaction 为 native unsupported）。诚实，未因单轮 marker 升格。
- 生命周期 fixture 仍覆盖 **PTY** Antigravity 路径；生产 factory 走 `NativeProcessHarnessRuntimeAdapter`。PTY 保留为 legacy/reference，不能当成产品路径验收。

## Spec Fidelity

| Gate                             | 工程实现                              | 真实证据                            | 结论                        |
| -------------------------------- | ------------------------------------- | ----------------------------------- | --------------------------- |
| Antigravity official stream-json | transport/adapter/canonicalizer       | 单轮 product-path JSON + agy 1.1.22 | 工程部分关闭；验收门未满    |
| UI 实时 canonical 事件           | Supervisor emit + HarnessPanel 状态行 | Debugger 未独立看到桌面 UI 流       | BLOCKED                     |
| 退出/取消                        | interrupt/cleanup 代码与 fixture      | 无真实 agy 取消/退出证据            | BLOCKED                     |
| 官方自管 tool/MCP/Skills         | 未重写 agent loop                     | 无真实 tool/MCP 证据                | 保持 implementation missing |
| DSH 真实 runtime                 | JSON-RPC 合同 + unavailable factory   | 无 Windows carrier                  | BLOCKED / unavailable 诚实  |
| 脱敏                             | redactNativePayload                   | 未见 token 进 artifact              | 工程关闭                    |
| oxfmt                            | —                                     | 6 files check fail                  | FAIL（F40）                 |

## Findings

### F38 — Antigravity 真实验收门未闭合

- Evidence：仅单轮 marker；无真实 cancel/exit；无 Debugger 独立 UI 实时观察；descriptor 仍 implementation missing。Coder Remaining 已自承 tool/MCP/resume/multi-turn 未证。
- Impact：不能把 Feature 标 PASS。单 Harness 单轮成功不是 Feature 完成。
- Root Cause：证据范围小于 Manager Antigravity Gate（streaming + 终态 + 退出/取消 + UI 实时）。
- Fix：补可脱敏的真实证据，而不是升格 capability。优先：一次 interrupt/cancel 或进程退出 cleanup；若用户允许，再补第二轮 turn。不要为了 PASS 把 implementation missing 改成 supported+integrated。
- Acceptance：真实 cancel/exit 或明确记录官方不支持该探测；UI/IPC 路径有非 fixture 事件转发证据。无更多凭据/额度则保持 BLOCKED。

### F39 — DeepSeek/DSH 保持 RUNTIME_UNAVAILABLE

- Evidence：本机无 official carrier；descriptor/factory/测试一致。
- Impact：DeepSeek Gate 的真实 init/stream 未完成。
- Root Cause：官方分发无 Windows carrier（环境）。
- Fix：**不要**伪造 executable 或 API fallback。有官方 carrier 后再做真实 JSON-RPC smoke。
- Acceptance：保持 unavailable 直到真实二进制存在。本项不是立刻改代码。

### F40 — 触及文件 oxfmt --check 失败

- Evidence：`HarnessPanel.tsx`、`descriptors.ts`、`index.ts`、`nativeAdapter.ts`、`nativeEventCanonicalizer.ts`、`nativeTransport.ts`。
- Impact：v0.7 静态门未过。
- Fix：仅对上述文件跑 `oxfmt`，不要全仓格式化无关文件。
- Acceptance：同样 6 个路径 `oxfmt --check` 通过。

## Fix Plan

Coder 只做：

1. **F40**：格式化上述 6 个文件。
2. **F38**：在不升格 capability 的前提下补 Antigravity 退出/取消或第二轮真实证据；没有额度则保持 BLOCKED 并写明。
3. **F39**：无 DSH Windows carrier 则停止，不改 unavailable。

不要重做已关闭 redact/stream-json 合同，不要碰 v0.6/v0.8 树，不要为全仓品牌测试全绿。

## Fix Execution Order

1. F40 oxfmt
2. F38 仅在有官方 agy 会话可消耗时补 cancel/exit 证据
3. F39 等待官方 DSH carrier

## Verdict

**FAIL / BLOCKED**

- 工程主路径（stream-json adapter、DSH unavailable 诚实、脱敏、定向测试）大部分可复核。
- Feature v0.7.0 不能 PASS。
- Requires Manager Re-plan: **No**
