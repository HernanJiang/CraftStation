# CraftStation 1.9.2

## 用户可见

- 修复聊天中偶发的文字重叠：流式输出和 Markdown 更新后及时同步消息高度与后续行位置。
- 左侧快速导航完整显示每一轮对话，长历史在打开线程后自动分批加载，入口随可用高度收缩。
- 点击早期对话或搜索结果时解除自动跟随底部，避免刚跳转就被新输出拉回最新消息。

## 实现

- 为已挂载消息增加 DOM 内容变更测量，与现有 ResizeObserver 配合，在绘制前同步增长的消息与后续虚拟行。
- 复用现有分页与工具记录压缩加载完整历史，离开聊天页后停止继续请求；失败或游标不推进时结束本次加载。
- 导航采用可压缩布局，并通过一次索引构建查找每轮回复，避免长历史重复扫描。

## 验证

- 新增回归用例覆盖 Markdown 内容更新、超过十二页的历史、取消与恢复加载、空页和导航入口。
- 真实 Electron 隔离测试覆盖 120 轮导航、动态高度连续更新、三档缩放，以及数据库中 300 轮历史的完整加载与第一轮跳转。
- 类型检查、两种 lint 和相关回归测试通过；Electron mock smoke 覆盖启动、线程搜索、输入光标与相关门禁，控制台及运行时错误为 0。
- 本补丁仅发布 Windows x64 安装包和便携版。

---

# CraftStation 1.9.2

## User-facing

- Fix intermittent overlapping chat text by updating message heights and following row positions when streaming output or Markdown changes.
- Show a quick navigation entry for every conversation turn, automatically load older history in pages, and fit the entries within the available rail height.
- Release automatic scrolling to the latest reply when jumping to an earlier turn or a search result so new output does not immediately pull the conversation back down.

## Implementation

- Measure DOM content mutations in mounted messages alongside the existing ResizeObserver and synchronize growing rows before painting.
- Reuse existing pagination and tool-record compaction to load complete history; stop requesting pages when the pane closes, a request fails, or the cursor stops advancing.
- Use a compressible navigation layout and build the reply lookup index once per update to avoid repeated scans of long histories.

## Verification

- Add regression coverage for Markdown mutations, history beyond twelve pages, cancellation and resumption, empty pages, and navigation entries.
- Test the real isolated Electron app with 120 navigation entries, continuous height updates, three zoom factors, and complete loading of 300 persisted turns with a jump to the first turn.
- Type checking, both lint passes, and relevant regression tests pass. Electron mock smoke covers startup, thread search, composer caret, and related gates, with zero console or runtime errors.
- This patch ships Windows x64 installer and portable builds only.
