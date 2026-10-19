# CraftStation 1.11.4

## 用户可见

- 打开临时对话窗口后，立刻按上次选择的模型启动 CLI。编辑提示词的时候就在准备，不用等点击发送。
- 右上角增加减号。点它把窗口收进侧边栏工作区，这次对话和已经打开的 CLI 都保留。
- 收进工作区的临时对话不会因为闲置两小时被关掉。只有点关闭才删除这次对话。
- 临时窗口改成真正的圆角，四角不再留一圈方形边。
- 本版为补丁版本，只发布 Windows x64 NSIS 安装包与便携版。

## 实现

- 临时对话单独记住的模型会在打开窗口时用于预热。输入框先画出模型、账号稍后恢复时，不会把已经开始的预热关掉。
- 发送时只要预热身份仍然对得上，就进入这场 CLI，不再因为线程里记下的模型被改写而另开一个。
- 减号只隐藏窗口并在工作区留下入口。关闭会结束这场对话、换一个新的线程，并在隐藏窗口里准备下一场。
- 已收进工作区时，两小时闲置计时不会关掉 CLI。
- Windows 上不再让系统给透明窗口套圆角外框，改由页面自己裁出圆角。

## 验证

- `temporaryChat.test.ts`、`SidebarWorkspaceInbox.test.tsx`、`ThreadDraftView.test.tsx` 与更新日志校验已在发布前跑过；提交钩子里的类型检查通过。
- 正在运行的桌面窗口没有逐项点过圆角、预热和最小化。安装本版后需要重新打开 CraftStation。未验证真实账号模型回合。

---

# CraftStation 1.11.4

## User-facing

- Opening the temporary chat starts the CLI for the last selected model immediately. It prepares while the prompt is being edited, instead of waiting for Send.
- A minimize button now sits at the top right. It parks the window in the sidebar Workspace list and keeps both the conversation and the CLI that is already open.
- A parked temporary chat is not closed by the two-hour idle timer. Only the close button deletes that conversation.
- The temporary window is clipped to a real rounded rectangle, without square scraps at the corners.
- This patch publishes Windows x64 only: an NSIS installer and a portable package.

## Implementation

- The model remembered for temporary chat is the one warmed when the window opens. The composer can paint the model before the saved account is restored; that partial identity does not cancel a prepare already aimed at the same harness and model.
- Send reuses the prepared CLI when the warm identity still matches, even if the thread's stored model was rewritten.
- Minimize only hides the window and leaves a Workspace entry. Close ends the conversation, mints a new thread, and prepares the next one in the hidden window.
- While the chat is parked, the two-hour idle timer does not stop the CLI.
- On Windows the transparent window no longer uses the system rounded frame. The page clips its own corners.

## Verification

- `temporaryChat.test.ts`, `SidebarWorkspaceInbox.test.tsx`, `ThreadDraftView.test.tsx`, and the changelog check were run before release. The commit hook's typecheck passed.
- The already-running desktop window was not clicked through for corners, warmup, or minimize. CraftStation has to be opened again after installing this version. No real-account model turn was run.
