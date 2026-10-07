# CraftStation v1.8.3

## 用户可见

- 修复截图、图片、代码和 Mermaid 流程图放大后，关闭按钮 X 大部分区域无法点击的问题。
- 在不同界面缩放比例下，点击 X 的左侧、中心和右侧均可关闭预览。
- 调整跨线程对话弹窗：扩大输入区，窄窗口自动使用单栏，长内容在内部滚动，底部操作按钮保持可见；投递选项的选中状态更清晰。

## 实现

- 为弹窗遮罩和图片预览统一设置 `no-drag`，阻止底层窗口拖动区拦截鼠标点击。
- 冒烟测试增加 Windows 原生命中检查；将 CSS 纳入变更覆盖，避免只改样式时遗漏预览回归。
- 跨线程弹窗按自身宽度切换布局，修正界面缩放后的遮罩和居中容器高度，固定标题与底部操作区，移除列表中冗余的原生会话 ID。

## 验证

- 隔离 Electron 覆盖代码、Mermaid 和图片预览，在 100%、130%、150% 界面缩放下通过 81 个原生命中点和 27 次关闭操作。
- 真实鼠标点击 Mermaid 预览的 X 中心可正常关闭。
- 跨线程对话在五种窗口尺寸与缩放组合下通过布局、输入区宽度、内部滚动、底部按钮和关闭操作检查，覆盖长记录及附加上下文输入框。
- 56 项 Markdown 测试、8 项跨线程对话测试、20 项 changelog 相关测试、类型检查、普通及类型感知 lint 通过；相关冒烟和确定性 mock 门禁通过，控制台和运行时错误为 0。

---

# CraftStation v1.8.3

## User-facing

- Fix most of the X button becoming unclickable after expanding screenshots, images, code blocks, and Mermaid diagrams.
- Clicking the left, center, or right side of the X closes the preview at different interface zoom levels.
- Improve the cross-thread dialogue layout with a wider request form, a single column in smaller windows, internal scrolling for long content, and visible action buttons. Selected delivery options are clearer.

## Implementation

- Mark modal backdrops and image previews as `no-drag` so underlying window drag regions cannot intercept mouse clicks.
- Add Windows native hit testing to preview smoke coverage and include CSS changes in scope selection so style-only fixes receive regression checks.
- Switch dialogue columns based on the dialog's own width, correct backdrop and centering-container heights under interface zoom, keep the header and footer outside the scroll area, and remove redundant native session IDs from target rows.

## Verification

- Isolated Electron checks covered code, Mermaid, and image previews at 100%, 130%, and 150% interface zoom, passing 81 native hit points and 27 close actions.
- A real mouse click at the center of the Mermaid preview's X closed it successfully.
- Cross-thread dialogue passed layout, input width, internal scrolling, footer visibility, and close checks across five window-size and zoom combinations, with long exchange records and the optional context field.
- All 56 Markdown tests, 8 cross-thread dialogue tests, and 20 changelog-related tests passed, along with type checking, standard lint, and type-aware lint; relevant smoke checks and deterministic mock gates passed with zero console or runtime errors.
