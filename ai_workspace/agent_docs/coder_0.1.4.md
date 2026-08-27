# Coder Fix Report — Fix Cycle v0.1.4

## Scope

依据 `ai_workspace/agent_docs/debugger_0.1.4.md` 的 Fix Plan，完成 `craftAgent` supervisor 覆盖、真实产品路径诊断、provenance 跟随 thread persistence 的恢复接线，以及 validation checklist 诚实性修正。

## Implemented Fixes

### F11 — `SupervisorRuntime.craftAgent` supervisor 测试

- 在 `src/supervisor/runtime.test.ts` 增加 supervisor seam 测试，保留生产 `CodexHarnessRuntimeAdapter` 组装，仅替换边界上的 `ThreadSessionManager` 行为。
- 覆盖：
  - production adapter 的 spawn/create/send 与 Entity/Session identity 返回；
  - 空 prompt 跳过 `sendPrompt`；
  - TSM 启动认证失败映射为 `AUTH_REQUIRED`；
  - 非 Codex harness 在触碰 TSM 前映射为 `RUNTIME_UNAVAILABLE`。

### F02 / F10 — 真实产品路径证据

- 运行 `craftAgent.integration.test.ts` 的真实路径：
  `craftAgent -> CodexHarnessRuntimeAdapter -> Entity -> Session -> local Codex runtime`。
- 当前本机 Codex runtime 不可用，测试按稳定失败诊断通过，并写入非 synthetic 证据：
  `ai_workspace/validation/craftstation_execution_path_v0.1.4.json`。
- 证据包含 recipe、craftPlan、runtime binding、thread、entity、错误 code、phase、remediation；当前没有真实 response，未宣称 round-trip PASS。

### F03 — Thread persistence 与 resume

- `Thread` contract 增加可选 `compositionProvenance`。
- SQLite `threads` 表新增 `composition_provenance` JSON 列，加入 schema v35 migration、safe drift repair、required-column 检查、row mapper、单条 upsert 与 bulk sync。
- `startThreadFromCraft` 创建 UI row 后，在启动 runtime 前显式 `dbUpsertThread`，确保 provenance 先落到 durable thread row。
- 已有 thread 打开时，`performInitialThreadLaunch` 优先从 thread persistence 读取 provenance，重建 CraftPlan/runtime binding，并调用 `resumeCraftAgent`；旧 `appState` KV 仍作为兼容回退。
- 新增真实 SQLite close/reopen round-trip 测试，以及 renderer resume seam 回归测试。

### F08 — Validation honesty

- 更新 `ai_workspace/validation/regression_checklist_v0.1.2.md`：
  - 只记录本轮实际执行的命令；
  - 区分 diagnostic PASS 与真实 response PASS；
  - 移除未执行命令的 PASS 宣称；
  - 记录 full lint/test 未运行及一个与本 Fix Cycle 无关的既有 supervisor shell-argv 测试失败。
- 新增 `ai_workspace/validation/provenance_resume_v0.1.4.md`。

## Verification

通过：

- `pnpm run typecheck`
- touched-file `pnpm exec oxlint --deny-warnings ...`
- touched-file `pnpm exec oxfmt --check ...`
- `pnpm exec vitest run --configLoader runner src/shared/crafting src/renderer/components/crafting src/supervisor/runtime/codexRuntimeAdapter.test.ts src/renderer/actions/threadLaunchActions.test.ts src/main/db/projectsThreads.test.ts src/main/db/migrations.test.ts` — 9 files / 70 tests
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime.test.ts -t craftAgent` — 4 tests
- `CRAFTSTATION_REAL_RUNTIME=1 pnpm exec vitest run --configLoader runner src/supervisor/runtime/craftAgent.integration.test.ts` — 1 diagnostic test
- `pnpm run build` — renderer 与 Electron bundle 完成；仅有既有 Vite/Rolldown warning
- `codegraph sync` — 20 changed files synced

未运行：

- 全量 `pnpm run lint`
- 全量 `pnpm run test`

已知非本轮失败：

- 全文件 `src/supervisor/runtime.test.ts` 当前为 37 passed / 1 failed；失败是既有 shell-argv 断言 `does not eagerly start a queued Codex turn during thread startup`，与本轮 `craftAgent` 测试和修改无关。

## Fix Self-check

- [x] 产品 Craft 路径继续调用 `craftAgent` / 生产 Adapter。
- [x] `craftAgent` 具备 supervisor 级自动化覆盖。
- [x] 真实产品路径有非 synthetic 稳定失败诊断；未伪造真实 response。
- [x] provenance 跟随 durable thread persistence，重启后可读回。
- [x] crafted thread resume 通过 `resumeCraftAgent` / Adapter，不回退为普通 `startThreadFromDraft`。
- [x] validation checklist 不把未运行命令或 synthetic 结果标为 Feature PASS。
- [x] typecheck、touched lint/format、直接回归测试与 build 通过。

## Ready for Debugger Re-review

`Requires Manager Re-plan: No`。请 Debugger 复检 F11 supervisor seam、非 synthetic `RUNTIME_UNAVAILABLE` 证据、thread persistence resume，以及 checklist 诚实性。
