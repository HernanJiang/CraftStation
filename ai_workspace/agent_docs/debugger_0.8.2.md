# Debugger Re-review — v0.8.0 F37（二次确认）

> 对应 Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 角色：Debugger
>
> 日期：2026-08-29
>
> 工作树：`D:\\Work\\CraftStation\\craftstation\\.worktrees\\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> HEAD：`7ae6506` + 未提交 v0.8 改动
>
> 上一轮：[debugger_0.8.1.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/debugger_0.8.1.md)
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

只确认 Coder 对 debugger_0.8.1.md 的处理：无官方 CLI 时是否停止、是否未 synthetic smoke、是否未升格 compatibility/capability。不重开已关闭工程项。不把 Coder 自述当 PASS。

## Evidence

### 独立 CLI 探针（本轮 Debugger 再次执行）

- `Get-Command opencode, opencode.exe, opencode.cmd`：无 Name/Source。
- `where.exe` 三个名字均未找到。
- 常见安装位 `Test-Path` 全 false（LocalAppData/opencode、Roaming/npm、~~/.opencode/bin、~~/.local/bin、Program Files、scoop shim）。
- 独立结论：**OPENCODE_BINARY_UNAVAILABLE**。

### 状态未升格

- [v0.8.0-opencode-compatibility.json](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-opencode-compatibility.json)：probe.status=`unavailable`，reason=`OPENCODE_BINARY_UNAVAILABLE`；六条记录仍全部 `unavailable`。
- `capabilityMap()` 仍把 implemented 标为 `implementation missing`；descriptors.ts 不含 `supported+integrated`。
- Git：无新的 serve/smoke 产物；无 commit/push/tag；相对 0.8.1 没有为伪造 E2E 改 compatibility 或 descriptor。

### Coder 行为

Coder 声明：无 CLI 故本 Fix Cycle 没有可实施代码修复；未启动 serve；未读凭据；未 synthetic smoke。本轮独立证据与该声明一致。这是正确停止，不是 Feature PASS。

## Findings

### F37 — 仍然打开，但没有新的工程回归

- Evidence：官方 executable 仍不存在；矩阵与 capability 未升格。
- Impact：真实 init / assistant stream / 后续 turn 仍无法验收。
- Root Cause：环境缺少官方 OpenCode CLI 与对应 provider 凭据。不是合同代码回退。
- Fix：**Coder 现在不要再改代码、不要再空转 CLI 检查。** 等官方 `opencode` 与凭据可用后再做真实 smoke。
- Acceptance：与 debugger_0.8.0.md / 0.8.1.md 相同。

已关闭工程项保持关闭。既有 v0.4 F04、v0.5 F29/F33、v0.6 F35/F36 继续 FAIL/BLOCKED。

## Fix Plan

无新代码项。环境门：

1. 用户或环境提供官方 OpenCode executable（及所需 provider credentials）。
2. 之后 Coder 只补真实脱敏探针，更新 compatibility.json。
3. Debugger 再复检 F37。在此之前停止派发空转修复。

## Verdict

**FAIL / BLOCKED**

- Feature v0.8.0 不能 PASS。
- F37 因 OPENCODE_BINARY_UNAVAILABLE 保持打开。
- Coder 停止实施是正确的。
- Requires Manager Re-plan: **No**
