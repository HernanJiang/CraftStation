# coder_0.9.1 — v0.9.1 Fix Cycle #1（F1/F2/F3）

日期：2026-09-01。基线：`4ef61356bf9d9f4490517210cfa21fbe0454632d`（v0.9.0 首轮 Feature commit）。本轮修复全部为工作区未提交修改，未 merge、未 tag、未 push。

## Verdict

`ENGINEERING FIX #1 COMPLETE / READY FOR USER ACCEPTANCE / REAL T08 STILL BLOCKED BY ENVIRONMENT`

三个 Debugger Finding 的工程修复已完成并通过定向验证；真实 provider 三段 continuation 仍被 `QUOTA_OR_LIMIT` 阻塞，不升格为 PASS。

## F1 — crafted active command execution fencing（已修复）

- Supervisor（`src/supervisor/sessionHandoff/coordinator.ts`）：`assertActiveExecution` 对 crafted Thread 改为 fail closed——缺失/畸形 envelope → `HANDOFF_ACTIVE_EXECUTION_REQUIRED`；segmentId / runtimeSessionId / bindingEpoch 漂移 → `HANDOFF_EXECUTION_STALE`。legacy non-crafted Thread 行为不变。
- 初始绑定发布（`src/supervisor/supervisorRuntime.ts`）：`registerCraftedSession` 通过既有 `session-switch-state` 通道发布首个 crafted Segment 的 active binding，并经 ledger 持久化，`readSessionSwitchState` 可重新播种；Renderer 不再存在"首 Segment 无 envelope"窗口。
- Renderer 唯一 envelope 来源（`src/renderer/state/sessionHandoffStore.ts`）：新增 `getRuntimeExecutionEnvelope(threadId)`，仅在 `phase="active"` 且 activeSegment runtime-bound 时返回，绝不自行推导 epoch。
- envelope 贯穿全部 crafted active command caller：prompt（`threadRuntimeActions.ts`）、slash command（`commands/registry.ts`）、interrupt（`ThreadComposerSection.tsx`）、steer set/clear、permission/question resolution、close/unload/delete（`threadActions.ts`）；project-delete close sweep 同步携带（保守偏差，避免删除项目时静默泄漏活跃 crafted session）。shell/terminal legacy close 保持不带 envelope。
- Pending request origin binding：`request.opened` 的 origin execution 存入 pending map；resolution 必须同时匹配当前 active binding 与请求创建时 binding，旧 Segment 的请求不能解析进新 Segment。
- Renderer `OpenRuntimeRequest` 保留 origin envelope（legacy/快照回退无 origin = unbound，不得绕过 crafted fence）。
- 已知边界（记录为后续项）：mobile/remote sync 未传播 `session-switch-state`，mobile 对 crafted Thread 的 prompt 现在明确 fail closed 而非竞态写入；`useAppHydration` 后台 close sweep 保持 unbound（错误被捕获，不静默）。

## F2 — 真实验收 false-green（已修复）

`src/supervisor/runtime/crossHarnessHandoff.integration.test.ts` 重构：

- Preflight 与 started-chain 分离：仅当官方 Runtime 尚未真正开始 turn 时，`AUTH_REQUIRED` / `QUOTA_OR_LIMIT` / `RUNTIME_UNAVAILABLE` 才允许归类 `BLOCKED BY ENVIRONMENT`；链路一旦开始，产品异常与断言失败必须使测试失败（`PRODUCT_CHAIN_FAILED`，重新抛出，不得被 catch-all 降级）。
- Codex A / Grok B / Codex C 均要求真实 completed assistant response + 明确 marker；artifact 只保存脱敏 summary `{nonEmpty, length, hash}`，不保存正文、凭据或 hidden reasoning。
- 链路断言：同 Thread、同 workspace、3 个不同 Segment、ordinal 与 bindingEpoch 严格递增、B/C 全新的 runtime/native session identity。
- `REAL_NATIVE_CHAIN_COMPLETED` 仅在全部断言成功后写入。
- 11 个 scenario 逐项记录 passed/blocked/unverified/failed：三段 continuation、queued（replace-latest / cancel / safe-boundary）、abort confirmed、abort timeout/failure、target prepare rollback、target bootstrap rollback、stale event、stale input、restart recovery；真实环境不可用时逐项如实标记，不以 mock 冒充。
- 新增 16 个确定性 false-green 回归测试（无 provider 依赖）：B/C 无 response、缺 marker、Segment 数错误、ordinal/epoch 不递增、session identity 复用、thread/workspace 漂移、启动后产品异常归类为 product failure 等。
- 真实 gated 场景行为契约不变：无 `CRAFTSTATION_REAL_CROSS_HARNESS_E2E` 时正确 skip；既有 artifact 文件保持 `BLOCKED BY ENVIRONMENT` 原样，未伪造。

## F3 — migration regression（已修复）

- `src/main/db/projectsThreads.test.ts`：schema 断言改为 `String(LATEST_SCHEMA_VERSION)`（39），并断言 `runtime_segments` / `runtime_segment_event_archive` / `conversation_checkpoints` / `session_switch_transactions` 四表与 `idx_runtime_segments_one_active` partial unique index 存在；legacy project 数据保留断言不变。
- `src/main/db/migrations.test.ts`：新增 v32→39 真实升级路径测试（v32 baseline → 迁移 → 新表/索引/新列/schema version 断言），并内置 Node-ABI better-sqlite3 binding 回退。

## 验证记录

- 合并定向套件（F1+F2+F3 全部涉及文件）：15 files / **408 passed** / 1 skipped（唯一 skip 为 gated 真实场景）。
- `src/supervisor/runtime.test.ts` 全量：72/72 passed（含 3 个新 fencing 测试）。
- `pnpm typecheck`：PASS（0 errors）。此前 6 个集成测试类型错误已修复（`ChainSegmentIdentity` 可选字段显式 `| undefined` 适配 `exactOptionalPropertyTypes`；`chainSegment` 测试助手显式构造对象）。
- `pnpm run build:renderer`、`pnpm run build:electron`：PASS。
- 触及文件 `oxfmt --check`、`oxlint --deny-warnings`：clean。`git diff --check`：PASS。
- 完整 `pnpm test`：进行中/已完成见 `PROJECT_STATUS.md` 当日记录；失败项均为既有 rename-migration/环境失败，无 v0.9 Feature 回归。

## 环境保护与既有阻塞（非本轮范围）

- 本 worktree 处于 Poracode→CraftStation 全局改名迁移中途（1000+ dirty 文件）。为恢复可构建/可运行，仅补齐了改名迁移缺失的模块文件（全部为新增副本或半途损坏的最小修复，其余现场保留未动）：
  - `src/shared/craftstationPaths.ts` + `.test.ts`：自根仓库完成态镜像（根仓库为未跟踪新文件，worktree 不继承）。
  - `src/main/craftstationData.ts`：本 worktree `poracodeData.ts` 的改名副本（保持本分支 2 参签名；根仓库同名文件是 1 参精简版，不适用于本分支调用方）。
  - `src/main/attachments/localFiles.ts:81`：改名机械替换把原本两个不同 scheme（`poracode-local` / `lightcode-local`）都替换成 `craftstation-local`，Electron 拒绝重复注册导致主进程启动即崩。已改为单一 `["craftstation-local"]`（两个旧 scheme 在全仓产品代码中已无任何残留引用）。**注意：根仓库 `main` 工作区同一行存在相同重复，root 下次启动会以同样方式失败，需镜像修复。**
  - `src/supervisor/agents/opencode/plugin/craftstation-status.mjs` 与 `src/supervisor/agents/plugin/forward-runtime/craftstation-hook-runtime.mjs`：代码/打包脚本已指向新名，磁盘文件仍为旧名，按根仓库完成态补齐改名副本。
  - `.agents/skills/interactive-testing/scripts/` 下 8 个 `craftstation-*.mjs`：脚本内部 import 已指向新名但文件未改名，按内容原样复制出新名文件（旧 `poracode-*.mjs` 保留未删）。
  - `src/supervisor/runtime/openCodeNative/transport.ts`：`@opencode-ai/sdk@1.18.10` 的 `./v2/client` 导出仅含 `import` 条件，CJS supervisor bundle 中的静态 require 在启动时即崩（`ERR_PACKAGE_PATH_NOT_EXPORTED`）。改为通过变量模块 ID 的原生动态 `import()` 懒加载（CJS 产物保留原生 import，运行时走 ESM 条件解析），`createClient` 转异步、测试注入的 `clientFactory` 快路径不变。这是一个自 v0.8 起 OpenCode 生产路径从未在 CJS supervisor 中真实运行过的潜在缺陷，本轮首次暴露并修复。
- 既有失败（与本 Feature 无关，记录不修）：`ThreadView` todo dock 相关、`remote/client` 环境端点回退、`debugCdpScripts`、plugin install 组、`poracodeData.migrate` 语义组等——均为改名迁移半途损坏或环境依赖，待独立改名迁移工作流收口。
- 真实 T08 的 `QUOTA_OR_LIMIT` 阻塞未解除；额度恢复前 T08 保持 blocked。

## 验收候选（已启动）

- 2026-09-01 通过 managed launcher 以 `--mode real`（真实 HOME、隔离 `CRAFTSTATION_BASE_DIR`）启动成功：`C:\Users\Haona\.craftstation-smoke\debug-1788274750239-56052\session.json`；App URL `http://127.0.0.1:9246`；日志无 supervisor 崩溃、无协议注册错误。真实 provider 操作由用户执行。

## 下一步

1. 用户亲自验收工程候选（同线程切换 UI、fencing 行为、Segment marker 展示）。
2. 真实 provider 三段 continuation（Codex A → Grok B → Codex C）在额度恢复后由用户执行或明确授权后执行，以 artifact verdict 为准。
3. 原配对 Debugger 在同一 worktree 复检 F1–F3 关闭情况；PASS 后按流程完成候选收口。在此之前不 merge main、不 tag、不 push。
