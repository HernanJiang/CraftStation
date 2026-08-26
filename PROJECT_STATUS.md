# PROJECT_STATUS.md

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库 commit 见 `reference/BASELINES.md`。

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

| Field             | Current Value |
| ----------------- | ------------- |
| Major Stage       | `v0`          |
| Lifecycle State   | FEATURE PASS  |
| Active Feature    | None          |
| Active Ticket     | None          |
| Current Fix Cycle | None          |
| Current Role      | None          |
| Review Status     | PASS          |

## Historical Debugger Re-review (v0.3.1 -> v0.3.2)

- Document: `ai_workspace/agent_docs/debugger_0.3.2.md`
- Verdict: FAIL
- Requires Manager Re-plan: No
- Closed: F03 model/list silent fallback
- Still blocking: no successful official initialize/turn; wire may still send jsonrpc field omitted by official stdio; evidence lacks stderr/exit
- Next: Coder Fix Cycle `v0.3.2`

## Current Fix Cycle v0.3.2

Fix Cycle v0.3.2 已完成 Coder 修复与自检：官方 JSONL wire framing 省略 `jsonrpc`，真实集成证据通过 `SupervisorRuntime.craftAgent` 产品 seam 执行，并保存 binary/version、initialize、model discovery、双轮 response、stderr、spawn args 与 exit 信息；等待 Debugger 复审，不宣称 Feature 已最终 PASS。

## Completed Feature

- `v0.1.0 — OpenAI Model + Codex Harness Native Recipe` **PASS**
- Debugger Closeout：`ai_workspace/agent_docs/debugger_0.1.4.md`
- Report：`ai_workspace/reports/report_0.1.md`
- 产品路径：Craft Table -> `craftAgent` -> `CodexHarnessRuntimeAdapter` -> TSM
- 本机真实 Codex response 未取得；关闭证据为非 synthetic 的 `RUNTIME_UNAVAILABLE` 诊断
- Working Copy 实现仍在 `craftstation/` 分支 `codex/v0.1.0` 未提交

## Historical v0.2 Goal

完成并关闭 `v0.2.16 — UI 细节精修与品牌规范落地`（纯 UI 与既有交互接线、无功能迭代）。`v0.3.0` 的 Manager Plan 已就绪，但在 v0.2 关闭前不启动产品实现。不要把旧 `deepseek-harness/` 路线当作工作副本。

## Next Feature Plan

- `v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane` 已完成 Ideate、Gate Check 和 Manager Plan。
- Feature 目标：`CraftPlan -> CraftStation-owned Codex Runtime -> official codex app-server -> Entity -> Session -> real response`。
- Codex 系列 Model Items 共享同一个 Codex Harness Runtime Adapter，不为每个模型分别实现 Adapter。
- 最终产品路径不得依赖或 fallback 到 PoraCode 的 `ThreadSessionManager`、`SpawnPipeline`、`AgentAdapter`、`CodexStructuredSession`、canonical event mapping 或 Codex hook plugin。
- Codex Agent Loop、Context/Compaction、Tools、MCP、Skills、Subagents 与原生 Session 语义继续由官方 Codex Runtime 拥有。
- Runtime parity 指相同官方 Runtime、effective configuration、protocol semantics、events 与 lifecycle，不要求非确定性模型输出逐字相同。
- 默认继承用户现有 Codex binary、account/auth、`CODEX_HOME`、config、requirements、MCP 与 Skills；只有 UI 显式选择才形成 override。
- Manager 文档：`ai_workspace/agent_docs/manager_0.3.0.md`。
- 历史 Ideate 输入：`ai_workspace/agent_docs/ideate_0.3.0.md`。
- Tickets：`.scratch/craftstation-0.3.0/issues/01-...md` 至 `09-...md`，线性顺序 `T01 -> T09`。
- 当前 frontier：等待 `v0.2.16` 关闭；关闭后从 `v0.3/T01 — Native Codex Runtime Interface 与 Parity Harness` 开始。
- 根治理仓库当前没有 tracking remote，Plan 前的 `git pull --ff-only` 未完成；Coder 启动前需重新确认同步基线。

## Repository State

- 唯一产品 Working Copy：`craftstation/`。
- Working branch：`codex/v0.2.0`（基于 `codex/v0.1.0` 未提交工作树创建）。
- HEAD：`2a646f8`；PoraCode 基线：`a28b995c47987b09862d8d18cb1203ddfb4ba159`。
- CraftStation 自有远端尚未配置。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Next Step

1. Debugger 读取 `ai_workspace/agent_docs/coder_0.3.2.md` 与 `ai_workspace/validation/craftstation_execution_path_v0.3.2.json`，执行 Fix Cycle v0.3.2 re-review。
2. Debugger 重点复核真实证据是否满足官方 initialize -> thread -> turn -> second turn、wire framing、stderr/exit 与 legacy boundary acceptance。
3. 仅当 Debugger PASS 后进入 Feature Closeout；若再次 FAIL，按新报告继续 Fix Cycle。
