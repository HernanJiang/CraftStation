# CraftStation Coder 交付 — v0.9.0

## 交付结论

- Feature：`v0.9.0 — Cross-Harness Session Handoff`
- Coder 状态：已按 Execution Order 连续完成 T01 → T08，并完成 Feature-level self-check。
- 唯一工作树：`D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`
- 分支：`dev/v0.9-cross-harness-handoff`
- 基线：`7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`
- 工程交付状态：`IMPLEMENTED / READY FOR DEBUGGER`
- 真实证据状态：`BLOCKED BY ENVIRONMENT`。T08 的真实官方 Runtime gate 未取得 Codex → Grok Build → Codex 的三段 non-synthetic response，因此不能将 Feature 写成 PASS，也不能把 mock 或协议测试当作真实跨 Harness 证据。

## Ticket 映射

### T01 — Expand Durable Runtime Segment Ledger

- 在 `src/main/db.schema.ts`、`src/main/db/migrations.ts` 与连接/迁移测试中加入 schema 37–39：`runtime_segments`、`conversation_checkpoints`、`session_switch_transactions` 和 stale-event archive。
- `RuntimeSegmentLedger` 提供 lazy initial Segment、唯一 active partial index、epoch 递增、native/runtime/entity 引用、provenance、checkpoint 保存、重启恢复和 interrupted switch recovery。
- 旧 Thread 没有 Segment 时幂等创建 initial Segment；同一 Thread 不允许两个 active binding。

### T02 — Build Versioned ConversationCheckpoint Projection

- `src/supervisor/sessionHandoff/checkpointProjection.ts` 从 canonical ledger 生成 versioned `ConversationCheckpoint`，包含任务摘要、当前状态、决策、结果、工作区变化、最近完成轮次、anchors、source Segment/native ref、预算和截断信息。
- `src/supervisor/sessionHandoff/redaction.ts` 与 allowlist schema 只输出可移植字段；隐藏推理、凭据、活动工具句柄、未决权限/问题和 provider 内部状态不会进入 checkpoint。
- 投影和目标 bootstrap 文本是确定性的，并受字符/预算限制；不默认全量重放 transcript。

### T03 — First Same-Thread Safe Switch Tracer Bullet

- `SessionHandoffCoordinator` 位于 Supervisor 侧，封装 lock、preflight、prepare、checkpoint、target start/ready、CAS activation、bootstrap 和 rollback。
- 切换创建新的 Runtime Segment、Entity/native Session 与不可变 binding provenance；保持同一个 CraftStation Thread identity，不伪造跨厂商 native resume。
- target Ready 与订阅完成前 source 保持 active/可恢复；失败时 source 继续作为 active writer。

### T04 — Queue Switch at Turn Boundary

- 支持 `after-current-turn` safe-boundary 模式、queued 状态、replace-latest、cancel 和下一 Prompt gate。
- busy Runtime 只排队，不让目标抢占当前 turn；当前 turn 持久化并满足 safe boundary 后才执行切换。
- per-thread lock 阻止并发切换与双 writer。

### T05 — Abort Current Turn and Transactional Rollback

- 支持 `abort-current-turn`，先执行官方 Runtime interrupt/terminate handshake，并等待 source stopped confirmation。
- abort 未确认时 fail closed，不激活 target；target start/bootstrap/activation 失败时 reverse CAS、source recovery 和资源清理均有明确状态。
- 诊断保留 correlation/request、thread、segment、epoch、phase、operation、稳定 error code 和 cleanup/rollback 结果。

### T06 — Fence Events and Inputs Across Active Paths

- `src/shared/contracts/runtimeEvent.ts` 扩展可选 execution envelope；新路径携带 `threadId + segmentId + runtimeSessionId + bindingEpoch`，旧事件仍可解码。
- Supervisor canonical event、prompt/steer、permission/question、interrupt/terminate 和 remote procedure 路由均检查 active binding；迟到旧事件只写 archive，不改变当前 UI/lifecycle/message state。
- `src/renderer/remoteProcedureRoutes.ts` 已补齐 handoff 的 local-supervisor-only 分类，避免新增 IPC 被错误地作为 remote procedure 转发。

### T07 — In-place Switch UI and Provenance Timeline

- `ContinueInProviderDialog` 保留 Fork/Move，新增 `Switch in this conversation`、current/target combination、after-current-turn 与 abort-current-turn、progress/queue/cancel/error 状态。
- Renderer 只调用 handoff IPC seam；`app.tsx` 保持单一全局 Supervisor event subscription，并将 active binding 更新到同一 Thread 的 provider/model/provenance/native session/account opaque binding。
- `RuntimeSegmentMarker` 在时间线显示 Segment、Recipe/CraftPlan、Model/Harness 和短化 native Session provenance；不展示凭据或完整 native identity payload。
- 13 个 locale 只追加 v0.9 的 14 个 msgid，避免 Lingui extract 对历史 catalog 的无关大范围重排；非英文条目已翻译并保留占位符。

### T08 — Real Codex → Grok → Codex Continuation Acceptance

- 保留真实验收测试：`src/supervisor/runtime/crossHarnessHandoff.integration.test.ts`。
- 真实 opt-in 测试会从官方 Codex app-server / 官方 Grok ACP 路径尝试执行；当前首段官方 Codex Runtime 不可用，测试以真实环境阻塞诊断收口。
- 证据 artifact：`ai_workspace/validation/v0.9-cross-harness-handoff-real.json`。
- 当前 artifact 关键字段：`synthetic: false`、`verdict: BLOCKED BY ENVIRONMENT`、`blockedReason.code: RUNTIME_UNAVAILABLE`、`runtimeEventCount: 19`、`scenarios: []`。
- 因此 T08 的代码 gate 已覆盖 fail-closed 行为，但真实三段 response、Grok checkpoint comprehension、同工作区多轮 continuation 仍为 `UNVERIFIED/BLOCKED`，交由 Debugger 在具备环境时独立验收。

## 验证证据

### 通过

- Fixed Node ABI focused suite：10 files / 145 tests PASS；真实 integration case 1 SKIPPED（未设置 real opt-in）。
- Remote procedure regression：1 file / 215 tests PASS。
- Real T08 opt-in fail-closed test：1 file / 1 test PASS；PASS 仅表示运行阻塞被正确诊断，不表示真实 provider PASS。
- `pnpm typecheck`：PASS。
- `pnpm run build:renderer`：PASS。
- `pnpm run build:electron`：PASS。
- 触及源码 `oxlint --deny-warnings`：PASS。
- 触及源码 `oxfmt --check`：PASS（34 个源码/测试文件）。
- `git diff --check`：PASS。
- `package.json` 与 `pnpm-lock.yaml`：无 diff。
- Electron changed-surface mock smoke：`welcome-dismissal`、`baseline` PASS，console/runtime errors `0`；报告位于 `C:\Users\Haona\.poracode-smoke\automated-1788177448287-27260\artifacts\smoke-report.json`。该 smoke inventory 当前只执行 baseline，不能替代 handoff UI/真实 provider 验收。

### 环境/历史阻塞，未误报为 Feature 回归

- 全仓 `pnpm lint` 仍被既有错误阻塞：`src/supervisor/agents/codex/codexRouterOverlay.test.ts:52:7` 的 `vitest(no-conditional-expect)`；不在本 Feature 修改范围内。
- `pnpm exec lingui compile --strict` 受历史 locale 缺译阻塞；本轮新增的 v0.9 条目已填充。未提交 Lingui 生成的 `src/renderer/locales/en/messages.js`。
- 迁移前 full test 曾在未固定 SQLite ABI 的环境下出现 Electron ABI 148 / Node ABI 137 mismatch 及历史 schema/命名债务；本轮 focused 测试统一使用：

  ```powershell
  $env:PORACODE_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'
  ```

  不使用 worktree 内 Electron ABI 148 的 binding。focused 与 v0.9 相关测试的固定 ABI 结果已记录在上方。

## 安全与边界检查

- 真实 artifact 不含 response 正文、token、cookie、API key、private key 或隐藏推理；只保留非敏感计数、稳定状态和错误 code。
- 变更 diff 未命中常见 `sk-*`、Bearer、GitHub token、OAuth token、private-key、password/api-key assignment 模式。
- `credentialScopeRef` 只作为 opaque reference；UI marker 仅短化 native Session ID。
- 官方 Native Harness Runtime First 保持不变；portable continuation 使用 checkpoint + 新 Runtime Segment/native Session，不声称跨厂商 native resume。
- 未验证组合和真实 T08 继续 `UNVERIFIED/BLOCKED`；没有静默切换到其他 provider、Harness 或账号。
- Coder 没有 merge `main`、merge 共享 Dev、创建正式 tag 或 push。

## 最短复核路径

在唯一 Feature worktree 执行：

```powershell
cd D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff
$env:PORACODE_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'
pnpm exec vitest run --configLoader runner src/supervisor/sessionHandoff/segmentLedger.test.ts src/supervisor/sessionHandoff/checkpointProjection.test.ts src/supervisor/sessionHandoff/coordinator.test.ts src/supervisor/runtime/crossHarnessHandoff.integration.test.ts
pnpm typecheck
pnpm run build:renderer
pnpm run build:electron
```

真实 T08 需要显式环境 gate，且应继续按 artifact verdict 判断：

```powershell
$env:CRAFTSTATION_REAL_CROSS_HARNESS_E2E = '1'
$env:PORACODE_BETTER_SQLITE3_NATIVE_BINDING = 'D:\Work\CraftStation\dist\server-native\better_sqlite3.node'
pnpm exec vitest run --configLoader runner src/supervisor/runtime/crossHarnessHandoff.integration.test.ts
```

必须取得三段官方 Runtime 的 non-synthetic response、同工作区 continuation、rollback/abort/late-event/restart 证据后，才可改变 T08 verdict；当前结果保持 `BLOCKED BY ENVIRONMENT`。

## 交接

请全新项目绑定的 `Debugger-0.9-Cross-Harness Handoff` 在同一工作树、同一分支独立读取 `PROJECT_STATUS.md` 和本文件，复核 source/target/restart、真实 Codex → Grok → Codex、abort/rollback/late events、Thread identity、artifact 与 credential safety。Debugger PASS 后按项目新平铺拓扑在当前版本分支完成候选收口；不得合入 `main`、打 tag 或 push，除非另有用户授权。
