# Debugger — v0.3.1

## Review Scope

Feature-level Review：`v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane`。

对照 `manager_0.3.0.md`、`coder_0.3.0.md`、`nativeCodex/**`、官方 `reference/codex` app-server 测试。

本轮不修改产品代码。Fix Cycle `v0.3.1` 由 Coder 执行。

## Evidence

- 生产 cutover：`SupervisorRuntime.createCraftingAdapter` 使用 `new NativeCodexRuntimeAdapter()`；`craftAgent` / `resumeCraftAgent` 经该 Adapter。
- 独立测试：`vitest run src/supervisor/runtime/nativeCodex src/shared/crafting/fakeCodexHarness.test.ts src/shared/crafting/boundaryGuard.test.ts` → 全部绿（mock transport）。
- 无 `ai_workspace/validation/` 真实 app-server / prompt / response 证据。
- CodeGraph 已 `sync`（21 files）。
- 官方对照：`reference/codex/codex-rs/app-server/tests/suite/v2/initialize.rs` 使用 `initialize_with_client_info` / `ThreadStartParams` / `TurnStartParams`（V2 协议），不是 Coder 自造的 `thread/start` mock 形状。

## Review

### Spec Fidelity

T01 fake seam 仍成立。T02–T09 的**产品声明**（官方 app-server、真实 streaming、resume/fork/steer/interrupt、approval/MCP、cutover）在代码结构上有对应模块，但验收证据全部是 **PassThrough mock JSON-RPC**。`listModels` 在失败时返回硬编码 GPT 列表。没有本机 `codex app-server` initialize → thread → turn → response 证据。

Manager：没有真实 round-trip 不得把 Feature 当 PASS。本轮适用同一标准。

### Integration

UI 仍走 `craftAgent`。Adapter 不再用 TSM。但 Adapter 与官方协议是否能握手未证明。`resumeCraftAgent` 仍 `sendPrompt`，resume 语义是否等于官方 `thread/resume` 未用真服务器验证。

### Regression

nativeCodex / fake / boundary 测试绿。未跑全仓。工作区仍混有 v0.1/v0.2 品牌与 UI 未提交改动。

### Runtime / Edge Cases

- `model/list` 失败静默 fallback 到内置模型，违反「不静默 fallback」。
- `startTurn` 若收不到 `turn.completed` 会挂起（无超时，也无失败）。
- 无 AUTH / binary missing 的真实诊断证据文件。

### Architecture

方向对：CraftStation-owned host + JSON-RPC + mapping，不 deep-import CraftStation Codex session。boundaryGuard 检查 nativeCodex 不引用 TSM。这不够证明协议正确。

## Findings

### F01 — 无官方 app-server 真实 round-trip

- Evidence：测试用 PassThrough 自写 `initialize` / `thread/start` / `turn/start` 响应。validation 目录无 v0.3 证据。
- Impact：不能声称 T02–T09 完成或 Feature PASS。
- Fix：对真实 `codex app-server` 跑 initialize、thread/turn、至少一条 prompt 的 events/response；失败则保存 `AUTH_REQUIRED` / `RUNTIME_UNAVAILABLE` 等稳定诊断，禁止 mock JSON 标 PASS。
- Acceptance：`ai_workspace/validation/` 非 synthetic 证据含 binary 版本、initialize result、thread/turn id、非合成 events。

### F02 — JSON-RPC method/payload 未对照官方 schema 锁死

- Evidence：`AppServerClient` 调用 `thread/start`、`turn/start`、`model/list`。官方测试使用生成的 `ThreadStartParams` / `TurnStartParams` 与 initialize client info。Coder mock 的 result `{ threadId, created: true }` 不能代表官方 wire format。
- Impact：连上真服务器可能 method not found / invalid params。
- Fix：对照 `reference/codex` app-server-protocol，把 request/response/notification 名称与必填字段改成官方 V2；加 golden fixture（从官方测试或 schema 截取），mock 必须用同一形状。
- Acceptance：fixture 来自官方协议；真实握手或明确 protocol mismatch 错误。

### F03 — `model/list` 失败时静默返回内置模型

- Evidence：`appServerClient.listModels` catch 后返回 gpt-5.3-codex 等硬编码列表。
- Fix：失败映射 `RUNTIME_UNAVAILABLE` 或 capability 缺失，不假装发现成功。
- Acceptance：transport 拒绝 `model/list` 时测试断言抛错/降级状态，不出现假模型列表。

### F04 — Coder 把 mock 管道写成 Feature 完成

- Evidence：`coder_0.3.0.md` 称 T01–T09 完整执行、生产路径完全切换。测试与真实 Codex 未接通。
- Fix：`coder_0.3.1.md` 区分 mock contract 与官方 runtime 证据。

## Fix Plan

1. 用官方 protocol 校正 JSON-RPC methods/params/notifications。
2. `listModels` 禁止静默假数据。
3. 真实 `codex app-server` 证据或产品路径稳定失败诊断。
4. 补 supervisor 级 `craftAgent` 使用 Native adapter 的测试（fake host，但 method 形状正确）。
5. 诚实更新 Coder 文档。

## Fix Acceptance Criteria

- [ ] request/response/notification 与 `reference/codex` V2 协议一致，或可证明的稳定 mapping
- [ ] 非 synthetic 真实 round-trip **或** 产品路径 `AUTH_REQUIRED`/`RUNTIME_UNAVAILABLE`/protocol mismatch 诊断
- [ ] `model/list` 失败不返回硬编码成功列表
- [ ] `craftAgent` 生产组装 Native adapter 有自动化覆盖
- [ ] 文档不把 mock 当 Feature PASS

## Requires Manager Re-plan

`No`。目标仍是官方 app-server，实现未对齐协议与证据。

## Verdict

`FAIL`

## Closeout

PASS 时才执行。本轮无 User Smoke（Feature 未通过，不要让用户当完成品验收官方 Codex 路径）。
