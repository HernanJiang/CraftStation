# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.5  
> 角色：Debugger  
> 日期：2026-08-30  
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
> 分支：`feature/v0.7-native-harnesses`  
> HEAD：`7ae6506`  
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（F40、F42、F43、F44、F45、F46 保持关闭；F41 只完成 Windows shim 与部分 fail-closed，未满足 v0.7.4 的完整 Fix Acceptance Criteria）**

v0.7.5 的两个代码方向是正确的：Windows npm `.cmd` shim 已能安全解包为 `node + JS entry + args`，且未提供 Cordis config 时会在 transport/process 创建前给出 `RUNTIME_UNAVAILABLE`。但是 Feature 仍不能 PASS：

1. production factory 测试只断言“adapter 存在、descriptor 是 deepseek”，没有验证 installed-but-unconfigured 的 fail-closed 行为；当前本机 carrier 已安装时，这个测试实际构造的是 `NativeProcessHarnessRuntimeAdapter`。
2. unconfigured 测试先调用 `spawnEntity()` 生成 `entity:deepseek:*`，再由 `createSession()` 拒绝。Supervisor 不会注册或向成功响应返回该 Entity，也没有创建 Session/transport/process；但错误 detail 会携带 `entityId`。这仍不满足上一轮明确写下的“不得创建 synthetic Entity/Session”。
3. 没有 production-boundary 的 absent / installed-unconfigured / protocol-failure / ready 覆盖，也没有真实官方 carrier 的 `initialize -> notification -> shutdown -> process exit` 证据。fixture JSON-RPC 测试不能替代该门槛。

因此，本轮不能把“官方包已安装 + shim 可启动到 usage + fixture 绿测”升级为 DeepSeek Harness 已集成。当前准确边界仍是：**官方 DSH carrier 真实存在；CraftStation 在缺完整 Cordis composition 时必须保持 `RUNTIME_UNAVAILABLE`，且完整 Windows product integration 尚未验收。**

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge main、merge nested Dev 或执行 dev→main promotion。

## Review Scope

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.4.md`
- `ai_workspace/agent_docs/coder_0.7.5.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- F40~F46 对应 factory、adapter、transport、canonicalizer、Supervisor、IPC、renderer UI/action 与 focused/full tests
- 本机官方 npm carrier：`@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5`

验收原则：GitHub/npm 包存在、单个可执行文件、usage 输出、fixture、mock child process、Coder 自检、测试数量或单轮 Antigravity artifact 均不能单独替代 Feature product acceptance；不得使用普通 API、CLIProxyAPI、legacy APIProxy、TUI/PTY 注入或 synthetic Entity/Session 冒充官方 DSH runtime。

## Evidence

### 1. Worktree / Git boundary

- 目标分支：`feature/v0.7-native-harnesses`
- HEAD：`7ae6506`
- 复检和写入均显式针对 v0.7 worktree。
- main、共享 v0.6/dev 与 v0.8 的既有修改只做边界核对，没有清理、reset、覆盖或写入。
- 本轮新增的项目内文件仅为本复检文档。

### 2. F40 — static gates

显式复跑全部 21 个触及 TS/TSX 文件：

| 检查 | 结果 |
|---|---|
| `pnpm exec oxfmt --check <21 files>` | PASS；21 files 全部格式一致 |
| `pnpm exec oxlint --deny-warnings <21 files>` | PASS；0 warning / 0 error |
| `pnpm run typecheck` | PASS |
| `git diff --check` | PASS |

**F40：PASS。**

### 3. Focused / full regression

独立 focused suite：

```text
Test Files  8 passed | 1 skipped (9)
Tests       102 passed | 1 skipped (103)
```

跳过项为未设置真实 Antigravity 开关的 `nativeProductPath.integration.test.ts`。本轮没有把既有 artifact 冒充新 product-path PASS。

全仓独立复跑：

```text
pnpm run test
Test Files  6 failed | 855 passed | 10 skipped (871)
Tests       16 failed | 9618 passed | 48 skipped (9682)
```

16 个失败归属：

- `remoteProcedureRouter.test.ts`：2 个 profile login procedures 未分类；
- `poracodeData.migrate.test.ts`：8 个迁移、marker、backup、lock、rollback 基线失败；
- `channel.config-parity.test.ts`、`channel.test.ts`、`poracodePaths.test.ts`、`probeCwd.test.ts`：`.poracode` / `.craftstation` 品牌路径基线不一致。

这些失败没有命中 v0.7 native harness 触及模块，但全仓不能写成 PASS。全仓 lint 的既有失败仍为未触及的 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52`：`vitest(no-conditional-expect)`。

### 4. F41 — Windows npm shim

源码 `nativeTransport.ts` 的 `resolveNativeSpawnTarget()`：

- Windows 下解析 npm `.cmd` shim；
- 使用 `extractWindowsCmdShimScript()` 提取 JS entry；
- 校验 entry 文件存在；
- 以 `node` 或 shim 目录内 `node.exe` 启动；
- 参数形状为 `[scriptPath, ...originalArgs]`；
- `child_process.spawn` 保持 argv 数组和 `shell: false` 语义，没有拼接 shell 字符串。

本机真实核验：

```text
dsh-jsonrpc-agent.cmd
-> node C:\Users\Haona\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh-sdk-jsonrpc-demo\lib\bin.js
-> usage: dsh-jsonrpc-agent <path/to/cordis.yml> ...
-> exit 1
```

这证明 `.cmd` 的 `ENOENT` 缺口已关闭，且参数成功到达官方 JS entry。usage/exit 1 是缺 config 的官方预期，不是 handshake PASS。

**F41 Windows shim 子项：PASS。**

### 5. F41 — unconfigured fail-closed 与 factory 边界

`nativeAdapter.ts` 在 `openSession()` 中先解析：

```text
CraftPlan.runtimeBinding.options.configPath
-> process.env.DSH_CORDIS_CONFIG
-> 均缺失时 RUNTIME_UNAVAILABLE
```

拒绝发生在 transport 和 `NativeProcessCraftSession` 构造之前，所以：

- 不启动 child process；
- 不发送 `initialize`；
- 不创建/缓存 Session；
- Supervisor 不调用 `registerCraftedSession()`；
- 不向调用方返回成功的 Entity/Session。

但是 `spawnEntity()` 已在前一步返回一个内存 `Entity`，Supervisor 将其 `entityId` 写入失败 detail；`nativeAdapter.test.ts` 的 unconfigured case 也明确先 `spawnEntity()` 再断言 `createSession()` reject。这与 v0.7.4 Fix Acceptance Criteria 的“不得创建 synthetic Entity/Session”不一致。

production factory 测试名为“honest unavailable descriptor when missing”，实际只断言：

```text
adapter is defined
adapter.descriptor.harnessKind === deepseek
```

它没有断言 adapter 类型、`RUNTIME_UNAVAILABLE`、无 Entity/Session/process、诊断内容或 active session retention。在本机已安装 `dsh-jsonrpc-agent` 时，它走的是 native adapter 分支，不是 unavailable adapter；因此 Coder 文档所称“覆盖 missing carrier / unconfigured carrier”不成立。

**F41 unconfigured/factory 子项：FAIL。**

### 6. 官方 DSH carrier 实时事实

本机当前官方分发：

```text
@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5
bin: dsh-jsonrpc-agent
```

官方包 README 与真实 CLI 一致：

- `$DSH_CORDIS_CONFIG` 优先，其次位置参数；
- 没有 working-directory 或内置 config fallback；
- 发布包根目录没有可直接使用的 `cordis.yml`；
- 即使 config 可加载，没有 `dsh-sdk-jsonrpc-server` 也会“启动但不提供服务”；
- stdout 只能承载 JSON-RPC frames；
- orderly close 由 protocol `shutdown` 与进程 disposal 共同完成。

所以 PATH 命中或 JS entry 可执行，不足以证明“完整 carrier ready”。v0.7.5 没有提供一个经验证包含 JSON-RPC serving plugin、backend/model/auth composition 的 config，也没有真实完成初始化、notification 和 shutdown。

**当前 DeepSeek product state：`RUNTIME_UNAVAILABLE`；不是 synthetic/API fallback，也不是 integrated PASS。**

### 7. F42~F46 回归边界

- **F42：PASS（implementation/component seam）**。生产 `HarnessPanel -> CraftingGrid(onCraft, workspace) -> startThreadFromCraft -> bridge.craftAgent` 路由和 i18n 仍在，focused test 通过。由于 Feature 被 F41 阻断，本轮未执行最终 Electron 自主 UI smoke，不能写成完整桌面 product acceptance。
- **F43：PASS**。IPC `interruptThread` 路由到 `SupervisorRuntime.interruptThread()`，优先命中 `craftedSessionsByThread`。
- **F44：PASS（contract regression）**。Windows interrupt 的 `turn.completed(state=interrupted)`、`session.exited(reason=interrupted)` 唯一性、Supervisor forwarding/release、adapter session retention 断言保持通过；真实 provider interrupt E2E 仍未完成。
- **F45：PASS**。Antigravity/DeepSeek 的 tool、permission、MCP、Skills、subagents、resume/multi-turn、context、compaction 等未实测能力保持 `implementation missing`，没有升格为 `supported + integrated`。
- **F46：PASS**。`CONTENT_KEY` 覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta` 等正文键，DSH nested `session.event` 展开与正文脱敏 focused regression 通过。

### 8. Antigravity artifact

既有 `ai_workspace/validation/v0.7.0-antigravity-product-path.json` 当前记录：

- `synthetic: false`
- `agy 1.1.22`
- `verdict: AUTH_REQUIRED`
- canonical / IPC 事件：`turn.started`、`error`、`turn.completed`、`session.exited`
- cleanup：`SupervisorRuntime.closeThread`
- `observedSessionExited: true`

这是 live 账号 eligibility/auth 限制下的真实产品路径及清理证据，准确而非伪造 PASS。它不证明真实 assistant response，也不证明 Electron 点击、interrupt、resume/multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

## F40~F46 Status Matrix

| Fix | 独立复核结果 | 状态 |
|---|---|---|
| F40 static gate | 21 文件 format/lint、typecheck、diff check 全绿 | **PASS** |
| F41 DeepSeek carrier | shim 已修复；缺 config 不启动进程，但先创建 Entity；factory tests 和真实 handshake 不足 | **FAIL** |
| F42 production Craft callback | 生产 callback/workspace/action、i18n 与组件回归成立 | **PASS（desktop smoke remaining）** |
| F43 interrupt routing | crafted session 优先路由成立 | **PASS** |
| F44 interrupt lifecycle/retention | canonical event 唯一性、forward/release/retention 回归成立 | **PASS（real provider E2E remaining）** |
| F45 capability honesty | 未实测能力保持 implementation missing | **PASS** |
| F46 redaction/canonicalizer | 正文脱敏与 nested event 展开成立 | **PASS** |

## Findings

### [P1] F41：installed-but-unconfigured 路径仍先创建并暴露失败用 Entity identity

**Evidence**

- `nativeAdapter.ts:458-472` 的 `spawnEntity()` 无 config/readiness gate，直接生成 `entity:deepseek:*`。
- `nativeAdapter.ts:504-518` 到 `createSession/openSession` 才检查 Cordis config。
- `supervisorRuntime.ts:1133-1135` 先保存 `entityId` 再创建 Session；失败 detail 在 `supervisorRuntime.ts:1166-1178` 携带该 ID。
- `nativeAdapter.test.ts:160-186` 直接固化了“先 Entity、后拒绝”的行为。

**Impact**

虽然没有 Session、process、缓存或成功响应，但明确的 Fix Acceptance Criteria 是“installed-unconfigured 不得创建 synthetic Entity/Session”。当前实现和测试没有满足这个边界。

**Fix**

把 DeepSeek 必要配置/readiness 验证放在 Entity 创建前的生产 seam；或者使 factory 在 carrier 已安装但缺 config 时直接返回 `UnavailableNativeHarnessRuntimeAdapter`。错误 detail 不得生成 synthetic `entityId`。

**Acceptance**

- production `craftAgent()` 在 carrier 已安装、config 缺失时返回准确 `RUNTIME_UNAVAILABLE`；
- 不调用/不完成 `spawnEntity()`，错误 detail 无 `entityId` / `sessionId`；
- 无 transport、process、Session、active-session 或 Supervisor cache 残留。

### [P1] F41：所谓 production factory test 没有测试 production fail-closed behavior

**Evidence**

- `nativeAdapter.test.ts:188-194` 只断言 adapter 存在与 descriptor kind。
- 测试未隔离/控制 executable resolver；在本机 carrier 已安装时实际走 native adapter。
- 未断言 missing carrier、installed-unconfigured、invalid config/protocol failure、ready 或无 fake child process。

**Impact**

测试名和 Coder 交付文档高估了覆盖面，无法防止 factory 再次 false-ready，也无法证明官方 Windows product carrier 已集成。

**Fix**

给 factory 注入可控 discovery/readiness seam，分别覆盖 absent、installed-but-unconfigured、invalid/non-serving config、protocol failure 和 ready；至少一个本机 integration 不使用 fake child process。

**Acceptance**

- absent 与 installed-unconfigured 都在 Entity 前 fail-closed；
- valid carrier 只有真实 `initialize` 成功后才能成为 active Session；
- invalid/non-serving config 有有界超时与稳定诊断，不能挂起；
- 测试断言具体 adapter/diagnostic/lifecycle，而非只看 descriptor。

### [P1] F41：尚无完整官方 DSH Windows product-path handshake

**Evidence**

- 本轮真实边界只到 `node + official bin -> usage -> exit 1`。
- 完整 turn 仍来自 `JsonRpcFixture` / mock child process。
- 没有官方 config、`initialize` response、`session.event`、`shutdown` response 和 clean process exit 的同一路径 artifact。

**Impact**

不能判定 DeepSeek Harness “supported + integrated”；Feature 的 DeepSeek Gate 仍是环境/配置阻塞状态。

**Fix / Acceptance**

提供一个官方且完整的 Cordis composition 或经核验的官方 profile/bundled runtime，在 Windows 真实完成：

```text
factory discovery
-> safe spawn
-> initialize
-> session/prompt admission
-> at least one official session notification (or accurate AUTH_REQUIRED)
-> shutdown
-> process exit
```

不得使用 API proxy、CLIProxyAPI、legacy APIProxy、synthetic lifecycle 或 fake process 替代。

## Remaining

- 修复 F41 的 Entity-before-readiness 与 production factory coverage。
- 取得一个真实、完整、可启动的官方 DSH Windows carrier/config artifact；当前继续 `RUNTIME_UNAVAILABLE`。
- DSH 未取得 real handshake 前，所有高级 capability 继续 `implementation missing`。
- F41 关闭后执行真实 Electron 自主 UI smoke：CraftingGrid -> thread -> `craftAgent` -> runtime event/accurate diagnostic -> interrupt/close -> terminal lifecycle。
- 全仓 lint/test 基线失败另行归属，不能在本 Fix Cycle 擅改无关文件。

## Fix Plan

1. **Entity 前置 readiness**：在 factory/adapter 的 Entity 创建前验证 DSH carrier variant 与必要 config；installed-unconfigured 直接 fail-closed。
2. **可测试的 production discovery**：抽出可注入 resolver/readiness seam，覆盖 absent、installed-unconfigured、invalid/non-serving、protocol failure、ready。
3. **真实 carrier integration**：用官方完整 config/profile/bundled runtime 完成 Windows 非 fake handshake 与 shutdown；无法取得时保持 `RUNTIME_UNAVAILABLE`，不要伪造 PASS。
4. **回归边界**：直接断言失败 detail 无 Entity/Session ID、无 process/active-session/Supervisor cache；保持 Windows shim `shell:false` 与参数完整性。
5. 复跑 21 文件 format/lint、focused suite、typecheck、diff check，并记录全仓基线归属。
6. 交接同一 v0.7 专属 Debugger 再次复检。

## Fix Acceptance Criteria

- 安装官方 npm carrier但缺完整 config 时，production `craftAgent()` 在 Entity 创建前返回准确 `RUNTIME_UNAVAILABLE`。
- 失败 detail 不含 synthetic `entityId` / `sessionId`，没有 transport/process/Session/cache 残留。
- production factory tests 真实覆盖 absent、installed-unconfigured、invalid/non-serving config、protocol failure 和 ready。
- Windows npm shim 继续安全解析为 `node + entry + args`，不使用 shell 字符串。
- 至少一个不使用 fake child process 的官方 carrier probe 完成 `initialize -> notification/auth diagnostic -> shutdown -> process exit`；若外部环境不满足，则 Feature 保持明确 blocked/limited，不写 integrated PASS。
- CLIProxyAPI、普通 API、legacy APIProxy 和 synthetic fallback 均未进入执行路径。
- F40、F42、F43、F44、F45、F46 现有通过项无回归。
- 未实测高级 capability 继续是 `implementation missing`。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。这是 production readiness、lifecycle 和 evidence 缺口，不改变原 Feature intent。
- Requires Ideate Revision：**No**。

## User Smoke

本轮 Verdict 为 FAIL，未进入 PASS closeout，因此没有启动或打开最终 Electron 产物，也没有把组件测试冒充桌面验收。F41 关闭后，Debugger 必须先在真实桌面完成 DeepSeek/DSH 的最短主路径；自主 UI smoke 通过后才能给用户最短操作说明。

## Final Decision

**Do not promote. Do not merge to nested Dev. Main promotion remains NOT AUTHORIZED.**

v0.7.5 已关闭真实的 Windows `.cmd` ENOENT 问题，也让缺 config 的路径不再启动无用进程；但它没有关闭上一轮 F41 的全部 acceptance。官方 DeepSeek Harness 与 Windows npm carrier 都是真的，当前缺口是 CraftStation 尚未在 Entity 创建前建立完整 readiness，也没有完成一个真实官方 carrier 的 product-path handshake。下一轮必须修复并取得对应证据，而不是回退为“官方仓库不存在”或用 fixture/API fallback 代替。
