# 1.11.15 已完成时长恢复修复（2026-10-23）

## 用户可见

- 新回合独立计时，不再继承数天前的开始时间并显示数千分钟。
- 已完成回合使用保存的开始、结束时间，重新打开会话或切换后不再继续增长；残留 active 时间不会覆盖有效的已完成时间对。
- 缺少可靠开始、结束时间，或时间顺序错误时，只显示状态，不编造耗时或整轮速度估算。

## 实现

- 原生 `turn.started` 同步重置 renderer 与 main/headless 持久化的 active 开始时间，覆盖单事件、批量与多线程批量。
- 快照恢复及完成边界不再把会话 `updatedAt` 当作回合开始；重新打开正在活动的 GUI 回合保留新原生时间。
- 已完成时长必须有有效、顺序正确且冻结的时间对；输出速度的整轮兜底遵循同一时间窗口。

## 验证

- 200 项相关测试、完整 `pnpm typecheck` 与 `pnpm lint` 通过。
- 隔离 Electron 的 6 项定向检查通过，覆盖 renderer 重载恢复、切换会话、新回合计时、完成后冻结与异常时间。
- 本次变更范围的 mock smoke 全部通过，控制台/运行时错误 0。未测试真实账号回合、完整功能库存或整应用进程退出重启。
- 已写入完整但错误的历史时间对，若缺少可信原始记录，不猜测重建；有效长回合不按任意时长截断。

---

# 1.11.15 Completed turn duration recovery fix (2026-10-23)

## User-facing

- New turns start their own clock instead of inheriting a start time from days earlier and showing thousands of minutes.
- Completed turns use their saved start and end times, so their duration stays fixed when you reopen or switch conversations. A stale active clock no longer overrides a valid completed window.
- When reliable timing is missing or the timestamps are reversed, only the status is shown without an invented duration or whole-turn speed estimate.

## Implementation

- Native `turn.started` resets the active start in both renderer state and main/headless persistence, including single events, batches and multi-thread batches.
- Snapshot recovery and turn completion no longer use the thread's `updatedAt` as a turn start. Reopening an active GUI turn preserves its fresh native start.
- Completed durations require valid, ordered and frozen timestamps. The whole-turn fallback for output speed uses the same timing window.

## Verification

- 200 related tests, full `pnpm typecheck` and `pnpm lint` passed.
- Six targeted checks passed in an isolated Electron app, covering renderer reload recovery, conversation switching, a fresh turn clock, frozen completion and invalid timestamps.
- All changed-scope mock smoke checks passed with zero console/runtime errors. Real provider turns, the full functional inventory and a full app process restart were not tested.
- Complete but already incorrect historical timestamp pairs cannot be precisely rebuilt without reliable source records. This patch does not guess their timing or cap valid long-running turns.
