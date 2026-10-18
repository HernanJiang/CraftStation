# CraftStation 1.11.1

## 用户可见

- 点击左侧远程对话即可自动打开对应网页；标签已关闭时恢复保存的网址，无需再点击“打开新选项卡”。
- 网页加载或正文同步较慢时，先显示对应网页；重复点击复用原标签并保留草稿，快速切换对话时旧请求不会抢回当前选中项。
- 修复删除 Devin 等渠道后，SWE 等模型仍留在聊天参数菜单中的问题；删除后立即移除对应模型，重新打开菜单也不会恢复。

## 实现

- 新增主进程 `webChatOpen`，先返回当前网页绑定，再读取正文；同一线程的并发打开请求合并，暂时失败后可重试。
- 参数菜单与普通模型选择器共用渠道过滤规则，避免直接遍历已安装 CLI 的模型目录而重新显示已删除渠道；保留当前会话的模型显示。
- Windows x64 提供 NSIS 安装包与便携版。本次包含远程对话与渠道删除修复，没有加入内存优化改动。

## 验证

- 修复阶段的 83 项相关回归通过；发布前另复查 74 项核心回归与更新记录检查，完整类型检查、普通 lint 与类型感知 lint 通过。延迟正文同步的回归用例确认修复前失败、修复后通过。
- 隔离 Electron 的 20 项固定网页检查通过，运行错误为 0，覆盖关标签后自动恢复、网址与线程保留、重复点击和草稿保留、对话切换及刷新。
- 常规烟测的界面基线与两个 mock 门禁通过；网页导入仍有既有的源网页复用断言失败，未宣称整套烟测通过。未发起真实账号模型回合。
- 渠道删除追加的 6 个文件、93 项相关回归通过，覆盖实际状态变更后已打开菜单立即隐藏 SWE、重新打开不恢复，以及普通选择器和模型管理的既有行为。
- 渠道删除的隔离 Electron 检查通过：模拟 Devin 登录状态删除后，已打开的菜单立即移除 SWE，重新打开也不恢复；保留 Codex，运行错误 0。相关界面基线、设置、搜索、输入框与 4 项 mock 门禁通过，未验证真实账号模型回合。

---

# CraftStation 1.11.1

## User-facing

- Clicking a remote conversation in the sidebar opens its webpage automatically. If its tab was closed, CraftStation restores the saved URL without requiring another click on Open new tab.
- The webpage appears before slow page loading or transcript synchronization finishes. Repeated clicks reuse the tab and preserve drafts, while stale requests cannot reclaim the selection after switching conversations.
- Fixed SWE and other models remaining in the chat parameter menu after deleting their Devin or other channel. The models disappear immediately and stay absent when reopening the menu.

## Implementation

- Added the main-process `webChatOpen` operation to return the current page binding before reading the transcript. Concurrent opens for the same conversation share one request, and temporary failures can be retried.
- Parameter menus and the regular model picker now share channel filtering, preventing installed CLI catalogs from bringing deleted channels back while preserving the current session's model display.
- Windows x64 includes an NSIS installer and a portable package. This release contains the remote-conversation and channel-deletion fixes; no memory optimizations were added.

## Verification

- All 83 targeted regression tests passed during the fix. A further pre-release run passed 74 core regression and changelog checks, full type checking, standard lint, and type-aware lint. The slow-transcript regression test was confirmed to fail before the fix and pass afterward.
- All 20 deterministic webpage checks passed in isolated Electron with zero runtime errors, covering automatic recovery after tab closure, URL and conversation identity, repeated clicks, draft preservation, switching, and refresh.
- The regular smoke run passed its UI baseline and two mock gates. An existing source-page reuse assertion in web-chat import still fails, so the full smoke suite is not claimed as passing. No real-account model turn was run.
- An additional 93 regression tests across six files passed for channel deletion, covering immediate removal of SWE from an open menu after the actual state change, reopening without resurrection, and existing model-picker and model-management behavior.
- The isolated Electron channel-deletion check passed: clearing the mocked Devin login state immediately removes SWE from the open menu, and reopening keeps it absent while preserving Codex, with zero runtime errors. The related UI baseline, settings, search, composer, and four mock gates passed. No real-account model turn was tested.
