# Debugger — v0.4.0 Native Multi-Harness Compatibility

> Feature Review（独立质量门）
> 日期：2026-08-27
> 角色：Debugger
> 对应 Coder 交接：`ai_workspace/agent_docs/coder_0.4.0-native-harness.md`
> 对应 Manager：`ai_workspace/agent_docs/manager_0.4.0.md`
> Fix Cycle：`v0.4.1`
> Verdict：**FAIL**

本轮**不复用**旧 Codex 多账号 / `debugger_0.4.1.md` 结论。验收对象是五个平级 Native Harness。

## Review Scope

- Spec Fidelity：Official / Native Runtime First；`Crafting -> CraftPlan -> Native Runtime -> Entity -> Session`
- 五个平级目标：Codex / Grok Build / Kimi Code / Antigravity / DeepSeek-DSH
- Capability matrix 诚实性：`supported+integrated` / `native unsupported` / `implementation missing` / `unavailable` / `error`
- Integration：Craft Table / Recipe / `createCraftingAdapter` / Control Plane IPC
- Regression：v0.3 Codex app-server baseline 不回退；旧 DSH / CLIProxyAPI / Model API 不得伪造 Harness
- Runtime / Edge：真实 binary 未探针或未认证时不得 synthetic PASS
- Architecture：shared crafting 不拥有 provider loop；Renderer 不直接导入 native runtime
- Tests / Validation：独立复跑，不以 Coder self-check 代替 Quality Gate

## Evidence

### 独立读取

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.0-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.0-native-harness.md)
- [v0.4.0-native-harness-audit.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.0-native-harness-audit.md)
- [v0.4.0-capability-decomposition-handoff.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.0-capability-decomposition-handoff.md)

### 独立源码复核（Working Copy）

- `craftstation/src/supervisor/runtime/nativeHarness/index.ts`：Grok/Kimi 走官方 ACP Adapter；Antigravity 走官方 `agy` PTY；DeepSeek 走 `UnavailableNativeHarnessRuntimeAdapter`；Codex **不在** FACTORIES，生产路径仍是 `NativeCodexRuntimeAdapter`
- `craftstation/src/supervisor/supervisorRuntime.ts` `createCraftingAdapter`：`harnessKind === "codex"` -> native Codex；其余 `createNativeHarnessRuntimeAdapter`
- `craftstation/src/supervisor/agents/grok/index.ts`：`grok agent stdio`
- `craftstation/src/supervisor/agents/kimi/index.ts`：`kimi acp`
- `craftstation/src/supervisor/agents/antigravity/`：`binary: "agy"`
- `craftstation/src/supervisor/runtime/nativeHarness/descriptors.ts`：已安装 Harness 的 start/resume/stream/tool 等被**硬编码**为 `supported+integrated`
- `craftstation/src/renderer/components/crafting/CraftingGrid.tsx`：Recipe 一键填充强制 `setHarnessSelection("auto")`，而 `auto` 解析为 Codex
- `craftstation/src/supervisor/supervisorRuntime.ts` `getNativeHarnessControlPlane`：未传入 adapter diagnostics；`profileConfigured` 来自 Codex-centric `accountStore`
- Renderer **没有**消费 `getNativeHarnessControlPlane`

### 独立测试 / 工具

| 检查 | 结果 |
|---|---|
| `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/shared/crafting src/supervisor/runtime/nativeCodex` | **16 files / 72 tests passed** |
| `pnpm typecheck` | **PASS** |
| `codegraph status`（`D:\Work\CraftStation\craftstation`） | Index is up to date；2,889 files / 40,313 nodes / 151,311 edges |
| `CRAFTSTATION_REAL_RUNTIME=1` / 真实 ACP / PTY / app-server 会话 | **本轮未执行，不得记 PASS** |
| 全量 `src/supervisor/runtime.test.ts` 独立复跑 | 启动过但未在本轮拿到完整输出；**不以 Coder 自称的 116 passed 作为门禁** |

### 本机 binary / 认证信号（仅 `--version` 与文件存在性）

| Harness | binary | version | auth signal | 本轮真实 session |
|---|---|---|---|---|
| Codex | Local OpenAI Codex `codex.exe` | `codex-cli 0.150.0-alpha.8` | `~/.codex/auth.json` 存在 | **unprobed** |
| Grok Build | `~/.grok/bin/grok.exe` | `1.0.5 (5115b46bc9)` | `~/.grok/auth.json` 存在 | **unprobed** |
| Kimi Code | npm `kimi.ps1` | `0.36.1` | `~/.kimi-code/config.toml` 与 credentials 存在 | **unprobed** |
| Antigravity | `agy.exe` | `1.1.21` | keyring 仍为 soft signal | **unprobed** |
| DeepSeek / DSH | PATH 中无 `dsh` / `deepseek` | n/a | n/a | **honest unavailable** |

未读取任何 token / cookie / auth 文件内容；未启动 `grok agent stdio`、`kimi acp`、`agy` 交互或 Codex app-server 本轮探针。

## Spec Fidelity

Manager 要求五个平级 Harness 都能进入同一 Crafting 链路，capability 状态必须区分“已集成、原生不支持、实现缺失、不可用、错误”，并且真实 runtime 未取得时不得 synthetic PASS。

Coder 交付了：

- 正确的 Official/Native 方向（Grok ACP、Kimi ACP、Agy PTY、Codex app-server、DSH unavailable）
- 共享 seam、architecture guard、脱敏 control-plane **投影函数**
- fixture 级 lifecycle / cleanup / DSH 不创建 synthetic Entity
- T10 设计 handoff，未做 Universal* / Item promotion

但以下 Spec 项**未满足**：

1. `supported+integrated` 在没有真实 ACP/PTY/app-server 往返时被写进生产 descriptor。
2. Craft Table 不能按 Recipe 选择对应 Harness；Grok/Kimi/Antigravity/DSH 一键填充仍落到 Codex `auto`。
3. T08 的“五 Harness lifecycle acceptance”只覆盖 mock fixture，不能关闭 Feature。
4. Control Plane IPC 存在，但 UI 未展示公共生命周期 / native-specific 投影。

## Integration / Regression / Edge Cases

- **正向集成缺口**：`startThreadFromCraft` 会把 `plan.runtimeBinding.harnessKind` 交给 `craftAgent`；若用户**手动**点 Harness Item，生产路由代码路径是对的。Recipe 按钮与默认 `auto` 会把大多数 UI 操作送回 Codex。
- **DSH**：`UnavailableNativeHarnessRuntimeAdapter.spawnEntity` 抛 `RUNTIME_UNAVAILABLE` 且文案含 `no synthetic Entity`。这项诚实，应保留。
- **Codex baseline**：未发现把生产路径打回 `ThreadSessionManager` / `SpawnPipeline` / CLIProxyAPI。architecture guard 覆盖 nativeHarness 层。
- **安全**：`controlPlane.ts` 会剥离 executablePath / 盘符路径 / 原始 details；IPC payload 拒绝路径型 `harnessKind`。但 Supervisor 调用未接入 live diagnostics，Renderer 也未使用该 IPC。
- **默认 Crafter**：`getDefaultCrafter()` 不带 `checkRuntimeAvailable`，Craft Table 可 compile DeepSeek plan；失败被推迟到 spawn。可接受为延迟诊断，但不能替代 UI/capability 诚实性。

## Findings

### F01 — Capability 过标为 `supported+integrated`（P0）

- Evidence：`descriptors.ts` 对 Codex/Grok/Kimi/Antigravity 的 start/resume/multi_turn/streaming/tool_execution/file_access/shell_execution 等直接 `capabilityMap(...) -> supported+integrated`。Coder 自己的 audit 写明 ACP/PTY/app-server **unprobed**。本 Debugger 本机探针仅 `--version`。
- Impact：UI/Control Plane 会把未验证能力显示成已集成，违反 Manager 的五态矩阵，属于 synthetic 完成声明。
- Root Cause：把“Adapter 代码已接线”当成“native runtime 已验收”。
- Fix：未取得真实 native session / handshake 证据的能力改为 `implementation missing` 或保持诊断 `unprobed`；仅 DSH 用 `unavailable`；原生明确不支持的（如 Grok context/compaction、Kimi MCP、Agy MCP/subagents）保持 `native unsupported`。测试锁定：没有 live evidence fixture 时禁止 `supported+integrated`。
- Acceptance：生产 descriptor 与 control-plane 投影不再把 unprobed 能力标成 `supported+integrated`；矩阵与 audit 文档一致。

### F02 — Craft Table Recipe 一键填充仍强制 Codex `auto`（P0）

- Evidence：`CraftingGrid.tsx` Recipe `onClick`：`setSelectedModelId(availableModels[0].id)` + `setHarnessSelection("auto")`。`registry.resolveSlot("harness", "auto")` 固定返回 `BUILTIN_CODEX_HARNESS_ITEM`。`CraftingGrid.test.tsx` 只覆盖默认 auto -> Codex。
- Impact：用户点击 Grok / Kimi / Antigravity / DeepSeek Recipe 仍会编出 Codex CraftPlan。五个平级 Harness 无法从同一 UI 进入对应 Runtime。
- Root Cause：旧 Codex-first UI 未随 Native Recipe 一起改。
- Fix：Recipe 点击必须填充该 Recipe 的 `harnessItemId` 与匹配 vendor 的 Model Item，而不是 `auto` + 第一个 OpenAI 模型。保留 `auto` 作为显式 Codex 默认可以，但不得劫持其它 Recipe。
- Acceptance：`CraftingGrid` 测试覆盖四个非 Codex Recipe 的一键填充；compile 后 `runtimeBinding.harnessKind` 分别为 grok/kimi/antigravity/deepseek。

### F03 — Control Plane 未进入产品面，且 live 诊断/profile 未接线（P1）

- Evidence：
  - Renderer 无 `getNativeHarnessControlPlane` 引用。
  - `SupervisorRuntime.getNativeHarnessControlPlane` 只传 descriptors + `agentStatusService` + `accountStore.records()`，**不传** `diagnostics`。
  - `profileConfigured` 来自 AccountStore provider 字段，Grok/Kimi 官方认证信号在 `~/.grok` / `~/.kimi-code`，不在该 store。
- Impact：T09 的安全投影停留在单元测试；用户看不到五 Harness 的 ready / not-configured / unavailable / error。Grok 已有 `auth.json` 仍可能被标成未配置。
- Fix：Renderer Harness/Craft 面板消费 typed IPC；Supervisor 聚合各 adapter `getDiagnostics()`；`profileConfigured` 按 harnessKind 使用官方认证信号（文件存在性 / AgentStatus.authState），禁止把路径、token、`CODEX_HOME` 投影给 Renderer。
- Acceptance：IPC 往返测试 + Renderer 测试证明五条 harness 状态可见；敏感字段仍被拒绝。

### F04 — 本 Feature 没有真实 Native Session 证据（P0 / BLOCKED）

- Evidence：Coder 明确“未做真实 login/response”。Lifecycle 测试全部 mock `StructuredSessionHandle` / fake PTY。本机四套官方 CLI 已安装且 Codex/Grok/Kimi 有认证文件，但本轮未做 app-server / ACP / PTY 会话。
- Impact：T03–T06、T08 不能关闭。按 Manager 规则，这不是 PASS，也不是“代码写了就算集成”。
- Fix：对已安装且有认证信号的 Codex / Grok / Kimi，补最小非交互探针（initialize / 一轮受控 prompt / interrupt / dispose），把证据写入 `ai_workspace/validation/`；失败则记录稳定错误码，capability 不得升格。Antigravity 若只能 PTY/soft keyring，保持 soft + `implementation missing`，不要假装 ACP。DSH 继续 unavailable。
- Acceptance：每个已安装 Harness 要么有非 synthetic Entity/Session 证据文件，要么公开状态为 `implementation missing` / `error` / `unavailable`，两者必须与 UI 一致。无证据不得标 PASS。

### F05 — 生产 `craftAgent` 缺少非 Codex Harness 路由回归（P1）

- Evidence：`runtime.test.ts` 的 `craftAgent` 用例全部 `setCustomCraftingAdapter`，默认 craftPlan 还是 `harness: "auto"`（Codex）。没有断言 grok/kimi/antigravity 会构造 `StructuredNativeHarnessRuntimeAdapter` / `PtyNativeHarnessRuntimeAdapter`，也没有断言 deepseek 在 spawn 处 `RUNTIME_UNAVAILABLE`。
- Impact：F02 修完后仍可能在 Supervisor 路由上回归而不被测试抓住。
- Fix：增加**不**覆盖 custom adapter 的定向测试：四个 CraftPlan 分别进入对应 FACTORY；deepseek spawn 失败且无 Entity。可用已有 fixture 注入 provider Adapter，但不得绕过 `createCraftingAdapter`。
- Acceptance：对应测试红/绿证明生产路由，而不是只测 wrapper 类。

## Verdict

**FAIL**

- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 原 Plan 仍有效。这是实现诚实性、UI 组合、Control Plane 接线与真实 runtime 证据缺口，不是产品方向变更。

保留且肯定的部分（修复时不要拆掉）：

- Official/Native First，没有 CLIProxyAPI / 旧 DSH / Model API 假 Harness
- Codex 继续走 `NativeCodexRuntimeAdapter`
- DSH unavailable adapter 拒绝 synthetic Entity
- architecture guard、脱敏投影函数、fixture 级 cleanup

## Fix Plan

Fix Owner：Coder  
Fix Cycle：`v0.4.1`（Native Multi-Harness 轨道；不要覆盖历史 `coder_0.4.1.md` / `debugger_0.4.1.md`）  
交付文档：更新 `coder_0.4.0-native-harness.md` 或新增 `coder_0.4.1-native-harness.md`

### Fix Execution Order

1. **F01** 先改 capability 诚实性（否则 UI/IPC 会继续撒谎）。
2. **F02** 修 Craft Table Recipe 填充与测试。
3. **F05** 补生产 `createCraftingAdapter` / `craftAgent` 路由测试。
4. **F03** 把 control plane 接到 Supervisor live 诊断 + Renderer。
5. **F04** 对已安装 Harness 做最小真实探针或留下一致的 unprobed/error 证据；禁止用 fixture 宣称 Feature PASS。
6. 回归：nativeHarness + crafting + CraftingGrid + craftAgent 路由 + controlPlane；`pnpm typecheck`；必要时 `codegraph sync`。
7. 自检完成后通知 Debugger 复检。

不要扩大到 Universal Skill/MCP、Auto-Crafting、任意 Model×Harness、Gemini CLI、旧 DSH 复活。

## Fix Acceptance Criteria

- [ ] 生产 capability 矩阵与真实证据一致；unprobed 不得为 `supported+integrated`
- [ ] Craft Table 点击各 Native Recipe 会选出对应 harnessKind 与匹配 vendor model
- [ ] `auto` 仍可表示确定性 Codex，但不再覆盖其它 Recipe
- [ ] Renderer 能展示五 Harness 的 ready / not-configured / unavailable / error，且无路径/token/`CODEX_HOME`
- [ ] grok/kimi/antigravity/deepseek 的生产路由有测试；DSH spawn 仍 `RUNTIME_UNAVAILABLE` 且无 Entity
- [ ] Codex 生产路径仍是官方 app-server，不回退 PoraCode TSM
- [ ] 真实 session：有证据则记录 validation 文件；无证据则保持 BLOCKED/unprobed，Coder 不得写 Feature PASS
- [ ] 独立测试与 typecheck 由 Debugger 复跑后才能进入 Closeout

## 给用户的当前验收说明

本轮 **Coder 未通过**。请不要按 PASS 做功能验收。

最短人工复核（仅确认 FAIL 现象，不是放行）：

1. 终端进入 [craftstation](file:///D:/Work/CraftStation/craftstation)，执行 `pnpm dev`，等 Electron 起来。
2. 打开 Craft Table，切到「配方」，分别点 Grok / Kimi / Antigravity / DeepSeek Recipe。
3. 看 Harness 槽：如果仍停在 `auto（确定性 Codex）`，就是 F02。
4. 右侧 Harness 面板：如果看不到五套 ready/unavailable 投影，就是 F03。
5. 不要对未修复版本点「Craft」去跑真实 Grok/Kimi，避免把错误 Recipe 打到 Codex。

修复并通过 Debugger 复检后，会再给最短 PASS 烟雾路径。
