# Debugger — v0.8.3

> 对应 Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 角色：Debugger
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06` + 未提交 v0.8 改动
>
> 上一轮：[debugger_0.8.2.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/debugger_0.8.2.md)
>
> Coder 交付：[coder_0.8.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/coder_0.8.0.md)
>
> Manager Plan：[manager_0.8.0.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/manager_0.8.0.md)
>
> Verdict：**FAIL / BLOCKED**
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**

## Review Scope

独立 Feature-level 复检，不把 Coder 自检、合同测试绿灯或 compatibility JSON 记录存在当成真实 E2E PASS。本轮核对：

1. 登记工作树 / 分支 / 基线，不在 main 或 nested Dev 上验收候选代码。
2. Coder 声称的 `package.json` 污染修复：与 HEAD 一致。
3. 桌面快捷方式 `C:\Users\Haona\Desktop\OpenCode.lnk` 是否可当作 headless `opencode serve`。
4. PATH / 常见安装位是否存在官方 CLI。
5. 定向 8 文件 / 41 测试、tsc、oxlint、oxfmt 是否可独立复现。
6. capability / recipe / 兼容矩阵是否被升格成虚假 PASS。
7. Manager Acceptance Gates 中的真实 session / stream / 五类模型 init 是否取得。
8. 已关闭工程项不重开：HTTP/OpenAPI+SSE 合同、session/event seam、binding、recipes、composition、脱敏。

未执行 commit / push / tag / merge main / merge nested Dev。未改 v0.6 `craftstation-dev` 或 v0.7 工作树。

## Evidence

### Git / 工作树

- 当前分支：`feature/v0.8-opencode-native`
- HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06`（与 Manager 基线一致）
- 工作区：已修改 AGENTS.md、PROJECT_STATUS.md、crafting / nativeHarness / OpenCode 新增文件；`package.json` 与 `pnpm-lock.yaml` 相对 HEAD 干净
- `code-review` 三-dot `7ae6506...HEAD` 为空，因为 v0.8 仍是未提交工作区。本轮改为直接审阅 working tree vs `7ae6506`

### 独立 CLI / 快捷方式探针（本轮 Debugger 亲自执行）

证据：[v0.8.0-debugger-0.8.3-recheck.txt](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-debugger-0.8.3-recheck.txt)

- `Get-Command opencode, opencode.exe, opencode.cmd`：全部 `NOT_FOUND`
- 常见安装位 `Test-Path` 全 false：`%LOCALAPPDATA%\opencode`、`Programs\opencode`、npm shim、`~\.opencode\bin`、`~\.local\bin`、Program Files、scoop shim
- 桌面快捷方式存在：
  - Target：`C:\Users\Haona\AppData\Local\Programs\@opencode-aidesktop\OpenCode.exe`
  - Arguments 为空
  - ProductName / FileDescription：`OpenCode`
  - FileVersion：`1.18.21`
  - 体积：231548456 bytes
  - 同目录含 `chrome_100_percent.pak`、`ffmpeg.dll`、`app.asar`、`LICENSE.electron.txt`
- `OpenCode.exe --help`：3 秒内无 CLI help 输出，进程仍在运行；本轮杀掉 pid=8120
- 独立结论：该快捷方式是 Electron GUI 桌面应用，**不能**作为 headless `opencode serve`。PATH 仍无官方 CLI。`OPENCODE_BINARY_UNAVAILABLE` 成立。

本轮没有启动 GUI 当 server、没有读取凭据、没有 synthetic smoke。

### 独立复跑测试 / 静态检查

- 定向 Vitest：`8 files / 41 passed`
  - `src/shared/opencodeNative/binding.test.ts`
  - `src/supervisor/runtime/openCodeNative/events.test.ts`
  - `src/supervisor/runtime/openCodeNative/session.test.ts`
  - `src/supervisor/runtime/openCodeNative/transport.test.ts`
  - `src/shared/crafting/openCodeNativeComposition.test.ts`
  - `src/shared/crafting/nativeHarnessRegistry.test.ts`
  - `src/shared/crafting/crafting.test.ts`
  - `src/supervisor/runtime/nativeHarness/controlPlane.test.ts`
- `npx --no-install tsc --noEmit -p tsconfig.json`：exit 0
- 本轮改动文件 `oxlint`：exit 0
- 本轮改动文件 `oxfmt --check`：All matched files use the correct format
- 仓级 `pnpm fmt:check` 仍被既有文档/非本 Feature 文件挡住，不作为 v0.8 FAIL

合同测试绿灯只证明 wiring，不构成五类模型真实 E2E。

### 兼容矩阵与 capability 诚实性

- [v0.8.0-opencode-compatibility.json](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-opencode-compatibility.json)：`probe.status=unavailable`，`reason=OPENCODE_BINARY_UNAVAILABLE`；六条记录仍全部 `unavailable`
- `capabilityMap()` 仍把 implemented 标为 `implementation missing`；descriptors 不含 `supported+integrated`
- OpenCode recipes 仍为 `EXPERIMENTAL`
- 没有把 catalog / fixture / 快捷方式存在升格成 Native E2E PASS

### 源码边界（独立抽检）

- Transport：`OpenCodeNativeTransport` 走官方 SDK client + `buildOpenCodeServerCommand` / `opencode serve`，不抓 TUI
- Adapter factory：`nativeHarness/index.ts` 的 `opencode` 工厂指向 `OpenCodeNativeRuntimeAdapter`，`harnessKind: "opencode"`
- Binding：OpenAI / xAI / Google / DeepSeek / Moonshot-native / Moonshot OpenAI-compatible 分开；DeepSeek 不走 DSH Harness
- Events / CraftPlan：敏感字段脱敏；controlPlane 公共投影不回显物理路径
- CodeGraph：`codegraph status` 显示索引属于 `D:\Work\CraftStation\craftstation` 而非本 worktree。本轮以降级源码/测试审阅继续，不阻塞 Verdict

## Review

### Spec Fidelity

Manager Intent 是 Official/Native OpenCode Harness：`opencode serve` + HTTP/OpenAPI + SSE，五类 Model Provider 独立绑定。工程契约与此对齐。Acceptance Gates 要求真实 session / stream / abort / 五类模型 init 证据；当前只有可复现阻塞证据，Feature 不能 PASS。

### Integration

OpenCode 已接入 crafting registry、Native Recipe、controlPlane、IPC 安全投影。未验证组合保持 EXPERIMENTAL / implementation missing / unavailable。未把 Antigravity / DSH 当成 OpenCode。

### Regression

定向 41 测试独立通过。仓级既有失败（品牌路径、migration、remote procedure overlay lint）仍在，未发现 Coder 为全绿去改无关测试。`package.json` 污染已不存在。

### Runtime / Edge Cases

无官方 CLI 时 transport 只能走 unavailable。桌面 Electron GUI 不是可替代的 serve 入口。无凭据时不得伪装 smoke。这些边界当前被诚实记录。

### Architecture / Standards

Harness vendor 与 Model vendor 分离；CraftStation 包装 Runtime，不重写模型 API。SDK `@opencode-ai/sdk@1.18.10` 未被表述成 CLI 版本。安全引用保持 opaque。

## Findings

### F37 — 官方 OpenCode CLI 仍不可用，真实 E2E 未取得

- Evidence：PATH 无 `opencode`；常见安装位全 false；桌面快捷方式指向 Electron GUI `OpenCode.exe` 1.18.21；`--help` 不提供 CLI；兼容矩阵 6/6 `unavailable`
- Impact：无法完成 Manager 要求的真实 init / assistant stream / multi-turn / tool / compaction / usage。Feature 不能 PASS，也不能合入 nested Dev
- Root Cause：当前机器没有官方 headless `opencode` executable 与对应 provider 凭据。不是本轮合同代码回退，也不是 shortcut 探测遗漏
- Fix：**Coder 不要再改代码、不要再空转 CLI 检查、不要把 GUI exe 当成 serve。** 等官方 `opencode` CLI 与凭据可用后再做真实 smoke
- Acceptance：官方 CLI `opencode --version` / `opencode serve` 可用后，五类模型（含 Kimi 双 route）各自留下真实 init/stream/终态证据；capability / recipe / 矩阵只按真实结果升格

已关闭工程项保持关闭。无新的必须立刻改代码的工程回归。

## Fix Plan

1. Coder 停止本 Feature 的代码修改与重复 CLI 空转。
2. 保持 compatibility JSON、descriptor capability、recipe `EXPERIMENTAL` 不被升格。
3. 官方 headless `opencode` 进入 PATH 或明确 executablePath 后，再启动 `opencode serve`，做非 synthetic 的五类模型最小 smoke。
4. 不要用桌面 `OpenCode.lnk` / `@opencode-aidesktop\OpenCode.exe` 冒充 CLI。
5. 真实证据写入 compatibility artifact 后，再交本 Debugger 复检。

## Fix Acceptance Criteria

- [ ] 官方 headless `opencode` 可执行，且 `opencode serve` 能建立 HTTP/OpenAPI + SSE
- [ ] OpenAI、xAI/Grok、Gemini、DeepSeek Model、Kimi Moonshot-native、Kimi OpenAI-compatible 至少各有一条真实 init/stream/终态证据，或继续诚实 `unavailable`
- [ ] 无 fixture/catalog/GUI 快捷方式被写成 Native E2E PASS
- [ ] capability / recipe 只按真实结果升格
- [ ] 未读取或投影 secret
- [ ] 定向合同测试与本轮静态检查不回退

## Fix Execution Order

1. 等待官方 CLI + 凭据。
2. 真实 smoke / 更新 compatibility artifact。
3. 交 Debugger 复检。无 CLI 时不要进入新的代码 Fix Cycle。

## Requires Manager Re-plan

`No`

计划仍成立：官方 Native Harness 路线正确；阻塞是环境缺少 CLI，不是 Spec 失效。

## Requires Ideate Revision

`No`

## Verdict

`FAIL / BLOCKED`

打开项只有 F37。工程契约可保持关闭。不得 merge nested Dev、不得 merge main、不得打正式 tag。

## User Smoke

本轮 FAIL，不打开产品给用户验收。真实 OpenCode session 尚未存在。

## Feature → Dev Closeout

- Report generated：No（FAIL 不生成 PASS report）
- PROJECT_STATUS updated：Yes
- Lifecycle State：`DEBUGGER FAIL / BLOCKED`
- Feature → Dev merge：未完成
- Merge conflict：未发生
- Main Promotion：NOT AUTHORIZED
- Dev commit / local SHA：仍为基线 `7ae6506` + 未提交 v0.8 改动
- origin/dev remote SHA verified：No（未 push / 未 merge）
- Official release tag created：No
- Cloud/local sync：N/A
- Clickable links in chat：debugger / validation / PROJECT_STATUS
