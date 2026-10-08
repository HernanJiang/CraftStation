# CraftStation v1.8.6

## 用户可见

- Mermaid 和图片的放大预览支持鼠标滚轮缩放：向上放大、向下缩小，范围为 25%–400%，围绕鼠标位置调整。
- 放大后可拖动查看细节，点击底部百分比恢复默认大小；Mermaid 预览新增缩放按钮，高图保持原有初始文字大小并可拖动查看上下部分。
- 预览内滚轮不会改变应用缩放比例；关闭、重新打开或切换图片后恢复默认视图。

## 实现

- 两类预览共用缩放与拖动逻辑，使用可取消的原生滚轮监听，处理滚轮单位、鼠标锚点、拖动边界及界面缩放下的坐标。
- 保留聊天内图形与代码块的滚动行为；缩放和拖动仅作用于放大预览，关闭按钮维持原生命中修复。

## 验证

- 68 项 Markdown 渲染与图片预览测试、20 项 changelog 相关测试通过；类型检查、普通及类型感知 lint 通过。
- 隔离 Electron 在 100%、130%、150% 界面缩放下，验证两类预览的真实滚轮缩放、25%/400% 边界、鼠标锚点、拖动及重置；三类预览的原生命中和关闭回归通过。
- 宽图、高图及图片切换检查通过；相关聊天、设置、跨线程对话冒烟和四个确定性 mock 门禁通过，控制台和运行时错误为 0。

---

# CraftStation v1.8.6

## User-facing

- Expanded Mermaid diagrams and images support mouse-wheel zoom: scroll up to enlarge and down to shrink, from 25% to 400%, centered on the pointer.
- Drag to inspect details and click the percentage to restore the default view. Mermaid previews also have zoom buttons; tall diagrams retain their initial text size and can be dragged vertically.
- Wheel input inside a preview does not change the app's zoom. Closing, reopening, or switching images restores the default view.

## Implementation

- Both previews share zoom and pan behavior with a cancelable native wheel listener, normalized wheel units, cursor anchoring, bounded panning, and coordinates adjusted for whole-app zoom.
- Preserve scrolling for inline diagrams and code blocks. Zoom and pan apply to expanded previews, while close buttons retain their native mouse-target fix.

## Verification

- All 68 Markdown rendering and image-preview tests and 20 changelog-related tests passed, along with type checking, standard lint, and type-aware lint.
- Isolated Electron verified native wheel zoom, 25%/400% bounds, cursor anchoring, panning, and reset for both previews at 100%, 130%, and 150% app zoom. Native mouse targets and closing passed for all three preview types.
- Wide and tall diagrams and image switching passed. Relevant chat, settings, cross-thread dialogue smoke checks and four deterministic mock gates passed with zero console or runtime errors.
