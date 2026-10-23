# 1.11.14 重开窗口检查与通知关闭修复（2026-10-23）

## 用户可见

- 关闭到托盘后重新打开、或从最小化还原主窗口时，会检查界面内容；发现空白后自动重载，必要时重建窗口。首次打开仍保留加载时间。
- 通知右上角的关闭图标在悬停时保持可见、可点。关闭通知不会触发其中的重试或打开对话操作。

## 实现

- 主窗口的内容检查从启动时的一次检查扩展到 show / restore；hide / closed 清除待执行检查，异步探测期间隐藏也不会启动恢复。沿用已有的单窗口恢复合并与重建上限。
- 合并 mvanhorn 的 [PR #18](https://github.com/HernanJiang/CraftStation/pull/18)，为通知关闭控件补齐可见性和交互状态样式及相关测试。感谢社区贡献。

## 验证

- `pnpm typecheck`、`pnpm lint` 通过；窗口与通知 55 项测试、changelog 16 项测试通过。
- 隔离 Electron 中连续 10 次关闭到托盘再打开通过；注入空白内容后重新打开，自动重载并恢复（约 4 秒）；3 次渲染重载正常。悬停、鼠标关闭和键盘关闭通知通过，未误触其他 handler。定向 smoke 的启动和界面基线通过，控制台 / 运行时错误 0。
- 全量 mock smoke 存在 schedules、webchat、provider-live、composer-caret 和 responsive-layout 场景失败，未宣称全量 PASS。未测试真实账号回合。本次确认并修复了内容恢复漏检；截图中偶发灰屏的首次触发原因尚未唯一定位。

---

# 1.11.14 Window reopen checks and toast dismissal fixes (2026-10-23)

## User-facing

- Reopening the main window from the tray or restoring it from a minimized state now checks its content. Blank content triggers a renderer reload and, if needed, window recreation. The first opening still has time to load normally.
- The toast dismiss icon stays visible and clickable on hover. Dismissing a notification does not run its retry action or open its conversation.

## Implementation

- Main-window content checks now run on show / restore as well as startup. Hide / closed cancel pending checks, and hiding during an asynchronous probe prevents recovery from starting. Existing recovery coalescing and recreation limits remain in use.
- Merged mvanhorn's [PR #18](https://github.com/HernanJiang/CraftStation/pull/18), adding visibility and interaction-state styles for toast dismissal along with related tests. Thank you for the contribution.

## Verification

- `pnpm typecheck` and `pnpm lint` passed, along with 55 window / toast tests and 16 changelog tests.
- An isolated Electron app passed 10 close-to-tray / reopen cycles. After blank content was injected, reopening automatically reloaded and restored the UI in about four seconds. Three renderer reloads also mounted normally. Toast hover, mouse dismissal, and keyboard dismissal passed without triggering other handlers. Targeted startup and renderer smoke checks passed with zero console / runtime errors.
- The full mock smoke run had failures in schedules, webchat, provider-live, composer-caret, and responsive-layout; it is not reported as a full PASS. Real account turns were not tested. This release fixes a confirmed gap in content recovery; the original intermittent gray-screen trigger shown in the screenshot has not been uniquely identified.
