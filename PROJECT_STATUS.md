# PROJECT_STATUS.md

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库精确基线见 `reference/BASELINES.md`。

## Parallel Feature Notice — v0.7.0

本工作树承载一个与共享 v0.6 并行的独立 Feature，不覆盖或搬运共享工作树的未提交修改。

- Feature：`v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`
- Manager Plan：`ai_workspace/agent_docs/manager_0.7.0.md`
- Tickets：`.scratch/craftstation-0.7.0/issues/`
- Feature worktree：`D:\Work\CraftStation\dev\.worktrees\v0.7-native-harnesses`
- Feature branch：`feature/v0.7-native-harnesses`
- Base：`dev` / `7ae6506`
- Lifecycle：`DEBUGGER DIRECT RE-REVIEW v0.7.15 — FAIL / PARTIAL（ENGINEERING PASS；AGY/Grok/Kimi/Codex Native Agentic PASS；DSH/API AUTH BLOCKED）`
- Debugger Fix Plan：`ai_workspace/agent_docs/debugger_0.7.15.md`（Codex provider-native子Agent已闭环；剩余为DSH/API认证、三项动态模型与宿主返回正文外部阻塞）
- v0.7 专属 Debugger task：`01a04cf5-47e0-7b12-8e0e-9d3768cfb6e8`（`grok-4.6` / `high`）
- Main promotion：`NOT AUTHORIZED`
- Shared Dev worktree：`D:\Work\CraftStation\dev`（保持原样）
- 当前修复责任：按用户最新授权由本 Debugger 任务直接修复与复检，不再回派 Coder；范围仍仅限本 Feature worktree，不得写 `main`、共享 v0.6/dev 或 v0.8。

## v0.7.0 Coder Closeout Snapshot

- Feature：`v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`
- Manager Plan：`ai_workspace/agent_docs/manager_0.7.0.md`
- Coder 交付：`ai_workspace/agent_docs/coder_0.7.0.md` ~ `coder_0.7.8.md`
- Fix Cycle v0.7.9 Coder 交付：`ai_workspace/agent_docs/coder_0.7.9.md`
- Lifecycle：`DEBUGGER DIRECT RE-REVIEW v0.7.10 — FAIL / PARTIAL（ENGINEERING PASS；F48 CLOSED；Antigravity真实response已闭环；官方DSH与高级能力仍BLOCKED）`
- Debugger Verdict：`FAIL / PARTIAL（Engineering PASS；Antigravity与Command Code DeepSeek Agentic smoke通过；官方DSH真实assistant response及DSH高级能力未闭环）`
- Main promotion：`NOT AUTHORIZED`
- Feature branch：`feature/v0.7-native-harnesses`
- Base：`dev / 7ae6506`

### Native Evidence Boundary

- Antigravity：已通过 CraftStation 产品路径驱动真实官方进程。路径为
  `SupervisorRuntime.craftAgent -> NativeProcessHarnessRuntimeAdapter -> official agy.exe stream-json -> Entity -> Session`；
  最新 `agy 1.1.22` artifact 为 `synthetic=false / PASS / responseLength=33 / marker=true / cleanup=true`。独立CLI smoke还验证了原生工具、AGENTS自动读取、Skill、MCP、子Agent、网络搜索和双轮resume；`/compact`不是agy 1.1.22命令，不能标记为支持。该单Harness证据仍不是Feature PASS。
  证据见 `ai_workspace/validation/v0.7.0-antigravity-product-path.json`。
- Antigravity 的独立 CLI probe 仅用于冻结官方 schema；产品路径证据与独立 probe 已分开记录，不能将其扩展为所有能力或 Feature PASS。
- DeepSeek / DSH：官方 npm `0.1.1-rc.2` Windows JSON-RPC carrier事实成立；既有真实产品路径完成 `initialize -> session/prompt -> session.event -> shutdown -> process exit`，但最新证据仍无assistant response（provider transport/auth失败）。不得用Command Code、普通API、CLIProxyAPI或synthetic Session冒充官方DSH产品路径PASS。证据见 `ai_workspace/validation/v0.7.9-deepseek-product-path.json`。
- DeepSeek / Command Code：`command-code 1.38.2 + deepseek/deepseek-v4-flash + high`取得真实模型流量，并独立验证原生文件工具、Skill、后台子Agent、网络搜索、MCP、AGENTS自动读取、双轮resume、`/context`及真实TTY `/compact`后继续消息。该成功证明的是Command Code CLI能力，不是官方DSH集成能力。
- 真实模型流量矩阵：本轮生产动态目录14/14均尝试；首轮矩阵13/14取得非空response、12/14严格marker；最终定向重试后`deepseek-v4-pro-0813`已严格marker PASS。`claude-opus-4.6-thinking`在首轮矩阵及两次独立重试中均为外部provider failure。因此当前14个模型中13个最终严格通过，仅Claude失败。
- F48 生产动态模型目录：`HarnessPanel -> typed IPC -> SupervisorRuntime.getCraftingModelInventory -> official Codex app-server model/list -> ItemRegistry.refreshCodexModels -> Crafting UI` 已闭环。v0.7.10 历史快照发现 14 个模型并记录 14/14 非空 response、13/14 严格 marker；本轮 v0.7.11 同目录重新发现并尝试 14 项，最终 13 项严格 PASS，仅 Claude provider failure。旧 4 个静态历史 Item 生产尝试数为 0，route 404 为 0；F48 动态目录实现仍为 CLOSED，但实时 provider 可用性不等于永久全绿。
- 生产 descriptor 仍按真实证据表达 capability；fixture/unit、静态检查和 Antigravity 单 Harness 响应均不等于两个 Harness 全部 Native PASS。

### Validation Boundary

- Fix Cycle v0.7.10由Debugger直接完成复检与必要修复；最新较宽focused为 `11 passed / 2 skipped files`、`156 passed / 7 skipped tests`；31个触及TS/TSX的oxfmt/oxlint、typecheck与diff检查通过。本地pnpm store中损坏的`node-pty`和TipTap空包仅在本worktree的`node_modules`内从官方npm tarball恢复，未修改产品依赖声明或lockfile。
- 全量 test 为 `6 failed / 855 passed / 10 skipped files`、`16 failed / 9634 passed / 51 skipped tests`，仍是既有路径/迁移/remote procedure 基线；全仓 lint 仍仅命中既有 `codexRouterOverlay.test.ts:52`。F39 的旧“无 Windows carrier”结论已被推翻：官方 DSH `0.1.1-rc.2` carrier 可 serving，当前真实 blocker 是 provider 401/AUTH。

## 如何接手本项目

云端 / 本地 Manager 先读这 4 个文件，不要扫描整个 Repo：

1. 本文件 —— 当前 Feature、Verdict、Git 检查点、Next Step
2. `AGENTS.md` / 产品仓 `CRAFTSTATION.md` —— 硬规则与仓库边界
3. `IDEA_GUIDE.md` —— Ideate Mode 提示词
4. `ai_workspace/agent_docs/manager_0.5.0.md` —— 当前 Feature 的 Ideate + Plan

当前冻结点：

- 当前 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
- Debugger 独立复检：**PASS**（`ai_workspace/agent_docs/debugger_0.5.2.md`）；生命周期 DEV PASS / USER ACCEPTANCE PENDING
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.2.md`；Debugger 独立复检已关闭 F13
- 关闭项：F10 / F11 / F12 / F14 / F15 / F13 均已关闭；v0.4 F04 仍 FAIL/BLOCKED
- 报告：`ai_workspace/reports/report_0.5.md`；真实探针 `ai_workspace/validation/v0.5.2-grok-product-path.json`
- 上一 Feature `v0.4.0` 保持 **NOT PASS**，Fix Cycle 停在 `v0.4.12`；Debugger 检查点：`ai_workspace/agent_docs/debugger_0.4.12-checkpoint.md`
- 下一步：用户按 debugger_0.5.2.md 最短 Smoke 亲自验收；通过前不得 merge main、不得打正式 v0.5.0 tag
- 产品源码与治理文档推送到 `https://github.com/HernanJiang/CraftStation.git`

## Roadmap

CraftStation 的长期路线收敛为四个阶段。当前版本只推进当前阶段所需的最小闭环，不提前实现后续阶段的研究算法。

### Phase 1 — Runtime Foundation

基于 PoraCode 建立独立、可诊断、可恢复的 Harness Runtime 基础设施。

- 保留 PoraCode 的 Desktop、Workspace、Session persistence、Terminal、Git/Worktree、MCP 和已有 Agent integration。
- 建立 `crafting`、`registry`、`harness-runtime` 与 `provider/API` seam。
- 分别接入 DeepSeek Harness、Codex Harness、Grok Build Harness；统一 CraftStation 所需语义，不统一各 Harness 内部 agent loop、transport 或 process architecture。
- 依次证明 `Model -> Vendor Harness -> Entity -> Session -> real response`，并覆盖错误透传、resume、terminate、资源清理和 observability。

### Phase 2 — Native Composition Runtime

证明 CraftStation 不是三个 CLI wrapper，而是真正的 Harness Composition System。

```text
Model Item + Harness Item
-> Native Recipe
-> Crafter
-> CraftPlan
-> Harness Runtime
-> Entity
-> Session
```

- Model Item 与 Harness Item 保持独立。
- `auto` 只是 Slot resolution mode，不是 Item 或 Router。
- Result 仍是 Item，可保留 provenance 并进入后续 Recipe。
- Crafter 在 V0 只做 deterministic `resolve / validate / compile`，不加入 AI 搜索。

### Phase 3 — Evaluation and Auto-Crafting

在 Runtime 与 Composition 稳定后，建立经验数据和有限预算下的 Recipe 选择能力。

- 建立 `Model × Recipe × Task × Environment × Budget` performance matrix。
- 研究 Model×Item、Item×Item 和 Model×Item×Item 的 interaction / synergy。
- 比较 global-best、per-model、random、Bayesian 或 factorization 等 baseline 与 typed semantic Recipe search。
- 研究 evaluation budget、regret、oracle gap、evaluations needed 和 latency/token cost。
- 在已证明 Model preference 差异后，再进入 Cold-Start Model-Aware Crafting、behavioral probes 和 top-k Recipe prediction。
- Auto-Crafting、Model Fingerprint、Interaction-Aware Search、Cold-Start 和 Learned Router 均属于本阶段研究范围，不进入前两阶段核心 Runtime。

### Phase 4 — Recursive and Adaptive Composition

让成功的组合结果成为新的可复用知识，并支持运行过程中的 Recipe 变化。

- 研究 `Result -> reusable Item -> future Recipe` 的 Recursive Recipe Abstraction。
- 从稳定 Recipe 中抽象新的 typed Item，例如 `RepositoryContextPack`，再参与后续 Recipe。
- 研究 Runtime Re-Crafting：根据 Session phase、failure signal 或 environment state，在 `Recipe_t -> Recipe_t+1` 间安全切换。
- 该阶段再考虑 online decision、contextual bandit、MDP 或 controller learning；在前面阶段稳定前不提前引入。

### Cross-Phase Principles

- PoraCode 是工程基础，不是 CraftStation 的最终 domain；DeepSeek Harness、Codex Harness、Grok Build Harness 是独立 Runtime。
- 采用 Strangler Refactor 与 deep-module 原则，不做一次性全仓 rename 或统一重写各 Harness 内部实现。
- Runtime / Programming Model 先于 Auto-Crafting / Agentic Algorithm；基础设施没有真实运行证据时，不扩大算法 scope。
- 正式的一等 Domain 术语保持 `Item`、`Component`、`Ingredient`、`Slot`、`Recipe`、`Result`、`Crafter`、`Entity`、`Session`。

## Lifecycle Snapshot

| Field             | Current Value                                                          |
| ----------------- | ---------------------------------------------------------------------- |
| Major Stage       | `v0`                                                                   |
| Lifecycle State   | DEBUGGER FAIL / PARTIAL — v0.7.15 ENGINEERING PASS；AGY/Grok/Kimi/Codex Native Agentic PASS；DSH/API AUTH BLOCKED |
| Active Feature    | `v0.7.0 — Native Antigravity CLI and DeepSeek Harness Adapters`        |
| Active Ticket     | Fix Cycle v0.7.15：Debugger direct Codex provider-native subagent acceptance and closeout |
| Current Fix Cycle | v0.7.15：Codex Native Agentic已PASS；DSH/API认证、三项动态模型及宿主返回正文仍未闭环 |
| Current Role      | Debugger                                                               |
| Review Status     | v0.7.15 direct re-review complete；Engineering PASS；Feature FAIL/PARTIAL；Main Promotion NOT AUTHORIZED |

## Historical v0.3 Closeout

- Feature：`v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane`
- Final tag/HEAD：`v0.3.2` / `67bbea5` (`feature(v0.3): Codex native app-server runtime — PASS`)
- Verdict：PASS
- Report：`ai_workspace/reports/report_0.3.md`
- 说明：此前的 v0.3.1/v0.3.2 re-review 文本是历史过程记录，不再代表当前阻塞状态。

## Completed Feature

- `v0.1.0 — OpenAI Model + Codex Harness Native Recipe` **PASS**
- Debugger Closeout：`ai_workspace/agent_docs/debugger_0.1.4.md`
- Report：`ai_workspace/reports/report_0.1.md`
- 产品路径：Craft Table -> `craftAgent` -> `CodexHarnessRuntimeAdapter` -> TSM
- 本机真实 Codex response 未取得；关闭证据为非 synthetic 的 `RUNTIME_UNAVAILABLE` 诊断
- Working Copy 实现仍在 `craftstation/` 分支 `codex/v0.1.0` 未提交

## Historical v0.2 Goal

完成并关闭 `v0.2.16 — UI 细节精修与品牌规范落地`（纯 UI 与既有交互接线、无功能迭代）。`v0.3.0` 的 Manager Plan 已就绪，但在 v0.2 关闭前不启动产品实现。不要把旧 `deepseek-harness/` 路线当作工作副本。

## Active v0.4 Feature

`v0.4.0 — Native Multi-Harness Compatibility`

- Status：`FAIL / BLOCKED — v0.4.12 checkpoint freeze（用户授权 Git 收口；不是 Feature PASS；不要开 v0.4.13）`
- Coder delivery：`ai_workspace/agent_docs/coder_0.4.12-native-harness.md`
- Debugger review：`ai_workspace/agent_docs/debugger_0.4.12-rereview-native-harness.md`
- Checkpoint freeze：`ai_workspace/agent_docs/debugger_0.4.12-checkpoint.md`
- Prior Fix Plan：`ai_workspace/agent_docs/debugger_0.4.12-native-harness.md`
- Prior re-review：`ai_workspace/agent_docs/debugger_0.4.10-rereview-native-harness.md`
- Manager document：`ai_workspace/agent_docs/manager_0.4.0.md`
- Next-version Ideate：`ai_workspace/agent_docs/manager_0.5.0.md`
- Grok Account Control Brief：`ai_workspace/agent_docs/debugger_0.5.0-grok-account-control-brief.md`
- Current evidence：F08–F24 工程项已关闭；F04 五 Harness 产品级真实 response 仍 BLOCKED。新 Session 的 `craftAgent` 当前不传 `accountId`，走 Auto；点账号行只改 selected。不能把「无论选哪个都能回复」当成 per-account sticky PASS。
- Binding finding：用户希望耗尽时静默填补、不要把「Grok 额度已耗尽」挡在聊天前面。这与冻结的 F20 explicit 语义冲突，必须由下一版本 Manager / Ideate 拍板，不能静默改代码。

## Repository State

- Product Git Root / Main Worktree：`D:\Work\CraftStation`，`main`，稳定产品线。
- Dev Worktree：`D:\Work\CraftStation\dev`，`dev`，Feature集成线。
- Active Feature Worktree：`D:\Work\CraftStation\dev\.worktrees\v0.7-native-harnesses`，`feature/v0.7-native-harnesses`。
- Active Development Branch：`feature/v0.7-native-harnesses`（本Feature只在上述worktree验收与写文档）。
- GitHub origin：`https://github.com/HernanJiang/CraftStation.git`（产品仓 `main`）。
- `main` tracking `origin/main`，HEAD `b1af0e2`。`dev` tracking `origin/dev`，closeout 前 HEAD `be8d8c2`；Debugger PASS closeout 后以 `origin/dev` SHA 为准。不得 merge main。
- 根仓库 `D:\Work\CraftStation` 是无 remote 的治理仓，不承载产品源码提交。
- 产品仓检查点 tag：`checkpoint-v0.4.12`（不是 PASS tag，也不是 `v0.4.0`）。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Active v0.5 Feature

`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`

- Manager：`ai_workspace/agent_docs/manager_0.5.0.md`
- Tickets：`.scratch/craftstation-0.5.0/issues/01-audit-baseline.md` 至 `10-grok-e2e.md`
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.2.md`；Debugger 独立复检已关闭 F13
- Debugger Review：`ai_workspace/agent_docs/debugger_0.5.2.md` — **PASS**
- Prior review：`ai_workspace/agent_docs/debugger_0.5.0.md` / `ai_workspace/agent_docs/debugger_0.5.1.md`
- Report：`ai_workspace/reports/report_0.5.md`
- Real probe：`ai_workspace/validation/v0.5.2-grok-product-path.json`
- Lifecycle：DEV PASS / USER ACCEPTANCE PENDING
- Main Promotion：NOT AUTHORIZED
- F10 / F11 / F12 / F14 / F15 / F13 均已关闭。用户 Smoke 通过前不得 merge main、不得打正式 `v0.5.0` tag。
- v0.4 F04 五 Harness 仍 FAIL/BLOCKED，不得升格。
- Out of scope：CLIProxyAPI、第二套 Usage 系统、Account/Quota/Usage 进入 Item/Recipe/Crafter、智能路由和 Auto-Crafting。

## v0.7.0 Next Step

1. Antigravity真实assistant response已闭环；保留`agy 1.1.22`没有`/compact`的真实能力边界。
2. 官方DSH必须在`dsh-jsonrpc-agent`产品路径取得真实assistant response；Command Code或普通API成功不能替代。
3. 官方DSH的tool/MCP/Skills/subagents/resume/multi-turn/context/compaction只在逐项真实验证后升级；当前继续`implementation missing`。
4. Codex Native provider-native子Agent identity/wait/parent exactly-once已闭环；AGY/Grok/Kimi/Codex Native Agentic均为PASS。
5. 最新动态模型最终11/14；仍需关闭Kimi K3 timeout、Muse与Z-AI/GLM provider failure，才能宣称所有动态模型成功。
6. 宿主后台子任务可完成但返回正文不可观察，跨任务消息仍为PARTIAL。
7. Feature PASS、dev candidate closeout和用户验收前，不得merge Dev/main、不得创建正式`v0.7.0` tag、不得promotion。

## Historical Next Step

1. Debugger v0.5.2 Re-review **PASS**。dev candidate 进入 DEV PASS / USER ACCEPTANCE PENDING。
2. 用户按 `ai_workspace/agent_docs/debugger_0.5.2.md` 的最短 Smoke 亲自验收功能。
3. 用户验收通过并明确授权后，才由 Manager 执行 dev→main promotion。现在不得 merge main、不得打 `v0.5.0` tag。
4. v0.4.0 仍为 FAIL/BLOCKED checkpoint `checkpoint-v0.4.12` / `b1af0e2`，不能宣称 PASS。


## Next Step

1. Debugger v0.7.15 已直接完成修复与复检：engineering PASS；Antigravity/Grok/Kimi/Codex Native 最新真实 Agentic 产品路径 PASS；Codex provider-native子Agent child identity、wait与parent exactly-once已闭环。
2. 官方 DSH 仍为 AUTH_REQUIRED、无 assistant response；官方 DeepSeek API 与第三方 Router API 当前凭据均认证失败，不能把实现回归或其它 CLI 证据升格为真实 API Agentic PASS。
3. 最新动态 14 模型全量为 9/14 strict PASS；定向重试恢复 DeepSeek Flash/Pro 0813 后最终 11/14，Kimi K3 timeout、Muse 与 Z-AI/GLM provider failure。
4. 宿主后台子任务可dispatch并完成，但调用方仍看不到请求的assistant marker/body；保持PARTIAL / NOT OBSERVABLE。
5. 复检文档：`ai_workspace/agent_docs/debugger_0.7.15.md`；统一矩阵：`ai_workspace/validation/v0.7.15-full-harness-agentic-matrix.json`。
6. 不得 commit / push / tag / merge Dev/main；不得修改 main、共享Dev或其它Feature工作树。

### v0.7.9 Debugger Final Seal（2026-08-30）

- 最新 30 个触及 TS/TSX 的 `oxfmt --check`、`oxlint --deny-warnings`、`typecheck`、`git diff --check` 均通过。
- 较宽 focused 为 11 passed / 2 skipped files、150 passed / 7 skipped tests；F48 UI/registry/IPC 子集 3 files / 28 tests passed。
- 当前生产 inventory 14 discovered / 14 attempted / 14 non-empty response / 13 exact marker / 0 static attempts / 0 route 404。
- 最新 v0.7 validation artifacts 敏感信息扫描 0 命中；测试参数残留进程 0。
- 结论：F48 CLOSED；F47 仍 `FAIL / BLOCKED`；不得合入 Dev 或执行 Main promotion。

### v0.7.10 Debugger Direct Re-review Seal（2026-08-30）

- 用户授权后，本 Debugger 任务直接完成修复、复检与文档收口，不再回派 Coder。
- 最新 Antigravity 产品路径：`agy 1.1.22 / synthetic=false / PASS / responseLength=33 / marker=true / cleanup=true`。
- Command Code 1.38.2 + `deepseek/deepseek-v4-flash` 真实验证：工具、Skill、后台子 Agent、网络搜索、MCP、AGENTS 自动读取、双轮 resume、`/context`、TTY `/compact` 后继续消息均通过。
- 官方 DSH Windows carrier存在，但最新产品证据仍无 assistant response；DSH tool/MCP/Skills/subagents/resume/multi-turn/context/compaction继续 `implementation missing`。
- 最新生产模型矩阵：14 discovered / 14 attempted；首轮13 non-empty / 12 exact marker；最终定向重试关闭DeepSeek Pro 0813偏差，13个模型最终严格PASS；Claude provider failure连续重试仍失败。
- 工程门：11 passed / 2 skipped files、156 passed / 7 skipped tests；31个触及TS/TSX的oxfmt/oxlint、typecheck、diff check通过。
- 结论：`FAIL / PARTIAL`；不得合入Dev/main或执行promotion。复检文档：`ai_workspace/agent_docs/debugger_0.7.10.md`。

### v0.7.12 Debugger Direct Re-review（2026-08-31）

- 本轮验收对象改为两条 DeepSeek API provider path，不把普通 API 当作官方 DSH Harness。
- 真实产品路径 artifact：`ai_workspace/validation/v0.7.12-deepseek-api-product-path.json`。
- 官方 `api.deepseek.com/v1`：`deepseek-chat` 与 `deepseek-reasoner` 均 PASS，非空正文、精确 marker、`synthetic=false`、`session.exited` 清理成立。
- 火山方舟 `ark.cn-beijing.volces.com/api/coding/v3`：`deepseek-v4-flash` 与 `deepseek-v4-pro` 均真实 HTTP 401 / `AUTH_REQUIRED`，不能宣称全模型通过。
- 本轮直接修复了 API Recipe 的 model Item 路由隔离，并扩展四模型产品路径矩阵；工程门禁保持全绿。
- API tool execution、MCP、Skills、子 Agent、resume、context、compaction 等不能从其它 CLI 或 DSH 证据迁移；当前 adapter 未逐项真实集成的能力保持 `implementation missing`。
- 当前结论：`FAIL / PARTIAL`；不得 merge Dev/main、不得 tag/push/promotion。
- 复检文档：`ai_workspace/agent_docs/debugger_0.7.12.md`。

### v0.7.14 Debugger Direct Re-review（2026-08-31）

- 本 Debugger 按用户授权直接修复，不再回派 Coder。
- 修复 DeepSeek API selected MCP canonical identity，私有 server/tool identity 不进入 Provider wire payload；新增真实 API Agentic product-path test。
- 修复 DSH 未配置回归对宿主 `DSH_CORDIS_CONFIG` 的测试隔离，并在 finally 恢复原值。
- 最新真实 Harness：AGY PASS、Grok PASS、Kimi定向重试 PASS；Codex core PASS/subagent identity未证明，PARTIAL。
- 官方 DSH AUTH_REQUIRED且无assistant response；官方 DeepSeek API真实 Agentic请求 AUTH_REQUIRED；Ark key未配置；第三方 Router OpenAI-compatible DeepSeek probe HTTP 401。
- 最新动态模型最终 11/14 strict PASS；仍失败 Kimi K3 timeout、Muse provider failure、Z-AI/GLM provider failure。
- 最终 focused 4 files/114 tests；52个触及TS/TSX oxfmt/oxlint、typecheck、diff check全绿；凭据扫描0，残留目标进程0。
- 结论仍为 `FAIL / PARTIAL`；不得 merge Dev/main、commit、push、tag或promotion。

### v0.7.15 Debugger Direct Re-review（2026-08-31）

- Codex官方app-server真实Agentic产品路径升级为PASS：selected MCP、Skill、provider-native spawnAgent child thread identity、wait completion、parent started/completed exactly-once、context、resume与两次session.exited均成立。
- 新增Native Codex自有子Agent事件映射，不依赖旧ACP路由，不生成synthetic child Entity/Session；只有官方spawnAgent标记为子Agent。
- AGY/Grok/Kimi继续PASS；官方DSH与官方/第三方DeepSeek API继续AUTH_REQUIRED / BLOCKED。
- 动态模型最终11/14；Kimi K3 timeout，Muse与Z-AI/GLM provider failure。
- 宿主后台子任务status completed / error null，但assistant marker/body不可观察；跨任务返回保持PARTIAL。
- 工程门禁：Codex focused 4 files/22 tests；更宽143 passed/1 skipped；58个触及TS/TSX的oxfmt/oxlint、typecheck、diff check通过。
- 结论仍为`FAIL / PARTIAL（Engineering PASS）`；不得commit、push、tag、merge Dev/main或promotion。
