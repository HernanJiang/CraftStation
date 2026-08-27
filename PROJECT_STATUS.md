# PROJECT_STATUS.md

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库精确基线见 `reference/BASELINES.md`。

## 如何接手本项目

云端 / 本地 Manager 先读这 4 个文件，不要扫描整个 Repo：

1. 本文件 —— 当前 Feature、Verdict、Git 检查点、Next Step
2. `AGENTS.md` / 产品仓 `CRAFTSTATION.md` —— 硬规则与仓库边界
3. `IDEA_GUIDE.md` —— Ideate Mode 提示词
4. `ai_workspace/agent_docs/manager_0.4.0.md` —— 当前 Feature 的 Ideate + Plan

当前冻结点：

- Feature `v0.4.0` **没有 PASS**，Fix Cycle 停在 `v0.4.12`
- Debugger 检查点：`ai_workspace/agent_docs/debugger_0.4.12-checkpoint.md`
- 用户授权 Git 收口后，下一版本目标改由 Manager / Ideate 讨论
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

| Field | Current Value |
|---|---|
| Major Stage | `v0` |
| Lifecycle State | MANAGER PLAN READY / CODER HANDOFF |
| Active Feature | `v0.5.0 — Account Pool + Quota + Token Usage Stabilization` |
| Active Ticket | `v0.5/T01 — Audit baseline 与迁移契约` |
| Current Fix Cycle | `v0.4.12` checkpoint（历史；未通过） |
| Current Role | Manager |
| Review Status | v0.4 FAIL / BLOCKED；v0.5 Plan Ready，等待 Coder 在 dev 执行 |

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

- Product Git Root：`craftstation/`（独立产品仓）。
- Main Worktree：`D:\Work\CraftStation\craftstation`，`main`，稳定产品线；用于运行 main 版 CraftStation 开发其它项目（dogfooding）。
- Dev Worktree：`D:\Work\CraftStation\craftstation-dev`，`dev`，当前 Feature 唯一开发线。
- Active Development Branch：`dev`（本文件与当前 Manager 文档均以 dev 为准）。
- GitHub origin：`https://github.com/HernanJiang/CraftStation.git`（产品仓 `main`）。
- `main`、`dev` 均 tracking 对应 `origin` 分支；当前两工作树 HEAD 均为 `b1af0e2`。
- 根仓库 `D:\Work\CraftStation` 是无 remote 的治理仓，不承载产品源码提交。
- 产品仓检查点 tag：`checkpoint-v0.4.12`（不是 PASS tag，也不是 `v0.4.0`）。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Active v0.5 Feature

`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`

- Manager：`ai_workspace/agent_docs/manager_0.5.0.md`
- Tickets：`.scratch/craftstation-0.5.0/issues/01-audit-baseline.md` 至 `10-grok-e2e.md`
- Plan Status：`Ready for Coder`
- 执行顺序：`T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10`
- Blocking acceptance：至少两个真实 Grok 账号在 Official Grok Harness Runtime 上完成独立 profile、quota、Priority/RR/explicit/sticky E2E；无真实证据不得 PASS。
- Out of scope：CLIProxyAPI、第二套 Usage 系统、Account/Quota/Usage 进入 Item/Recipe/Crafter、智能路由和 Auto-Crafting。

## Next Step

1. Coder 在 `D:\Work\CraftStation\craftstation-dev` 读取 Manager v0.5 Part II 与 `.scratch/craftstation-0.5.0/issues/`，按 T01→T10 连续执行。
2. Coder 完成后交 Debugger 在 dev 独立验收；Debugger 只在真实证据满足时形成 DEV PASS candidate。
3. 用户验收 dev candidate 后，Manager 才执行上一 Feature/当前 candidate 的 dev→main promotion；在此之前 main 保持 `b1af0e2` 稳定基线。
4. v0.4.0 仍为 FAIL/BLOCKED checkpoint，不能宣称 PASS、不能创建 v0.4.13。
