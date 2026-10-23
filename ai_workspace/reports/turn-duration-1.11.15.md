# 1.11.15 已完成时长修复验证

日期：2026-10-23。Working copy：`D:/Work/CraftStation`，分支 `main`。

## 根因和处理

- 原生 `turn.started` 未重置 thread 的 active 开始时间；多轮沿用旧时间，持久化后可跨重开继续错误。
- 已结束状态缺少 end 时，状态栏使用 `now`，把离线与空闲时间计入耗时。已完成状态优先取 last start/end；有效结束时间不随挂载或时钟推进而变化。
- main 与 renderer 的开始和结束兜底曾借用 `updatedAt`。缺少真实开始时现在保留未知，避免构造数天的已完成回合和速度估算。
- 时间戳非法或结束早于开始时不显示耗时。有效长回合不按任意阈值截断；已经持久化为完整但错误的历史时间对，缺少可信原始时间时不能精确重建，本版不猜测改写。

## 自动测试

`pnpm exec vitest run --configLoader runner src/main/remote/server/runtimePersistence.test.ts src/renderer/state/appStore.test.ts src/renderer/components/thread/ThreadRuntimeStatusBar.test.tsx src/renderer/state/slices/runtimeEventSlice.test.ts src/renderer/state/slices/runtimeEventSlice.helpers.test.ts src/main/db/projectsThreads.test.ts src/main/db/runtimeItems.test.ts`：7 文件，200 项通过。

覆盖 native start（单事件、批量、多线程批量）、已有 stale active、新回合活动重新打开 GUI、快照恢复、未知开始的完成落库、完成状态未知/非法/倒置 end、跨日重新挂载时冻结耗时。新增未知开始用例先运行失败：main 与 renderer 均返回旧 `2026-10-21T10:58:18.458Z`，去掉 fallback 后通过。

`pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。发布说明测试单独验证。

## 隔离 Electron

Session：`C:/Users/Haona/.craftstation-smoke/turn-duration-1.11.15-20261023/session.json`。

定向脚本及证据均在该隔离目录，`artifacts/duration-verification.json` 的 6 项全部通过：

1. 已完成时间对覆盖残留旧 active，显示 1m 0s。
2. 保存到真实 SQLite 后 renderer reload，恢复后仍为 1m 0s，等待后不增长。
3. native start 重置两天前的开始时间，Working 1s -> Completed 1s，完成后冻结。
4. 完成但缺少 end，只显示状态。
5. end 早于 start，不显示假零耗时。
6. 切换到草稿再回原会话，保持 1m 0s。

截图：`artifacts/completed-one-minute.png`、`completed-unknown-duration.png`、`completed-after-switch.png`。定向脚本运行时异常 0。

Changed scope mock smoke：`artifacts/smoke/smoke-report.json`。welcome-dismissal、baseline、settings、control-geometry、thread-search、mock-integrations、composer-caret 全通过；changed-surface、provider-live、remote-mobile、runtime-requests 均为 MOCK PASS。控制台和运行时错误 0。该结果只证明本地确定性场景；未执行真实 provider 回合、整应用进程退出重启或完整功能库存。未把 renderer reload 说成进程重启。

## 发布审计

前一 tag：`v1.11.14`。目标为当前修复及 1.11.15 发布元数据提交，创建 tag 前为未发布边界。

Commit disposition：`40b86359 docs: 记录 1.11.14 发布与验证结果` -> omit（上一版发布记录，无新产品行为）。当前全部产品 diff -> include，合并为新回合独立计时与已完成固定时间两个 changelog bullet。既有 `pnpm-lock.yaml` 改动和无关临时文件排除。
