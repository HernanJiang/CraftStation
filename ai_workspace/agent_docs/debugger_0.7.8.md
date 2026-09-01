# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.8
> 角色：Debugger
> 日期：2026-08-30
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
> 分支：`feature/v0.7-native-harnesses`
> HEAD：`7ae6506`
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（v0.7.8 已关闭 long-lived non-serving initialize 的无限等待和 Supervisor error-detail identity 暴露，但把 readiness deadline 错误提升为整个 JSON-RPC transport 的统一 deadline，导致正常 DeepSeek turn 默认 15 秒、显式配置时甚至只允许 50ms；这直接违反 Feature 的长任务生命周期边界）**

本轮确认 v0.7.8 有实质进展：长期存活但不回应 `initialize` 的 child 会在有界时间内失败；timeout 后 child 被 kill，adapter active sessions 归零；`craftAgent()` 只在 `createSession()` 完成后提交 `entityId/sessionId`；absent、unconfigured、crash、protocol mismatch、long-lived non-serving、fixture-ready 六态都有 production factory/Supervisor seam 回归。真实 DeepSeek serving composition 仍不可用，因此产品继续诚实返回 `RUNTIME_UNAVAILABLE`，没有 API、CLIProxyAPI、PTY/TUI 或 synthetic fallback。

但 timeout 的作用域不正确：`readinessTimeoutMs` 在 `nativeAdapter.ts:582-584` 被写成 transport 级 `requestTimeoutMs`，而 `sendRequest()` 在 `nativeTransport.ts:341` 又给所有请求默认 15000ms。正常 `session/prompt` 和 `shutdown` 都没有传独立策略。Debugger 的独立 transport 探针设置 `requestTimeoutMs: 50` 后，对一个仍在正常执行、尚未回复的 `session/prompt` 在约 62ms 返回：

```text
RUNTIME_UNAVAILABLE: Request 'session/prompt' timed out after 50ms with no response.
```

这不是 readiness failure，而是合法长 turn 被 CraftStation 自己截断。未配置 `readinessTimeoutMs` 时同一问题仍存在，只是固定为 15 秒。Manager 明确要求“不得设置固定 60 秒上限替代 Harness 自己的长任务生命周期”，因此 F41 仍是 Feature blocker。

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge nested Dev、merge main 或执行 dev→main promotion。项目工作树内唯一新增文件是本 Debugger 文档；真实 product-path 测试按既有测试设计刷新了现有 validation artifact。

## Review Scope

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.7.md`
- `ai_workspace/agent_docs/coder_0.7.8.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- `ai_workspace/validation/v0.7.0-native-runtime-audit.md`
- v0.7.8 的 transport、adapter、Supervisor、factory、lifecycle、renderer action 与回归测试
- F40~F46 的既有实现与证据边界

CodeGraph 状态显示索引属于 main worktree，而不是 v0.7 Feature worktree；为避免使用错误分支的符号事实，本轮降级为当前 worktree 的源码搜索、逐段阅读、diff、独立运行探针和测试。

## Evidence

### 1. Worktree / Git boundary

- 目标 worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 分支：`feature/v0.7-native-harnesses`
- HEAD：`7ae6506`
- 所有项目读取、测试和文档写入均显式针对 v0.7 worktree。
- main、共享 v0.6/dev 和 v0.8 未被修改、清理、reset、切换或合并。

### 2. F40 — static gates

独立复跑全部 21 个触及 TS/TSX 文件：

| 检查                                          | 结果                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm exec oxfmt --check <21 files>`          | PASS；21 files 全部格式一致                                                                        |
| `pnpm exec oxlint --deny-warnings <21 files>` | PASS；0 warning / 0 error                                                                          |
| `pnpm run typecheck`                          | PASS                                                                                               |
| `git diff --check`                            | PASS                                                                                               |
| Full `pnpm run lint`                          | FAIL；未触及 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 的既有 conditional expect |

**F40：PASS（触及路径门禁）；全仓 lint 不得表述为 PASS。**

### 3. Focused / full regression

扩展 focused suite：

```text
Test Files  9 passed | 1 skipped (10)
Tests       112 passed | 1 skipped (113)
```

跳过项是未开启真实 Antigravity gate 的 product-path integration；随后单独开启真实 gate 复跑通过。

全仓测试：

```text
Test Files  6 failed | 855 passed | 10 skipped (871)
Tests       16 failed | 9626 passed | 48 skipped (9690)
```

16 项均为稳定既有基线：

- `remoteProcedureRouter.test.ts`：1；
- `craftstationData.migrate.test.ts`：8；
- `channel.config-parity.test.ts`：2；
- `channel.test.ts`：1；
- `craftstationPaths.test.ts`：2；
- `probeCwd.test.ts`：2。

没有命中 v0.7 native harness 触及模块，但全仓 test 不能写 PASS。

### 4. F41 — 已关闭的 v0.7.7 blockers

#### 4.1 Long-lived non-serving initialize 已有界失败

- `NdjsonProcessTransport.sendRequest()` 已支持 `timeoutMs` 与 `AbortSignal`。
- timeout/abort 会删除相应 pending entry，并清理 timer/listener。
- `openSession()` 在 `initializeDeepSeek()` 失败后执行 session termination。
- factory matrix 的 long-lived child 不依赖 process exit，而是在 50ms readiness deadline 内拒绝。
- focused tests 确认 child kill 和 adapter active sessions 归零。

因此 v0.7.7 的“initialize 可永久 pending”Finding 已关闭。

#### 4.2 Supervisor identity commit boundary 已关闭 craftAgent 路径

`SupervisorRuntime.craftAgent()` 和 `resumeCraftAgent()` 均在 `createSession()` / `resumeSession()` 成功后才赋值 `entityId/sessionId`。Supervisor 测试覆盖 unconfigured、crash、protocol mismatch 和 timeout 的 `craftAgent()` 错误 detail，均不再暴露 provisional identity。

准确边界是：adapter 内部仍会构造 provisional Entity/Session 对象；v0.7.8 已保证 readiness 失败时不向 Supervisor error detail commit/expose 它们，并清理 session/process。不能把它扩大表述为所有分支“物理上从未创建对象”。

### 5. [P1] Readiness timeout 错误限制所有正常 JSON-RPC 请求

源码链路：

1. `nativeAdapter.ts:582-584` 把 plan 的 `readinessTimeoutMs` 写入 transport 级 `requestTimeoutMs`。
2. `nativeTransport.ts:341` 对每个 `sendRequest()` 使用：

   ```text
   options.timeoutMs ?? transport.requestTimeoutMs ?? 15000
   ```

3. `nativeAdapter.ts:302-310` 的 `session/prompt` 未传 timeout/AbortSignal 策略。
4. `nativeAdapter.ts:378-384` 的 `shutdown` 也未传独立 cleanup deadline。

Debugger 在系统临时目录构建只读独立 probe，并通过当前 `nativeTransport.ts` 执行：child 保持存活、不回复 `session/prompt`，transport `requestTimeoutMs=50`。结果：

```json
{
  "status": "rejected",
  "elapsedMs": 62,
  "message": "RUNTIME_UNAVAILABLE: Request 'session/prompt' timed out after 50ms with no response."
}
```

diagnostic 同时把 operation 记录为 `session/prompt` / `RUNTIME_UNAVAILABLE`；probe 随后 dispose 并 kill fixture，系统临时脚本/产物已清理。

**影响：**

- 测试或用户为 readiness 设置 50ms，会把每个正常 DeepSeek turn 也限制为 50ms。
- 未显式设置时，所有 turn 仍被固定为 15 秒。
- DSH 自己仍在工作的长任务会被 CraftStation误判为 runtime unavailable。
- timeout 后 `failTurn()` 只结束 turn；这不是 Harness 自己的自然生命周期，也不是用户取消。

**F41 timeout scope：FAIL。**

### 6. [P1] Initialize failure cleanup 不是“立即 kill”

`openSession()` 在 initialize timeout 后调用 `await session.terminate()`；`terminate()` 会先发送并等待 `shutdown`，而 shutdown 继承同一个 transport-wide timeout，之后才 `dispose()/kill`。

因此：

- `readinessTimeoutMs=50` 时，最坏还会再等待约 50ms；
- 默认 initialize timeout 15 秒时，最坏还会再等待一个 15 秒 shutdown timeout；
- Coder 文档中“立即调用 transport.dispose() 强制终止”的描述不准确。

这与上一 Finding 同根：readiness、turn 和 cleanup deadline 被一个 primitive 配置混在一起。

### 7. Test assertion boundaries

- `nativeAdapter.test.ts:306-360` 的测试标题写“clears pending requests”，但只直接断言 child killed、diagnostic 和 active sessions；没有直接观测 pending map 清零。
- `runtime.test.ts:3252-3310` 断言 error detail 和 child kill，但没有直接断言 Supervisor `craftedSessionsByThread` / binding cache 无残留。
- `resumeCraftAgent()` 实现已延迟 identity commit，但新增 readiness failure 回归均调用 `craftAgent()`；resume failure 尚无同等级测试。

这些是 P2 coverage gaps，不单独推翻实现事实；P1 timeout scope 已足以判定 Feature FAIL。

### 8. Real Antigravity product path

独立设置真实 gate 与本机 `agy.exe` 后复跑：

```text
Test Files  1 passed (1)
Tests       1 passed (1)
```

最新 artifact：

- `timestamp: 2026-08-30T10:21:43.078Z`；
- `synthetic: false`；
- `agy 1.1.22`；
- `verdict: AUTH_REQUIRED`；
- canonical `turn.started`、`error`、`turn.completed`、`session.exited`；
- Supervisor IPC forwarding 包含同一组事件；
- cleanup operation 为 `SupervisorRuntime.closeThread`；
- `observedSessionExited: true`。

这是真实 live 账号 eligibility/auth 边界和退出清理证据，不是 assistant-response PASS，也不证明 UI、interrupt、multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

### 9. Official DeepSeek / DSH boundary

本机仍没有完整、可 serving 的官方 Windows Cordis composition。v0.7.8 没有把 fixture-ready 或 timeout coverage 冒充真实 DSH response；production 继续 `RUNTIME_UNAVAILABLE`，禁止普通 API、CLIProxyAPI、TUI/PTY 或 synthetic Entity/Session fallback。

**F41 carrier honesty：PASS；F41 runtime timeout scope：FAIL。**

### 10. F42~F46 regression boundary

- **F42：PASS（implementation seam）**。生产 `HarnessPanel -> CraftingGrid(onCraft, workspace) -> startThreadFromCraft -> bridge.craftAgent` 路由及 Lingui 文案保持；Feature FAIL，未进入最终 Electron PASS smoke。
- **F43：PASS**。IPC interrupt 优先路由 crafted session。
- **F44：PASS（contract regression）**。Windows interrupted terminal events、Supervisor forwarding/release、adapter retention 回归保持；真实 provider interrupt E2E 仍未取得。
- **F45：PASS**。未实测高级能力继续为 `implementation missing`，没有升格为 supported/integrated。
- **F46：PASS**。正文键深度脱敏与 nested `session.event` canonicalization 保持通过。

## F40~F46 Status Matrix

| Fix                               | 独立复核结果                                                                                                          | 状态                                    |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| F40 static gate                   | 21 文件 format/lint、typecheck、diff check 全绿                                                                       | **PASS**                                |
| F41 DeepSeek carrier/runtime      | six-state readiness、identity error detail、真实 unavailable 已关闭；正常 turn 被 readiness/default 统一 timeout 错杀 | **FAIL**                                |
| F42 production Craft callback     | production callback/workspace/action、i18n 回归成立                                                                   | **PASS（desktop smoke remaining）**     |
| F43 interrupt routing             | crafted session 优先路由成立                                                                                          | **PASS**                                |
| F44 interrupt lifecycle/retention | canonical uniqueness、forward/release/retention 成立                                                                  | **PASS（real provider E2E remaining）** |
| F45 capability honesty            | 未实测能力保持 implementation missing                                                                                 | **PASS**                                |
| F46 redaction/canonicalizer       | 正文脱敏与 nested event 展开成立                                                                                      | **PASS**                                |

## Findings

### [P1] `readinessTimeoutMs` 泄漏为 transport-wide deadline，正常 turn 默认 15 秒或被缩短到 readiness 值

**Evidence**

- `nativeAdapter.ts:582-584`：readiness 配置写入 transport `requestTimeoutMs`。
- `nativeTransport.ts:341`：所有请求默认 15000ms。
- `nativeAdapter.ts:302-310`：`session/prompt` 没有独立 timeout/signal 策略。
- 独立 probe：`session/prompt` 在 `requestTimeoutMs=50` 时约 62ms 被拒绝。
- Manager `manager_0.7.0.md:93` 明确禁止固定上限替代 Harness 长任务生命周期。

**Impact**

合法的长 DeepSeek turn 会被 CraftStation 主动截断并误报 `RUNTIME_UNAVAILABLE`。这是产品行为错误，不是测试覆盖不足。

**Root Cause**

readiness deadline、turn cancellation 和 shutdown cleanup 三个不同生命周期概念被合并为单个 transport-wide `requestTimeoutMs`。

**Fix**

1. transport 不得把 readiness timeout 隐式用于所有 request。
2. `initialize` 显式使用独立、默认有界的 readiness deadline。
3. `session/prompt` 默认跟随 Harness 长任务生命周期，不设置 CraftStation 固定 15 秒上限；需要取消时使用 `StartTurnCommand.signal` / 明确用户策略。
4. `shutdown` 使用独立、较短且明确的 cleanup deadline，deadline 后立即 dispose/kill。
5. timeout/abort diagnostic 保留 request method、request id/correlation id 和稳定 code，不记录 prompt/secret。

**Acceptance**

- fixture initialize 在短 readiness deadline 内成功；随后 `session/prompt` 延迟超过该 readiness 值仍能正常完成。
- 未配置 readinessTimeoutMs 的 turn 延迟超过 15 秒时不会被 transport 默认超时（可使用 fake timers，不必让测试真实等待 15 秒）。
- `StartTurnCommand.signal` 可以有界取消 pending request/turn，而不是依赖固定正常-turn deadline。
- non-serving initialize 仍有界失败并清理 process/pending/session/cache。
- shutdown 有独立 cleanup deadline，provider 不回应时仍快速 dispose/kill。

### [P2] Pending/cache 与 resume failure 的直接断言不足

**Evidence**

- long-lived adapter test 未直接观测 pending request 数量。
- Supervisor timeout test 未直接观测 `craftedSessionsByThread` / binding cache。
- readiness failure tests 只覆盖 `craftAgent()`，没有 `resumeCraftAgent()`。

**Impact**

当前实现从代码可推导大部分清理成立，但测试名称和 Coder 声明强于直接断言；未来改动可能回归而不被发现。

**Fix / Acceptance**

- 提供只读 test seam（例如 pending count）或通过可观测行为直接断言 pending 清零；不要依赖 private-field 深挖。
- timeout/exit 后断言 adapter active sessions、Supervisor crafted-session registration 和 binding cache 均无残留。
- 补 `resumeCraftAgent()` 的 crash/protocol/non-serving 至少一个代表性 identity/cleanup failure test。

## Remaining

- 分离 initialize readiness、normal turn cancellation 与 shutdown cleanup deadline。
- 补正常长 turn 不继承 readiness timeout 的直接回归。
- 补 pending/Supervisor cache 和 resume failure 的直接断言。
- 当前官方 DeepSeek Windows serving composition 仍不可用；继续 `RUNTIME_UNAVAILABLE`，禁止 fallback。
- 高级能力继续 `implementation missing`。
- F41 关闭后再执行真实 Electron 自主 UI smoke。

## Fix Plan — v0.7.9

1. **Split timeout scopes**：transport request timeout 只由调用点显式选择；initialize 使用独立 readiness deadline，normal prompt 不继承，shutdown 使用独立 cleanup deadline。
2. **Long-turn regression**：fixture initialize 快速成功，prompt response 延迟超过 readiness 值仍完成；fake timer 证明默认 turn 不在 15 秒自动失败。
3. **Cancellation regression**：把 `StartTurnCommand.signal` 正确绑定到 pending request/turn 清理，验证主动取消而非固定 deadline。
4. **Cleanup assertions**：直接验证 pending、child、active sessions、Supervisor registration/binding 全部归零；补 resume failure 代表性路径。
5. **保持 fail-closed**：真实官方 carrier不可 serving 时继续 `RUNTIME_UNAVAILABLE`，不引入 API/CLIProxy/synthetic fallback。
6. 复跑 21 文件静态门、focused、真实 Antigravity gate、full baseline attribution，并更新 Coder/状态文档后交接同一 Debugger。

## Fix Acceptance Criteria

- non-serving initialize 有界失败，但 readiness timeout 不影响正常 `session/prompt`。
- 默认正常 turn 不被固定 15 秒 deadline 截断；只由 Harness 终态或显式 abort/用户策略结束。
- shutdown deadline 独立且有界，失败后 dispose/kill 不再额外等待一个 readiness/turn timeout。
- timeout/abort 后 pending、transport/process、provisional session、adapter active session、Supervisor registration/binding 均无残留。
- `craftAgent()` 与 `resumeCraftAgent()` readiness failure 均不向错误 detail暴露 `entityId/sessionId`。
- six-state matrix 保持；ready 仍明确是 fixture，不冒充真实 DSH response。
- 官方 Windows serving composition 不可用时保持准确 `RUNTIME_UNAVAILABLE`。
- F40、F42、F43、F44、F45、F46 无回归；未实测高级能力保持 `implementation missing`。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。这是既有生命周期 timeout policy 的局部实现错误，不改变 Feature Spec。
- Requires Ideate Revision：**No**。

## User Smoke

本轮 Verdict 为 FAIL，未进入 PASS closeout；没有启动或打开最终 Electron candidate，也没有把 factory fixture、绿测或真实 AUTH_REQUIRED artifact 冒充桌面验收。

## Final Decision

**Do not promote. Do not merge to nested Dev. Main promotion remains NOT AUTHORIZED.**

v0.7.8 解决了“初始化永挂”和“失败 identity 暴露”，但修复方式引入了更广的正常-turn 固定上限。下一轮只需收窄 timeout scope、补直接清理/恢复测试；不需要也不允许把当前不可 serving 的 DSH 包装成成功。
