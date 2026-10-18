# CraftStation 1.11.3

## 用户可见

- 临时对话记住上次模型后，应用会在后台提前打开对应 CLI 并加载模型。之后按 Alt+Space 发送，不用再等这一段初始化。
- 窗口开着不算闲置。收起或点 X 关闭后，超过两小时没再打开，后台 CLI 会自动退出。
- 这两小时里藏在后台、还没处理完的临时对话也会清掉。下次打开是新的空白对话，并重新准备模型。
- 还没选过模型时，不会提前启动 CLI。

## 实现

- 应用就绪约 1.5 秒后，若存在 `temporary-chat-model`，创建隐藏的临时对话窗口，用空 prompt 预热上次的 CLI 和模型。
- 发送时若已准备的 harness 和模型匹配，直接进入该会话。仍在启动时排队等待，不另开一个 CLI。
- 还没发送就关闭：隐藏窗口，保留预热进程和未发送草稿。已经开始的对话点 X：结束该会话，换成新的线程 id，隐藏窗口并预热下一场。
- 更换模型后等待 400 毫秒再重新预热。
- 窗口隐藏满两小时后只关掉 CLI 进程，保留线程 id。再次打开窗口时重新准备。窗口可见时不计时。
- 本版为补丁版本，只发布 Windows x64 NSIS 安装包与便携版。

## 验证

- `temporaryChat.test.ts`、`temporaryChatSession.test.ts`、`createQuickComposerWindow.test.ts` 共 18 项测试通过，`tsc --noEmit` 通过。
- 未启动真实 Kimi CLI，未在本机重打安装包。正式包由发布流水线构建。未验证真实账号模型回合。

---

# CraftStation 1.11.3

## User-facing

- After a temporary chat remembers its last model, the app opens that CLI and loads the model in the background. The next Alt+Space send does not wait through that startup.
- A visible window counts as in use. After the window is hidden or closed, the background CLI exits once it has been unused for two hours.
- A temporary conversation left hidden for those two hours is cleared too. The next open is a new empty chat and prepares the model again.
- The first use, before any model has been chosen, does not start a CLI ahead of time.

## Implementation

- About 1.5 seconds after the app is ready, if `temporary-chat-model` is set, a hidden temporary-chat window warms the last CLI and model with an empty prompt.
- A send reuses that session when the prepared harness and model match. A start that is still running is queued, and a second CLI is not launched.
- Closing before a send hides the window and keeps the warm process and unsent draft. Closing after a conversation ends that session, mints a new thread id, hides the window, and warms the next one.
- A model change waits 400 milliseconds before warming again.
- After the window stays hidden for two hours, only the CLI process is stopped. The thread id is kept, and the next time the window is shown the model is prepared again. A visible window does not start the idle clock.
- This patch publishes Windows x64 only: an NSIS installer and a portable package.

## Verification

- 18 tests in `temporaryChat.test.ts`, `temporaryChatSession.test.ts`, and `createQuickComposerWindow.test.ts` passed, and `tsc --noEmit` passed.
- A real Kimi CLI was not started, and the installer was not rebuilt locally. The release workflow builds the official packages. No real-account model turn was run.
