# CraftStation 1.11.0

## 用户可见

- 新增置顶临时对话弹窗：默认按 `Alt+Space` 呼出，可在设置 → 快捷键中修改。再次按下可收起或恢复当前对话；点击关闭或系统关闭即结束并删除临时线程，不进入主聊天记录。
- 临时对话沿用模型管理中勾选的模型，并单独记住弹窗内最后选择的模型，即使尚未发送消息也会保存，不改变主窗口的默认模型。
- 模型管理页中已勾选的模型与配方自动置顶；取消选择后回到原目录顺序，搜索结果同样适用。
- 修复临时窗参数菜单向侧边越界、界面放大后输入框被挤出底部，以及菜单覆盖标题栏时点击被拖拽区域拦截的问题。
- 修复代理取消请求失败后，补充消息可能持续停在“等待引导”的异常路径；停止超时兜底继续生效。
- Windows 下默认不启动 WSL，后台状态与凭据扫描跳过未授权的 WSL。主动启动 WSL 对话、终端或 Muse 时先确认；取消即不启动，授权仅在本次应用运行期间有效，退出后需要重新确认。

## 实现

- 临时线程在 main 持久化与主窗/远程广播前分流，阻止临时线程显式入库和主状态覆盖。普通启动与 Recipe 启动均处理关闭期间晚到的结果并清理。
- 临时窗使用独立模型偏好，复用已有聊天和模型管理能力；Windows 与 POSIX 使用各自的工作目录类型。
- WSL 命令、桥接服务、网络探测与本地 UNC 文件访问使用统一的启动门禁；后台探测不弹出确认框，用户主动操作由主进程确认后放行。
- 小问题累计迭代 `1.10.3a/b/c/d/e` 在本版集中发布。Windows 提供 x64 安装包与便携版，Linux/macOS 由稳定版流水线构建。

## 验证

- 临时对话与模型选择已有 155 项相关单测通过，另完成 48 组不同尺寸与缩放下的 Electron 菜单布局检查；等待引导另有 68 项回归与隔离界面证据。
- 已验证两轮模拟消息、主历史和数据库隔离、关闭重开后的新线程 ID 与模型记忆、快捷键改绑，以及模型取消选择后的排序恢复。
- WSL 启动确认另有 90 项相关回归通过，覆盖取消后无启动请求、并发确认、授权失败、不启动后台桥接与扫描，以及普通原生启动路径。隔离 Electron 的真实确认框取消后，WSL 继续关闭；本轮全量模拟检查 14/15 通过、17 个 mock 门禁通过、运行错误 0，网页对话导入源复用断言未通过。
- 未发起真实账号模型回合。额外全量 mock 烟测中的网页同步超时，以及主窗口代码预览在 150% 缩放下关闭按钮的原生命中检查未通过；本版未修改这两个范围，未将该烟测表述为全量通过。

---

# CraftStation 1.11.0

## User-facing

- Open a new always-on-top temporary chat with `Alt+Space`, configurable in Settings → Shortcuts. Press it again to hide or restore the current chat. Closing the window ends and deletes the temporary thread without adding it to the main chat history.
- Temporary chat uses the models selected in model management and remembers its own last model selection, even before sending a message, without changing the main window's default model.
- Selected models and recipes move to the top of model management. Deselecting restores their original catalog order, including in search results.
- Fixed parameter submenus extending outside narrow temporary windows, composers moving below the viewport at larger UI zoom, and title-bar drag regions intercepting menu clicks.
- Fixed a failure path where a rejected agent cancellation could leave follow-up messages waiting indefinitely for guidance; the stop timeout remains armed.
- WSL stays disabled by default on Windows, and background status/credential scans skip it until authorized. Starting a WSL chat, terminal, or Windows Muse runtime asks for confirmation. Cancellation leaves WSL stopped; consent lasts only for the current app run and must be granted again after quitting.

## Implementation

- Temporary events are separated before main-process persistence and main/remote broadcasts. Ephemeral thread upserts and main-state overwrites are blocked. Both standard and Recipe launches clean up results that arrive after closing.
- Temporary chat stores model preferences independently while reusing existing chat and model-management capabilities, with platform-appropriate Windows or POSIX workspace locations.
- WSL commands, bridge services, network probes, and local UNC file access share a startup gate. Background probes never display a consent dialog; the main process confirms explicit user actions before allowing access.
- This release combines internal iterations `1.10.3a/b/c/d/e`. Windows includes x64 installer and portable packages; Linux/macOS are built by the stable release workflow.

## Verification

- The temporary-chat and model-selection changes passed 155 targeted tests and 48 Electron menu-layout checks across window sizes and UI zoom levels. Guidance recovery has a separate set of 68 regression tests and isolated UI evidence.
- Verified two mocked chat rounds, main-history and database isolation, new thread identity and remembered model after reopening, shortcut rebinding, and catalog ordering after deselection.
- An additional 90 WSL-related regression tests passed, covering cancellation without launch requests, concurrent consent, failed authorization, blocked background bridges/scans, and ordinary native launch paths. Cancelling the real native dialog in isolated Electron left WSL stopped. The latest full mock run passed 14/15 checks and 17 mock gates with zero runtime errors; its web-chat source-reuse assertion did not pass.
- No real-account model turn was run. The additional full mock smoke run still had a web-sync timeout and a native hit-test failure on the main window's code-preview close button at 150% zoom. Those surfaces were unchanged in this release; that smoke run is not claimed as fully passing.
