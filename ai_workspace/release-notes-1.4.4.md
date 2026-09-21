# CraftStation v1.4.4 — 计划弹层操作修复

## 用户可见

- 线程顶部的"计划"弹层按钮修复：原先两个图标按钮（暂停/继续 + 立即运行）在任务暂停时都渲染成 Play，看起来像是重复的暂停/继续键。
- 现在每条计划提供三个明确操作：
  - **暂停/继续**（Pause / CirclePlay 图标区分）
  - **编辑**（铅笔）：跳转计划页并直接打开编辑器，可修改时间、周期、时区、Agent、提示词等全部字段
  - **删除**（垃圾桶）：弹确认框后才删除
- "立即运行"在计划主页保留（点击计划名称进入）。

## 实现

- `scheduleStore` 新增 `editingScheduleId` 跨视图编辑请求：弹层设置后跳转计划页，`SchedulesView` 消费该字段自动打开 `ScheduleEditor`（列表未加载完时等待，目标已删除时丢弃）。
- 删除走与计划主页一致的 `ConfirmDialog` + `deleteSchedule` 链路，删除后经统一 store 刷新。

## 验证

- `ThreadScheduleIndicator` 新增 6 例（三按钮渲染、暂停、恢复、编辑路由、删除确认、取消不删）；`SchedulesView` 新增 2 例（跨视图编辑请求打开预填编辑器、陈旧 id 丢弃）。
- 30/30 计划相关测试通过；`pnpm typecheck` + `pnpm lint` PASS。

Windows x64 提供 NSIS 安装包和便携版。

---

# CraftStation v1.4.4 — Schedule popover action fix

## User-facing

- Fixed the thread "Schedules" popover: its two icon buttons (pause/resume + run-now) both rendered as Play when a schedule was paused, looking like duplicate pause/resume controls.
- Each schedule now offers three clear actions:
  - **Pause/Resume** (distinct Pause vs CirclePlay icons)
  - **Edit** (pencil): jumps to the Schedules page and opens the editor directly — time, recurrence, timezone, agent, and prompt are all editable
  - **Delete** (trash): confirmed via a dialog before removal
- "Run now" remains available on the Schedules page (click the schedule name).

## Implementation

- `scheduleStore` gains an `editingScheduleId` cross-view request: the popover sets it and navigates; `SchedulesView` consumes it to open `ScheduleEditor` (waits for the list to load, drops stale ids).
- Deletion reuses the same `ConfirmDialog` + `deleteSchedule` flow as the Schedules page, refreshing through the shared store.

## Verification

- 6 new `ThreadScheduleIndicator` cases (three buttons, pause, resume, edit routing, delete confirmation, cancel) and 2 new `SchedulesView` cases (cross-view edit opens a prefilled editor, stale ids dropped).
- 30/30 schedule tests pass; `pnpm typecheck` and `pnpm lint` pass.

Windows x64 NSIS installer and portable builds are provided.
