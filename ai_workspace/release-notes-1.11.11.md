# 1.11.11 临时对话只记住自己的上次模型（2026-10-20）

## 用户可见

- 临时对话重新打开时，使用上次在临时对话里实际发送过的模型与 Harness。主窗口之后换成别的模型，不会改掉这个默认值。空白预热不会写入。

## 实现

- 只有临时对话窗口里的启动和后续发送写入 `temporary-chat-model`。主窗口请求不再写入，窗口打开和聚焦也不再读取主窗口记录。

## 验证

- `pnpm typecheck` 通过。`pnpm lint` 0 警告 0 错误。临时对话记忆、启动与后续发送相关 113 项测试通过。其中新增断言：主窗口请求不写入临时对话记忆；临时对话发送 DeepSeek 后，即使同时存在主窗口的 Codex 记录，重新打开仍是 DeepSeek。

---

# 1.11.11 Temporary chat keeps its own last model (2026-10-20)

## User-facing

- Reopening a temporary chat uses the model and Harness from the last request sent in the temporary chat. Changing the model in the main window does not change that default. An empty prewarm does not write it.

## Implementation

- Only a launch or follow-up sent from the temporary chat window writes `temporary-chat-model`. Main-window requests no longer write it, and opening or focusing the window no longer reads the main-window record.

## Verification

- `pnpm typecheck` passed. `pnpm lint` reported 0 warnings and 0 errors. 113 tests covering temporary-chat memory, launch, and follow-up passed. New assertions: a main-window request does not write the temporary-chat memory; after the temporary chat sends DeepSeek, reopening it stays on DeepSeek even when a main-window Codex record exists.
