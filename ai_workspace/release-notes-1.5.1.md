# CraftStation v1.5.1 — Devin 任务完成状态修复

## 用户可见

- 修复 Devin 在前台轮次结束后继续自主执行任务、最终已经给出完成报告，但线程仍长期显示“工作中”的问题。
- Devin 的最终回复在没有未完成工具或子 Agent 时，会经过 5 秒静默确认后自动结束运行状态；静默期内出现新的真实活动会取消收口，避免误判仍在执行的任务。
- 更新并重启后，旧版本遗留的“工作中”状态会按现有启动恢复机制清理；后续同类任务会自动正确结束。

## 实现

- 为共享 ACP Session 增加可选的孤立轮次完成策略，默认行为保持不变，仅由需要该语义的 Harness 启用。
- Devin Adapter 启用最终助手消息静默收口，并在工具调用、子 Agent 或新思考继续时撤销待执行的收口。
- 收口会补发 `item.completed` 与 `turn.completed`，使运行时、数据库和界面计时状态保持一致。

## 验证

- ACP、Session Factory 与 Devin 定向测试共 162 项通过；新增回归测试覆盖最终回复自动结束以及静默期内恢复工作不会被提前结束。
- `pnpm typecheck`、`pnpm lint`、格式检查和 Electron 主进程生产构建通过。
- 完整测试执行 12,074 项：12,007 项通过、64 项跳过；3 项 Windows 并发时序用例在整套高负载下超时，逐文件重跑共 96 项全部通过。

Windows x64 提供 NSIS 安装包和便携版。

---

# CraftStation v1.5.1 — Reliable Devin task completion

## User-facing

- Fixed Devin threads remaining in the working state after foreground completion, autonomous follow-up work, and a final completion report.
- When no tool or sub-agent remains active, Devin's final response now closes the running state after a five-second quiet period. Any real activity during that window cancels completion so ongoing work is not stopped early.
- Restarting after the update clears stale working states through the existing startup recovery path, while future tasks settle automatically.

## Implementation

- Added an opt-in orphan-turn completion policy to the shared ACP session while preserving the existing default for other harnesses.
- Enabled final-response quiet-period completion for the Devin adapter, cancelling the pending completion when tools, sub-agents, or reasoning resume.
- Completion emits both `item.completed` and `turn.completed` so runtime, persistence, and UI timing remain consistent.

## Verification

- All 162 targeted ACP, session factory, and Devin tests pass, including new coverage for final-response completion and resumed activity during the quiet period.
- `pnpm typecheck`, `pnpm lint`, formatting checks, and the production Electron main-process build pass.
- The full suite ran 12,074 tests: 12,007 passed and 64 were skipped. Three Windows concurrency timing cases timed out under full-suite load and all 96 tests passed when their files were rerun individually.

Windows x64 NSIS installer and portable builds are provided.
