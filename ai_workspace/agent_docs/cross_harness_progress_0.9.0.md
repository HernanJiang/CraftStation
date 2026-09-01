# Cross-Harness Session Handoff 项目进度交接

> 文档用途：供其他 Agent 接手 v0.9.1 Fix Cycle。本文是事实交接与修复入口，不是 Feature PASS 证明。
>
> 更新时间：2026-08-31

## 一、当前结论

- Feature：`v0.9.0 — Cross-Harness Session Handoff`
- 当前状态：`DEBUGGER FAIL / BLOCKED BY ENVIRONMENT / CODER FIX #1 REQUIRED`
- Fix Cycle：`v0.9.1`，第 `#1` 轮
- Requires Manager Re-plan：`No`
- Requires Ideate Revision：`No`
- 真实 T08：`UNVERIFIED / BLOCKED BY ENVIRONMENT`
- 当前真实 artifact verdict：`BLOCKED BY ENVIRONMENT`
- 当前没有 Feature PASS、没有候选收口、没有 merge、没有 tag、没有 push。

真实环境阻塞不能被修复成伪造成功。后续 Agent 即使完成 F1–F3，也必须继续把真实 Codex → Grok Build → Codex 的证据与工程修复分开记录。

## 二、唯一工作区与 Git 状态

所有源码、测试和 Feature 文档只能在以下工作树进行：

```text
D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff
```

- Product Git root：`D:\Work\CraftStation`
- Product root branch：`main`
- Feature branch：`dev/v0.9-cross-harness-handoff`
- 当前 Feature HEAD：`4ef61356bf9d9f4490517210cfa21fbe0454632d`
- HEAD commit：`feature(v0.9): cross-harness session handoff — READY FOR DEBUGGER`
- Manager Plan base/commit：`7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`

当前接手时工作树状态：

- Feature 源码实现仍来自 `4ef61356bf9d9f4490517210cfa21fbe0454632d`。
- `PROJECT_STATUS.md` 已由 Debugger 写入首轮 FAIL/Fix #1 状态。
- `ai_workspace/validation/v0.9-cross-harness-handoff-real.json` 已由真实 gate 更新为当前环境阻塞结果。
- `ai_workspace/agent_docs/debugger_0.9.0.md` 和 `ai_workspace/agent_docs/debugger_0.9.1.md` 是当前首轮审查与 Fix Plan，当前为未提交文档修改。
- 尚未有 F1、F2、F3 的源码修复提交。
- 不要执行 `git reset --hard`、`git checkout --` 或清理未跟踪文档；这些文件是当前交接现场。

建议接手第一步：

```powershell
cd D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff
git branch --show-current
git rev-parse HEAD
git status --short
```

## 三、必须读取的文档

按以下顺序读取：

1. `AGENTS.md`（项目长期边界与新平铺 worktree 拓扑）
2. `PROJECT_STATUS.md`（动态状态唯一来源）
3. `ai_workspace/agent_docs/manager_0.9.0.md`（完整 Feature Spec、Tickets、Execution Order）
4. `ai_workspace/agent_docs/coder_0.9.0.md`（Coder 首轮实现与证据）
5. `ai_workspace/agent_docs/debugger_0.9.0.md`（Debugger 首轮独立 Review、Findings、证据）
6. `ai_workspace/agent_docs/debugger_0.9.1.md`（当前 Fix #1 的唯一修复计划）

不要把 Coder 文档或本文件当成独立质量门；修复 Agent 仍需自己检查源码、测试和 artifact。

## 四、Feature 已实现的整体能力

首轮已经实现 T01 → T08 的产品代码，但 T08 真实证据未关闭。

### T01：Runtime Segment Ledger

- DB schema 37–39。
- `runtime_segments`、`conversation_checkpoints`、`session_switch_transactions` 与 stale-event archive。
- 唯一 active partial index、按 Thread 的 Segment ordinal/epoch、lazy initial Segment、restart recovery。
- Segment 保存脱敏 provenance、Entity、runtime Session、native Session reference 和 checkpoint reference。

主要代码：`src/main/db.schema.ts`、`src/main/db/migrations.ts`、`src/supervisor/sessionHandoff/segmentLedger.ts` 及其测试。

### T02：ConversationCheckpoint

- versioned `ConversationCheckpoint`。
- 任务摘要、当前状态、重要决策、结果、workspace change、最近完成消息、anchors、预算和截断 metadata。
- allowlist redaction；不导出 hidden reasoning、credentials、活动工具句柄、未决权限/问题和 provider 内部状态。

主要代码：`src/shared/sessionHandoff.ts`、`src/supervisor/sessionHandoff/checkpointProjection.ts`、`src/supervisor/sessionHandoff/redaction.ts`。

### T03–T06：Supervisor-owned Handoff 与 fencing

`SessionHandoffCoordinator` 已覆盖 per-thread lock、queued replace-latest/cancel、safe-boundary、abort-confirmation、prepare/checkpoint/target start/ready/active CAS/bootstrap/commit、target failure rollback/reverse CAS、source recovery 和 stale event archive。

Runtime event envelope 使用：

```text
threadId + segmentId + runtimeSessionId + bindingEpoch
```

主要代码：`src/supervisor/sessionHandoff/coordinator.ts`、`src/supervisor/supervisorRuntime.ts`、`src/shared/contracts/runtimeEvent.ts`、`src/shared/contracts/thread.ts`、`src/shared/sessionHandoff.ts`。

### T07：In-place UI

- `ContinueInProviderDialog` 保留 Fork/Move，新增同一会话内 Switch。
- 支持 `after-current-turn` 与 `abort-current-turn`，并显示 target/current、queued/progress/cancel/error 状态。
- `RuntimeSegmentMarker` 显示 Segment、Recipe/CraftPlan、Model/Harness 和短化 native Session provenance。
- `app.tsx` 保持单一全局 Supervisor event subscription。
- handoff IPC 已在 `src/renderer/remoteProcedureRoutes.ts` 分类为 local supervisor only。

主要代码：`src/renderer/components/thread/ContinueInProviderDialog.tsx`、`src/renderer/components/thread/ChatPane/parts/items/RuntimeSegmentMarker.tsx`、`src/renderer/actions/sessionHandoffActions.ts`、`src/renderer/state/sessionHandoffStore.ts`。

### T08：真实验收代码入口

- 测试：`src/supervisor/runtime/crossHarnessHandoff.integration.test.ts`
- artifact：`ai_workspace/validation/v0.9-cross-harness-handoff-real.json`
- 目标链路：官方 Native `Codex A → Grok Build B → Codex C continuation`
- portable continuation 只能使用 checkpoint + 新 Runtime Segment/native Session；不得伪造跨厂商 native resume。

## 五、Debugger 首轮 Findings：当前真正需要修复的三项

完整内容见 `ai_workspace/agent_docs/debugger_0.9.0.md` 与 `debugger_0.9.1.md`。Fix #1 只修 F1、F2、F3，不扩大 Feature。

### F1 [P1] Crafted active command 没有携带 execution envelope

现象：协议和 Supervisor 已支持可选 execution envelope，但 crafted Thread 的 Renderer command callers 仍只发送 `threadId` 等旧字段。切换完成后，旧 UI binding 发出的迟到命令可能只按 Thread ID 命中当前新 Session。

已定位位置：

- `src/shared/contracts/thread.ts`：Prompt、interrupt、steer、request resolution、close 已定义可选 `execution`。
- `src/supervisor/sessionHandoff/coordinator.ts`：`assertActiveExecution()` 目前在 execution 存在时比较 `segmentId/runtimeSessionId/bindingEpoch`；缺失 envelope 还没有对 crafted Thread fail closed。
- `src/supervisor/supervisorRuntime.ts`：crafted `sendThreadInput`、`interruptThread`、`setPendingSteer`、`clearPendingSteer`、`resolveThreadServerRequest`、`closeThread` 已调用 guard，但需要完成 missing/stale 语义和 request origin 绑定。
- `src/renderer/actions/threadRuntimeActions.ts`：submit、request resolution、pending steer 路径尚未把当前 execution envelope 传入。
- `src/renderer/components/thread/ThreadComposerSection.tsx`：interrupt 目前调用 `interruptThread({ threadId })`。
- `src/renderer/commands/registry.ts`：slash command 目前调用 `sendThreadInput({ threadId, prompt, config })`。

必须达到：

- 当前 binding 必须来自 Supervisor-issued state/active Segment，Renderer 不得根据 provider/model 自己猜测或重建 epoch。
- crafted Thread 的 Prompt、slash command、interrupt、steer/clear、permission/question response、close 以及同类 active command 都携带完整 `segmentId + runtimeSessionId + bindingEpoch`。
- missing/stale envelope 对 crafted Thread 稳定 fail closed；建议错误 code：`HANDOFF_ACTIVE_EXECUTION_REQUIRED`。
- current envelope 的 command 只能到达 current target；旧 source envelope、错误 session、错误 epoch、缺失 envelope 均不能触发 target Session。
- pending request 必须保存创建时的 execution origin；resolution 同时检查 request origin 与当前 active execution。
- legacy non-crafted Thread 保持兼容，不要求旧路径强制携带 envelope。

必须新增/保留的测试：current / stale / missing envelope；Prompt、slash command、interrupt、steer/clear、permission/question response、close 的关键路径；迟到 source command 不得触发 target；legacy Thread 不回归。

### F2 [P1] T08 integration test false-green，且没有独立失败 scenarios

现象：首轮 `crossHarnessHandoff.integration.test.ts` 把环境诊断和产品验收放进同一 catch-all 流程：

- Grok B / Codex C 主要只检查 `disposition === activated`，没有检查真实 assistant completion/marker。
- 在 Segment count 等产品断言完成前就可能写入 `REAL_NATIVE_CHAIN_COMPLETED`。
- catch-all 会把认证、额度、binary、产品异常、断言失败都降成 artifact 写出，测试进程仍显示绿色。
- 没有 queued、abort success/failure、target rollback、late-event/input、restart recovery 的独立 scenario 结果。

必须达到：

- 官方 Runtime 尚未真正启动前，`AUTH_REQUIRED`、`QUOTA_OR_LIMIT`、`RUNTIME_UNAVAILABLE` 可以产出 `BLOCKED BY ENVIRONMENT`；一旦链路已开始，产品断言失败必须让测试失败并保留非环境 failure classification。
- Codex A、Grok B、Codex C 分别验证真实 assistant completion/response；artifact 只保存 `nonEmpty`、`length`、`hash`，不保存正文。
- 验证三段 distinct Segment、同一 Thread、同一 workspace、ordinal/epoch 单调递增、B/C 新 native Session 存在。
- 只有全部产品断言通过后最后才能写 `REAL_NATIVE_CHAIN_COMPLETED`。
- artifact 记录每个 scenario 的 status、blocked/unverified/failure 分类和脱敏 response summary。
- 加入 false-green regression tests：B/C 无 response、Segment count 错、产品 exception 必须红。
- queued、abort-confirmed、abort-failed、target rollback、stale event/input、restart recovery 要有独立 scenario 证据；真实 Runtime 需要真实 gate，不能用 mock 冒充。

### F3 [P2] broader migration test 仍硬编码 schema 36

现象：v0.9 migrations 已将 latest schema 提升到 `39`，但 `src/main/db/projectsThreads.test.ts:309` 仍断言 `schema_version === "36"`。Debugger 定向复现为 `1 failed / 18 passed`，实际收到 `39`、期望 `36`。

必须达到：

- 使用 `String(LATEST_SCHEMA_VERSION)`，不要继续硬编码 36。
- v32 fixture 必须完整迁移到 latest。
- 同时保留 legacy project data，并明确断言 `runtime_segments`、`conversation_checkpoints`、`session_switch_transactions` 及 active uniqueness/stale archive 相关索引存在。
- `src/main/db/projectsThreads.test.ts` 与 `src/main/db/migrations.test.ts` 定向全绿。

## 六、已取得的验证证据

以下是首轮 Coder 与 Debugger 已实际取得的证据，均不能单独替代真实 T08 Feature gate：

- 固定 Node ABI 的 v0.9 focused suite：10 files / 145 tests PASS；真实 integration 默认 SKIPPED。
- Remote procedure routing：1 file / 215 tests PASS。
- `pnpm typecheck`：PASS。
- `pnpm run build:renderer`：PASS。
- `pnpm run build:electron`：PASS。
- 触及文件 `oxlint --deny-warnings`：PASS。
- 触及文件 `oxfmt --check`：PASS。
- `git diff --check`：PASS。
- `package.json`、`pnpm-lock.yaml`：无 diff。
- Electron changed-surface mock smoke：welcome dismissal、baseline PASS；console/runtime errors 为 0。该 smoke inventory 只覆盖 baseline，不是 handoff UI 或 provider E2E。

固定 SQLite ABI 的测试环境变量：

```powershell
$env:CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'
```

不要使用 worktree 内 Electron ABI 148 的 `better-sqlite3` binding；当前 Node 测试 ABI 为 Node 137。

### Broader/full test 状态

Debugger 首轮独立记录的 `pnpm test` 汇总：

- 883 files / 9837 tests PASS。
- 8 files / 19 tests FAIL。
- 14 files / 78 tests SKIPPED。
- 1 unhandled error。

失败包括 `projectsThreads.test.ts` 的 schema 36 硬编码，以及未修改范围的 `craftstationData.migrate`、ThreadView todo dock、CraftingGrid DeepSeek default、channel parity、probe cwd、Antigravity OAuth timeout、Crossagent MCP network paths 等。修复 Agent 必须逐项确认，不要把所有 broader failure 都归因于 v0.9，也不要忽略 schema regression。

全仓 `pnpm lint` 的已知既有失败：

```text
src/supervisor/agents/codex/codexRouterOverlay.test.ts:52:7
vitest(no-conditional-expect)
```

## 七、当前真实 T08 artifact 与证据边界

当前文件：`ai_workspace/validation/v0.9-cross-harness-handoff-real.json`

当前关键字段：

```json
{
  "synthetic": false,
  "verdict": "BLOCKED BY ENVIRONMENT",
  "scenarios": [],
  "blockedReason": {
    "code": "QUOTA_OR_LIMIT"
  },
  "runtimeEventCount": 18
}
```

这表示当前环境在真实官方 Runtime 链路上受额度/限制阻塞，不能证明 Codex A、Grok B、Codex C 三段真实 response、Grok 对 checkpoint/workspace 的理解、回 Codex 时创建有效新 continuation Segment/native Session，或真实 queued、abort、rollback、late-event/input、restart recovery。

必须保持：

```text
IMPLEMENTED / DEBUGGER FAIL / BLOCKED BY ENVIRONMENT
```

不得把 opt-in test process 的 exit code 0 写成真实链路 PASS；不得写入伪造 marker、完整 response、token、cookie、hidden reasoning 或 provider internal state。

## 八、Fix #1 推荐执行顺序

严格按 Debugger Fix Plan：

```text
F1 execution state source
→ Renderer/remote propagation
→ Supervisor missing/stale fail-closed
→ request-origin binding
→ F1 regression tests
→ F3 migration test/schema assertions
→ F2 T08 harness refactor
→ false-green/scenario tests
→ focused/broader/static/build
→ real opt-in
→ sanitized artifact
→ coder_0.9.1.md
→ notify paired Debugger
```

建议每个小步骤遵循 red → green：先添加能够复现 Finding 的 public-seam test，再修改最小实现，最后跑对应 focused regression。

## 九、推荐验证命令

在唯一 Feature worktree 执行，避免并行首次 `pnpm exec` 触发原生依赖安装竞争：

```powershell
cd D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff
$env:CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'

pnpm exec vitest run --configLoader runner `
  src/supervisor/sessionHandoff/segmentLedger.test.ts `
  src/supervisor/sessionHandoff/checkpointProjection.test.ts `
  src/supervisor/sessionHandoff/coordinator.test.ts `
  src/supervisor/runtime/crossHarnessHandoff.integration.test.ts `
  src/renderer/actions/sessionHandoffActions.test.ts `
  src/renderer/components/thread/ContinueInProviderDialog.test.tsx `
  src/renderer/components/thread/ChatPane/parts/items/RuntimeSegmentMarker.test.tsx

pnpm exec vitest run --configLoader runner src/renderer/remoteProcedureRouter.test.ts
pnpm exec vitest run --configLoader runner src/main/db/projectsThreads.test.ts src/main/db/migrations.test.ts
pnpm typecheck
pnpm run build:renderer
pnpm run build:electron
```

真实 T08 必须显式 opt-in，并按 artifact/scenario verdict 判断：

```powershell
$env:CRAFTSTATION_REAL_CROSS_HARNESS_E2E = '1'
$env:CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'
pnpm exec vitest run --configLoader runner src/supervisor/runtime/crossHarnessHandoff.integration.test.ts
```

UI 回归使用隔离的 mock Electron smoke：

```powershell
node D:\Work\CraftStation\.agents\skills\interactive-testing\scripts\run-craftstation-smoke.mjs --scope changed --mode mock
```

不要用 mock smoke、unit test 或已存在的 binary 代替真实 Provider/Harness response。

## 十、完成后的交接要求

Fix #1 完成后：

1. 写 `ai_workspace/agent_docs/coder_0.9.1.md`，逐项映射 F1/F2/F3 的源码、测试、验证和仍然存在的真实环境阻塞。
2. 更新 `PROJECT_STATUS.md`：保持 T08 `UNVERIFIED/BLOCKED`，不要写 Feature PASS。
3. 在同一 Feature branch 提交 Fix #1；不得 merge `main`、不得 merge 共享 Dev、不得 tag、不得 push。
4. 复用原配对 Debugger task `Debugger-0.9-Cross-Harness Handoff`，发送复检消息；不要创建第二个 Debugger。
5. 原配对 Debugger thread id：`01a057b4-c0b2-7181-8243-801b00eee3a6`。
6. Debugger 复检仍需独立验证，不能以 Coder 的修复文档代替验收。

## 十一、关键线程与角色

- Manager：项目绑定线程 `01a0287a-174b-7b31-b34d-03cff94cfbb8`
- 原始 Coder：项目绑定线程 `01a05632-bfcc-77e2-a41c-52af8c39457f`
- 配对 Debugger：项目绑定线程 `01a057b4-c0b2-7181-8243-801b00eee3a6`
- 本文对应工作流：`my-workflow Coder` Fix Cycle #1

新的修复 Agent 应在现有 Feature worktree 上继续，不要从 `main`、v0.8、v0.10 或其他旧 CraftStation 路径重新创建工作副本。
