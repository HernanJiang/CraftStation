# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.2（F41~F46）
> 角色：Debugger
> 日期：2026-08-30
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
> 分支：`feature/v0.7-native-harnesses`
> HEAD：`7ae6506`
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL / BLOCKED**

本轮确认 Fix Cycle 已修复多处源码接线和测试覆盖，但 Feature-level acceptance 仍不能 PASS：

1. F41 的官方 DeepSeek Harness / DSH 源码与协议路线是真实存在的，但当前本机可安装的官方 npm 包仍没有 `sdk` profile，产品解析到 Windows npm shim 后也不能直接由 Node `spawn()` 启动，故真实 Windows carrier 仍不可用，必须保持 `RUNTIME_UNAVAILABLE`。
2. F44 虽然避免了 Windows interrupt 后再次向已死亡进程写 stdin，但 interrupt 路径没有发出 canonical `turn.completed` 和 `session.exited`，Supervisor 也不会自动释放 session；这会使 renderer turn 状态和 crafted-session map 可能残留。
3. F40 的 focused `oxfmt --check` 仍失败于 `nativeHarnessLifecycleAcceptance.test.ts`。
4. 全仓测试本轮为 `855 passed / 6 failed / 10 skipped` files、`9615 passed / 16 failed / 48 skipped` tests；失败集中在既有 remote procedure 分类、CraftStation migration、channel/path 基线，不把它们错误归因给 F41~F46，但全仓也不是绿态。
5. 真实 Antigravity 证据证明了官方 `agy 1.1.22` 的 CraftStation 单轮 product path 和事件转发，不足以证明完整桌面点击、取消、resume、多轮、工具、permission、MCP、Skills、subagents、context 或 compaction。

未修改产品源码、正式测试或状态文档；未创建/移动/切换 worktree；未 commit、push、tag、merge main 或执行 dev→main promotion。

## Review Scope

本复检只针对现有 v0.7 worktree，独立读取并核对：

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.1.md`
- `ai_workspace/agent_docs/coder_0.7.2.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- F41~F46 对应源码、测试、artifact、UI/IPC seam 与失败基线

验收原则：不以 Coder 自检、单轮 marker、fixture、mock spawn、测试数量或提交状态替代真实 Feature-level evidence；不把未实测高级 capability 升格为 `supported+integrated`；不使用 CLIProxyAPI、普通 API fallback、synthetic Entity/Session 或 TUI/PTY 伪造产品成功。

## Independent Evidence

### 1. Git/worktree boundary

- 当前工作树确认：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 当前分支：`feature/v0.7-native-harnesses`
- 当前 HEAD：`7ae6506`
- 工作树存在大量 Feature 既有未提交修改；本轮只写本文件以及要求的外部测试报告，不清理或覆盖其他修改。

### 2. Antigravity real product path

Artifact：`ai_workspace/validation/v0.7.0-antigravity-product-path.json`

- `synthetic: false`
- `version: 1.1.22`
- 官方可执行文件：`C:\Users\Haona\AppData\Local\agy\bin\agy.exe`
- 路径：`SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe --input-format stream-json --output-format stream-json -> Entity -> Session`
- marker：`CRAFTSTATION_AGY_PRODUCT_PATH_OK`
- native events：`init`、`step_update`、`result`
- canonical/IPC events：`turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`
- cleanup：`SupervisorRuntime.closeThread`，且观察到 `session.exited`

该证据关闭了“官方 agy stream-json 是否能够穿过 CraftStation Supervisor、Entity/Session 和 runtime event forwarding”的窄门；没有关闭 UI 实际点击、interrupt/取消、resume、多轮和官方 agent loop 高级能力门。

### 3. DeepSeek / DSH current Windows verification

本轮对官方仓库和本机 carrier 做了独立复核：

- `git ls-remote https://github.com/deepseek-ai/deepseek-harness.git HEAD` 返回官方 master：`cd5ef8148158c3a752a658978873241fdf8e2bbc`。
- 官方仓库确实是 DeepSeek Harness，并已存在 SDK JSON-RPC runtime 方向；协议边界与实现使用的 `initialize`、`session/prompt`、`shutdown`、`session.event`、`session.status` 相符。
- `npm view @deepseek-ai/dsh dist-tags version --json` 当前返回：`latest=0.1.1-rc.2`、`next=0.1.1-rc.2`、`version=0.1.1-rc.2`。
- 本机 `dsh --version` 返回 `0.1.1-rc.2`。
- 本机真实执行 `dsh --profile sdk --help` 失败：`dsh: profile "sdk" does not exist`。
- 产品实现位于 `src/supervisor/runtime/nativeHarness/nativeAdapter.ts` / `nativeTransport.ts` / `index.ts`，通过 `resolveExecutablePath("dsh") ?? resolveExecutablePath("dsh-jsonrpc-agent")` 找到命令，并直接交给 `child_process.spawn()`。
- Windows shim 的独立实测结果：直接 spawn `dsh.cmd` 为 `spawn EINVAL`；直接 spawn `dsh.ps1` 为 `spawn EFTYPE`；无扩展名 `dsh` 为 `ENOENT`。只有 `node.exe + @deepseek-ai/dsh/lib/bin.js --version` 可成功运行，但产品当前没有这一 carrier 解析/启动闭环。
- `nativeAdapter.test.ts` 的 `spawnProcess` 是 mock，证明参数和事件转换，不证明真实 npm shim 可启动。
- 当前 GitHub pre-release 没有可直接下载的 Windows release asset；PyPI 已见版本也没有在本机形成可安装的官方 `0.1.2-alpha.1` Windows carrier。

结论：GitHub 仓库是真的，官方 Harness 也不是“假的”；但“仓库开源”不等于“当前 Windows 产品 carrier 已安装且可被 CraftStation 可靠启动”。因此 F41 真实运行门仍是 **FAIL / BLOCKED**，必须继续返回 `RUNTIME_UNAVAILABLE`，禁止 synthetic lifecycle、CLIProxyAPI 或普通 API 代替。

### 4. Independent checks

- 定向 native/UI/IPC 测试：**11 files / 130 tests passed**。
- focused `oxlint --deny-warnings`：**PASS**。
- `pnpm run typecheck`：**PASS**。
- `git diff --check`：**PASS**。
- focused `oxfmt --check`：**FAIL**，文件：`src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts`。
- full `pnpm run lint`：**FAIL**，已知基线失败：`src/renderer/remoteProcedureRouter.test.ts:478` 的 `startCodexProfileLogin` / `startGrokProfileLogin` 未分类；本轮既有 full-test 也再次显示该失败及其他 CraftStation/channel/path 基线失败。
- full `pnpm run test -- --reporter=dot`：**FAIL**，`6 failed | 855 passed | 10 skipped` files；`16 failed | 9615 passed | 48 skipped` tests。失败归属见下文。

## F41~F46 Status Matrix

| Fix                                                    | 独立复核结果                                                                                                                                                                   | 结论                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| F41 DSH 官方 `dsh` / SDK JSON-RPC carrier              | 源码参数、协议和 mock fixture 对齐；真实 npm 包 `0.1.1-rc.2` 没有 `sdk` profile，Windows shim 不能直接 spawn                                                                   | **FAIL / BLOCKED**                     |
| F42 HarnessPanel CraftingGrid → `startThreadFromCraft` | 生产 `HarnessPanel.tsx` 传入 `workspace={workspacePath}`、`onCraft={handleCraft}`；`handleCraft` 调用 `startThreadFromCraft(currentProject, result, prompt)`；定向测试通过     | **源码/测试 PASS；真实桌面 UX 未闭环** |
| F43 interrupt IPC → crafted session                    | `ipcHandlers.ts` 调用 `runtime.interruptThread(payload)`；`SupervisorRuntime` 优先查 `craftedSessionsByThread` 并调用 `craftedSession.interrupt()`；定向单测通过               | **PASS（路由窄门）**                   |
| F44 Windows interrupt lifecycle                        | `child.kill()` 后将状态改为 `terminated`，阻止后续向死 stdin 写入；但没有 canonical `turn.completed` / `session.exited`，Supervisor 不会因 interrupt 自动 release              | **FAIL（生命周期缺口）**               |
| F45 capability honesty                                 | `descriptors.ts` 将 wiring 证明的 capability 统一保持 `implementation missing`；未实测高级能力未被写成 integrated                                                              | **PASS（诚实性窄门）**                 |
| F46 nativeEnvelope redaction                           | `CONTENT_KEY` 覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta`、`query` 等正文键；嵌套凭据/正文测试通过；DSH nested `session.event` params 可派发 `turn.completed` | **PASS（脱敏/解析窄门）**              |

## Findings

### [P0] F41：真实 Windows DSH carrier 未闭环

当前代码能构造 `--profile sdk`，但安装的官方 npm 包没有该 profile；即使将 shim 解析出来，Windows `child_process.spawn()` 也不能直接执行 `.cmd` / `.ps1`。这不是仓库真实性问题，而是“官方仓库/包存在”到“CraftStation 可实际启动并建立 JSON-RPC session”的 machine-facing carrier 缺口。

**影响：** DeepSeek 不能宣称 native integrated；当前正确产品行为是 `RUNTIME_UNAVAILABLE`。

**要求：** 重新基于官方仓库当前可交付版本确认 Windows carrier，或实现明确、可审计的 Windows launcher（例如在不改变官方协议和不绕过 carrier ownership 的前提下使用官方 npm entrypoint），并以真实 `initialize -> session/prompt -> session.event -> shutdown` 取得非 synthetic 证据；不能靠 fixture、普通模型 API、CLIProxyAPI、伪造 Entity/Session 关闭此项。

### [P1] F44：interrupt 没有完成 canonical turn/session 收口

`NativeProcessCraftSession.interrupt()` 调用 transport interrupt，并在 Windows 把状态设为 `terminated`，随后只通过内部 `finishTurn("interrupted")` resolve turn。`finishTurn` 不 emit `turn.completed`，transport/child exit 也未必再产生 `session.exited`。Supervisor 的 `registerCraftedSession` 只在观察到 `session.exited` 时 `releaseCraftedSession(threadId)`。

**影响：** renderer 依赖的 turn-open gate 可能保持打开，`craftedSessionsByThread` 可能残留；下一次路由和资源清理依赖显式 `closeThread`，与完整 interrupt lifecycle 不一致。

**要求：** 为 interrupt 定义一次且仅一次的 canonical completion/exit 语义，覆盖 Windows killed-child 和非 Windows interrupt；确保 Supervisor map、renderer runtime state、Promise settle 和 process disposal 一致收口，并增加真实/可证明的 regression evidence。

### [P1] F40：指定文件格式门未关闭

Coder 文档声称 12 个触及文件 `oxfmt --check` 通过，但独立 focused check 明确失败于：

`src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts`

在 format gate 未闭合时，不能把 Fix Cycle 的静态验收写成全通过。

### [P2] F42：真实桌面点击和错误显示未独立验收

F42 的组件 seam 和定向测试证明回调 wiring，但没有本轮真实 Electron/桌面操作证据。应在 carrier 可用的环境中验证 CraftingGrid 点击、workspace 传递、startThreadFromCraft、Supervisor 事件到 renderer、失败诊断及关闭行为；组件 mock 不能代替 product UI acceptance。

### [P2] 全仓既有基线失败需单独归属

本轮 full test 的 16 个失败不是 F41~F46 的直接失败，但必须作为发布基线记录：

- `src/renderer/remoteProcedureRouter.test.ts`：`startCodexProfileLogin`、`startGrokProfileLogin` 未被分类。
- `src/main/craftstationData.migrate.test.ts`：迁移目录/marker/backup/锁定与恢复场景失败。
- `src/shared/channel.config-parity.test.ts`、`src/shared/channel.test.ts`、`src/shared/craftstationPaths.test.ts`、`src/supervisor/agents/probeCwd.test.ts`：`.craftstation` 与 `.craftstation` 命名基线不一致。

这些基线失败不应被错误算给 F41~F46，也不能在报告中被隐藏成“全仓绿”。

## Remaining

- 官方 DSH Windows carrier 的可安装、可发现、可启动和真实 JSON-RPC 生命周期证据。
- F44 interrupt 的 canonical event、Supervisor release、renderer 收口和进程生命周期回归。
- `nativeHarnessLifecycleAcceptance.test.ts` 的格式修正并重新执行 focused format gate。
- 在真实桌面环境完成 F42 product UX 验收。
- 对 Antigravity 的 resume、多轮、工具/permission/MCP/Skills/subagents/context/compaction 逐项取得 provider-native evidence 后，才可改变 capability state；单轮 marker 不足。
- 对 DSH 同样不得从官方协议存在或 fixture 直接推导高级 capability 已集成。

## Fix Plan / Next Step

1. Coder 先处理 F41 carrier 方案：锁定官方仓库/包版本、Windows launcher 入口和 stderr/stdout 约束；完成真实 DSH JSON-RPC 生命周期证据，否则保留 `RUNTIME_UNAVAILABLE`。
2. Coder 修复 F44 的 interrupt 收口：定义 canonical `turn.completed(state=interrupted)` 与 `session.exited` 的唯一性、释放 crafted map，并覆盖 renderer runtime reducer。
3. Coder 修复 `oxfmt` 失败文件，重新跑 touched format/lint/typecheck/diff。
4. 在有真实 carrier 的机器上运行 Antigravity/DSH product-path 和桌面点击验收；报告必须区分 narrow provider pass 与 Feature PASS。
5. 修复或明确隔离上述全仓 baseline failures 后再做 Feature-level re-review。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**Yes**（F41 需要重新规划官方 Windows carrier 交付边界；F44 需要重新规划 interrupt lifecycle contract）。
- Requires Ideate Revision：**No**（当前产品方向仍合理；问题是 carrier 可执行性和生命周期实现/证据闭环，不是需要重做产品概念）。

## Final Decision

**Do not promote. Do not merge to nested Dev.**

本 Feature 当前为 **FAIL / BLOCKED**。Antigravity 已有真实、非 synthetic 的单轮 product-path 证据；F42/F43/F45/F46 的窄 seam 通过；但 F41、F44、F40 以及未完成的真实桌面验收阻止 Feature PASS。Fix Cycle 后必须重新交接同一 Feature 的 Debugger 复检，不能用 v0.6 Debugger、Coder 自检或 GitHub 仓库存在本身替代验收。
