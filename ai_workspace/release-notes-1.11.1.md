# CraftStation 1.11.1

## 用户可见

- 点击左侧远程对话即可自动打开对应网页；标签已关闭时恢复保存的网址，无需再点击“打开新选项卡”。
- 网页加载或正文同步较慢时，先显示对应网页；重复点击复用原标签并保留草稿，快速切换对话时旧请求不会抢回当前选中项。

## 实现

- 新增主进程 `webChatOpen`，先返回当前网页绑定，再读取正文；同一线程的并发打开请求合并，暂时失败后可重试。
- Windows x64 提供 NSIS 安装包与便携版。本次仅包含远程对话修复，没有加入内存优化改动。

## 验证

- 修复阶段的 83 项相关回归通过；发布前另复查 74 项核心回归与更新记录检查，完整类型检查、普通 lint 与类型感知 lint 通过。延迟正文同步的回归用例确认修复前失败、修复后通过。
- 隔离 Electron 的 20 项固定网页检查通过，运行错误为 0，覆盖关标签后自动恢复、网址与线程保留、重复点击和草稿保留、对话切换及刷新。
- 常规烟测的界面基线与两个 mock 门禁通过；网页导入仍有既有的源网页复用断言失败，未宣称整套烟测通过。未发起真实账号模型回合。

---

# CraftStation 1.11.1

## User-facing

- Clicking a remote conversation in the sidebar opens its webpage automatically. If its tab was closed, CraftStation restores the saved URL without requiring another click on Open new tab.
- The webpage appears before slow page loading or transcript synchronization finishes. Repeated clicks reuse the tab and preserve drafts, while stale requests cannot reclaim the selection after switching conversations.

## Implementation

- Added the main-process `webChatOpen` operation to return the current page binding before reading the transcript. Concurrent opens for the same conversation share one request, and temporary failures can be retried.
- Windows x64 includes an NSIS installer and a portable package. This release contains the remote-conversation fix only; no memory optimizations were added.

## Verification

- All 83 targeted regression tests passed during the fix. A further pre-release run passed 74 core regression and changelog checks, full type checking, standard lint, and type-aware lint. The slow-transcript regression test was confirmed to fail before the fix and pass afterward.
- All 20 deterministic webpage checks passed in isolated Electron with zero runtime errors, covering automatic recovery after tab closure, URL and conversation identity, repeated clicks, draft preservation, switching, and refresh.
- The regular smoke run passed its UI baseline and two mock gates. An existing source-page reuse assertion in web-chat import still fails, so the full smoke suite is not claimed as passing. No real-account model turn was run.
