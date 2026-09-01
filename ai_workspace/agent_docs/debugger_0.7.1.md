# Debugger 最终复检 — v0.7.1 Native Antigravity CLI and DeepSeek Harness Adapters

> 对应 Feature：`v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`
>
> Fix Cycle：`v0.7.1`
>
> 角色：Debugger（v0.7 专属独立复检）
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
>
> 分支：`feature/v0.7-native-harnesses`
>
> HEAD：`7ae6506` + 未提交 v0.7 改动
>
> Verdict：**FAIL / BLOCKED**
>
> Main promotion：`NOT AUTHORIZED`

## 结论修正

上一版本文档的 `PASS / LIMITED` 结论撤回。

用户指出官方仓库已经提供 `dsh web` 后，本轮重新安装并实测官方 `@deepseek-ai/dsh`，同时重新读取 2026-08-27 的官方 GitHub `master`。此前“官方没有 Windows carrier，因此 F39 可按诚实 unavailable 关闭”的事实前提已经过时：

- 官方 npm CLI `dsh` 可在本机 Windows 安装和运行。
- `dsh web` 可在 Windows 正常启动并返回 HTTP 200。
- 官方 GitHub 最新源码还明确实现了 Windows x64 Python SDK runtime、`dsh --profile sdk` / `sdk-minimal` 和 JSON-RPC server 路径。
- CraftStation 当前仍只寻找不存在的旧名字 `dsh-jsonrpc-agent`，因此把真实存在的 `dsh` 判成 `RUNTIME_UNAVAILABLE`。

这不是“Windows 没有 DeepSeek Harness”，而是 **CraftStation 的 DeepSeek Adapter 没有跟上官方入口与协议实现**。

## Review Scope

本轮只在既有 v0.7 worktree 读取、测试和更新本 Debugger 文档；未修改产品源码或测试，未创建/移动/切换 worktree，未 commit、push、tag、merge，也未触碰 main、共享 v0.6 或 v0.8 worktree。

复核范围：

1. F40：指定六文件与 product-path integration test 的格式、触及路径 lint、typecheck、diff。
2. F38：真实 Antigravity product path、退出清理、IPC seam，以及 UI、interrupt、多轮和 capability 事实。
3. F39：重新核对官方 npm/GitHub 的 Windows carrier，不沿用 2026-08-29 的旧结论。
4. Composition UI、Supervisor IPC、native transport、descriptor、错误与脱敏边界。
5. 定向回归和全仓基线失败归属。

## Evidence

### 官方 DeepSeek Harness 安装与 Windows 实测

本轮执行：

```text
npm install -g @deepseek-ai/dsh@0.1.1-rc.2
dsh --version
dsh --help
dsh web --help
dsh --profile headless --help
```

结果：

- 安装成功：`@deepseek-ai/dsh 0.1.1-rc.2`
- Windows 命令：`C:\Users\Haona\AppData\Roaming\npm\dsh.ps1`
- `dsh web --no-open --host 127.0.0.1 --port 0` 启动成功。
- 本轮监听地址：`http://127.0.0.1:6512`
- HTTP `/`：`200`，`Content-Type: text/html; charset=utf-8`
- `dsh --profile headless` 已进入官方 Harness/认证路径；当前环境的 `DEEPSEEK_API_KEY` 格式无效，因此真实模型响应停在 `AUTH`，没有伪造成功。

官方 npm CLI 自带的 profile：

- `dsh web`：持久 browser application。
- `dsh --profile headless "task"`：创建一个持久化 Session、输出最终答案并退出。

这已经足以否定“Windows 完全没有官方 DSH carrier”。

### 官方 GitHub 最新源码事实

官方仓库：`deepseek-ai/deepseek-harness`

- `master` HEAD：`cd5ef8148158c3a752a658978873241fdf8e2bbc`
- 官方 release/tag：`dsh-v0.1.2-alpha.1`，发布日期 2026-08-27。
- `apps/cli/package.json` 源码版本：`0.1.2-alpha.1`。
- 官方 `docs/user/guide/python-sdk.md` 已列出 `Windows x64`。
- 官方架构文档明确实现：
  - `deepseek-harness-sdk-runtime-win-x64.exe`
  - Windows wheel tag `py3-none-win_amd64`
  - 普通 `dsh --profile sdk`
  - 示例使用 `dsh --profile sdk-minimal`
  - SDK JSON-RPC server row
  - Windows PowerShell persistent tool surface

发布状态边界：

- npm 当前公开最新仍是 `0.1.1-rc.2`，没有 `0.1.2-alpha.1` npm 包。
- 本机 PyPI 当前查不到 `deepseek-harness-sdk` / runtime wheel。
- GitHub `dsh-v0.1.2-alpha.1` release 当前没有二进制 assets。

因此最新 SDK Windows carrier 可能需要从官方源码/tag 构建，不能假装已从 PyPI 安装成功；但这与“官方不存在 Windows carrier”是两回事。

### CraftStation 当前 DeepSeek 实现

源码仍固定为旧边界：

```text
resolveExecutablePath("dsh-jsonrpc-agent")
machineFacingBoundary: "official dsh-jsonrpc-agent over JSON-RPC stdio"
DSH_CORDIS_CONFIG + positional configPath
```

本机事实：

```text
dsh-jsonrpc-agent  MISSING
dsh                FOUND
```

所以当前工厂对已安装的官方 `dsh` 仍返回 `UnavailableNativeHarnessRuntimeAdapter`。Fixture 测试使用自造的 `dsh-jsonrpc-agent-fixture`，不能证明官方 `dsh` 产品路径。

### Antigravity 真实产品路径

既有 artifact 仍有效：

- `agy 1.1.22`
- `synthetic: false`
- 路径：
  `SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> agy.exe stream-json -> Entity -> Session`
- 响应：`CRAFTSTATION_AGY_PRODUCT_PATH_OK`
- native events：`init`、`step_update`、`result`
- canonical/IPC seam：
  `turn.started`、`session.started`、`content.delta`、`turn.completed`、`session.exited`
- cleanup：
  `SupervisorRuntime.closeThread -> session.terminate -> session.exited`

该证据只证明单轮文本、事件投影和 close cleanup，不证明完整 Antigravity 适配。

### 静态检查

| 检查                                           | 结果                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| F40 六文件 + product-path test `oxfmt --check` | PASS，7 files                                                     |
| 触及 TypeScript/TSX `oxlint --deny-warnings`   | PASS                                                              |
| `pnpm run typecheck`                           | PASS                                                              |
| `git diff --check`                             | PASS                                                              |
| 全仓 `pnpm run lint`                           | FAIL，1 个既有 `codexRouterOverlay.test.ts:52` conditional expect |

F40 保持关闭。

### 测试

定向回归：

```text
Test Files  9 passed
Tests       53 passed
```

覆盖 native adapter、lifecycle acceptance、provider fixtures、control plane、native runtime config、native registry、HarnessPanel、CraftingGrid、thread launch actions。

全仓：

```text
Test Files  6 failed | 855 passed | 10 skipped
Tests       16 failed | 9610 passed | 48 skipped
```

16 个失败集中在既有 `.poracode` / `.craftstation` 品牌路径、数据迁移、probe cwd 和 remote procedure classification；未发现 v0.7 native 定向测试新增失败。全仓基线失败不替代 Feature 验收，也不把本 Feature 自动判 PASS。

## Findings

### F41 — P0：DeepSeek 官方 Windows carrier 已存在，但产品只找旧 `dsh-jsonrpc-agent`

**Evidence**

- 官方 npm `dsh 0.1.1-rc.2` 已安装并在 Windows 运行。
- `dsh web` 实测 HTTP 200。
- 官方最新源码已实现 Windows x64 SDK/JSON-RPC runtime。
- `index.ts` / `nativeAdapter.ts` 只解析 `dsh-jsonrpc-agent`。

**Impact**

DeepSeek 在 CraftStation UI 中被错误显示为 `RUNTIME_UNAVAILABLE`。当前 Feature 没有适配真实官方产品入口。

**Required fix**

重新按官方版本选择并实现一条真实边界：

1. 优先适配官方 SDK profile 的 stdio JSON-RPC：`dsh --profile sdk` 或 `sdk-minimal`，使用显式 `DSH_HOME`，按官方 initialize/run/notification/shutdown 协议实现。
2. 若当前只采用 npm `0.1.1-rc.2`，`headless` 只能作为有限的一次性 tracer bullet，不能冒充 persistent multi-turn Session。
3. `dsh web` 是真实官方产品，但官方文档明确它是独立 browser application；不得抓 UI、不得把普通 HTTP 页面当 SDK JSON-RPC。
4. 若需要从 `dsh-v0.1.2-alpha.1` 源码构建，必须固定官方 tag/SHA、构建产物和 provenance，再做 Windows 真实 product-path test。

不得使用 CLIProxyAPI、普通 OpenAI-compatible API 或 synthetic runtime 替代 Harness。

### F42 — P1：生产 Crafting UI 没有调用 `startThreadFromCraft`

**Evidence**

- `HarnessPanel.tsx` 渲染的是 `<CraftingGrid />`，没有传 `onCraft`。
- `CraftingGrid.handleCraft()` 在没有 `onCraft` 时只输出：
  `[Feature Pending Implementation] Spawn crafted Agent Entity`
- `startThreadFromCraft()` 只有测试和 `uiPreview.tsx` 调用，生产 HarnessPanel 无调用者。

**Impact**

用户在真实 CraftStation HarnessPanel 点击“合成并启动 Agent”不会进入 `bridge.craftAgent`，因此“CraftStation UI -> CraftPlan -> Entity -> Session”没有完成。

### F43 — P1：crafted Session 的 interrupt IPC 未接 Supervisor crafted-session map

**Evidence**

- `ipcHandlers.ts`：
  `interruptThread: (payload) => threads.interruptThread(payload)`
- crafted Session 存在 `SupervisorRuntime.craftedSessionsByThread`。
- `closeThread()` 已特殊处理 crafted Session；`interruptThread()` 没有对应 Runtime 路由。

**Impact**

UI/IPC 的暂停或中断请求会落到旧 `ThreadSessionManager`，找不到 crafted Session。真实 native Session 不能按产品控制面中断。

### F44 — P1：Antigravity Windows interrupt 会杀死进程，却把 Session 留成可继续状态

**Evidence**

- `NdjsonProcessTransport.interrupt()` 在 Windows 调用 `child.kill()`。
- `NativeProcessCraftSession.interrupt()` 随后 `finishTurn("interrupted")`，状态回到 `idle`。
- 下一轮仍尝试对已经被杀死的 transport 写 stdin。

**Impact**

当前不是官方可恢复 interrupt；执行一次 interrupt 后，多轮 Session 预期失败。不能把 `interrupt`、`multi_turn` 或 `resume` 视为已适配。

### F45 — P1：capability 状态不符合真实证据

**Evidence**

Antigravity descriptor 将 `mcp`、`subagents`、`context`、`compaction` 写为 `native unsupported`；本轮没有官方实测证明这些能力原生不支持。其他 tool、permission、skills、resume、multi-turn 仍无真实产品证据。

**Impact**

“未验证”被错误表达为“官方不支持”。正确状态应是 `implementation missing` / unverified，直到真实 capability probe 完成。

### F46 — P1：nativeEnvelope 的内容脱敏存在漏项

**Evidence**

- `redactNativePayload()` 只对精确 key `text`、`content`、`response` 等做摘要。
- `text_delta`、`reasoning_delta`、`output_text` 等字符串 key 会进入 `safeText()`，保留原文最多 500 字符。
- canonical event 的 `nativeEnvelope` 会随 Supervisor runtime event 进入 IPC。

**Impact**

部分 provider 原始文本可能通过诊断 envelope 跨 IPC；与“原始敏感 payload 不进入日志/IPC”的边界不一致。

## F38 / F39 / F40 状态

| Finding         | 最终状态               | 说明                                                                                                                |
| --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F40 格式门      | **CLOSED**             | 指定格式、触及 lint、typecheck、diff 均通过。                                                                       |
| F38 Antigravity | **PARTIAL / BLOCKING** | 单轮真实文本、event forwarding、close cleanup 成立；生产 UI、interrupt、multi-turn/resume、capability gate 未闭合。 |
| F39 DeepSeek    | **REOPENED / FAIL**    | 官方 Windows `dsh` 已存在；当前 Adapter 仍绑定旧、不可发现的 carrier。                                              |

## 已完成与未完成

### 已完成

- Antigravity 官方 `agy` stream-json 单轮真实产品路径。
- canonical 文本/turn/session 事件投影。
- `SupervisorRuntime.closeThread -> session.exited`。
- native Recipe、CraftPlan、Entity/Session 核心 seam。
- DeepSeek unavailable adapter 不创建 synthetic Entity/Session。
- 定向测试、格式、触及 lint、typecheck、diff。
- 官方 `dsh` 已在本机安装，Windows `dsh web` 可运行。

### 未完成

- 生产 HarnessPanel 的 Crafting 启动接线。
- crafted Session 的 send/interrupt 产品 IPC 路由。
- Antigravity 官方可恢复 interrupt、多轮、resume。
- tool/permission/MCP/Skills/subagents/context/compaction 的真实验证。
- 最新官方 DSH Windows SDK/JSON-RPC 产品路径。
- DeepSeek 真实 init、stream、multi-turn、cleanup。
- Electron 窗口端到端真实 smoke。

## 下一步

1. Coder Fix Cycle 先关闭 F41：按官方 `dsh` profile/SDK 重新实现 DeepSeek discovery、launch 和 JSON-RPC；不得继续围绕虚构的 `dsh-jsonrpc-agent`。
2. 关闭 F42/F43：HarnessPanel 传入真实 `onCraft`，Supervisor `interruptThread` / 后续 turn 必须识别 crafted Session。
3. 关闭 F44/F45：实现或诚实禁用官方 interrupt；capability 全部回到 evidence-based 状态。
4. 关闭 F46：扩展内容 key 脱敏与回归测试。
5. 最终验收必须分别取得：
   - Antigravity：UI 启动、至少两轮或明确 resume、官方 interrupt/close、事件和资源清理。
   - DeepSeek：官方 Windows carrier 的真实 initialize、stream、Session continuation、shutdown。
6. 在上述 blocker 关闭前，不得 merge dev/main，不得打 `v0.7.0` tag，不得写 PASS 报告。

## Verdict

**FAIL / BLOCKED**

Antigravity 的单轮核心 Runtime 是真的，但还不是“全部按照要求适配完成”；DeepSeek 官方 Harness 也不是不存在，而是当前 CraftStation Adapter 没有适配真实的 Windows `dsh` 入口。Feature v0.7.0 当前不能 PASS。
