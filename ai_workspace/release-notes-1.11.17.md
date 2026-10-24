# CraftStation 1.11.17

## 用户可见

- 右上角 CLI 更新卡片改为更清晰的主题灰色。
- 修复非 100% 应用缩放下更新卡片向右错位、溢出窗口的问题；卡片现在会继续与更新按钮右对齐。

## 实现

- 更新卡片复用其他菜单已有的 `overlayZoomClasses` 缩放补偿，外层校正定位坐标，内层保持文字和图标的应用缩放。
- 卡片背景使用 `--surface-secondary`，保留现有圆角与菜单结构。
- 新增灰色表面与 125% 缩放补偿的回归断言。

## 验证

- `CliUpdateMenu.test.tsx` 12 项与 changelog 16 项测试通过；新增回归在修复前失败、修复后通过。
- `pnpm typecheck`、`pnpm lint` 与 `pnpm build` 通过。
- 隔离 Electron 在 125% 缩放下实测：背景为 `rgb(33, 34, 40)`，弹层与按钮右边缘偏差约 0.6px，未溢出窗口；截图位于 `C:/Users/Haona/.craftstation-smoke/debug-1792859588608-56944/cli-update-after-125.png`。
- changed-scope mock smoke 的 welcome、baseline 与 changed-surface gate 通过，控制台/运行时错误 0；既有 `responsive-layout` 场景在空节点 `querySelector` 断言失败，报告位于 `C:/Users/Haona/.craftstation-smoke/automated-1792860064496-51480/artifacts/smoke-report.json`，不宣称全量 smoke 通过。
- 完整测试在允许 WSL 启动的测试配置下为 12839 项通过、13 项失败；失败均位于本次未修改的模块，不宣称完整测试全绿。
- 本补丁仅发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.17

## User-facing

- The CLI update card in the top-right corner now uses a clearer theme grey.
- Fixed the update card drifting right and overflowing the window at non-100% app zoom. It now stays right-aligned with the update button.

## Implementation

- Reuse the existing `overlayZoomClasses` compensation: the outer layer corrects positioning coordinates while the inner layer preserves app-scaled text and icons.
- Use `--surface-secondary` for the card background while retaining the existing corners and menu structure.
- Add regression assertions for the grey surface and 125% zoom compensation.

## Verification

- All 12 `CliUpdateMenu.test.tsx` tests and 16 changelog tests passed. The new regression failed before the fix and passes after it.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed.
- In an isolated Electron app at 125% zoom, the card background is `rgb(33, 34, 40)`, its right edge differs from the button's by about 0.6px, and it does not overflow the window. Screenshot: `C:/Users/Haona/.craftstation-smoke/debug-1792859588608-56944/cli-update-after-125.png`.
- Changed-scope mock smoke passed welcome, baseline, and the changed-surface gate with zero console/runtime errors. The existing `responsive-layout` scenario still fails on a null-node `querySelector` assertion; see `C:/Users/Haona/.craftstation-smoke/automated-1792860064496-51480/artifacts/smoke-report.json`. This is not a claim of full smoke success.
- The full suite passed 12839 tests and failed 13 under the test configuration that permits WSL startup. Every remaining failure is outside the files changed here; this is not a claim of a fully green suite.
- This patch ships Windows x64 installer and portable packages.
