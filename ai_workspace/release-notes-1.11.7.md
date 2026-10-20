# CraftStation 1.11.7

## 用户可见

- Step Code 不再逐条命令请求批准。默认「完全访问权限」下，Step Code 启动、恢复与 GUI 会话都以 `--approval-mode auto` 运行，命令直接执行；在输入区选监督档时仍逐条确认。
- 临时对话不再反复「模型准备失败」。此前模型选择回调每次渲染都触发新的准备请求，形成每秒多次的重试风暴；现在相同选择只准备一次，并记住上次使用的模型。
- 主进程重置临时对话会话后，窗口不再一直失败。识别到会话 ID 失配后自动同步新会话并恢复就绪，发送消息时遇到失配也会用新会话重试一次。
- 本补丁只发布 Windows x64 NSIS 安装包与便携版。安装后重新打开 CraftStation，让新 Runtime 生效。

## 实现

- `src/supervisor/agents/stepcode/index.ts` 新增 `stepCodeApprovalModeArgs`：权限策略为 `never` 时传 `--approval-mode auto`，其余档位显式传 `confirm`。三个入口统一接入：`buildLaunchArgv`、`buildResumeArgv`（经 `buildPiArgs` 的 `extraFlags`）、`createStructuredSession`（经 `PiRpcSession.create` 的 `extraArgs`）。
- `src/renderer/components/thread/ThreadDraftView.tsx` 的 `onModelSelectionChange` 改用 ref 稳定化，准备 effect 只在模型、Harness 或账号真正变化时运行。
- `src/renderer/views/TemporaryChatWindow.tsx`：模型选择处理记忆化，相同选择且已有准备状态时直接跳过；`remember` 按内容去重，失败时允许重试；新增 `resyncThreadId`，准备失败错误码为会话失配/关闭时自动同步主进程当前会话 ID。
- `src/main/temporaryChatSession.ts` 拆分错误码：会话 ID 不等返回 `temporary-chat-id-mismatch`，释放中返回 `temporary-chat-busy`，窗口或发送者校验失败仍返回 `temporary-chat-closed`。

## 验证

- stepcode 新增 3 项测试：启动、恢复与 structured 会话的 argv 均含 `--approval-mode auto`；临时对话、pi、ThreadDraftView 相关 108 项测试通过；类型检查与全量常规/类型感知 lint 0 警告。
- 隔离 Electron 实例重现并重放完整故障：主进程重置会话 ID 后，准备仅失败 1 次（`temporary-chat-id-mismatch`）即自动同步恢复「模型已就绪」（修复前同样 8 秒内失败 19 次且持续循环）；关闭重开后保持上次选择的模型与权限档。
- 隔离实例真实 Step Code 会话：进程 argv 确认含 `--approval-mode auto`，发送运行 `pwd` 的消息后命令直接执行、约 3 秒完成并返回输出，全程无批准弹窗。
- `src/renderer/components/thread/` 下 8 项存量测试失败（ThreadStatusCapsule、ChatPane、ItemMarkdownInner、SubAgentOverlay）在未改动的干净代码上同样失败，与本次修改无关。

---

# CraftStation 1.11.7

## User-facing

- Step Code no longer asks for approval on every command. With the default Full Access permission, Step Code launch, resume, and GUI sessions now run with `--approval-mode auto` so commands execute directly; choosing the supervised mode still confirms each action.
- Temporary chat no longer loops on "model preparation failed". The model-selection callback used to fire a new prepare on every render, causing a retry storm several times per second; the same selection now prepares once, and the last used model is remembered.
- Temporary chat recovers when the main process resets its session. The window detects a stale session ID, syncs the current one, and returns to ready; a send that hits the stale ID retries once with the new session.
- This patch publishes Windows x64 only: an NSIS installer and a portable package. Reopen CraftStation after installing to load the updated runtime.

## Implementation

- `src/supervisor/agents/stepcode/index.ts` adds `stepCodeApprovalModeArgs`: permission policy `never` maps to `--approval-mode auto`, other modes pass `confirm` explicitly. All three entries are wired: `buildLaunchArgv`, `buildResumeArgv` (via `buildPiArgs` `extraFlags`), and `createStructuredSession` (via `PiRpcSession.create` `extraArgs`).
- `src/renderer/components/thread/ThreadDraftView.tsx` stabilizes `onModelSelectionChange` behind a ref so the prepare effect only runs when the model, harness, or account actually changes.
- `src/renderer/views/TemporaryChatWindow.tsx`: the model-selection handler is memoized and skips when an identical selection already has a prepare state; `remember` dedupes identical payloads and re-arms after failures; a new `resyncThreadId` syncs the main-process session ID when prepare fails with a lifecycle error.
- `src/main/temporaryChatSession.ts` splits error codes: a different session ID returns `temporary-chat-id-mismatch`, a release in progress returns `temporary-chat-busy`, and window/sender validation still returns `temporary-chat-closed`.

## Verification

- Three new stepcode tests assert `--approval-mode auto` in the launch, resume, and structured-session argv; 108 related temporary-chat, pi, and ThreadDraftView tests passed; typecheck and full regular/type-aware lint report zero warnings.
- An isolated Electron instance replayed the full failure: after the main process reset the session ID, prepare failed exactly once (`temporary-chat-id-mismatch`) before self-healing to "model ready" (previously 19 failures in 8 seconds and counting); closing and reopening kept the last selected model and permission mode.
- A real Step Code session in the isolated instance confirmed `--approval-mode auto` in the process argv; a message asking to run `pwd` executed directly, finished in about 3 seconds with output, and never showed an approval prompt.
- Eight pre-existing test failures under `src/renderer/components/thread/` (ThreadStatusCapsule, ChatPane, ItemMarkdownInner, SubAgentOverlay) also fail on the unmodified tree and are unrelated to this change.
