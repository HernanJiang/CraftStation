# CraftStation 1.11.0

## 用户可见

- 新增置顶临时对话弹窗：默认按 `Alt+Space` 呼出，可在设置 → 快捷键中修改。再次按下可收起或恢复当前对话；点击关闭或系统关闭即结束并删除临时线程，不进入主聊天记录。
- 临时对话沿用模型管理中勾选的模型，并单独记住弹窗内最后选择的模型，即使尚未发送消息也会保存，不改变主窗口的默认模型。
- 模型管理页中已勾选的模型与配方自动置顶；取消选择后回到原目录顺序，搜索结果同样适用。
- 修复临时窗参数菜单向侧边越界、界面放大后输入框被挤出底部，以及菜单覆盖标题栏时点击被拖拽区域拦截的问题。
- 修复代理取消请求失败后，补充消息可能持续停在“等待引导”的异常路径；停止超时兜底继续生效。

## 实现

- 临时线程在 main 持久化与主窗/远程广播前分流，阻止临时线程显式入库和主状态覆盖。普通启动与 Recipe 启动均处理关闭期间晚到的结果并清理。
- 临时窗使用独立模型偏好，复用已有聊天和模型管理能力；Windows 与 POSIX 使用各自的工作目录类型。
- 小问题累计迭代 `1.10.3a/b/c/d` 在本版集中发布。Windows 提供 x64 安装包与便携版，Linux/macOS 由稳定版流水线构建。

## 验证

- 临时对话与模型选择已有 155 项相关单测通过，另完成 48 组不同尺寸与缩放下的 Electron 菜单布局检查；等待引导另有 68 项回归与隔离界面证据。
- 已验证两轮模拟消息、主历史和数据库隔离、关闭重开后的新线程 ID 与模型记忆、快捷键改绑，以及模型取消选择后的排序恢复。
- 未发起真实账号模型回合。额外全量 mock 烟测中的网页同步超时，以及主窗口代码预览在 150% 缩放下关闭按钮的原生命中检查未通过；本版未修改这两个范围，未将该烟测表述为全量通过。

---

# CraftStation 1.11.0

## User-facing

- Open a new always-on-top temporary chat with `Alt+Space`, configurable in Settings → Shortcuts. Press it again to hide or restore the current chat. Closing the window ends and deletes the temporary thread without adding it to the main chat history.
- Temporary chat uses the models selected in model management and remembers its own last model selection, even before sending a message, without changing the main window's default model.
- Selected models and recipes move to the top of model management. Deselecting restores their original catalog order, including in search results.
- Fixed parameter submenus extending outside narrow temporary windows, composers moving below the viewport at larger UI zoom, and title-bar drag regions intercepting menu clicks.
- Fixed a failure path where a rejected agent cancellation could leave follow-up messages waiting indefinitely for guidance; the stop timeout remains armed.

## Implementation

- Temporary events are separated before main-process persistence and main/remote broadcasts. Ephemeral thread upserts and main-state overwrites are blocked. Both standard and Recipe launches clean up results that arrive after closing.
- Temporary chat stores model preferences independently while reusing existing chat and model-management capabilities, with platform-appropriate Windows or POSIX workspace locations.
- This release combines internal iterations `1.10.3a/b/c/d`. Windows includes x64 installer and portable packages; Linux/macOS are built by the stable release workflow.

## Verification

- The temporary-chat and model-selection changes passed 155 targeted tests and 48 Electron menu-layout checks across window sizes and UI zoom levels. Guidance recovery has a separate set of 68 regression tests and isolated UI evidence.
- Verified two mocked chat rounds, main-history and database isolation, new thread identity and remembered model after reopening, shortcut rebinding, and catalog ordering after deselection.
- No real-account model turn was run. The additional full mock smoke run still had a web-sync timeout and a native hit-test failure on the main window's code-preview close button at 150% zoom. Those surfaces were unchanged in this release; that smoke run is not claimed as fully passing.
