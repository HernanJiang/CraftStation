# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.7  
> 角色：Debugger  
> 日期：2026-08-30  
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
> 分支：`feature/v0.7-native-harnesses`  
> HEAD：`7ae6506`  
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（v0.7.7 已关闭 production factory 可注入 seam、absent/unconfigured/exit/protocol/fixture-ready 基本矩阵、真实 carrier 审计和治理缺口；但真正 long-lived non-serving Cordis composition 会让 `initialize` 永久悬挂，且 invalid/protocol failure 仍先生成 Entity identity）**

v0.7.7 是有效进展：`createNativeHarnessRuntimeAdapter()` 已支持注入 `resolveExecutable` 与 `spawnProcess`；五个测试场景确实经过 production factory；`coder_0.7.6.md`、`coder_0.7.7.md` 和 `PROJECT_STATUS.md` 已存在；本机官方 npm carrier 的 usage、完整 config loader failure 和 Windows 分发边界也被诚实记录。DeepSeek 没有被错误升格为 integrated，仍保持 `RUNTIME_UNAVAILABLE`，没有普通 API、CLIProxyAPI 或 synthetic fallback。

但是，“invalid/non-serving 已完整覆盖”的结论不成立。矩阵里的该分支只模拟 child process 立即 `exit(1)`；官方 `@deepseek-ai/dsh-sdk-jsonrpc-demo` README 明确说明：不含 `dsh-sdk-jsonrpc-server` 的有效 Cordis config 可以成功启动但不提供服务。Debugger 用官方 `dsh-jsonrpc-agent` bin 和一个有效、长期存活但无 JSON-RPC server 的本地 Cordis composition 独立复现：进程保持存活，收到 `initialize` frame 后无响应。CraftStation `NdjsonProcessTransport.sendRequest()` 只登记 pending promise，没有 timeout、abort 或 readiness deadline，所以 `createSession()` / `craftAgent()` 可以无限等待，无法返回准确 `RUNTIME_UNAVAILABLE`，也无法自动清理进程。

此外，invalid-exit 和 protocol-mismatch 分支先成功执行 `spawnEntity()`，随后才在 `createSession()` 失败；Supervisor 会把该 `entityId` 放入 enriched error detail。测试只断言 `getActiveSessions() === []`，没有验证上一轮要求的“所有 readiness 失败分支无 Entity/Session identity”。

因此 Feature 仍不能 PASS，也不能 merge nested Dev。修复目标不是让不可用的官方 DSH carrier伪装成功，而是让 unavailable/non-serving 路径有界、可诊断、可清理。

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge nested Dev、merge main 或执行 dev→main promotion。

## Review Scope

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.6.md`
- `ai_workspace/agent_docs/coder_0.7.6.md`
- `ai_workspace/agent_docs/coder_0.7.7.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- `ai_workspace/validation/v0.7.0-native-runtime-audit.md`
- F40~F46 对应 factory、adapter、transport、canonicalizer、Supervisor、IPC、renderer UI/action 与测试
- 官方只读参考：`D:\Work\CraftStation\reference\deepseek-harness`
- 本机官方 npm carrier：`@deepseek-ai/dsh@0.1.1-rc.2`、`@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5`

验收继续遵守严格证据边界：factory fixture “ready”仅证明 CraftStation protocol/lifecycle wiring；真实 carrier usage、loader failure 或单轮 Antigravity AUTH_REQUIRED 不能证明 DeepSeek response 或未实测高级能力。

## Evidence

### 1. Worktree / Git boundary

- 目标 worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- 分支：`feature/v0.7-native-harnesses`
- HEAD：`7ae6506`
- 所有读取、测试和项目内文档写入均显式针对 v0.7 worktree。
- main、共享 v0.6/dev 和 v0.8 未被修改、清理、reset、切换或合并。
- 本轮项目内唯一新增文件是本 Debugger 文档。

### 2. F40 — static gates

独立复跑全部 21 个触及 TS/TSX 文件：

| 检查 | 结果 |
|---|---|
| `pnpm exec oxfmt --check <21 files>` | PASS；21 files 全部格式一致 |
| `pnpm exec oxlint --deny-warnings <21 files>` | PASS；0 warning / 0 error |
| `pnpm run typecheck` | PASS |
| `git diff --check` | PASS |
| Full `pnpm run lint` | FAIL；未触及 `codexRouterOverlay.test.ts:52` 的既有 conditional expect |

**F40：PASS（触及路径门禁）；全仓 lint 不得表述为 PASS。**

### 3. Focused / full regression

扩展 focused suite（包含 registry、control plane、factory、lifecycle、Supervisor 和 renderer action）：

```text
Test Files  8 passed | 1 skipped (9)
Tests       101 passed | 1 skipped (102)
```

跳过项为未开启真实 Antigravity gate 的 product-path integration；随后已单独开启真实 gate 复跑。

全仓测试：

```text
Test Files  6 failed | 855 passed | 10 skipped (871)
Tests       16 failed | 9622 passed | 48 skipped (9686)
```

16 项均为稳定既有基线：

- `remoteProcedureRouter.test.ts`：1；
- `poracodeData.migrate.test.ts`：8；
- `channel.config-parity.test.ts`：2；
- `channel.test.ts`：1；
- `poracodePaths.test.ts`：2；
- `probeCwd.test.ts`：2。

没有命中 v0.7 native harness 触及模块，但全仓 test 不能写 PASS。

### 4. F41 — production factory seam 与五态矩阵

`src/supervisor/runtime/nativeHarness/index.ts:39-50` 新增：

- `resolveExecutable?: (command) => string | undefined`；
- `spawnProcess?: typeof child_process.spawn`。

Antigravity 与 DeepSeek factory 都使用该 seam；DeepSeek 仍按 `dsh-jsonrpc-agent -> dsh` 顺序发现官方 carrier，并把 `spawnProcess` 传入 `NativeProcessHarnessRuntimeAdapter`。

`nativeAdapter.test.ts:183-326` 的五个场景确实通过 `createNativeHarnessRuntimeAdapter("deepseek", ...)` 创建 adapter：

| 场景 | 实际覆盖 | 结果 |
|---|---|---|
| absent | resolver 返回 undefined；Unavailable adapter、diagnostic、spawn reject | PASS |
| installed-unconfigured | native adapter；`spawnEntity()` 前置拒绝；无 active session | PASS |
| invalid exit | fake child 收到 initialize 后立即 exit 1；`createSession()` reject | PASS，但先生成 Entity |
| protocol mismatch | fake child 输出 malformed line 后 exit 0；记录 `PROTOCOL_MISMATCH` | PASS，但先生成 Entity |
| ready | `JsonRpcFixture` 完成 initialize/prompt/event/shutdown；retention 归零 | PASS（fixture only） |

这比 v0.7.6 的 descriptor-only 测试有实质提升。缺口是第三项测试名写 `invalid/non-serving exit`，实际只覆盖 immediate exit，不覆盖官方定义的 long-lived non-serving composition。

### 5. [P1] 真实 long-lived non-serving Cordis 会永久悬挂

官方 npm README（本机已安装包）明确写明：

```text
A config without dsh-sdk-jsonrpc-server is valid and serves nothing.
The bin cannot prove that the config serves JSON-RPC.
```

Debugger 使用官方：

```text
C:\Users\Haona\AppData\Roaming\npm\node_modules\
  @deepseek-ai\dsh-sdk-jsonrpc-demo\lib\bin.js
```

并在系统临时目录创建一个有效 Cordis composition，只加载一个保持进程存活的本地插件，不加载 JSON-RPC server。发送标准 `initialize` frame 后，2.4 秒观察结果：

```json
{
  "config": "long-lived-valid-no-server",
  "aliveBeforeCleanup": true,
  "responded": false,
  "stdoutBytes": 0,
  "exitCodeBeforeCleanup": null
}
```

探针随后主动 kill 并删除系统临时目录，没有留下进程或文件。

源码 `nativeTransport.ts:330-345`：

```text
sendRequest -> pendingRequests.set -> send -> return unresolved Promise
```

没有 timeout、AbortSignal 或 readiness deadline。`NativeProcessCraftSession.initializeDeepSeek()` 直接 await 该 promise；因此真实 non-serving carrier 不会进入 catch/terminate，也不会返回 `RUNTIME_UNAVAILABLE`。

**F41 long-lived non-serving readiness：FAIL。**

### 6. [P1] invalid/protocol readiness failure 仍生成并暴露 Entity identity

矩阵在 invalid 与 protocol 分支都执行：

```text
const entity = await adapter.spawnEntity(plan(...))
await expect(adapter.createSession(entity)).rejects...
```

Supervisor `craftAgent()` 在 `spawnEntity()` 后立即保存 `entityId`，`createSession()` 失败时 `enrichCraftingError()` 会把该 ID写入 error detail。虽然 session 初始化失败时 adapter 会 terminate transport，且 `getActiveSessions()` 保持 0，但“所有 readiness 失败分支不生成 Entity/Session identity”的 acceptance 尚未满足。

**F41 failure identity boundary：FAIL。**

### 7. 官方 Windows carrier 真实边界

本机确认：

```text
@deepseek-ai/dsh@0.1.1-rc.2
@deepseek-ai/dsh-sdk-jsonrpc-demo@0.0.1-rc.5
dsh.cmd / dsh.ps1 / dsh-jsonrpc-agent.cmd / dsh-jsonrpc-agent.ps1
```

独立真实探针：

1. 未提供 config：官方 usage，约 199 ms，exit 1。
2. 提供只读官方参考的 `examples/jsonrpc-agent/minimal.cordis.yml`：exit 1；loader 明确报告无法解析 `@deepseek-ai/dsh-sdk-jsonrpc-server`。
3. 有效但不含 server 的长期存活 composition：进程不退出、不回应 initialize，证明需要 CraftStation-owned readiness deadline。

因此 `v0.7.0-native-runtime-audit.md` 的核心产品决定正确：当前机器没有完整可 serving 的官方 Windows composition，DeepSeek 必须保持 `RUNTIME_UNAVAILABLE`；但产品还必须保证这种 unavailable 路径有界完成。

### 8. Antigravity real product path

独立设置真实 gate 和 `agy.exe` 后复跑：

```text
Test Files  1 passed (1)
Tests       1 passed (1)
```

最新 artifact：

- `synthetic: false`；
- `agy 1.1.22`；
- `verdict: AUTH_REQUIRED`；
- `turn.started`、`error`、`turn.completed`、`session.exited`；
- `SupervisorRuntime.closeThread`；
- `observedSessionExited: true`。

这是 live 账号 eligibility/auth 限制和退出清理的真实证据，不是 assistant-response PASS，也不证明 UI、interrupt、multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

### 9. F42~F46 regression boundary

- **F42：PASS（implementation seam）**。`HarnessPanel -> CraftingGrid(onCraft, workspace) -> startThreadFromCraft -> bridge.craftAgent` 路由与本地化保持成立；Feature FAIL，未进入最终 Electron PASS smoke。
- **F43：PASS**。IPC interrupt 路由优先命中 crafted session。
- **F44：PASS（contract regression）**。Windows interrupted terminal events、Supervisor forwarding/release 和 adapter retention 回归通过；真实 provider interrupt E2E 仍未取得。
- **F45：PASS**。所有未实测高级能力继续为 `implementation missing`，没有升格为 supported/integrated。
- **F46：PASS**。正文键脱敏与 nested `session.event` canonicalization 保持通过。

### 10. Governance

- `coder_0.7.6.md`：存在；
- `coder_0.7.7.md`：存在；
- `PROJECT_STATUS.md`：Lifecycle Snapshot 和 Next Step 已更新到 v0.7.7；
- `v0.7.0-native-runtime-audit.md`：包含 npm carrier usage、minimal config loader failure 和 fail-closed 决策。

**上一轮 governance Finding：PASS。**

## F40~F46 Status Matrix

| Fix | 独立复核结果 | 状态 |
|---|---|---|
| F40 static gate | 21 文件 format/lint、typecheck、diff check 全绿 | **PASS** |
| F41 DeepSeek carrier | factory seam/基本矩阵/audit 已完成；non-serving timeout 与 failure identity 未完成 | **FAIL** |
| F42 production Craft callback | production callback/workspace/action、i18n 回归成立 | **PASS（desktop smoke remaining）** |
| F43 interrupt routing | crafted session 优先路由成立 | **PASS** |
| F44 interrupt lifecycle/retention | canonical uniqueness、forward/release/retention 成立 | **PASS（real provider E2E remaining）** |
| F45 capability honesty | 未实测能力保持 implementation missing | **PASS** |
| F46 redaction/canonicalizer | 正文脱敏与 nested event 展开成立 | **PASS** |

## Findings

### [P1] DeepSeek initialize 没有 readiness timeout，官方 long-lived non-serving config 可永久挂住 craftAgent

**Evidence**

- 官方 npm README 明确允许有效 config 启动但不 serving。
- Debugger 真实官方 bin 探针：进程存活、无 initialize response。
- `nativeTransport.ts:330-345` 的 pending request 无 timeout/abort。
- v0.7.7 矩阵只模拟立即 exit，不覆盖长期存活。

**Impact**

用户提供存在但不 serving 的 Cordis config 时，DeepSeek 创建流程不会返回 `RUNTIME_UNAVAILABLE`，UI/IPC 可无限等待，process 无自动 owner 清理。这违反 Manager 的 unavailable/service-unreachable diagnostic、取消/超时/资源清理要求，也违反上一轮“invalid/non-serving 有界完成”acceptance。

**Fix**

给 JSON-RPC request 增加可配置且有明确默认值的有界 timeout/AbortSignal；至少 initialize readiness 必须超时后：

1. 删除 pending request；
2. 记录稳定 `RUNTIME_UNAVAILABLE` 或 `PROTOCOL_MISMATCH`（语义统一并测试）；
3. dispose/kill child process；
4. terminate provisional session；
5. 不留下 active session、pending request 或 Supervisor crafted-session state。

**Acceptance**

- production factory non-serving case 使用保持存活、无 JSON-RPC response 的 child；
- `createSession()` 在测试设定的短 deadline 内 reject，而非靠 child exit；
- 断言 child 被清理、pending map 清空、active sessions 为 0；
- 真实官方 long-lived non-serving probe 在产品 adapter 路径有界返回 accurate unavailable。

### [P1] invalid/protocol readiness failure 在 Supervisor detail 中暴露 provisional Entity ID

**Evidence**

- factory matrix invalid/protocol 两项先 `spawnEntity()`，再等待 `createSession()` reject。
- `SupervisorRuntime.craftAgent()` 保存 `entityId` 后调用 `createSession()`。
- `enrichCraftingError()` 对失败 detail附加该 ID。

**Impact**

交接摘要声称五态验证“无 Entity 生成”，实际仅 absent/unconfigured 满足。对于尚未完成 initialize 的 carrier，产品仍把 provisional identity 暴露为失败对象，不满足上一轮所有 readiness failure 无 identity 的 acceptance。

**Fix / Acceptance**

- 将 DeepSeek initialize/readiness 纳入 Entity commit 前的 adapter seam，或确保失败 detail不暴露 provisional identity并显式回收 provisional Entity；
- Supervisor-level tests 覆盖 invalid exit、protocol mismatch、non-serving timeout；
- 错误 detail 无 `entityId/sessionId`，无 process/session/cache residue。

## Remaining

- 给 DeepSeek initialize 和 JSON-RPC request 建立有界 deadline/abort/cleanup。
- 扩展 production matrix 的真实 non-serving case，不用 exit 模拟 non-serving。
- 关闭 invalid/protocol failure 的 provisional Entity identity 边界。
- 当前官方 Windows serving composition 仍不可用；保持 `RUNTIME_UNAVAILABLE`，禁止 fallback。
- 高级能力保持 `implementation missing`。
- F41 关闭后再执行真实 Electron 自主 UI smoke。

## Fix Plan — v0.7.8

1. **Bounded JSON-RPC requests**：为 pending request 增加 timeout/abort 和 race-safe cleanup，优先覆盖 initialize/shutdown。
2. **Long-lived non-serving regression**：factory 注入一个保持存活、无 response 的 child，断言 deadline、diagnostic、kill/dispose、pending/session/cache 全部归零。
3. **Identity commit boundary**：在 initialize 成功前不向 Supervisor 失败 detail暴露 Entity/Session identity；补 Supervisor production-path failure tests。
4. **保持 fail-closed**：真实官方 carrier不可 serving 时继续 `RUNTIME_UNAVAILABLE`，不引入 API/CLIProxy/synthetic fallback。
5. 复跑 touched static gates、focused、真实 Antigravity probe、full baseline attribution，并更新 Coder/PROJECT_STATUS 后交接同一 Debugger。

## Fix Acceptance Criteria

- long-lived non-serving Cordis/child 不会让 `createSession()` / `craftAgent()` 永久 pending。
- timeout 后 pending request、transport/process、provisional session、adapter active session、Supervisor crafted-session 均无残留。
- invalid exit、protocol mismatch、non-serving timeout 的错误 detail均无 `entityId/sessionId`。
- absent、unconfigured、invalid exit、protocol mismatch、long-lived non-serving、fixture-ready 六种边界均由 production factory seam 覆盖。
- ready 仍明确标记 fixture，不冒充真实 DSH product response。
- 官方 Windows serving composition 不可用时保持准确 `RUNTIME_UNAVAILABLE`。
- F40、F42、F43、F44、F45、F46 无回归；未实测高级能力保持 `implementation missing`。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。这是既有 runtime timeout、readiness commit 和测试缺口，不改变 Feature Spec。
- Requires Ideate Revision：**No**。

## User Smoke

本轮 Verdict 为 FAIL，未进入 PASS closeout；没有启动或打开最终 Electron candidate，也没有把组件/factory fixture 冒充桌面验收。

## Final Decision

**Do not promote. Do not merge to nested Dev. Main promotion remains NOT AUTHORIZED.**

v0.7.7 已证明 factory 可测性和 unavailable 审计方向正确，但尚未证明所有官方允许的 non-serving 边界都能有界失败。下一轮只需关闭 timeout/cleanup/identity commit，不需要也不允许把当前不可 serving 的 DSH 包装成成功。
