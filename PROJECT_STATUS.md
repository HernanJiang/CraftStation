# PROJECT_STATUS.md

## Active Feature — v0.9.0 Cross-Harness Session Handoff

- Feature：`v0.9.0 — Cross-Harness Session Handoff`
- 唯一 Feature worktree：`D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`
- Feature branch：`dev/v0.9-cross-harness-handoff`
- Manager Plan：`ai_workspace/agent_docs/manager_0.9.0.md`
- Manager Plan base：`7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`
- Coder 状态：T01–T08 已连续实现并提交 `4ef61356bf9d9f4490517210cfa21fbe0454632d`；Debugger 已完成首轮独立 Feature Review。
- Debugger Review：`ai_workspace/agent_docs/debugger_0.9.0.md`；Verdict `FAIL / BLOCKED BY ENVIRONMENT`；Requires Manager Re-plan `No`。
- Current Fix Cycle：`v0.9.1`；Fix Owner：Coder；Fix Plan：`ai_workspace/agent_docs/debugger_0.9.1.md`。
- 打开 Findings：F1/F2/F3 工程修复已完成（2026-09-01，未提交，见 `ai_workspace/agent_docs/coder_0.9.1.md`）；F1 crafted active commands 现全程携带 execution envelope 且 Supervisor 对 crafted Thread fail closed；F2 真实集成测试已消除 false-green（preflight 与 started-chain 分离、B/C 需真实 response summary、11 个 scenario 逐项记录、16 个 false-green 回归测试）；F3 schema 断言改为 `LATEST_SCHEMA_VERSION` 并验证 v0.9 新表/索引。
- 修复后工程门：`pnpm typecheck` PASS；`build:renderer` + `build:electron` PASS；合并定向套件 15 files / 408 passed / 1 skipped（唯一 skip 为 gated 真实场景）；`git diff --check` PASS。完整套件失败均为既有 rename-migration/环境失败，无 v0.9 Feature 回归。
- T08 真实证据：`ai_workspace/validation/v0.9-cross-harness-handoff-real.json`；`synthetic: false`，当前 `BLOCKED BY ENVIRONMENT / QUOTA_OR_LIMIT`、`scenarios: []`。未取得真实 Codex → Grok Build → Codex non-synthetic response，不将 Feature 升格为 PASS。
- Feature-level verdict：`ENGINEERING FIX #1 COMPLETE / READY FOR USER ACCEPTANCE / REAL T08 STILL BLOCKED BY ENVIRONMENT`
- 当前下一步：用户亲自验收工程候选（同线程切换 UI 与 fencing 行为）；真实 provider 三段 continuation 在额度恢复后由用户执行或授权执行；随后原配对 Debugger 复检。
- Git 边界：Coder 不 merge `main`、不 merge共享 Dev、不打正式 tag、不 push；Debugger 独立验收后在本版本分支完成候选收口，用户明确授权后才允许 Main promotion。

## Dev Integration — v0.8.0

- `v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility` 已于 2026-08-31 合入本地 `dev`。
- Feature commit：`20be0e1a28056a8103a4f49b65be61cece5ad797`。
- Dev merge commit：`e74808cdc649fdf37b1e23aa9edc810f3467e8fb`。
- 合并时有 2 个源码冲突，已保留现有 Codex/OpenAI-compatible 账号路由并加入 OpenCode provider 路由，同时补齐 OpenCode adapter imports。
- 合并后回归：`19 files / 225 tests PASS`；`pnpm typecheck` PASS；44 个触及源码文件 oxlint/oxfmt PASS；diff check PASS。
- 真实证据边界不变：只有 `kimi-for-coding/kimi-for-coding` 完成真实两轮 assistant response；OpenAI、xAI、Google、DeepSeek、OpenAI-compatible Kimi 仍为 unverified。
- 生命周期：`MERGED TO DEV / USER ACCEPTANCE PENDING`。尚未将 v0.8 合入 `main`，未创建正式 tag，未 push。

## Active Feature — v0.6.0

- `v0.6.0 — Native Provider Authentication & Ark Token Plan Surface`：`DEBUGGER FAIL / BLOCKED`
- Release Lifecycle：`LOCAL MAIN PROMOTED / USER ACCEPTED RUNNABLE CANDIDATE CHECKPOINT`
- Manager Plan：`ai_workspace/agent_docs/manager_0.6.0.md`
- 允许工作树：本 `dev` worktree；用户已于 2026-08-29 明确授权切换并开始执行。
- 范围：Antigravity 系统浏览器 Google OAuth + loopback/main-process exchange/安全存储/刷新；移除独立 Gemini usage surface 但保留 Gemini CLI agent/runtime 与 Antigravity Gemini quota group；新增官方事实核验驱动的 Volcengine Ark Token Plan。
- Coder 交付：`ai_workspace/agent_docs/coder_0.6.0.md`
- Debugger 复检：`ai_workspace/agent_docs/debugger_0.6.0.md`（2026-08-29 18:00 独立复检：定向 11 files / 110 passed；工程项可关闭；F35 真实 Google OAuth E2E 与 F36 真实 Ark 线上凭据仍 BLOCKED；Feature 不能 PASS）
- 用户已于 2026-08-31 完成当前原生 Electron 候选的手动验收并明确授权本地 `dev -> main` 收口。该授权是对当前可运行候选的接受，不会把 F35/F36、F33、F29、v0.5.0 或 v0.4 F04 升格为 PASS。
- 本地 `dev -> main` fast-forward 已于 2026-08-31 完成；本轮只创建 accepted-candidate checkpoint tag，不允许 push，不创建正式 `v0.6.0` PASS tag。

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库精确基线见 `reference/BASELINES.md`。

## 如何接手本项目

云端 / 本地 Manager 先读这 4 个文件，不要扫描整个 Repo：

1. 本文件 —— 当前 Feature、Verdict、Git 检查点、Next Step
2. `AGENTS.md` / 产品仓 `CRAFTSTATION.md` —— 硬规则与仓库边界
3. `IDEA_GUIDE.md` —— Ideate Mode 提示词
4. `ai_workspace/agent_docs/manager_0.6.0.md` —— 当前 Feature 的 Ideate + Plan

当前冻结点：

- 当前 Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface`
- Debugger 独立复检：**FAIL / BLOCKED**（`ai_workspace/agent_docs/debugger_0.6.0.md`）；OAuth broker / Gemini usage 移除 / Ark parser / titlebar 工程项可关闭；F35 真实 Google OAuth E2E 与 F36 真实 Ark 线上凭据仍 BLOCKED；Feature 不能 PASS
- Release Lifecycle：用户于 2026-08-31 接受当前可运行候选；本地 Main promotion 已完成。这是 accepted-candidate checkpoint，不是 Feature PASS
- Coder 交付：`ai_workspace/agent_docs/coder_0.6.0.md`
- 关闭项：v0.6 工程契约与定向测试；未关闭：F35 / F36，以及既有 F29 / F33 / v0.5.0 / v0.4 F04
- v0.5.0 继续 **FAIL / BLOCKED**（`ai_workspace/agent_docs/debugger_0.5.7.md`；真实探针 `ai_workspace/validation/v0.5.7-grok-quota-probe.json`）
- 上一 Feature `v0.4.0` 保持 **NOT PASS**，Fix Cycle 停在 `v0.4.12`；Debugger 检查点：`ai_workspace/agent_docs/debugger_0.4.12-checkpoint.md`
- 下一步：从 Main 完成回归并启动原生 Electron 供用户复核；有真实 Google / Ark 凭据时再补 F35/F36 证据。保持不 push、不创建正式 PASS tag
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

## Lifecycle Snapshot

| Field             | Current Value                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Major Stage       | `v0`                                                                                                      |
| Lifecycle State   | `v0.9.1 / DEBUGGER FAIL / BLOCKED BY ENVIRONMENT / CODER FIX #1`                                          |
| Active Feature    | `v0.9.0 — Cross-Harness Session Handoff`                                                                  |
| Active Ticket     | F1 command fencing；F2 T08 evidence integrity/scenarios；F3 schema regression；real gate `QUOTA_OR_LIMIT` |
| Current Fix Cycle | `v0.9.1`                                                                                                  |
| Current Role      | Coder Fix #1                                                                                              |
| Review Status     | `FAIL / BLOCKED BY ENVIRONMENT`；Fix Plan `debugger_0.9.1.md`                                             |

## v0.9.0 Plan Reference

- Feature：`v0.9.0 — Cross-Harness Session Handoff`
- Manager Ideate + Plan：`ai_workspace/agent_docs/manager_0.9.0.md`
- Tickets：`.scratch/craftstation-0.9.0/issues/01-runtime-segment-ledger.md` 至 `08-real-cross-harness-acceptance.md`
- 状态：`DEBUGGER FAIL / BLOCKED BY ENVIRONMENT / CODER FIX #1 REQUIRED`
- Feature worktree：`D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`
- Feature branch：`dev/v0.9-cross-harness-handoff`
- Planning base：`7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`
- 目标：在同一 CraftStation 用户可见 Thread 和同一工作区中，让后续 Turn 在不同 Model × Harness Runtime Segment 之间安全接力；不伪造跨厂商 native Session resume。
- 已确认产品语义：
  1. 默认在当前 Turn 完成后自动切换，同时提供“终止当前 Turn 并切换”；
  2. 默认 checkpoint 使用“任务摘要 + 当前状态 + 重要结果 + 最近若干轮”，不全量历史重放；
  3. 切回曾使用的 Harness 时，只要中间产生新内容，就创建新的 continuation Segment。
- 实现边界：`ConversationCheckpoint` 与 `Runtime Segment` 均为 implementation-level 术语，不提升为一级 Item；每次切换保留不可变 Recipe/CraftPlan provenance，并创建新的 Entity/native Session。
- 验收主线：真实 `Codex -> Grok Build -> Codex continuation`、目标启动失败回滚、事件 epoch 隔离、应用重启恢复和凭据安全。
- Gate Check：`OK`。采用 expand → migrate active writers → contract；以独立 Runtime Segment ledger、versioned ConversationCheckpoint 与 Supervisor-owned Session Handoff Module 实现。
- Ticket 顺序：T01 Segment Ledger → T02 Checkpoint → T03 Same-Thread Tracer → T04 Turn Boundary → T05 Abort/Rollback → T06 Event/Input Fence → T07 UI → T08 Real Acceptance。
- Debugger 首轮独立验收已完成：focused/remote/typecheck/build/touched lint/format 通过，但发现 active command fencing、T08 false-green/场景缺失、schema migration broader regression 三项工程 Finding；真实 T08 另因 `QUOTA_OR_LIMIT` 保持 `BLOCKED BY ENVIRONMENT`。下一步执行 v0.9.1 Coder Fix #1；不执行 merge、tag 或 push。

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
- `main` tracking `origin/main`，HEAD `b1af0e2`。`dev` tracking `origin/dev`，closeout 前 HEAD `be8d8c2`；Debugger PASS closeout 后以 `origin/dev` SHA 为准。不得 merge main。
- 根仓库 `D:\Work\CraftStation` 是无 remote 的治理仓，不承载产品源码提交。
- 产品仓检查点 tag：`checkpoint-v0.4.12`（不是 PASS tag，也不是 `v0.4.0`）。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Active v0.5 Feature

`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`

- Manager：`ai_workspace/agent_docs/manager_0.5.0.md`
- Tickets：`.scratch/craftstation-0.5.0/issues/01-audit-baseline.md` 至 `10-grok-e2e.md`
- Coder 交付：`ai_workspace/agent_docs/coder_0.5.7.md`
- Debugger Review：`ai_workspace/agent_docs/debugger_0.5.7.md` — F32/F34 保持关闭；F33 token billing fallback 已接线，但真实 managed probe 仍无 usedPercent，Feature 仍 FAIL/BLOCKED
- Prior review：`ai_workspace/agent_docs/debugger_0.5.0.md` / `ai_workspace/agent_docs/debugger_0.5.1.md`
- Report：`ai_workspace/reports/report_0.5.md`
- Real probe：`ai_workspace/validation/v0.5.2-grok-product-path.json`
- Lifecycle: FAIL / BLOCKED；F32/F34 关闭；F33 真实 billing 与 F29 exact Token 未关闭
- Main Promotion：`COMPLETED AS ACCEPTED-CANDIDATE CHECKPOINT / NOT FEATURE PASS`
- F10 / F11 / F12 / F13 / F14 / F15 / F25 / F26 / F28 / F30 / F31 工程项已完成；F29 真实 Token 证据与 Grok billing 仍 BLOCKED。用户 Smoke 通过前不得 merge main、不得打正式 `v0.5.0` tag。
- v0.4 F04 五 Harness 仍 FAIL/BLOCKED，不得升格。
- Out of scope：CLIProxyAPI、第二套 Usage 系统、Account/Quota/Usage 进入 Item/Recipe/Crafter、智能路由和 Auto-Crafting。

## Next Step

1. 用户在本地 `dev` 验收 v0.8 OpenCode Native Harness；当前只有 Kimi native route 具备真实 assistant response 与后续 turn 证据。
2. OpenAI、xAI、Google、DeepSeek、OpenAI-compatible Kimi 获得有效对应凭据后，再逐条补真实 assistant stream/后续 turn；未验证 route 继续 fail-closed。
3. v0.6 F35/F36、Grok 真实额度、F29 exact Token、v0.5.0 与 v0.4 F04 继续保持 FAIL/BLOCKED。
4. v0.8 尚未合入 main、未 tag、未 push；只有用户后续明确授权时才执行 Dev → Main promotion。
5. v0.9 Debugger 首轮 Verdict 为 `FAIL / BLOCKED BY ENVIRONMENT`；Coder 在唯一 Feature worktree 执行 `debugger_0.9.1.md` Fix #1，完成后通知原配对 Debugger 复检；真实 T08 保持 `UNVERIFIED/BLOCKED`。
