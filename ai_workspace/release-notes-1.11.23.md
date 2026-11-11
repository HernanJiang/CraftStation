# CraftStation 1.11.23

## 用户可见

- 左侧对话导航条默认向左收起；鼠标移到左边缘时展开，移出后自动收起。
- 悬停预览、点击定位和键盘 Tab 导航继续可用；键盘焦点离开时，预览卡片一起关闭。

## 实现

- 保留 8px 边缘感应区，使用 150ms CSS 平移和透明度过渡；独立 hover group 避免聊天区域悬停误触。
- 隐藏的刻度不接收鼠标点击；仅键盘可见焦点保持展开，避免点击后的普通焦点导致导航常驻。

## 验证

- 导航组件与 changelog 共 24 项现有测试、类型检查、lint、格式检查通过。
- 真实隔离 Electron 的 60 轮消息中，默认隐藏、边缘展开、预览、点击跳转、点击后移出收起及键盘操作通过。
- 定向 mock 应用冒烟全部场景和 gate 通过，控制台 / 运行时异常 0。未重跑全量测试。
- 本补丁发布 Windows x64 安装包与便携版。

---

# CraftStation 1.11.23

## User-facing

- The left conversation navigation rail now slides out of view by default, expands when you hover over the left edge, and retracts when the pointer leaves.
- Hover previews, click-to-jump, and keyboard Tab navigation remain available. Leaving keyboard focus also closes the preview card.

## Implementation

- Keep an 8px edge target and use 150ms CSS translation and opacity transitions. A dedicated hover group avoids activation from unrelated chat hover states.
- Hidden ticks do not capture pointer input. Only keyboard-visible focus keeps the rail expanded, so a previous mouse click does not leave it open.

## Verification

- All 24 existing navigation and changelog tests, type checking, lint, and formatting checks passed.
- An isolated real Electron app with 60 conversation turns passed checks for hiding, edge reveal, previews, click-to-jump, hiding after clicks, and keyboard behavior.
- Every targeted mock app smoke scenario and gate passed with zero console/runtime exceptions. The full suite was not rerun.
- This patch ships Windows x64 installer and portable packages.
