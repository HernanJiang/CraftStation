# CraftStation 1.9.3

## 用户可见

- 修复网页已登录或恢复后仍持续显示“同步中断”：现有网页会继续检测并更新连接状态，恢复后清除过期同步错误。
- ChatGPT 网页顶部新增“刷新重试”，重载当前会话或重新打开已关闭的会话网页。
- 刷新保留本地草稿与历史，不自动重发已提交消息；生成回复时禁用刷新。

## 实现

- 解除错误状态对现有网页只读检测的阻断；同步检测错误与操作错误分别维护。
- 增加 main-local 刷新 IPC，复用内置浏览器登录状态和会话地址；等待并发读取结束，检查网页仍在生成时拒绝重载。

## 验证

- 151 项相关测试通过，类型检查与两种 lint 通过。
- 隔离 Electron 固定网页的 19 项全流程检查通过，覆盖登录恢复、错误恢复、实际刷新按钮、草稿保留、关闭后重连及原有多轮/停止/交互组件/导入/删除流程，控制台与运行时错误为 0。
- 本次未复测真实账号的完整联网回合；仅发布 Windows x64 安装包和便携版。

---

# CraftStation 1.9.3

## User-facing

- Fix web chat remaining interrupted after the existing webpage recovers or finishes login. Connection checks continue and outdated sync errors clear on recovery.
- Add Refresh and retry at the top of ChatGPT web chat to reload the current conversation or reopen its closed webpage.
- Keep local drafts and history during refresh without automatically resending submitted messages; disable refresh while a response is generating.

## Implementation

- Allow read-only checks of existing webpages after sync errors, and maintain sync errors separately from action errors.
- Add a main-local refresh IPC using the embedded browser's login state and bound conversation URL. Wait for concurrent reads and refuse reload while the webpage is still generating.

## Verification

- All 151 relevant tests, type checking, and both lint passes succeed.
- All 19 isolated Electron fixture checks pass, covering login recovery, error recovery, the real refresh control, draft preservation, reconnection after closure, and existing multi-turn, stop, widget, import, and delete flows, with zero console or runtime errors.
- A complete live-account turn was not retested in this run. This patch ships Windows x64 installer and portable builds only.
