# Debugger 独立复检 — v0.7.0 Native Antigravity CLI and DeepSeek Harness Adapters

> Fix Cycle：v0.7.3（F41~F46）  
> 角色：Debugger  
> 日期：2026-08-30  
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`  
> 分支：`feature/v0.7-native-harnesses`  
> HEAD：`7ae6506`  
> 配对 Coder：`01a04c72-0220-7961-9f23-990eb649b9bc`

## Verdict

**FAIL（Fix Cycle 未完全关闭；Do not promote）**

v0.7.3 已经正确修复或收紧了 F41、F42、F43、F44、F45、F46 的主要源码边界；其中 DeepSeek 当前返回 `RUNTIME_UNAVAILABLE` 是符合事实的 fail-closed 行为，不是用 API proxy、CLIProxyAPI 或 synthetic Session 伪装集成。但本轮仍不能 PASS：

1. Coder 文档声称的 13 个触及文件 `oxfmt --check` 并未全绿；独立复跑有 3 个文件失败。按当前工作树全部 21 个触及 TS/TSX 路径复跑则有 4 个文件失败。
2. F44 源码现在会产生 `turn.completed(state: "interrupted")` 和 `session.exited(reason: "interrupted")`，Supervisor 也会在 `session.exited` 时 release；但现有新增测试没有直接断言这三项关键 contract，回归保护不足。
3. F42 的新错误字符串会由 `CraftingGrid` 捕获并直接显示给用户，但没有 Lingui 本地化；新增 `useCallback` / `useMemo` 也未说明为何需要逃逸 React Compiler，违反仓库明确约定。
4. 本轮全仓测试仍非绿态；失败以既有品牌迁移/路径/remote procedure 基线为主，另有一个本轮 WSL timeout。不能归因成 F41~F46 全部回归，但也不能写成全仓 PASS。
5. 真实桌面点击路径、真实 Windows interrupt 进程级验收，以及未实测高级 capability 仍不能升格为 supported + integrated。

本轮没有修改产品源码、正式测试或 `PROJECT_STATUS.md`；没有创建、移动或切换 worktree；没有 commit、push、tag、merge main、merge nested Dev 或执行 dev→main promotion。

## Review Scope

独立读取并复核：

- `AGENTS.md`
- `PROJECT_STATUS.md`
- `ai_workspace/agent_docs/manager_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.0.md`
- `ai_workspace/agent_docs/debugger_0.7.1.md`
- `ai_workspace/agent_docs/debugger_0.7.2.md`
- `ai_workspace/agent_docs/coder_0.7.3.md`
- `ai_workspace/validation/v0.7.0-antigravity-product-path.json`
- F41~F46 对应 factory、adapter、transport、canonicalizer、Supervisor、IPC、renderer UI/action 与测试 seam

验收原则：不以 Coder 自检、fixture、mock spawn、测试数、单轮 marker 或 GitHub 仓库存在本身替代 Feature-level 验收；不把未实测 capability 升格；不允许 CLIProxyAPI、普通模型 API、synthetic Entity/Session 或 TUI/PTY 注入代替官方 machine-facing runtime。

## Independent Evidence

### 1. Git / worktree boundary

- 当前路径、分支与 HEAD 符合指定目标。
- 工作树有大量 Feature 既有未提交修改，均予以保护。
- CodeGraph 索引属于 main 工作树而不是 v0.7，本轮没有把该索引当作 v0.7 结构证据，改用直接源码检索与测试。

### 2. F41 — 官方 DeepSeek Harness 与 Windows carrier

本轮实时复核：

- `git ls-remote https://github.com/deepseek-ai/deepseek-harness.git HEAD` 返回 `cd5ef8148158c3a752a658978873241fdf8e2bbc`：官方 GitHub 仓库确实存在。
- npm 当前 `@deepseek-ai/dsh` 的 `latest` / `next` / `version` 均为 `0.1.1-rc.2`。
- 本机 `dsh --version` 返回 `0.1.1-rc.2`。
- 本机 `dsh --profile sdk --help` 失败：`dsh: profile "sdk" does not exist`。
- PATH 仅发现 npm `dsh.cmd` / `dsh.ps1` shim，未发现独立 `dsh-jsonrpc-agent`。
- 先前独立 Windows spawn 实测为：`dsh.cmd -> EINVAL`、`dsh.ps1 -> EFTYPE`、无扩展名 `dsh -> ENOENT`。即使手工 `node.exe + @deepseek-ai/dsh/lib/bin.js` 能启动 npm CLI，也不能据此虚构官方 SDK carrier 已闭环。

生产 factory 当前只解析：

```text
resolveExecutablePath("dsh-jsonrpc-agent")
```

缺失时返回 `UnavailableNativeHarnessRuntimeAdapter`，给出稳定 `RUNTIME_UNAVAILABLE` 诊断；没有使用 API proxy、CLIProxyAPI 或 synthetic fallback。这是当前正确边界。

**F41 结论：PASS（诚实 unavailable 行为）；真实 DeepSeek runtime integration 仍为 ENVIRONMENT RUNTIME_UNAVAILABLE。**

### 3. Antigravity product-path evidence

已复核既有 artifact：`ai_workspace/validation/v0.7.0-antigravity-product-path.json`：

- `synthetic: false`
- 官方 `agy.exe` 版本 `1.1.22`
- 路径：`SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe --input-format stream-json --output-format stream-json -> Entity -> Session`
- 响应 marker：`CRAFTSTATION_AGY_PRODUCT_PATH_OK`
- canonical / IPC：`turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`
- cleanup：`SupervisorRuntime.closeThread`，观察到 `session.exited`

由于用户限定本轮只能写独立 Debugger 文档，而真实 integration test 会覆写该 validation JSON，本轮没有重新生成 artifact；因此这里是对既有非 synthetic artifact、源码 seam 与版本的复核，不冒充本轮新运行。

该 artifact 只证明单轮官方 product path、事件 forwarding 和 close cleanup，不证明真实 UI 点击、interrupt、resume/multi-turn、tool/permission、MCP、Skills、subagents、context 或 compaction。

### 4. F42 — production Crafting UI seam

生产 `HarnessPanel.tsx` 现在传入：

```tsx
<CraftingGrid workspace={workspacePath} onCraft={handleCraft} />
```

`handleCraft` 调用 `startThreadFromCraft(currentProject, result, prompt)`；该 action 会创建/persist thread 与 provenance，并把 `craftPlan`、`projectLocation`、prompt 交给 `bridge.craftAgent`。HarnessPanel、CraftingGrid 与 thread launch 定向测试通过。

边界：这是源码与组件/action seam 证据；本轮没有在真实 Electron 窗口完成点击启动与失败 UX 验收。

### 5. F43 / F44 — interrupt lifecycle

- `ipcHandlers.ts` 已把 `interruptThread` 接到 `runtime.interruptThread(payload)`。
- `SupervisorRuntime.interruptThread` 优先查 `craftedSessionsByThread` 并调用 `craftedSession.interrupt()`。
- Windows `NativeProcessCraftSession.interrupt()` 现在：
  - interrupt transport；
  - 将 session 状态置为 `terminated`；
  - `finishTurn("interrupted")` 在缺少 provider completion 时补发 canonical `turn.completed(state: "interrupted")`；
  - 发出 `session.exited(reason: "interrupted")`。
- `registerCraftedSession()` 订阅到 `session.exited` 后调用 `releaseCraftedSession(threadId)`，并继续通过 Supervisor runtime event seam 转发该事件。

因此 v0.7.2 的源码生命周期缺口已经修复。现有测试只断言 interrupted TurnResult、terminated status、不能再次 startTurn，以及 interrupt 路由被调用；没有直接断言 completion event、exit reason 和 Supervisor map/account binding 自动释放，属于关键回归保护缺口。

### 6. F45 / F46

- `descriptors.ts` 对未取得 provider-native evidence 的实现统一保持 `implementation missing`，没有把 Antigravity / DeepSeek 的高级能力写成 supported + integrated。
- `CONTENT_KEY` 已覆盖 `text_delta`、`reasoning_delta`、`output_text`、`delta`、`query` 等正文键，正文摘要为 `{ redacted: true, ... }`，凭据键为 `[REDACTED]`。
- DSH `session.event` 的 nested `params` 展开可正确读取 `params.event`、`params.sessionId` 与 `event.data`，并映射 `turn.completed`。

## Independent Checks

| 检查 | 本轮结果 |
|---|---|
| Focused native/UI/IPC Vitest | `10 passed / 1 skipped` files；`128 passed / 1 skipped` tests |
| `pnpm run typecheck` | PASS |
| 原始 F40 六文件 + product-path test `oxfmt --check` | PASS，7 files |
| 原始 F40 七路径 `oxlint --deny-warnings` | PASS |
| Coder v0.7.3 声称的 13 文件 `oxfmt --check` | **FAIL**：`nativeHarness.ts`、`controlPlane.ts`、`structuredAdapter.ts` |
| 当前全部 21 个触及 TS/TSX `oxfmt --check` | **FAIL**：上述 3 个 + `nativeRuntimeConfig.test.ts` |
| 13 文件 `oxlint --deny-warnings` | PASS |
| `git diff --check` | PASS |
| full `pnpm run lint` | FAIL：既有 `codexRouterOverlay.test.ts:52` 的 `vitest(no-conditional-expect)` |
| full `pnpm run test -- --reporter=dot` | `7 failed / 854 passed / 10 skipped` files；`17 failed / 9614 passed / 48 skipped` tests |

全仓测试失败归属：

- `remoteProcedureRouter.test.ts`：2 个 profile login procedure 未分类。
- `poracodeData.migrate.test.ts`：迁移、marker、backup、lock、rollback 基线。
- `channel.config-parity.test.ts`、`channel.test.ts`、`poracodePaths.test.ts`、`probeCwd.test.ts`：`.poracode` / `.craftstation` 品牌路径基线不一致。
- `supervisor/wsl/runtime/index.test.ts`：1 个 15 秒 timeout；这是本轮相较先前数字新增的环境性失败，没有证据指向 F41~F46。

## F41~F46 Status Matrix

| Fix | 独立复核结果 | 状态 |
|---|---|---|
| F41 DeepSeek factory / Windows carrier | 只接受独立 `dsh-jsonrpc-agent`；缺失时稳定 unavailable；真实 npm 包无 sdk profile | **PASS（honest unavailable）** |
| F42 HarnessPanel → startThreadFromCraft | 生产 callback/workspace/action/IPC 参数接线与定向测试成立；真实桌面未验 | **PASS / LIMITED** |
| F43 interrupt IPC route | crafted session 优先路由与单测成立 | **PASS** |
| F44 Windows interrupt lifecycle | 源码 completion/exit/release 链成立；缺直接 contract regression | **IMPLEMENTATION PASS / TEST GAP** |
| F45 capability honesty | 未实测能力保持 implementation missing | **PASS** |
| F46 redaction / DSH canonicalizer | 正文键脱敏与 nested event 展开成立 | **PASS** |
| F40 static gate | 原始 7 路径通过，但 v0.7.3 声称的 13/全部触及路径失败 | **FAIL** |

## Findings

### [P1] F40：v0.7.3 “13 个触及文件全部格式对齐”与独立结果不符

13 文件门实际失败：

- `src/shared/crafting/nativeHarness.ts`
- `src/supervisor/runtime/nativeHarness/controlPlane.ts`
- `src/supervisor/runtime/nativeHarness/structuredAdapter.ts`

全部 21 个触及 TS/TSX 路径还额外失败：

- `src/shared/crafting/nativeRuntimeConfig.test.ts`

**影响：** Coder v0.7.3 的静态门声明不可复现，Fix Cycle 不能 PASS。

**修复：** 仅格式化上述触及文件，不全仓格式化、不清理其他角色修改；随后以明确文件数组复跑，而不是用 PowerShell 中未展开的数组参数产生假绿/假失败。

### [P1] F44：关键 interrupt contract 缺直接回归断言

源码目前正确补发 `turn.completed(interrupted)`、`session.exited(interrupted)` 并触发 Supervisor release，但新增测试没有直接断言事件唯一性、reason/state，以及 `craftedSessionsByThread` / account binding 在 interrupt 后已释放。

**影响：** 未来重构可能悄悄破坏 renderer turn settle 或 Supervisor 缓存释放，而现有测试仍然绿色。

**修复：** 在 native adapter 测试中订阅并精确断言 event sequence；在 Supervisor 测试中使用能够 emit `session.exited` 的 crafted session，interrupt 后通过公开行为证明 binding/map 已释放，并断言 runtime event forwarding。

### [P2] F42：新增用户可见错误未本地化

`HarnessPanel.tsx` 新增：

```ts
throw new Error("No project selected to launch crafted Agent.");
```

`CraftingGrid` 会 catch 此错误并把 `error.message` 渲染到 UI，因此它属于 renderer 用户可见字符串。该字符串未使用 Lingui macro，也未进入 13 个 locale catalog，违反 `AGENTS.md` 的强制 i18n 规则。

### [P2] F42：新增 React 手工 memoization 未说明逃逸理由

`handleCraft` 使用新增 `useCallback`，`workspacePath` 使用新增 `useMemo`；仓库约定 React Compiler 为默认 memoization，禁止无说明新增 `useCallback` / `useMemo`。这里没有看到必须逃逸 compiler 的证据。

### [P2] Native adapter 保留终态 session 的 bounded retention

`NativeProcessHarnessRuntimeAdapter.sessions` 只 `add`，从不 `delete` / `clear`，且没有其他读取用途。Supervisor 每次解析 adapter 时会覆盖相同 harness 的 map entry，因此当前更接近“每 harness 最近 adapter/session 的有界滞留”而不是无界泄漏；但终态 session 不被 adapter 主动释放，生命周期 ownership 不清晰。

**修复：** 删除无用途 Set，或在 session terminal callback / adapter dispose 中明确清理并增加测试；不要把 Supervisor map release 当作 adapter 内部 ownership 自动完成。

## Remaining

- 修复 4 个触及路径格式问题并复跑 13/21 文件门。
- 为 F44 增加 canonical event、reason/state、Supervisor release 的直接 regression。
- 本地化 F42 新增用户可见错误，移除或说明手工 memoization。
- 在真实 Electron 中完成 CraftingGrid 点击 → thread row → `craftAgent` → renderer event → close/interrupt 的最短 product smoke。
- DeepSeek 等待或安装可验证的官方 Windows `dsh-jsonrpc-agent` carrier 后，再运行真实 `initialize -> session/prompt -> session.event -> shutdown`；在此之前继续 `RUNTIME_UNAVAILABLE`。
- Antigravity / DeepSeek 的 tool、permission、MCP、Skills、subagents、resume/multi-turn、context、compaction 必须逐项有 provider-native evidence 才能改变 capability state。

## Fix Plan

1. 修复上述 4 个触及文件的格式，并用显式文件数组复跑 `oxfmt --check`。
2. 补 F44 直接 regression：事件序列、唯一性、exit reason、Supervisor release 与 forwarding。
3. 修复 F42 i18n 与 React Compiler 规范问题。
4. 重新运行 focused tests、触及 lint、typecheck、diff check；记录全仓失败归属，不要求为本 Feature 擅改无关基线。
5. 重新交接同一 v0.7 Feature Debugger 复检；不可复用 v0.6 Debugger。

## Fix Acceptance Criteria

- 原始 F40 7 路径、Coder 13 路径及当前全部触及 TS/TSX 路径 `oxfmt --check` 全部退出码 0。
- F44 测试明确观察且仅观察一次 `turn.completed(state="interrupted")`、`session.exited(reason="interrupted")`，并通过公开行为证明 Supervisor crafted-session/account binding 已释放。
- F42 新增用户可见文本全部经 Lingui，本次新增手工 memoization 已移除或有可验证的 compiler escape 理由。
- focused test、触及 oxlint、typecheck、git diff check 全绿。
- DeepSeek 仍不得在无官方 carrier 时伪装 ready；若 carrier 仍缺失，`RUNTIME_UNAVAILABLE` 即为正确验收结果。

## Fix Execution Order

1. F40 格式门。
2. F44 contract regression。
3. F42 i18n / React Compiler 规范。
4. focused + static + baseline attribution。
5. 同 Feature Debugger re-review。

## Requires Manager Re-plan / Ideate Revision

- Requires Manager Re-plan：**No**。当前问题是局部格式、测试保护和 renderer 规范；F41 的 unavailable 行为已经与现有 Feature 边界一致，不需改变产品目标。
- Requires Ideate Revision：**No**。

## Final Decision

**Do not promote. Do not merge to nested Dev.**

v0.7.3 的主要运行时修复方向成立，尤其 F41 已正确从错误的 npm shim / sdk 假设退回 honest unavailable，F44 源码也补齐 interrupt terminal events。但触及文件格式门不可复现、关键 regression 与 renderer 规范仍有缺口，因此本轮 verdict 为 **FAIL**。修复后需由同一 v0.7 专属 Debugger 再次独立复检。
