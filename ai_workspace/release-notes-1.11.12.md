# 1.11.12 临时对话记住窗口里的选择（2026-10-21）

## 用户可见

- 临时对话重新打开时，使用上次在这个窗口里点选的模型与 Harness。主窗口当前用的模型不会填进来，全局菜单里的默认模型也不会填进来。在临时对话里点选后就会记住，不必先发送一条消息。
- 临时对话这种窄窗口里，模型列表和上下文、推理强度放在同一张菜单中。鼠标从「模型列表」移到上面的模型时，列表保持打开，可以直接点选。

## 实现

- 临时对话启动只读自己的 `temporary-chat-model`。解析时不再合并 `defaultModels`。目录里没有的模型 id 保持原样，不会收成列表第一项后再写回。
- 窗口里换过一次模型之后，即使草稿还停在旧 id，也会把这次选择写入 `temporary-chat-model`。第一次打开时解析出的目录默认项不会覆盖已有记录。
- 宽度不超过 760px 时，模型列表不再使用向上弹出的二级菜单。

## 验证

- `pnpm typecheck` 通过。`pnpm lint` 0 警告 0 错误。`DraftParameterMenu`、`ThreadDraftView`、`temporaryChat` 共 91 项测试通过。新增断言：临时对话在全局默认是 Codex 时仍打开自己的 DeepSeek；目录里没有的 `deepseek-v4.1-flash` 不会被收成 `gpt-5.4` 并写回；窄窗口里指针移到模型上后，模型仍在同一张菜单里且可以点选。
- 正在运行的 1.11.11 窗口没有这版源码，安装前无法在那个窗口里点到修复后的菜单。

---

# 1.11.12 Temporary chat keeps the model picked in that window (2026-10-21)

## User-facing

- Reopening a temporary chat uses the model and Harness last picked in that window. The main window's current model does not fill it in, and neither does the global menu default. A pick inside the temporary chat is remembered without sending a message.
- In the narrow temporary-chat window, the model list stays in the same menu as context size and reasoning. Moving the pointer from Model list onto a model leaves the list open so it can be clicked.

## Implementation

- Temporary-chat startup reads only its own `temporary-chat-model`. Resolution no longer merges `defaultModels`. A model id that is absent from the catalog stays as saved, and is not snapped to the first catalog entry and written back.
- After the model changes inside the window, that selection is written to `temporary-chat-model` even when the draft still names the previous id. The catalog default resolved on the first open does not replace an existing record.
- At a width of 760px or below, the model list is no longer a submenu that opens upward.

## Verification

- `pnpm typecheck` passed. `pnpm lint` reported 0 warnings and 0 errors. 91 tests in `DraftParameterMenu`, `ThreadDraftView`, and `temporaryChat` passed. New assertions: a temporary chat whose global default is Codex still opens on its own DeepSeek; `deepseek-v4.1-flash`, which is absent from the catalog, is not snapped to `gpt-5.4` and written back; in a narrow window, moving the pointer onto a model leaves it in the same menu and the click is delivered.
- The running 1.11.11 window does not contain this source, so the fixed menu could not be clicked there before install.
