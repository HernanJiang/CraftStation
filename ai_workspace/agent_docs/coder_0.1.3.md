# Coder Fix Report — Fix Cycle v0.1.3

## Scope

依据 `ai_workspace/agent_docs/debugger_0.1.3.md` 的 Fix Plan，修复 Craft Table 绕过生产 Runtime Adapter、错误使用 `threads[0]`、workspace 丢失、provenance 仅由 renderer 尽力写入，以及 synthetic validation 被标记为 Feature PASS 的问题。

## Implemented Fixes

### F01 — Production Craft handoff

- 新增 supervisor IPC procedure `craftAgent`。
- `SupervisorRuntime.craftAgent` 是生产路径唯一的 Adapter 入口：持有真实 `ThreadSessionManager`，创建 `CodexHarnessRuntimeAdapter`，执行 `spawnEntity -> createSession -> sendPrompt`。
- `SupervisorRuntime` 将真实 `thread-runtime-event(s)` 转发给 Adapter 的订阅者，因此 `CodexCraftSession` 能观察真实 supervisor event bus，而不是 renderer mock listener。
- `startThreadFromCraft` 不再调用 `startThreadFromDraft`，先以 plan 的确定性/分配 thread id 创建 UI row，再调用 `bridge.craftAgent`。
- 新增回归测试断言 `startThread` 不被调用、`craftAgent` 收到同一 thread id、provenance 写入同一 thread key。

### F03 — Provenance and identity

- provenance 在调用生产 Craft seam 前通过现有 `dbSetState` bridge 写入 `craftstation:provenance:${threadId}`，不再从 `useAppStore.threads[0]` 猜测目标。
- `ProvenanceStore.saveProvenanceAsync` 提供写入完成语义；恢复仍可通过既有 `AppStateProvenanceDriver` / `ProvenanceStore` seam 执行。
- supervisor 返回 `threadId`、`entityId`、`sessionId` 与 response，保留 Entity/Session identity 证据。

### F02 / F09 — Evidence honesty

- `featurePath.test.ts` 保留为 synthetic Adapter seam 测试，但不再写仓库外 validation JSON，也不生成 Feature `PASS` verdict。
- `ai_workspace/validation/craftstation_execution_path_v0.1.2.json` 已标记 `synthetic: true`、`NOT_FEATURE_EVIDENCE`，防止被误读为真实 round-trip。
- regression checklist 改为只记录本轮实际执行过的命令。

### Workspace and remote boundary

- Craft UI 现在把 Windows、WSL Linux path 和 POSIX path 传入 CraftingGrid / CraftPlan / production IPC。
- `craftAgent` 明确列入 renderer remote procedure 的 local-supervisor-only 分类；远程项目当前安全拒绝，不错误地把本地 supervisor seam 路由到远端。

## Verification

通过：

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run build`
- `pnpm exec vitest run --configLoader runner src/renderer/remoteProcedureRouter.test.ts src/renderer/actions/threadLaunchActions.test.ts src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts src/shared/ipc` — 9 files / 270 tests
- `pnpm exec oxfmt --check <touched files>`
- `pnpm exec oxlint --deny-warnings <touched files>`

全仓 `pnpm run test` 共 827 个测试文件中 814 个文件通过、5 个 skipped；剩余 13 个测试失败均不涉及本轮修改：

- Windows 无 symlink 权限导致 `macAppPathMigration.test.ts` 2 项失败；
- Windows PowerShell/运行时路径差异导致 ACP registry、ACP generic、Gemini plugin 与一项 supervisor runtime 测试失败；
- ACP probe stress 4 项超时阈值；
- renderer usage currency formatting 2 项失败。

其中本轮直接引入的 `remoteProcedureRouter.test.ts` 分类失败已修复，并在上述 270 测试回归中通过。

## Fix Self-check

- [x] 产品 Craft 路径调用生产 Adapter。
- [x] 不再使用 `threads[0]` 取得 Craft thread。
- [x] 不再使用 `startThreadFromDraft` 执行 Craft handoff。
- [x] event subscription 来自 supervisor runtime event bus。
- [x] Windows / WSL / POSIX workspace 不在 renderer handoff 丢失。
- [x] synthetic validation 不再作为 Feature PASS 证据。
- [x] typecheck、lint、build 与直接回归测试通过。
- [x] 未覆盖的真实本机 Codex AUTH/round-trip 仍诚实保留为 Debugger / 人工验收项。

## Ready for Debugger Re-review

`Requires Manager Re-plan: No`。请 Debugger 复检生产 Craft seam、真实桌面 Codex round-trip 或 `AUTH_REQUIRED` / `RUNTIME_UNAVAILABLE` 诊断，以及重启后 provenance 恢复。
