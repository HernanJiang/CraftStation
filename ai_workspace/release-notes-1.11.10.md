# 1.11.10 Claude 5.5 与临时对话默认模型（2026-10-20）

## 用户可见

- Claude Code 可以选择 Opus 5.5、Sonnet 5.5、Haiku 5.5 和 Fable 5.1。新线程默认 Opus 5.5；推理档位与 1M 上下文随型号提供。已安装的 CLI 版本尚未收录的型号不会出现在菜单里。Command Code 的 Claude 目录同步这些名称。
- 临时对话的空白草稿默认跟随最近一次实际发出的请求，包括主窗口和临时对话本身，使用当时的模型与 Harness。只打开选择器或后台预热不会改写这个默认值。已经开始的临时对话保持当前选择；隐藏窗口再次聚焦时，空白草稿会刷新到最新组合。
- 最近一次请求如果是 Auto 目录通常隐藏的原生 DeepSeek Harness，临时对话仍能恢复该组合。

## 实现

- `src/supervisor/agents/claude/models.ts`：内置目录加入四个新型号，并按 CLI 版本门槛隐藏（Fable 5.1 自 2.1.257，Opus 5.5 自 2.1.280，Sonnet 5.5 自 2.1.284，Haiku 5.5 自 2.1.293）。同步推理档位、1M 上下文，以及 Opus 5.5 的 Fast。
- `src/renderer/components/providers/claude/index.tsx`：上述型号纳入 Auto 权限可选集。`src/shared/commandCodeModelIds.ts` 与 Command Code 标签同步新型号。
- 实际提交请求时写入 `last-submitted-chat-model`（启动、合成台启动、后续发送）。空 prompt 预热不写入。临时对话优先读这份记忆，没有时才回退到窗口自己的旧选择；主进程在任一份记忆存在时才预热。聚焦时若草稿尚未进入对话，则刷新到最新组合。

## 验证

- `pnpm typecheck` 通过。`pnpm lint`（含类型感知）0 警告 0 错误。Claude 目录、临时对话记忆、草稿恢复与 changelog 共 7 个文件 175 项测试通过。
- 应用实测：空白临时对话从最近一次请求跟随到 Codex + 6.1 Sol，再跟随到 Claude Code + Opus 5.5；已有对话保持当前选择。空白预热不写入默认组合。

---

# 1.11.10 Claude 5.5 and temporary chat defaults (2026-10-20)

## User-facing

- Claude Code can select Opus 5.5, Sonnet 5.5, Haiku 5.5, and Fable 5.1. New threads default to Opus 5.5, with effort tiers and a 1M context option for those models. Models the installed CLI does not yet catalog stay out of the menu. The Command Code Claude catalog uses the same names.
- A blank temporary chat follows the model and Harness from the most recent request that was actually sent, whether that request came from the main window or the temporary chat. Opening the picker or running an empty prewarm does not overwrite that default. A conversation already in progress keeps its current selection. When a hidden window is focused again, a blank draft refreshes to the latest pair.
- If the latest request used the native DeepSeek Harness, which the Auto catalog normally hides, the temporary chat can still restore that pair.

## Implementation

- `src/supervisor/agents/claude/models.ts`: the built-in catalog adds the four models and hides each one until the CLI version that first listed it (Fable 5.1 at 2.1.257, Opus 5.5 at 2.1.280, Sonnet 5.5 at 2.1.284, Haiku 5.5 at 2.1.293). Effort tiers, the 1M context size, and Fast for Opus 5.5 are included.
- `src/renderer/components/providers/claude/index.tsx`: those models are in the Auto permission set. `src/shared/commandCodeModelIds.ts` and the Command Code labels match.
- A submitted request writes `last-submitted-chat-model` from launch, Craft launch, and follow-up send. An empty prewarm does not. The temporary chat reads that memory first and falls back to its older window choice. The main process prewarms when either memory exists. On focus, a draft that has not entered a conversation refreshes to the latest pair.

## Verification

- `pnpm typecheck` passed. `pnpm lint`, including the type-aware pass, reported 0 warnings and 0 errors. Claude catalog, temporary-chat memory, draft restore, and changelog tests passed: 175 tests across 7 files.
- In the app, a blank temporary chat followed the latest request to Codex + 6.1 Sol, then to Claude Code + Opus 5.5. An existing conversation kept its current selection. An empty prewarm did not write the default pair.
