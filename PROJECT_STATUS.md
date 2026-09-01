# PROJECT_STATUS.md

## v0.7.0 Main Integration Record — 2026-09-01

- 用户已明确授权将 `dev/v0.7-native-harnesses`（Feature commit `4b92a43`）合入本地 `main`；本地 merge commit 为 `f570b178b3b8b2eb6a33398b45fd95780039bf75`，未 push、未 tag、未发布。
- 合入范围包括 Native Harness composition、官方 Antigravity/DeepSeek carrier seam、DeepSeek API adapter、OpenCode 兼容保留、Crafting UI/IPC、Codex agentic/runtime 回归证据及治理文档。
- 真实能力边界保持诚实：Antigravity、Grok、Kimi、Codex Native 的既有证据按各自 artifact 记录；官方 DSH 与 DeepSeek API/provider 结果仍受认证/外部 provider 限制；Command Code 或普通 API 证据不冒充官方 DSH。
- 本次合并成功不等于 v0.7 Feature 全部外部模型/高级能力永久 PASS；未验证能力继续按 `implementation missing`、`AUTH_REQUIRED` 或 `RUNTIME_UNAVAILABLE` 表达。

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库精确基线见 `reference/BASELINES.md`。

## 如何接手本项目

云端 / 本地 Manager 先读这 4 个文件，不要扫描整个 Repo：

1. 本文件 —— 当前 Feature、Verdict、Git 检查点、Next Step
2. `AGENTS.md` / 产品仓 `CRAFTSTATION.md` —— 硬规则与仓库边界
3. `IDEA_GUIDE.md` —— Ideate Mode 提示词
4. `ai_workspace/agent_docs/manager_0.5.0.md` —— 当前 Feature 的 Ideate + Plan

当前冻结点：

- 当前并行 Feature：`v0.9.0 — Cross-Harness Session Handoff` 与 `v0.10.0 — Cross-Thread Collaboration`，分别位于目标拓扑下的独立 Feature worktree；两者尚未完成 Coder 自检或 Debugger 验收，不得表述为 PASS。
- v0.9 Manager Plan：`.worktrees/v0.9-cross-harness-handoff/ai_workspace/agent_docs/manager_0.9.0.md`；Plan commit `7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`。
- v0.10 Manager Plan：`.worktrees/v0.10-cross-thread-collaboration/ai_workspace/agent_docs/manager_0.10.0.md`；Plan commit `0bbba5f66e5b7be782443206c02781ed6825ba77`。
- Coder 协调状态：两个 Coder 的源码与未提交测试均已无损迁移到新 Feature worktree，并已按新路径恢复原有 Coder 线程继续执行。此前的平台协调异常不是 Feature FAIL，也不是代码损坏。
- Git 拓扑迁移已完成：`D:\Work\CraftStation` 直接承载 Product Git `main`；并行版本开发工作树直接位于 `.worktrees\<version-feature>`，分别检出 `dev/<version-feature>`。本项目已取消共享 `dev` 分支和共享 Dev 工作树。
- 当前历史阻塞 Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface`。
- Debugger 独立复检：**FAIL / BLOCKED**（`ai_workspace/agent_docs/debugger_0.6.0.md`）；OAuth broker / Gemini usage 移除 / Ark parser / titlebar 工程项可关闭；F35 真实 Google OAuth E2E 与 F36 真实 Ark 线上凭据仍 BLOCKED；Feature 不能 PASS。
- Coder 交付：`ai_workspace/agent_docs/coder_0.6.0.md`。
- v0.5.0 继续 **FAIL / BLOCKED**；F33 真实 Grok billing 与 F29 exact Token 未关闭。
- v0.4.0 仍 **没有 PASS**，检查点 `checkpoint-v0.4.12` / `b1af0e2`
- 下一步：v0.9 与 v0.10 在各自版本开发工作树继续执行；有真实 Google / Ark 凭据时才补 v0.6 F35/F36 脱敏证据。未经用户授权不得 merge main、创建正式 tag 或 push。远端 `origin/dev` 保留为迁移前历史，不再是默认集成线。
- 产品源码与治理文档推送到 `https://github.com/HernanJiang/CraftStation.git`

## Roadmap

CraftStation 的长期路线收敛为四个阶段。当前版本只推进当前阶段所需的最小闭环，不提前实现后续阶段的研究算法。

### Phase 1 — Runtime Foundation

基于 CraftStation 建立独立、可诊断、可恢复的 Harness Runtime 基础设施。

- 保留 CraftStation 的 Desktop、Workspace、Session persistence、Terminal、Git/Worktree、MCP 和已有 Agent integration。
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

- CraftStation 是工程基础，不是 CraftStation 的最终 domain；DeepSeek Harness、Codex Harness、Grok Build Harness 是独立 Runtime。
- 采用 Strangler Refactor 与 deep-module 原则，不做一次性全仓 rename 或统一重写各 Harness 内部实现。
- Runtime / Programming Model 先于 Auto-Crafting / Agentic Algorithm；基础设施没有真实运行证据时，不扩大算法 scope。
- 正式的一等 Domain 术语保持 `Item`、`Component`、`Ingredient`、`Slot`、`Recipe`、`Result`、`Crafter`、`Entity`、`Session`。

## Planned Next Feature (Planning Only)

- Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface` 已进入 Debugger 复检，**FAIL / BLOCKED**
- Manager Plan：`ai_workspace/agent_docs/manager_0.6.0.md`
- Debugger：`ai_workspace/agent_docs/debugger_0.6.0.md`
- Tickets：`.scratch/craftstation-0.6.0/issues/`
- 状态：`DEBUGGER FAIL / BLOCKED`（F35/F36 缺真实凭据）
- 历史共享 Dev 已归档；后续 Feature 只允许使用 `D:\\Work\\CraftStation\\.worktrees\\<version-feature>` 与 `dev/<version-feature>`。
- 当前不执行：commit、push、任一版本开发分支 → `main` promotion 或正式 tag；v0.5 与 v0.4 F04 状态保持 FAIL/BLOCKED。

## Future Feature — v1.0.0 (Ideate Only)

- Feature：`v1.0.0 — Efficient Model × Harness Composition`
- Manager Ideate：`ai_workspace/agent_docs/manager_1.0.0.md`
- 状态：`IDEATE COMMITTED / NOT EXECUTING / NOT READY FOR PLAN`
- 目标：完善高效/兼容模式，让用户显式选择 Model Item 与 Harness Item，通过统一 Compatibility Layer 解析整个 Model × Harness matrix，并生成可审计的 Recipe / CraftPlan。
- 工作台：高效/兼容模式采用四格；自动模式采用九格。高效模式右下角显示 `Recipe 配置名称 · 模型名称`。
- 模型适配层暂定为 implementation-level Adapter/Binding，不提升为一级 Item；Provider/Auth 通过 opaque profile/auth reference 投影到官方 Harness。
- 高效模式四格配置是组合入口；每次 Model × Harness × Profile 配置变化都必须生成并展示当前组合的 `CapabilityResolution`（能力来源、状态、差异和诊断），用户明确 Craft 后才进入 Recipe/CraftPlan。
- 当前待拍板：四格第三/第四槽位、九格自动模式是否只读、全矩阵“可尝试但不保证可执行”的状态语义、Adapter 持久化和首条真实 tracer bullet。
- 执行门：未进入 Plan；不创建 Coder/Debugger，不修改当前 v0.6、v0.7、v0.8 的执行状态，不执行 commit/push/merge/tag。

## Lifecycle Snapshot

| Field             | Current Value                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Major Stage       | `v0`                                                                                                       |
| Lifecycle State   | `v0.9.0 + v0.10.0 / CODER IN PROGRESS`                                                                     |
| Active Feature    | `v0.9.0 — Cross-Harness Session Handoff`；`v0.10.0 — Cross-Thread Collaboration`                           |
| Active Ticket     | 两个 Coder 分别继续各自 Manager Plan 的剩余 Tickets                                                        |
| Current Fix Cycle | 尚未进入 Debugger Fix Cycle                                                                                |
| Current Role      | Coder（并行）／Manager（拓扑治理）                                                                         |
| Review Status     | v0.9/v0.10 尚未验收；v0.6 F35/F36、v0.5 F29/F33、v0.4 F04 保持 FAIL/BLOCKED；Main Promotion NOT AUTHORIZED |

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
- 历史 v0.1 Working Copy 记录已被后续 main/dev 生命周期取代；不得再使用旧 `craftstation/` 路径作为开发入口。

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

- Product Git Root：`D:\Work\CraftStation`，分支 `main`，HEAD `3ff2b9917909cdd8f95bc9316a6ac7f43e2ba96f`。
- 版本开发工作树：统一位于 `D:\Work\CraftStation\.worktrees\<version-feature>`；每个工作树直接检出对应 `dev/<version-feature>` 分支，不存在共享 Dev 集成线。
- 当前登记：v0.7 `dev/v0.7-native-harnesses` @ `7ae6506e`；v0.8 `dev/v0.8-opencode-native` @ `20be0e1a`；v0.9 `dev/v0.9-cross-harness-handoff` @ `7d1e2485`；v0.10 `dev/v0.10-cross-thread-collaboration` @ `0bbba5f6`。
- 旧共享本地 `dev` 分支已保留为归档分支 `archive/dev-before-flat-worktrees-20260831` @ `adf7cde4`；远端 `origin/dev` 未修改，后续不得作为默认开发或集成入口。
- 旧 `D:\Work\CraftStation\dev` 已从 Git worktree 注册表移除并完整移出产品仓，归档到 `D:\Work\CraftStation-MigrationBackup\root-worktrees-migration-20260831`；迁移中遇到的失效 pnpm/workspace junction 已单独保留在同一备份根目录。
- 旧 `D:\Work\CraftStation\craftstation-dev`（含旧 detached v0.9/v0.10）已在逐字节校验后移动到 `D:\Work\CraftStation-MigrationBackup\legacy-craftstation-dev`，并从 Git worktree 注册表清除。
- 旧 `D:\Work\CraftStation\craftstation\release-portable` 被当前运行的 `CraftStation-Portable-0.6.0-x64.exe` 占用，暂作可恢复迁移残留；应用关闭后可整体归档，不得作为源码或工作树使用。
- GitHub origin：`https://github.com/HernanJiang/CraftStation.git`（产品仓 `main`）。
- 根仓库没有 tracking remote；云端 Manager 以 GitHub 产品仓治理文档为准。
- 产品仓检查点 tag：`checkpoint-v0.4.12`（不是 PASS tag，也不是 `v0.4.0`）。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Next Step

1. v0.9 Coder 只在 `D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff` / `dev/v0.9-cross-harness-handoff` 继续剩余 Tickets 和 Feature-level self-check。
2. v0.10 Coder 只在 `D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration` / `dev/v0.10-cross-thread-collaboration` 继续 focused tests、typecheck 与 Feature-level self-check。
3. 两个 Coder 完成后分别创建一对一 `grok-4.6 / high` Debugger；Debugger 在各自版本开发分支完成候选收口并通知 Manager，不合入共享 Dev。
4. 用户验收并明确授权后，Manager 才将指定 `dev/<version-feature>` 分支收口到 `main`。未经授权不得 merge main、创建正式 tag 或 push；v0.6 F35/F36、v0.5 F29/F33 与 v0.4 F04 的证据门保持原判。
