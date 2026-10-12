# CraftStation 1.10.0

ChatGPT 对话卡片直接显示原始网页，保留网页自己的输入框、消息、登录及交互内容。远程线程支持快捷编辑，也可以把当前网页放到已有本地对话的右侧浏览器。

## 用户可见

- 主卡片显示完整 ChatGPT 原网页，移除重复的应用输入框、控制栏及视图切换；仅同步线程名称和对话地址。
- “打开为本地对话侧边栏”支持搜索并选择已有本地线程，切换到该线程右侧后保留当前网页实例及未发送草稿。
- 远程 `+` 直接打开新的 ChatGPT 网页；顶部 ChatGPT 入口恢复当前或已有对话。
- 远程线程悬停显示置顶、更多与删除展示快捷操作；菜单或双击可重命名，Enter 或失焦保存，Escape 取消，本地名称在刷新及重启后保留。
- “删除对话显示”仅移除本地列表记录；“删除账号中的对话”作为独立功能，继续要求确认。
- 刷新网页按钮修复 Windows 实际鼠标点击无效的问题，重载当前标签并显示加载状态，不重发消息。
- 普通打开右侧浏览器时，主网页继续显示并保留草稿，右侧打开相同地址的独立网页。
- 每条远程线程保留自己的对话绑定；原网页切换对话时同步地址和双处标题，过期同步结果不会抢回选中项。

## 实现

- 原生网页和普通浏览器分别保持宿主挂载，避免切换面板或移除展示记录造成网页实例重建。
- 本地线程侧栏入口沿用项目与线程导航，复用当前网页，不新建线程或发送消息。
- 刷新控件显式排除标题栏拖动区域；线程重命名和本地移除通过独立 IPC 持久化。
- 兼容映射实现保留供回归，补齐普通 HTML 小部件识别、滑块末次移动及登录失效时的草稿保留。

## 验证

- 合入 main 后，13 个文件的 109 项相关测试通过，包含网页、浏览器与更新记录格式回归；完整类型检查及普通和类型感知 lint 通过。
- 固定网页真实 Electron 的 18 项流程通过，运行错误为 0，覆盖主网页与独立侧栏共存、本地线程选择、原生草稿保留、刷新、线程切换、重命名和两种删除入口。
- Win32 原生鼠标点击验证刷新后文档确实重载，WebContents 保持不变；普通浏览器标签、地址栏、前进后退和设置验证通过。
- 用户已确认发布当前版本；自动化未执行真实账号对话删除，也不宣称覆盖真实账号完整回合或所有第三方网页内容。
- 本版提供 Windows 安装包与便携版，并按次版本发布规则构建 Linux 和 macOS。

---

# CraftStation 1.10.0

ChatGPT conversation cards display the original webpage, including its own composer, messages, login flow, and interactive content. Remote threads support quick editing, and the current page can open beside an existing local conversation.

## User-facing

- The main card shows the complete ChatGPT webpage without a duplicate application composer, control bar, or view switch; only conversation titles and addresses are synchronized.
- Open as local conversation sidebar lets you search and select an existing local thread, retaining the live page and unsent draft on its right.
- The Remote `+` opens a new ChatGPT webpage immediately, while the top ChatGPT entry resumes the current or an existing conversation.
- Remote rows reveal pin, more, and hide shortcuts on hover; rename through the menu or double-click, save with Enter or blur, cancel with Escape, and retain local names across refreshes and restarts.
- Remove conversation display removes only the local list record; Delete conversation from account remains a separate action requiring confirmation.
- Refresh webpage now responds to real Windows mouse clicks, reloads the current tab, and displays its loading state without resending messages.
- Opening the ordinary browser sidebar keeps the main page and draft visible and opens an independent page at the same address on the right.
- Each remote thread retains its own conversation binding; navigation in the original webpage updates the address and both titles without outdated synchronization results changing the selection.

## Implementation

- Native web chat and the ordinary browser retain separate mounted hosts so panel changes and local record removal do not recreate live pages.
- The local thread sidebar action uses existing project and thread navigation and reuses the current page without creating a thread or sending a message.
- Refresh controls explicitly opt out of the titlebar drag region; dedicated IPC operations persist local renaming and display removal.
- Compatibility mapping remains available for regression testing, with fixes for ordinary HTML widget detection, final slider movements, and draft preservation after login expiry.

## Verification

- After merging into main, 109 relevant tests across 13 files passed, including web chat, browser, and changelog regressions; full type checking and standard and type-aware lint also passed.
- Eighteen real Electron scenarios using fixed webpages passed with no runtime errors, covering independent sidebar coexistence, local thread selection, native draft preservation, refresh, thread switching, renaming, and both deletion entries.
- A Win32 native mouse click confirmed that refresh reloads the document while preserving its WebContents; ordinary browser tabs, address entry, back and forward navigation, and settings also passed.
- The user approved this version for release; automation did not delete real account conversations or claim coverage of complete real-account turns or all third-party web content.
- This minor release provides Windows installer and portable packages and builds Linux and macOS according to the release platform policy.
