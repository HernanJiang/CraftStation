# CraftStation v1.8.1

## 用户可见

- 修复 Mermaid 点击放大后可视区域反而缩小的问题：图形与代码预览使用接近全窗口的空间。
- 放大后的 Mermaid 不再受聊天卡片高度限制，只保留一层滚动区域，并提供关闭按钮。

## 实现

- 预览弹窗改用 `cover` 尺寸，明确占满可用宽度，固定标题栏并让内容填满剩余空间。
- Mermaid 的放大视图独立于聊天内视图，移除聊天内的高度与滚动限制。

## 验证

- TypeScript 类型检查、普通 lint 与类型感知 lint 通过。
- 56 项 Markdown 测试与 16 项 changelog 校验通过。
- 隔离 Electron 界面验证宽图、高图、小图与关闭操作：宽图可视宽度由旧弹窗的 470px 增至 1379px；高图可视高度由聊天内的 512px 增至 804px，小图和宽图的文字没有缩小。
- 聊天界面冒烟与相关确定性 mock 门禁通过，控制台及运行时错误为 0。

---

# CraftStation v1.8.1

## User-facing

- Fix Mermaid previews becoming narrower after expansion: diagram and code previews now use nearly the full window.
- Expanded Mermaid diagrams no longer inherit the chat card's height limit, with a single scrollable canvas and a visible close button.

## Implementation

- Use the modal's `cover` size and explicitly fill the available width; keep the header fixed while the content fills the remaining space.
- Render an expanded Mermaid view separately from its inline view, removing the inline height and scroll limits.

## Verification

- TypeScript checks, standard lint, and type-aware lint passed.
- All 56 Markdown tests and 16 changelog checks passed.
- Isolated Electron checks covered wide, tall, and small diagrams plus dismissal: the wide preview increased from 470px in the old dialog to 1379px; the tall viewport increased from 512px inline to 804px, without shrinking text in small or wide diagrams.
- Chat smoke tests and related deterministic mock gates passed with zero console or runtime errors.
