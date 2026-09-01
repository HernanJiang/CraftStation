# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.9（含 F47–F49 最终协调复检）  
> 角色：Debugger  
> 日期：2026-08-30  
> Worktree：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
> 分支：`feature/v0.7-native-harnesses`  
> HEAD / base：`7ae6506`  
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL / BLOCKED**

- **Engineering implementation：PASS。** v0.7.9 deadline/cancellation/lifecycle 修复与 F48 生产动态模型目录均已通过源码、测试、静态门和真实产品路径复核。
- **F48 model inventory：CLOSED。** 生产 `HarnessPanel -> typed IPC -> SupervisorRuntime.getCraftingModelInventory -> official Codex app-server model/list -> ItemRegistry.refreshCodexModels` 链路成立。当前生产目录发现 14 个模型，14/14 均发起真实流量并取得非空 response；13/14 严格返回 marker。旧 4 个静态历史 OpenAI Item 本轮生产尝试数为 0，route 404 为 0。
- **F47 real response/auth：BLOCKED。** Antigravity 与 DeepSeek 均通过非 synthetic `SupervisorRuntime.craftAgent` 触达官方 runtime，但分别停在账号资格/认证要求和 provider `401 / AUTH`；二者 response 仍为空。
- **Main promotion：NOT AUTHORIZED。** 本轮不生成 PASS report，不 commit/push/tag，不 merge Dev/main，不 promotion。

`AUTH_REQUIRED`、cleanup、fixture、单轮 marker或测试绿灯均不能替代两条新 Harness 的真实 assistant response，因此 Feature 仍不能 PASS。

## Review Scope

- `AGENTS.md`、`PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.7.md`、`debugger_0.7.8.md`
- `ai_workspace/agent_docs/coder_0.7.9.md`
- v0.7 当前 working-tree diff、UI/IPC seam、registry、Supervisor runtime、native Harness lifecycle 与 artifacts
- 五条 Native Harness 产品路径与当前生产可选 Codex 模型全集真实流量

CodeGraph 索引属于 main worktree而非 v0.7 Feature worktree，本轮继续使用当前 worktree源码搜索、diff、测试和真实运行证据，未使用错误分支索引替代复核。

## Evidence

### 1. Worktree / Git boundary

- Git root：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
- Branch：`feature/v0.7-native-harnesses`
- HEAD：`7ae6506`
- 未创建、移动、切换或清理 worktree；未修改 main、共享 v0.6/dev 或 v0.8；未执行 reset、commit、push、tag、merge 或 promotion。

### 2. F40 — static gates

最终触及 TS/TSX 文件数为 **30**：

| 检查 | 结果 |
|---|---|
| `oxfmt --check`（显式 30 文件数组） | PASS；30/30 |
| `oxlint --deny-warnings`（显式 30 文件数组） | PASS；30/30，0 warning / 0 error |
| `pnpm run typecheck` | PASS |
| `git diff --check` | PASS |

全仓 lint 的既有未触及 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` conditional-expect 基线仍不改写为全仓 PASS。

### 3. Regression

最新较宽 focused suite：

```text
Test Files  11 passed | 2 skipped (13)
Tests       150 passed | 7 skipped (157)
```

F48 UI / registry / IPC 无 runtime 子集：

```text
Test Files  3 passed (3)
Tests       28 passed (28)
```

含 `runtime.test.ts` 的 F48 定向断言为 4 files / 99 tests passed；Vitest 结束时仍出现既有 OpenCode teardown mock 的 4 个 unhandled rejection：

```text
terminateProcessTree
-> terminateOpenCodeServerChildNow
-> shutdownSpawnedOpenCodeServers
-> SupervisorRuntime.disposeAsync
TypeError: Cannot read properties of undefined (reading 'error')
```

该问题与 F48 生产 discovery 调用链无关，不能把该轮写作 clean full-suite PASS，也未在本 Feature 中删除或掩盖。

### 4. F41 / lifecycle acceptance

独立确认：

1. initialize readiness、normal turn cancellation、shutdown cleanup 使用分离 deadline；正常 prompt 默认没有 readiness / 固定 15 秒 deadline。
2. `StartTurnCommand.signal` 绑定 pending prompt；pre-aborted不发送，运行中 abort 清 pending并以 `interrupted` 收口，不伪造 `NATIVE_EXECUTION_FAILED`。
3. non-serving initialize与 unresponsive shutdown均有界清理；child、pending、active Session和 provisional transport归零。
4. `craftAgent()` / `resumeCraftAgent()` readiness failure不暴露 provisional `entityId/sessionId`，Supervisor registration/binding/unsubscribe/native-session cache均清零。

**F41 engineering acceptance：PASS。**

### 5. F48 — production-discovered model inventory（CLOSED）

生产链路：

```text
HarnessPanel
-> readBridge().getCraftingModelInventory(...)
-> typed Supervisor IPC
-> SupervisorRuntime.getCraftingModelInventory(...)
-> probeCodexCapabilities(...)
-> official Codex app-server model/list
-> ItemRegistry.refreshCodexModels(...)
-> CraftingGrid / CraftingRegistrySections
```

直接复核的边界：

- discovery失败时 fail-closed清空 OpenAI模型，不回退旧静态 `gpt-4o`、`gpt-5-hybrid`、`gpt-5.3-codex`、`o3-mini`；
- 项目切换先清旧 snapshot；异步请求有 `disposed` 防护，旧项目晚到结果不能污染新项目；
- `workspaceLocation` 稳定，避免 effect反复探测；
- inventory变化时纠正已失效选择；
- 官方动态模型优先，同时保留非 OpenAI Native Items。

真实 production inventory artifact：

`ai_workspace/validation/v0.7.10-crafting-model-inventory-product-path.json`

```text
synthetic=false
status=ready
source=codex-app-server-model-list
modelCount=14
```

当前生产目录全集真实流量 artifact：

`ai_workspace/validation/v0.7.10-codex-discovered-model-real-traffic.json`

```text
attempted=14
non-empty real response=14
exact marker=13
static builtin attempts=0
route 404=0
inventory model set == attempted model set
```

`deepseek-v4-pro-0813` 返回 7 字符非空、非 marker response，因此只记“真实 response”，不记严格 marker PASS。F48 原 Finding 已关闭；旧 v0.7.9 的 4 个静态 404 只保留为修复前历史，不再是当前生产 blocker。

真实 production inventory gate 已以 `CRAFTSTATION_REAL_CRAFTING_MODEL_INVENTORY=1` 独立复跑：`1 passed / 2 skipped`；通过项直接驱动 `SupervisorRuntime.getCraftingModelInventory` 并更新上述 artifact。

### 6. Five Native Harness real traffic

| Model / Harness | 官方机器边界 | 真实结果 | Cleanup | 当前结论 |
|---|---|---:|---:|---|
| Codex dynamic model / Codex | official `codex app-server` | PASS，真实 response / 已有双轮证据 | PASS | response成立 |
| Grok 4.6 / Grok Build | official ACP stdio | PASS，marker response | PASS | response成立 |
| Kimi for Coding / Kimi Code | official ACP stdio | PASS，marker response | PASS | response成立 |
| Antigravity Default / agy 1.1.22 | official stream-json | `AUTH_REQUIRED`，response空 | PASS | F47 BLOCKED |
| DeepSeek Chat / DSH 0.1.1-rc.2 | official JSON-RPC 2.0 stdio | provider `401/AUTH`，response空 | PASS | F47 BLOCKED |

没有使用普通 API、CLIProxyAPI、TUI 注入、synthetic Entity/Session 或 fixture替代真实流量。

### 7. Official DSH Windows carrier boundary

官方 `@deepseek-ai/dsh-sdk-jsonrpc-demo@0.1.1-rc.2` carrier及仅由本机官方 server / llm / agent-spine / session包组成的一次性 Cordis composition，已通过真实 `SupervisorRuntime.craftAgent` 观察：

```text
initialize
-> session/prompt
-> official notifications
-> failed turn
-> session.exited cleanup
```

当前 provider返回 `401 / AUTH`，产品准确映射 `AUTH_REQUIRED`。临时 config与 config-relative `node_modules` junction已删除，且只删除 junction本身；全局官方包 target仍存在。这个结果推翻旧“没有 Windows carrier”的历史结论，但不等于 response PASS。

### 8. Artifact safety

所有最新 v0.7 artifacts继续只保存结构化结果和 response长度，不保存完整 response或 credential。最终扫描覆盖 credential assignment、Bearer token、localhost、request id和 private key模式，结果均为 0 命中。

### 9. F42–F46 / capability boundary

- **F42：PASS。** 生产 `HarnessPanel -> CraftingGrid(onCraft, workspace) -> startThreadFromCraft -> bridge.craftAgent` 成立，错误文案已本地化。
- **F43：PASS。** `SupervisorRuntime.interruptThread()`优先路由 crafted session，IPC使用该 seam。
- **F44：PASS（contract regression）。** Windows interrupt事件唯一性、Supervisor forwarding/release和adapter retention有直接断言；真实 provider interrupt E2E仍未取得。
- **F45：PASS。** 未实测高级能力保持 `implementation missing`。
- **F46：PASS。** DSH nested事件展开、失败收口与正文深度脱敏通过。

## Findings

### [P1] Antigravity real response/auth remains blocked

**Evidence**：`agy 1.1.22`、`synthetic=false`、`AUTH_REQUIRED`、`responseLength=0`、`session.exited cleanup=true`。  
**Impact**：Manager Gate要求真实 assistant streaming/result；认证诊断和cleanup不能替代。  
**Acceptance**：恢复官方账号 eligibility/login后重跑同一产品路径，取得非空 assistant response、terminal result与cleanup。

### [P1] DeepSeek official provider authentication remains blocked

**Evidence**：官方 DSH carrier/composition真实 serving；`initialize`、`session/prompt`、official notifications和shutdown发生；provider返回 `401/AUTH`，response为空。  
**Impact**：DeepSeek response gate未通过。  
**Acceptance**：提供官方 endpoint接受的有效 `DEEPSEEK_API_KEY`，重跑同一路径并取得真实 streaming/terminal response与cleanup。禁止普通 API、CLIProxyAPI或 synthetic fallback。

### [P2] Advanced capabilities remain unverified

Antigravity / DeepSeek 的 tool、permission、MCP、Skills、subagents、resume、multi-turn、context、compaction尚无真实产品证据。Descriptor当前保守标记正确，但不得宣称 supported+integrated。

## Closed Finding

### F48 — stale static OpenAI model catalog：CLOSED

生产目录已改为官方 app-server动态 discovery，真实目录14项与流量尝试14项集合精确相等；14/14有非空 response、13/14严格 marker、静态历史项尝试0、route 404为0。该项不再出现在 Remaining或Feature blocker中。

## Remaining / 下一步

1. 恢复 Antigravity官方账号 eligibility/auth，取得真实 assistant response。
2. 为官方 DSH提供 endpoint接受的有效 key，取得真实 assistant response。
3. 在两条新 Harness真实 response闭环后，再逐项验证多轮、resume、interrupt、tool/permission及官方实际支持的高级能力；未验证前保持 `implementation missing`。
4. Main promotion保持 `NOT AUTHORIZED`；Feature仍 FAIL/BLOCKED，不 merge Dev/main，不生成 PASS report。

## Workflow Decision

- Requires Manager Re-plan：**No**
- Requires Ideate Revision：**No**
- Verdict：**FAIL / BLOCKED**

## Final Seal

- 30个触及 TS/TSX：`oxfmt --check`与`oxlint --deny-warnings`通过；
- `pnpm run typecheck`与`git diff --check`通过；
- 较宽 focused：11 passed / 2 skipped files，150 passed / 7 skipped tests；
- F48 UI/registry/IPC子集：3 files / 28 tests passed；
- 当前生产 inventory：14 discovered / 14 attempted / 14 non-empty response / 13 exact marker / 0 static attempts / 0 route 404；
- v0.7 artifacts敏感模式扫描0命中，测试参数残留进程0；
- 当前仍为 `feature/v0.7-native-harnesses` / `7ae6506`，未 commit/push/tag/merge/promotion。

封存结论：**F48已关闭；F47仅因Antigravity与DeepSeek两条外部认证/真实response门禁保持 FAIL / BLOCKED。**
