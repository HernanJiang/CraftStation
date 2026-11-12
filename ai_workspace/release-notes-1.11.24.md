# CraftStation 1.11.24

## 用户可见

- 临时对话窗口调小：默认最大 520×560，宽高分别不超过屏幕可用区域的 80%，并在屏幕中居中。
- 低分辨率和高系统缩放下保留屏幕边距；切换到较小屏幕后再次打开，会自动缩回屏幕内。
- 仍可手动拖动和调整大小，位于屏幕内的位置与尺寸会保留。

## 实现

- 在 Electron DIP 坐标中统一计算临时对话尺寸与位置，移除固定 640 高度和额外上移偏移。
- 最小窗口尺寸随小屏幕目标尺寸收缩；重新打开时检查整个窗口边界。

## 验证

- 窗口几何、临时对话及 changelog 共 44 项测试、类型检查、lint 与格式检查通过。
- 隔离真实 Electron 中确认原生 520×560 DIP 窗口；三种 viewport 尺寸与 100% / 125% / 150% 应用缩放共 8 组检查，输入框、发送按钮及关闭按钮均在窗口内。
- 定向 mock 应用冒烟自动场景通过，控制台 / 运行时错误 0。未重跑全量测试，未验证外部模型回复。
- 本补丁发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.24

## User-facing

- Temporary chat opens in a smaller window, up to 520×560, centered on the display. Its width and height each stay within 80% of the available screen area.
- Low-resolution displays and high system scaling retain screen margins. Reopening after switching to a smaller display brings an oversized window back on screen.
- Manual dragging and resizing remain available. Positions and sizes that fit on screen are preserved.

## Implementation

- Calculate temporary chat bounds consistently in Electron DIP coordinates, replacing the fixed 640 height and extra upward offset.
- Reduce minimum window dimensions when needed on smaller displays and check the entire window boundary when reopening.

## Verification

- All 44 relevant window geometry, temporary chat, and changelog tests, type checking, lint, and formatting checks passed.
- An isolated real Electron app confirmed native 520×560 DIP bounds. Eight viewport checks across three sizes and 100% / 125% / 150% application zoom kept the input, send button, and close button in view.
- Targeted mock app smoke scenarios passed with zero console/runtime errors. The full test suite and external model responses were not tested.
- This patch ships Windows x64 installer and portable packages.
