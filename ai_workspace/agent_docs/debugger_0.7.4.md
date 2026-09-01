# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.4
> 角色：Debugger
> 日期：2026-08-30
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
> 分支：`feature/v0.7-native-harnesses`
> HEAD：`7ae6506`
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（F40/F42/F43/F44/F45/F46 已关闭；F41 因官方 carrier 实时证据重新打开）**

v0.7.4 已可复现地关闭上一轮全部明确修复项：21 个触及 TS/TSX 文件格式和 lint 全绿，F42 生产 callback / i18n / React Compiler 规范成立，F43/F44 interrupt 事件唯一性、Supervisor forwarding、自动 release 与 adapter session retention 均有直接回归，F45 capability 表述保持保守，F46 正文脱敏和 DSH nested event 展开成立。

但是 Feature 仍不能 PASS。独立实时审计发现官方 DeepSeek Harness 分发事实已经超出 Coder v0.7.4 的前提：

1. 官方 npm 包 `@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5` 真实存在，明确暴露 `dsh-jsonrpc-agent` bin；本轮已成功安装到用户级 npm PATH。
2. 该官方 bin 不是带内置 profile 的完整 runtime；它要求 `DSH_CORDIS_CONFIG` 或位置参数指向一个真实、完整、含 JSON-RPC serving plugin 的 `cordis.yml`，否则打印 usage 并以 1 退出。
3. 当前生产 factory 只要发现命令存在就构造 `NativeProcessHarnessRuntimeAdapter`。默认 DeepSeek Recipe 不提供 `configPath`，所以安装 carrier 后会进入 false-ready 路径，实际 command 仍立即 usage exit。
4. Windows resolver 返回 npm `.cmd` shim；`nativeTransport.ts` 直接 `child_process.spawn(command, args, { shell: false })`，没有复用仓库已有的 npm shim → `node + bin.js` 解析。独立 spawn `dsh-jsonrpc-agent.cmd` 得到 `ENOENT`。现有 fixture mock 没覆盖真实 Windows shim。
5. 官方 `v0.1.2-alpha.1` source/release 已包含 Python SDK、`sdk` / `sdk-minimal` profile、Windows x64 runtime 设计；但本轮公开 npm 没有 `@deepseek-ai/dsh@0.1.2-alpha.1`，PyPI 的 `deepseek-harness-sdk==0.1.1rc1` 又因精确依赖的 `deepseek-harness-runtime-bin==0.1.1rc1` 不可取得而安装失败。本机 npm `dsh@0.1.1-rc.2` 仍没有 `sdk` 或 `sdk-minimal` profile。

因此不能继续写“官方 Windows carrier 不存在”，也不能因 bin 名存在就写 ready。当前正确 verdict 是：**官方可编程边界真实存在，但 CraftStation v0.7.4 尚未适配一个可实际启动的完整 Windows product carrier；必须 fail-closed，且 readiness 不能只做 PATH existence check。**

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge main、merge nested Dev 或执行 dev→main promotion。

## Review Scope

独立读取并复核：

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.3.md`
- `ai_workspace/agent_docs/coder_0.7.4.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- F40~F46 对应 factory、adapter、transport、canonicalizer、Supervisor、IPC、renderer UI/action 与测试 seam
- 官方 GitHub `deepseek-ai/deepseek-harness` 当前 `master` / release / npm / PyPI 分发事实

验收原则：GitHub 仓库存在、npm 包存在、单个 bin marker、fixture、mock spawn、单轮 Antigravity marker、Coder 自检和 test count 均不能独立替代 Feature product acceptance；不允许普通 API、CLIProxyAPI、APIProxy、synthetic Entity/Session 或 TUI/PTY 注入冒充官方 Harness runtime。

## Evidence

### 1. Worktree / Git boundary

- 当前路径是指定 v0.7 worktree，分支 `feature/v0.7-native-harnesses`，HEAD `7ae6506`。
- 工作树有大量 Coder/Feature 既有未提交修改，均予以保护。
- CodeGraph status 明确提示索引属于 main 工作树；本轮未把它当作 v0.7 结构证据，改用直接源码、diff、测试和真实命令。

### 2. F40 — 21 个触及文件静态门

显式传入 Coder v0.7.4 列出的全部 21 个 TS/TSX 文件：

| 检查                                                   | 结果                                             |
| ------------------------------------------------------ | ------------------------------------------------ |
| `pnpm exec oxfmt --check <21 explicit files>`          | PASS，`All matched files use the correct format` |
| `pnpm exec oxlint --deny-warnings <21 explicit files>` | PASS                                             |
| `pnpm run typecheck`                                   | PASS                                             |
| `git diff --check`                                     | PASS                                             |

**F40：PASS。**

### 3. Focused / full regression

Focused suite：

```text
Test Files  8 passed | 1 skipped (9)
Tests       119 passed | 1 skipped (120)
```

跳过项是未设置真实 Antigravity 开关的 product-path integration test。本轮没有覆写既有 validation artifact，因此不能冒充本轮重新运行了真实 product path。

全仓结果：

```text
pnpm run lint
FAIL: src/supervisor/agents/codex/codexRouterOverlay.test.ts:52
      vitest(no-conditional-expect)

pnpm run test
Test Files  6 failed | 855 passed | 10 skipped (871)
Tests       16 failed | 9615 passed | 48 skipped (9679)
```

全仓测试失败归属为：

- `remoteProcedureRouter.test.ts`：2 个 profile login procedures 未分类；
- `poracodeData.migrate.test.ts`：迁移、marker、backup、lock、rollback 基线；
- `channel.config-parity.test.ts`、`channel.test.ts`、`poracodePaths.test.ts`、`probeCwd.test.ts`：`.poracode` / `.craftstation` 品牌路径基线不一致。

这些失败没有命中 F40~F46 触及模块，但全仓不能写成 PASS。

### 4. F42 — production UI/action seam

当前生产 `HarnessPanel.tsx`：

```tsx
<CraftingGrid workspace={workspacePath} onCraft={handleCraft} />
```

`handleCraft` 调用 `startThreadFromCraft(currentProject, result, prompt)`；无项目错误已经使用 `t(msg`...`)` 包裹，上一轮新增的无必要 `useCallback` / `useMemo` 已移除。action 会创建并持久化 thread/provenance，并把 `craftPlan`、`projectLocation`、prompt 交给 `bridge.craftAgent`。对应组件/action 回归通过。

**F42：实现与组件 seam PASS。** 因 Feature 已被 F41 阻断，本轮没有进入 Debugger PASS closeout 的真实 Electron 自主 UI smoke；不能把组件测试写成最终桌面 product acceptance。

### 5. F43 / F44 — interrupt lifecycle and retention

源码与直接回归共同证明：

- `ipcHandlers.ts` → `runtime.interruptThread(payload)`；
- `SupervisorRuntime.interruptThread()` 优先路由 `craftedSessionsByThread`；
- Windows interrupt 后 session 进入 `terminated`，不再向已死亡 stdin 写入；
- `turn.completed(state: "interrupted")` 恰好一次；
- `session.exited(reason: "interrupted")` 恰好一次；
- Supervisor runtime event forwarding 收到上述 canonical events；
- `session.exited` 自动触发 `releaseCraftedSession(threadId)`；
- adapter `getActiveSessions()` 从 1 变 0。

**F43：PASS。F44：contract regression PASS。** 边界是 fixture/mock process regression，不是一个真实 provider 进程的 Windows interrupt E2E。

### 6. F45 / F46

- Antigravity / DeepSeek 的 tool、permission、MCP、Skills、subagents、resume/multi-turn、context、compaction 等未实测高级能力保持 `implementation missing`，没有升格为 `supported + integrated`。
- `CONTENT_KEY` 覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta`、`query` 等正文键；正文进入 `{ redacted: true, ... }`，credential 键进入 `[REDACTED]`。
- DSH nested `session.event` 的 `params.event` / `params.sessionId` / `event.data` 展开测试通过。

**F45：PASS。F46：PASS。**

### 7. Antigravity product-path artifact

既有 artifact `ai_workspace/validation/v0.7.0-antigravity-product-path.json` 已复核：

- `synthetic: false`
- `agy.exe 1.1.22`
- response `CRAFTSTATION_AGY_PRODUCT_PATH_OK`
- `turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`
- `SupervisorRuntime.closeThread`
- Supervisor runtime event forwarding

这是既有非 synthetic 单轮 + close artifact，不是本轮新运行；不证明 UI 点击、interrupt、resume/multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

### 8. F41 — 官方 DeepSeek carrier 实时审计

#### 官方 source / release

- GitHub：`https://github.com/deepseek-ai/deepseek-harness`
- 当前 HEAD：`cd5ef8148158c3a752a658978873241fdf8e2bbc`
- release：`dsh-v0.1.2-alpha.1`（2026-08-27）
- release note 明确写有 Python SDK Windows x64 runtime。
- source 中存在 `packages/sdk/client`、`packages/sdk/protocol`、`packages/sdk/server`、`python/sdk`、`python/sdk-runtime`、`sdk` / `sdk-minimal` profiles 与 Windows x64 platform manifest。

#### 公开分发 / 本机安装

- 本机 npm `@deepseek-ai/dsh@0.1.1-rc.2`，`dsh --profile sdk` 与 `sdk-minimal` 均报 profile 不存在。
- npm `@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5` 真实公开，bin：`dsh-jsonrpc-agent`。
- 本轮执行：

```text
npm install --global @deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5
added 20 packages
```

- `dsh-jsonrpc-agent --help` 实际打印：

```text
usage: dsh-jsonrpc-agent <path/to/cordis.yml> (or set DSH_CORDIS_CONFIG=<path>, which wins); the config is required — there is no built-in fallback
```

- 官方包 README 同样声明：不存在内置/default config；外部配置还必须自己组合完整 plugin tree，甚至“有效但不含 JSON-RPC server”的配置也会启动却不提供服务。
- Python SDK `0.1.1rc1` 可见，但安装失败，因为精确依赖 `deepseek-harness-runtime-bin==0.1.1rc1` 在当前索引无匹配 wheel；`0.1.2-alpha.1` npm/SDK artifacts 也未从当前 registry 取得。

#### CraftStation 当前 false-ready

生产 factory：

```ts
const executable = resolveExecutablePath("dsh-jsonrpc-agent");
if (!executable) return UnavailableNativeHarnessRuntimeAdapter;
return new NativeProcessHarnessRuntimeAdapter(...);
```

安装官方 npm bin 后，existence check 成功。但默认 DeepSeek Recipe 不提供 `configPath`：

- `nativeAdapter.ts` 对非 `dsh` 命令只在 `options.configPath` 存在时追加位置参数/`DSH_CORDIS_CONFIG`；默认没有，所以真实 bin立即 usage exit。
- Windows `where.exe` 返回 npm `.cmd`；native transport 直接 `spawn(..., shell:false)`。独立真实 spawn 结果：

```text
SPAWN_ERROR ENOENT
CLOSE -4058
```

- 现有 `nativeAdapter.test.ts` 使用 `spawnProcess` fixture，因此不能捕捉真实 Windows shim 或缺失 config 的失败。

**F41：FAIL。** 正确表述不再是“官方 carrier 不存在”，而是“官方 carrier 与 SDK source/分发存在，但 v0.7.4 production factory 尚未验证完整、可启动的 Windows distribution contract；当前安装会形成 false-ready / start failure”。

## F40~F46 Status Matrix

| Fix                                     | 独立复核结果                                                                                            | 状态                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| F40 static gate                         | 21 文件 format/lint、typecheck、diff check 全绿                                                         | **PASS**                                 |
| F41 DeepSeek official carrier           | 官方 bin 已安装；production detection 只看 PATH，缺 Cordis config + Windows shim handling，不能实际启动 | **FAIL**                                 |
| F42 HarnessPanel → startThreadFromCraft | 生产 callback/workspace/action、i18n、React Compiler 规范和回归成立                                     | **PASS（real desktop smoke remaining）** |
| F43 interrupt IPC route                 | crafted session 优先路由与 forwarding 回归成立                                                          | **PASS**                                 |
| F44 Windows interrupt lifecycle         | completion/exit 各一次、terminated、Supervisor/adapter release 直接断言成立                             | **PASS（real provider E2E remaining）**  |
| F45 capability honesty                  | 未实测能力保持 implementation missing                                                                   | **PASS**                                 |
| F46 redaction / DSH canonicalizer       | 正文脱敏与 nested event 展开成立                                                                        | **PASS**                                 |

## Findings

### [P1] F41：官方 `dsh-jsonrpc-agent` 安装后被误判为可运行，但默认产品路径没有它必需的完整 config

**Evidence**

- 官方 npm package / bin 已安装成功。
- 官方 CLI 和 README 明确要求 `DSH_CORDIS_CONFIG` 或位置 `cordis.yml`，无内置 fallback。
- production factory 只检查 executable existence。
- 默认 DeepSeek Recipe 不携带 `configPath`。

**Impact**

安装官方 carrier 后，DeepSeek 不再走诚实 `UnavailableNativeHarnessRuntimeAdapter`，而进入 NativeProcess path 后立即退出。这个状态既不是可运行集成，也不是准确 readiness。

**Root Cause**

T01 分发事实冻结过窄，把特定 bin 名是否存在等同于完整 SDK runtime 可启动；factory 没验证 carrier variant、配置来源和协议 serving capability。

**Fix**

选择并固定一个官方、可分发且完整的 product carrier contract：

1. 若支持 `dsh-jsonrpc-agent` demo bin：只有在受控、可验证的完整 Cordis config 存在且包含 SDK JSON-RPC server composition 时才允许 ready；否则返回 `RUNTIME_NOT_CONFIGURED` / `RUNTIME_UNAVAILABLE`，不得仅因 PATH 命中就构造 ready adapter。
2. 若支持官方 `dsh --profile sdk` / `sdk-minimal`：必须显式 `DSH_HOME`，探测 profile 真实存在，并按当前官方 protocol 启动；本机旧 npm profile 缺失时继续 fail-closed。
3. 若支持 Python bundled Windows x64 runtime：只在官方 wheel/exe 实际可取得、provenance/version 可核对并完成真实 JSON-RPC handshake 后启用。
4. 不使用普通 API、CLIProxyAPI、legacy APIProxy、synthetic lifecycle 或自创 agent loop。

### [P1] F41：Windows npm shim 未经过 native transport 的安全可执行归一化

**Evidence**

- resolver 返回 `dsh-jsonrpc-agent.cmd`。
- `NativeNdjsonProcessTransport.start()` 直接 `spawn(command, args, shell:false)`。
- 真实 Node spawn `.cmd` 返回 `ENOENT`。
- 仓库其他 base runtime 已有 npm cmd shim → Node entry 的解析逻辑，但 native transport 未复用。

**Impact**

即使用户提供有效 config，Windows npm carrier 仍可能在协议初始化前失败；fixture mock 会假绿。

**Fix**

在统一进程启动 seam 中复用/抽取安全的 Windows Node npm shim resolution，保持 `shell:false`，绝不能用 shell 字符串拼接。增加真实 npm-shim-shaped child-process regression，且至少做一次本机 carrier handshake integration。

### [P2] F41 readiness / tests 没覆盖“bin 已安装但不完整/不可启动”状态

当前 acceptance 只构造一个手写 `UnavailableNativeHarnessRuntimeAdapter`，没有走 production factory；因此不会发现 executable 已安装后 factory 的 false-ready。需要 production factory test 覆盖：absent、installed-but-no-config/profile、protocol mismatch、auth missing、ready。

## Remaining

- 适配并验证一个完整官方 DeepSeek Windows product carrier，而不只是安装 bin 名。
- 在 production factory 中对 installed-but-unconfigured / wrong-version / missing-profile / invalid-config fail-closed。
- 真实完成 `initialize -> session/prompt -> session.event/status -> shutdown -> process exit`；缺凭据时至少必须完成可归因的 auth failure，而不是 usage/spawn failure。
- 修复 Windows npm shim safe spawn 并增加真实边界回归。
- Feature 解除 F41 后，在真实 Electron 窗口执行 CraftingGrid → thread → `craftAgent` → runtime events → interrupt/close 的最短 UI smoke。
- Antigravity / DeepSeek 的 tool、permission、MCP、Skills、subagents、resume/multi-turn、context、compaction 仍不得升格，直到各自有 provider-native evidence。
- 全仓既有 lint/test 基线另行归属处理；不能在本 Fix Cycle 擅改无关文件。

## Fix Plan

1. **重新冻结官方 DSH distribution contract**：记录 package/version/bin/profile/config/home/protocol 与 Windows launch shape，区分 npm demo carrier、`dsh` profile carrier、Python bundled runtime。
2. **修正 readiness/factory**：只有完整可启动条件满足时构造 NativeProcess adapter；存在 bin 但缺配置/profile 时给准确 unavailable/not-configured diagnostic。
3. **修正 Windows spawn**：安全解析 npm `.cmd` shim 为 `node + bin entry`（或使用真实官方 `.exe`），保持 `shell:false`。
4. **补 production-boundary tests**：从真实 factory 走 absent / installed-incomplete / ready；fixture 不能替代真实本机 carrier probe。
5. **完成真实 DSH protocol smoke**：至少 initialize、prompt admission/event、shutdown、process exit；若凭据缺失，固定为准确 `AUTH_REQUIRED`，不得 synthetic fallback。
6. 复跑 21 文件 format/lint、focused tests、typecheck、diff check，并记录全仓基线归属。
7. 交接同一 v0.7 专属 Debugger 再次复检。

## Fix Acceptance Criteria

- 安装 `@deepseek-ai/dsh-sdk-jsonrpc-demo` 但未提供完整 config 时，production factory 不得 false-ready；必须返回准确 fail-closed diagnostic，且不得创建 synthetic Entity/Session。
- 提供官方、完整 config 或验证过的官方 profile/bundled runtime 后，Windows 能安全启动，不依赖 shell 字符串或 `.cmd` 直接 spawn。
- 真实 stdout 只承载 JSON-RPC，完成 `initialize`，并观察至少一个官方 session notification；关闭时完成 `shutdown` 和进程退出。
- production factory tests 覆盖 absent、installed-but-unconfigured、protocol failure 与 ready，且至少一个 test/probe 不使用 fake child process。
- CLIProxyAPI、普通 API、legacy APIProxy 和 synthetic fallback 均未进入执行路径。
- F40、F42、F43、F44、F45、F46 现有通过项无回归。
- 未实测高级 capability 继续是 `implementation missing`。

## Fix Execution Order

1. DSH official distribution / version / carrier contract freeze。
2. Windows executable normalization。
3. factory readiness + config/profile ownership。
4. production-boundary tests。
5. real DSH smoke。
6. focused/static/full-baseline attribution。
7. 同 Feature Debugger re-review。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。Manager 原计划已明确要求 T01 现场核验官方 SDK/JSON-RPC/runtime，并要求不可用时准确诊断；本 Finding 是实现和分发事实同步问题，不改变 Feature scope。
- Requires Ideate Revision：**No**。

## User Smoke

本轮 Verdict 为 FAIL，未进入 PASS closeout，因此没有启动最终 Electron 产物或让用户执行验收。F41 关闭后，Debugger 必须先自行在真实桌面完成：选择 DeepSeek Model + DSH Harness → Craft → thread 出现 → runtime initialization/response 或准确 auth diagnostic → interrupt/close → session terminal；自主 UI smoke 通过后才能给用户最短操作说明。

## Final Decision

**Do not promote. Do not merge to nested Dev. Main promotion remains NOT AUTHORIZED.**

v0.7.4 的工程修复质量相较 v0.7.3 已明显收口，F40/F42/F43/F44/F45/F46 均通过独立复核；但 F41 的官方分发事实和当前 production factory 不匹配。官方 DeepSeek Harness、SDK、JSON-RPC carrier 都是真的，本轮也已经安装了官方 `dsh-jsonrpc-agent`。问题不是“下载不了”，而是 CraftStation 还没有按该 carrier 的完整 config/profile/Windows spawn 合同完成 product integration。修复后必须由同一 v0.7 Debugger 再验，不得用 unavailable 文案、fixture 或 GitHub 仓库存在本身替代真实产品路径。
