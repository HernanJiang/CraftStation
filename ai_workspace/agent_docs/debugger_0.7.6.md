# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.6
> 角色：Debugger
> 日期：2026-08-30
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
> 分支：`feature/v0.7-native-harnesses`
> HEAD：`7ae6506`
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（v0.7.6 已关闭 Entity-before-readiness；F40、F42、F43、F44、F45、F46 保持通过；但 F41 的 production factory 覆盖、真实官方 DSH Windows handshake 与本 Fix Cycle 交付治理仍未满足）**

本轮确认一个重要修复成立：DeepSeek 缺少 `configPath` 且未配置 `DSH_CORDIS_CONFIG` 时，`NativeProcessHarnessRuntimeAdapter.spawnEntity()` 会在生成 Entity identity 之前同步拒绝，错误为准确的 `RUNTIME_UNAVAILABLE`，不会创建 Session、transport、process 或 Supervisor crafted-session 缓存。上一轮的“先生成 Entity，后在 createSession 拒绝”缺陷已经关闭。

但是，Coder 交接摘要与稳定工作树事实不一致：

1. `ai_workspace/agent_docs/coder_0.7.6.md` 不存在；`PROJECT_STATUS.md` 仍停在 v0.7.5。
2. 所谓“production factory 完整行为单测”仍只有 adapter 存在和 descriptor kind 两个断言；没有覆盖 absent carrier、installed-but-unconfigured、invalid/non-serving config、protocol failure、ready 或 lifecycle 无残留。
3. 本机官方 npm carrier 的真实证据仍只到安全解包 `.cmd` 并进入官方 JS entry 后输出 usage、exit 1。没有获得同一路径的 `initialize -> official session notification / accurate auth diagnostic -> shutdown -> process exit`。

因此不能把“前置 gate 已修复 + fixture/mock 绿测 + 官方包真实存在”升级为 DeepSeek Harness 已完整 supported/integrated。当前准确产品边界仍是：**缺少经验证的完整 Cordis composition 时，DeepSeek 保持 `RUNTIME_UNAVAILABLE`，禁止 API proxy、CLIProxyAPI 或 synthetic fallback。**

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge nested Dev、merge main 或执行 dev→main promotion。

## Review Scope

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.5.md`
- 用户提供的 v0.7.6 Coder 交接摘要
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- F40~F46 对应 native adapter、factory、transport、canonicalizer、Supervisor、IPC、renderer UI/action 与测试
- 本机官方 npm carrier：`@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5`

`coder_0.7.6.md` 是本轮要求的默认输入，但稳定工作树中不存在，因此无法读取。验收以当前源码、测试、artifact 和真实命令结果为准，不以交接摘要或 Coder 自检替代。

## Evidence

### 1. Worktree / Git boundary

- 目标 worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 分支：`feature/v0.7-native-harnesses`
- HEAD：`7ae6506`
- 所有读取、测试和项目内文档写入都显式针对该 worktree。
- main、共享 v0.6/dev 与 v0.8 未被修改、清理、reset、切换或合并。
- 本轮项目内唯一新增文件是本 Debugger 复检文档。

### 2. F40 — static gates

显式复核全部 21 个触及 TS/TSX 文件：

| 检查                                          | 结果                        |
| --------------------------------------------- | --------------------------- |
| `pnpm exec oxfmt --check <21 files>`          | PASS；21 files 全部格式一致 |
| `pnpm exec oxlint --deny-warnings <21 files>` | PASS；0 warning / 0 error   |
| `pnpm run typecheck`                          | PASS                        |
| `git diff --check`                            | PASS                        |

**F40：PASS。**

### 3. Focused / full regression

Focused suite：

```text
Test Files  8 passed | 1 skipped (9)
Tests       102 passed | 1 skipped (103)
```

跳过项是未启用真实 Antigravity 开关的 `nativeProductPath.integration.test.ts`；没有把跳过或既有 artifact 冒充本轮新 product-path PASS。

全仓测试原始结果：

```text
Test Files  8 failed | 853 passed | 10 skipped (871)
Tests       18 failed | 9616 passed | 48 skipped (9682)
```

其中 16 项属于稳定既有基线：

- `remoteProcedureRouter.test.ts`：1 项；
- `craftstationData.migrate.test.ts`：8 项；
- `channel.config-parity.test.ts`：2 项；
- `channel.test.ts`：1 项；
- `craftstationPaths.test.ts`：2 项；
- `probeCwd.test.ts`：2 项。

另外两项来自：

- `acp/probe.stress.test.ts`；
- `cursor/sdkWorkerClient.test.ts`。

二者单独复跑均通过（分别为 15 tests PASS，以及 8 passed / 2 skipped），可归因于 full-suite 并发资源/临时目录波动，而不是 v0.7 native harness 稳定回归。报告保留全仓原始失败数字，不能写“full test PASS”。

### 4. F41 — Entity-before-readiness

`src/supervisor/runtime/nativeHarness/nativeAdapter.ts:458-489` 当前行为：

1. 先验证 adapter 是否支持 CraftPlan；
2. DeepSeek 模式读取 `plan.runtimeBinding.options.configPath`，否则读取 `process.env.DSH_CORDIS_CONFIG`；
3. 两者都缺失时记录 `RUNTIME_UNAVAILABLE` diagnostic；
4. 抛出 `Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created).`；
5. 只有 gate 通过后才执行 `entity:deepseek:${randomUUID()}`。

直接回归位于：

- `src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts:160-187`；
- `src/supervisor/runtime.test.ts:3103-3124`。

Supervisor 的 `craftAgent()` 在 `adapter.spawnEntity()` 处失败，故 `entityId` 尚未赋值，也不会进入 `createSession()` 或 `registerCraftedSession()`。无 Session、transport、process、active-session 或 Supervisor cache 残留；失败 detail 不应包含 synthetic `entityId/sessionId`。

**F41 Entity-before-readiness 子项：PASS。**

### 5. F41 — Windows npm shim

`nativeTransport.ts` 的 `resolveNativeSpawnTarget()` 保持安全行为：

- Windows 下识别 npm `.cmd` shim；
- 提取 shim 指向的官方 JS entry；
- 使用 `node.exe + [entry.js, ...originalArgs]`；
- `spawn()` 使用 argv 数组，没有 shell 字符串拼接。

本机真实核验：

```text
command: C:\Users\Haona\AppData\Roaming\npm\dsh-jsonrpc-agent.cmd
official JS entry exists: true
usage: dsh-jsonrpc-agent <path/to/cordis.yml> ...
exit: 1
```

这证明 `.cmd` 参数已到达官方 JS entry，先前的 `ENOENT` 缺口已关闭。usage/exit 1 是缺少 Cordis config 的官方预期，不是 JSON-RPC handshake PASS。

**F41 Windows shim 子项：PASS。**

### 6. F41 — production factory coverage

`src/supervisor/runtime/nativeHarness/nativeAdapter.test.ts:189-195` 的 production factory 测试仍只执行：

```text
createNativeHarnessRuntimeAdapter("deepseek", ...)
adapter is defined
adapter.descriptor.harnessKind === "deepseek"
```

它没有断言：

- carrier absent 时的具体 adapter/diagnostic；
- carrier 已安装但未配置时 Entity 前 fail-closed；
- config 无效或没有 JSON-RPC serving plugin；
- initialize/protocol failure 与有界超时；
- ready 状态；
- 无 Entity、Session、transport、process、active-session、Supervisor cache 残留。

本机 carrier 已安装时，这条测试构造 native adapter 仍会通过，所以测试名称中的 “honest unavailable descriptor when missing” 与实际覆盖不一致。交接所称“production factory 完整行为单测”不成立。

**F41 production factory coverage 子项：FAIL。**

### 7. F41 — 官方 DSH Windows product path

本机官方分发真实存在：

```text
@deepseek-ai/dsh@0.1.1-rc.2
@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5
bin: dsh-jsonrpc-agent
```

但官方 `dsh-jsonrpc-agent` 要求显式 Cordis config；发布包没有可直接使用的默认 `cordis.yml`。仅有可加载 config 也不代表 JSON-RPC serving plugin 或 backend/model/auth 已就绪。

本轮真实 carrier probe 只证明：

```text
Windows npm shim -> node -> official bin.js -> usage -> exit 1
```

完整 turn 仍来自 `JsonRpcFixture` / fake child process。没有非 fake artifact 证明：

```text
factory discovery
-> safe spawn
-> initialize
-> session/prompt admission
-> official session notification 或准确 AUTH_REQUIRED
-> shutdown
-> process exit
```

因此 DeepSeek 不能标为 integrated PASS。无法提供完整官方 composition 时，保持 `RUNTIME_UNAVAILABLE` 是正确产品行为。

**F41 real product path：BLOCKED / NOT OBTAINED。**

### 8. F42~F46 regression boundary

- **F42：PASS（production implementation seam）**。`HarnessPanel -> CraftingGrid(onCraft, workspace) -> startThreadFromCraft -> bridge.craftAgent` 路由、workspace 与 Lingui 文案保持成立；Feature 因 F41 失败，本轮未进入最终 Electron PASS smoke。
- **F43：PASS**。IPC `interruptThread` 路由到 `SupervisorRuntime.interruptThread()`，优先命中 `craftedSessionsByThread` 并调用 crafted session interrupt。
- **F44：PASS（contract regression）**。Windows interrupt 的 `turn.completed(state=interrupted)` 与 `session.exited(reason=interrupted)` 唯一性、Supervisor event forwarding/release、adapter terminal-session retention 回归成立；真实 provider interrupt E2E 尚未取得。
- **F45：PASS**。Antigravity / DeepSeek 的 tool、permission、MCP、Skills、subagents、resume/multi-turn、context、compaction 等未实测能力继续标为 `implementation missing`，没有升格为 `supported + integrated`。
- **F46：PASS**。`CONTENT_KEY` 覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta` 等正文键；nested DSH `session.event` 展开和 nativeEnvelope 正文脱敏回归成立。

### 9. Antigravity product-path artifact

`ai_workspace/validation/v0.7.0-antigravity-product-path.json` 当前记录：

- `synthetic: false`；
- `agy 1.1.22`；
- `verdict: AUTH_REQUIRED`；
- 观察到 `turn.started`、`error`、`turn.completed`、`session.exited`；
- cleanup：`SupervisorRuntime.closeThread`；
- `observedSessionExited: true`。

这是 live Google 账号 eligibility/auth 限制下的真实产品路径与退出清理证据，不是 assistant-response PASS。它不证明 Electron UI、interrupt、resume/multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

### 10. v0.7.6 delivery governance

稳定工作树事实：

- `ai_workspace/agent_docs/coder_0.7.6.md`：**MISSING**；
- `PROJECT_STATUS.md`：仍声明 v0.7.5 ready for re-review；
- v0.7.6 DSH real product-path artifact：**MISSING**。

这不改变已经验证的源码事实，但表示本 Fix Cycle 的交付与状态治理未完成，且用户消息中的完成摘要不能替代仓库交付物。

## F40~F46 Status Matrix

| Fix                               | 独立复核结果                                                                    | 状态                                    |
| --------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| F40 static gates                  | 21 文件 format/lint、typecheck、diff check 全绿                                 | **PASS**                                |
| F41 DeepSeek carrier              | Entity 前 gate 与 Windows shim 已关闭；factory coverage 和真实 handshake 未完成 | **FAIL / BLOCKED**                      |
| F42 production Craft callback     | production callback/workspace/action、i18n 回归成立                             | **PASS（desktop smoke remaining）**     |
| F43 interrupt routing             | crafted session 优先路由成立                                                    | **PASS**                                |
| F44 interrupt lifecycle/retention | canonical uniqueness、forward/release/retention 回归成立                        | **PASS（real provider E2E remaining）** |
| F45 capability honesty            | 未实测能力保持 implementation missing                                           | **PASS**                                |
| F46 redaction/canonicalizer       | 正文脱敏与 nested event 展开成立                                                | **PASS**                                |

## Findings

### [P1] F41：production factory 测试仍是假覆盖

**Evidence**

- `nativeAdapter.test.ts:189-195` 只断言 adapter 存在和 descriptor kind。
- 测试没有可控 carrier resolver/readiness seam；当前机器 carrier 已安装时仍然无条件通过。
- 没有覆盖 absent、installed-unconfigured、invalid/non-serving、protocol failure、ready 或 lifecycle residue。

**Impact**

无法防止 production factory 再次 false-ready，也不能证明官方 Windows carrier 在产品 seam 上已完整集成。测试名和交接摘要高估了实际覆盖。

**Fix**

给 production factory 注入可控 discovery/readiness seam，覆盖上述状态，并断言具体 adapter、diagnostic、超时和 lifecycle 状态；不能只看 descriptor。

**Acceptance**

- absent 和 installed-unconfigured 均在 Entity 前准确 fail-closed；
- invalid/non-serving/protocol failure 有稳定错误和有界完成；
- ready 只有在真实 initialize 成功后成立；
- 每个失败分支断言无 Entity/Session/process/cache 残留。

### [P1] F41：真实官方 DSH Windows handshake 尚未取得

**Evidence**

- 非 fake 路径只到 official bin usage / exit 1。
- 完整 turn 来自 fixture/mock child process。
- 没有同一路径的 initialize、official notification/auth diagnostic、shutdown 与 process exit artifact。

**Impact**

不能判定 DeepSeek Harness supported + integrated，也不能把 GitHub/npm 包存在等同于 CraftStation 产品适配完成。

**Fix / Acceptance**

提供经验证包含 JSON-RPC serving plugin 和所需 backend/model/auth composition 的官方 Cordis config，在 Windows 完成：

```text
factory -> safe spawn -> initialize -> prompt/session admission
-> official notification 或准确 AUTH_REQUIRED -> shutdown -> clean exit
```

不得使用普通 API、CLIProxyAPI、legacy APIProxy、synthetic lifecycle 或 fake process 替代。外部环境无法满足时继续 `RUNTIME_UNAVAILABLE`，不能宣称 Feature PASS。

### [P2] v0.7.6 交付文档和动态状态缺失

**Evidence**

- `coder_0.7.6.md` 不存在。
- `PROJECT_STATUS.md` 仍停在 v0.7.5。
- 没有 v0.7.6 DSH product-path artifact。

**Impact**

Debugger 无法按标准输入复核 Coder 的具体交付记录，项目动态状态与实际 Fix Cycle 不一致。

**Fix / Acceptance**

- 下一 Fix Cycle 生成与真实源码/测试/边界一致的 Coder 交付文档；
- 由 Coder 按职责更新 `PROJECT_STATUS.md`；
- 文档不得把 usage probe、fixture 或测试数量表述为真实 DSH integration PASS。

## Remaining

- 补齐 production factory 的可控行为覆盖。
- 取得真实官方 DSH Windows carrier/config handshake；无法取得时保持 `RUNTIME_UNAVAILABLE`。
- 补齐 Coder 交付文档与动态状态。
- DSH real handshake 前，所有高级 capability 继续 `implementation missing`。
- F41 关闭后执行真实 Electron 自主 UI smoke：CraftingGrid -> thread -> `craftAgent` -> runtime event/accurate diagnostic -> interrupt/close -> terminal lifecycle。
- 全仓既有 lint/test 基线失败另行归属，不在本 Fix Cycle 擅改无关文件。

## Fix Plan — v0.7.7

1. **Production factory behavior matrix**：抽出/注入 carrier discovery 与 readiness seam，覆盖 absent、installed-unconfigured、invalid/non-serving、protocol failure、ready。
2. **真实 carrier integration**：准备经验证的官方 Cordis composition，完成 Windows 非 fake initialize/notification-or-auth/shutdown/exit artifact；不满足时保持 unavailable。
3. **Lifecycle assertions**：所有失败分支断言无 Entity/Session identity、transport/process、active session 或 Supervisor cache 残留。
4. **治理收口**：生成准确的 `coder_0.7.7.md` 并更新 `PROJECT_STATUS.md`，诚实说明 real product-path 是否取得。
5. **Regression**：保持 Entity-before-readiness、Windows shim、F40/F42/F43/F44/F45/F46 现有通过项，复跑 focused/static/full baseline attribution。
6. 完成后通知同一 v0.7 专属 Debugger 复检。

## Fix Acceptance Criteria

- production factory tests 覆盖 absent、installed-unconfigured、invalid/non-serving config、protocol failure 和 ready，不只断言 descriptor。
- 缺配置或 readiness 失败时，在 Entity 创建前返回准确 `RUNTIME_UNAVAILABLE`，detail 无 synthetic `entityId/sessionId`，无 lifecycle residue。
- Windows npm shim 继续安全解析为 `node + entry + args`，不使用 shell 字符串。
- 至少一个非 fake 官方 carrier probe 完成 `initialize -> official notification/auth diagnostic -> shutdown -> process exit`；外部条件不满足则 Feature 明确保持 blocked/unavailable。
- 普通 API、CLIProxyAPI、legacy APIProxy、TUI/PTY 与 synthetic fallback 均未进入执行路径。
- F40、F42、F43、F44、F45、F46 无回归。
- 未实测高级 capability 继续为 `implementation missing`。
- Coder 文档与 `PROJECT_STATUS.md` 准确反映当前 Fix Cycle 和真实证据。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。这是既定 F41 readiness/testing/evidence 与交付治理缺口，不改变 Feature Spec 或架构意图。
- Requires Ideate Revision：**No**。

## User Smoke

本轮 Verdict 为 FAIL，未进入 PASS closeout，因此没有启动或打开最终 Electron 产物，也没有把组件测试冒充桌面验收。F41 关闭后，Debugger 必须先完成真实产品路径和桌面自主 UI smoke，才可给出用户最短操作说明。

## Final Decision

**Do not promote. Do not merge to nested Dev. Main promotion remains NOT AUTHORIZED.**

v0.7.6 已准确修复 Entity-before-readiness，这是有效进展；但 production factory test、真实 DSH product-path 和交付治理仍未达到 Feature quality gate。官方 DeepSeek Harness 与 Windows npm carrier都是真的，当前缺口是 CraftStation 尚未证明完整官方 Cordis/JSON-RPC 产品集成，而不是官方仓库不存在。
