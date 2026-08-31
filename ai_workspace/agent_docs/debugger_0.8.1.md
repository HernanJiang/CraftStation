# Debugger Re-review — v0.8.0 F37

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
> 上一轮：[debugger_0.8.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/debugger_0.8.0.md)
>
> Coder 复检交接：`ai_workspace/validation/v0.8.0-f37-recheck-2026-08-29.txt`
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

只复检 F37。不重开已关闭工程项：HTTP/OpenAPI+SSE 合同、session/event seam、binding、recipes、composition、脱敏、定向测试。不把 Coder 复检文本当 PASS。独立再查官方 OpenCode executable。无 CLI 时不得启动 serve、不得读凭据、不得 synthetic smoke。

## Evidence

### 独立 CLI 探针（本轮 Debugger）

- `Get-Command opencode, opencode.exe, opencode.cmd`：无结果。
- `where.exe opencode / opencode.exe / opencode.cmd`：未找到。
- PATH 中无 opencode 目录命中。
- 常见安装位 `Test-Path` 全 false：
  - `%LOCALAPPDATA%\\opencode`
  - `%APPDATA%\\npm\\opencode.cmd` / `.exe`
  - `~\\.opencode\\bin\\opencode.exe`
  - `~\\.local\\bin\\opencode.exe`
  - `C:\\Program Files\\opencode\\opencode.exe`
  - scoop shim
- 结论与 Coder 一致，且可独立复现：**OPENCODE_BINARY_UNAVAILABLE**。

### Coder artifact

- [v0.8.0-f37-recheck-2026-08-29.txt](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-f37-recheck-2026-08-29.txt)
  - `opencode: NOT_FOUND`
  - `opencode.exe: NOT_FOUND`
  - `opencode.cmd: NOT_FOUND`
  - `F37_STATUS: OPENCODE_BINARY_UNAVAILABLE`
  - 明确未启动 serve、未读凭据。

### 兼容矩阵未升格

[v0.8.0-opencode-compatibility.json](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-opencode-compatibility.json)

- probe.status=`unavailable`
- probe.reason=`OPENCODE_BINARY_UNAVAILABLE`
- 六条记录仍为 `unavailable`：OpenAI gpt-4o、xAI grok-4、Google gemini-2.5-pro、DeepSeek deepseek-chat、Moonshot-native kimi-k2.5、OpenAI-compatible kimi-k2.5
- 无 verified / supported / integrated

### Descriptor 未升格

`OPENCODE_NATIVE_HARNESS_DESCRIPTOR.capabilities` 仍走 `capabilityMap(implemented)`，状态为 `implementation missing`，不是 supported+integrated。

### Git

- 工作树仍有未提交 v0.8 源码与文档。
- 本轮相对上一轮 Debugger 复检，新增的主要是 F37 recheck 文本；未见为伪造 E2E 而改 compatibility 或 capability。
- 未 commit / push / tag / merge main。

## Findings

### F37 — 仍然打开

- Evidence：本轮独立 PATH/where/常见路径全部 miss；矩阵六条 unavailable；descriptor 未升格。
- Impact：仍无法证明官方 serve 上的真实 init / assistant stream / 后续 turn / tool / compaction / usage。
- Root Cause：官方 OpenCode executable 不在本机。不是合同代码回退。
- Fix：有官方 CLI 与对应 provider 凭据后再做真实 smoke。无 CLI 则停止。
- Acceptance：至少一条真实成功响应，或每条 route 留下可复现官方错误；不得把 unavailable 改写成 supported。

已关闭工程项保持关闭。不要让 Coder 重做 mock/contract。

既有质量门继续 FAIL/BLOCKED：v0.4 F04、v0.5 F29/F33、v0.6 F35/F36。

## Fix Plan

与 debugger_0.8.0.md 相同，不扩 scope：

1. 等待官方 `opencode` executable。
2. 可用后对六条 route 做最小真实 smoke：init、assistant stream、至少一次后续 turn；按配置记录 tool/compaction/usage、abort/resume/cleanup。
3. 更新 compatibility.json，保持诚实 status。
4. 无 CLI/凭据则保持 BLOCKED，不得 synthetic PASS。

## Verdict

**FAIL / BLOCKED**

- F37 未关闭。
- Feature v0.8.0 不能 PASS。
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
