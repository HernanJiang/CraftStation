# Manager — v0.4.0 Native Multi-Harness Compatibility

> 当前 Feature 的唯一 Manager 交接入口。Part I 以 GitHub `main` 分支 commit `7bfaa67dd6391422a26c6441e47ca38123268a94` 为准；Part II 为本次 Manager Plan。

## Part I — Ideate

- Status：Ideated
- Ready for Plan：Yes
- Created / Last Updated：2026-08-27
- Roadmap Context：Phase 1 Runtime Foundation 向 Phase 2 Native Composition Runtime 扩展

### Feature Intent

CraftStation 必须证明自己是跨 Harness 的 Runtime Composition System，而不是 Codex GUI、通用 Agent Loop wrapper、模型 API proxy、CLIProxyAPI gateway 或任一 Harness 的替代实现。目标链路为：

```text
Model + Harness -> Crafting -> CraftPlan -> CraftStation-owned native runtime adapter
-> Official / Native Harness Runtime -> Entity -> Session -> native events / real response
```

本 Feature 的五个平级 Harness/runtime target：

1. Codex
2. Grok Build
3. Kimi Code
4. Antigravity（Google/Gemini 侧目标，不是 Gemini CLI）
5. DeepSeek / DSH

所有 execution 遵循 Official / Native Harness Runtime First。ACP、App Server、stdio RPC、SDK 或 local server 只是 machine-facing seam，不等于 CraftStation 自建 Harness。Codex 是已有 baseline，不重写其 Agent Loop；旧 `deepseek-harness/` working copy 为 `NOT PASSED / SUPERSEDED / DO NOT USE`，必须重新审计真实 upstream/native runtime，禁止用 Model API 冒充 Harness。

先完成五个完整原生 Harness，再讨论 Universal Skill/MCP/Subagent/Permission/Context 抽象、capability decomposition 或 Item promotion。只承诺经过验证的 native pairing，不默认任意 Model × Harness。

### Desired Outcome and Acceptance Intent

五个 Harness 都能进入 `Crafting -> Runtime -> Entity -> Session`，并在同一 UI 中展示公共生命周期与 native-specific 语义。至少核验 discovery/version/readiness、native auth/profile、start/resume/multi-turn、streaming、tool/file/shell、permission、interrupt、workspace、Skills、MCP、Subagents、instructions、context/compaction、plan/task、native errors、crash/protocol mismatch、cleanup 及 native session identity persistence。能力状态区分 `supported + integrated`、`native unsupported`、`implementation missing`、`runtime unavailable / not configured`、`error`。

### Frozen Decisions

- 五个 Harness 平级；Antigravity 不作为汇聚层，Gemini CLI 不进入核心范围。
- Runtime seam 只拥有 CraftStation 必须掌握的 `start/resume/send/interrupt/dispose` 与少量公共事件；每个 Adapter 自己拥有 protocol、transport、session mapping、event parser、capability discovery、permission、auth/profile、error、versioning。
- Renderer 不 spawn 进程；Supervisor/runtime layer 管理官方 binary 的 machine-facing mode。
- Account & Usage 只提供选定的 profile/environment；不把账号排序、额度 fallback、账号池策略塞入 Harness Runtime。
- CLIProxyAPI、OpenAI-compatible gateway、subscription-to-API proxy 不得进入 Harness execution path。

### Open Questions Reserved for Plan

Plan 需要根据真实仓库和 upstream audit 决定各 binary discovery、transport、native session ref、event envelope、capability descriptor、fixture/version matrix 与最小 seam 演化；不得重新开启已冻结的产品方向。

## Part II — Plan

### Ideate → Plan Gate Check

- Feasibility：**OK**。`craftstation/` 已有 Supervisor、AgentAdapter/ACP、Codex native runtime、Crafting registry、thread persistence、MCP 与 UI event seam；`reference/` 已包含 Codex、PoraCode、Harnss、AionUI、CLIProxyAPI、DSH 研究材料。
- Practicality：**OK with staged risk**。五个目标较大，按“审计 → 薄 seam → 独立 tracer bullet → 统一验收”线性推进；Codex 保持 baseline，未装/未认证 Harness 只记录 `runtime unavailable`，不伪造 PASS。
- Alignment：**OK**。直接服务 Phase 1/2；不提前进入 Phase 3/4 Auto-Crafting 或 Universal capability decomposition。
- Info Completeness：**OK**。五个 target、native-first、Antigravity 取代 Gemini CLI、旧 DSH 禁用、验收矩阵和非目标均已明确。

结论：**OK，进入 Plan。** 本次自行修复的小问题：将旧本地 Codex-first Account/Usage Plan 降级为历史/迁移输入；将旧 10 Ticket 全部替换为五 Harness 计划；保留已有 account/sidecar 工作树修改，不删除、不宣称其等于新 Feature 完成。

### Feature Spec

#### Problem Statement

当前产品已有 Codex native runtime，但共享层与现有 PoraCode 适配仍容易让 UI、session 和事件语义被某一 Harness 绑死。没有跨 Harness 的 capability evidence，就无法判断哪些是 CraftStation 必需语义，哪些只是厂商实现细节。

#### Solution

以 `harness-runtime` 为深 Module，在同一 Crafting/Entity/Session 链路中接入五个自有 Adapter。Adapter 负责官方 runtime 的发现、进程/transport、native session、事件、能力与错误；共享 seam 只负责 composition、lifecycle、workspace、profile input、公共事件投影和诊断。每个 tracer bullet 都必须从 Recipe/CraftPlan 走到真实 native response，并记录 native envelope 与 capability matrix。

#### Repository Evidence

- `craftstation/` 当前已有 Codex native app-server、ACP generic registry、AgentAdapter、MCP、Crafting registry、thread/session persistence、renderer event projection；Codex runtime 相关实现仍有大量用户未提交修改，必须原地保留。
- `reference/codex/` 是官方 Codex；`reference/poracode/` 是 `SDSLeon/lightcode` 基线；`reference/harnss/` 研究 ACP/MCP/权限/工作区；`reference/aionui/` 研究 Cowork/多 Agent UI；`reference/deepseek-harness/` 仅作最新 upstream/native 研究；`reference/CLIProxyAPI/` 仅作 provider/auth 参考，不能进入执行路径。
- CodeGraph 当前未初始化；T01 必须建立/记录索引或以结构化搜索降级。

#### Module / Seam Decisions

1. `crafting` 继续只做 deterministic resolve/validate/compile，输出 CraftPlan。
2. `registry` 保存 Harness Item、Model Item、Native Recipe 和 runtime binding。
3. `harness-runtime` 暴露最小生命周期与事件接口；禁止 UI deep-import adapter implementation。
4. 五个 provider Adapter 各自封装 native protocol/transport/session/events/capabilities/auth/errors/version。
5. `provider/API` 与 Account/Usage 只准备 profile/environment，不代理 Harness execution。
6. 公共事件保留 `nativeEnvelope` 或等价诊断引用；未知事件、版本不匹配、crash、auth/rate-limit 均稳定报错。

#### Testing Decisions

- 测试跨 Adapter/Runtime seam，断言外部行为、生命周期、错误和清理，不断言内部类名或 PoraCode 文件布局。
- 每个 Harness 有 fake process/protocol fixture 与 discovery/readiness、session/resume、stream、tool、permission、interrupt、crash、cleanup 测试；真实环境再做 manual smoke。
- Capability matrix 逐项记录 supported/integrated、native unsupported、implementation missing、unavailable、error，并保存版本、命令、证据路径。
- UI/IPC 测试验证公共 shell 与 native-specific projection 不丢事件；安全测试禁止 token/cookie/raw prompt 进入日志、renderer、持久化。
- 未安装或未认证不得以 synthetic response 宣称 Harness PASS；Coder 完成后由 Debugger 独立复核。

#### Out of Scope

UniversalSkillAdapter、UniversalMCPRuntime、UniversalSubAgentEngine、UniversalPermissionSystem；任意 Model × Harness；Gemini CLI；CLIProxyAPI/API proxy execution；Auto-Crafting、Recipe Search、Model Fingerprint、Learned Router、Recursive/Adaptive Composition；五 Harness 之前的 Component/Item promotion。

### Tickets

#### v0.4/T01 — Native Harness Audit & Compatibility Matrix

冻结五个 upstream/runtime 的 discovery、安装、版本、认证、machine-facing boundary、session、事件、能力、错误和 cleanup 证据；建立 CodeGraph 或记录可复现的搜索降级。产出每个 Harness 的 capability matrix、native pairing 清单和风险。

#### v0.4/T02 — Common Runtime Seam & Native Recipe Contract

在不破坏 v0.3 Codex baseline 的前提下，形成最薄 `start/resume/send/interrupt/dispose`、CraftPlan binding、workspace/profile input、公共事件和 capability descriptor contract；加入 architecture guard，防止共享层拥有 provider-specific loop。

#### v0.4/T03 — Codex Native Baseline Guard

把现有官方 Codex app-server runtime 固化为兼容性基线：真实 session/thread identity、stream/tool/permission/MCP/skills/subagent/context/compaction 语义不回退，legacy PoraCode adapter 不进入生产路径；补齐 contract/e2e evidence。

#### v0.4/T04 — Grok Build Native Harness

通过官方 Grok runtime machine-facing boundary 接入完整 Native Harness；优先实测 `grok agent stdio`/ACP，CLI commands 仅用于 discovery/management 辅助。完成 native session、事件、能力状态、错误和 cleanup。

#### v0.4/T05 — Kimi Code Native Harness

审计并接入官方 Kimi Code 最稳定完整的 machine-facing interface，贯通 Crafting→CraftPlan→Entity→Session，保留 Kimi 原生能力差异并输出兼容矩阵证据。

#### v0.4/T06 — Antigravity Native Harness

接入官方 Antigravity runtime 作为 Google/Gemini 侧平级目标；不以 Gemini CLI 替代。完成 discovery/auth/session/stream/events/interrupt/cleanup，并明确原生不支持项。

#### v0.4/T07 — DeepSeek / DSH Native Harness Re-audit and Integration

重新核验最新官方 DSH upstream/runtime；旧 `deepseek-harness/` 只读且 superseded。选择真实 native machine-facing boundary，禁止 Model API 假 Harness，完成 session/events/tools/capabilities/error/cleanup。

#### v0.4/T08 — Five-Harness Entity/Session/Lifecycle Acceptance

用同一 acceptance matrix 对五个 Adapter 做真实或明确 unavailable 的端到端验收：resume、multi-turn、stream、tool/file/shell、permission、interrupt、workspace、native identity、crash recovery、no leaked process。

#### v0.4/T09 — Cross-Harness Control Plane & Native Capability Projection

将已选择的 Account/Profile/Environment、权限控制、MCP/Skills 入口、诊断与公共 UI shell 贯通；保留 provider-specific semantics，不构建 universal capability runtime，明确每项 capability 状态。

#### v0.4/T10 — Capability Decomposition Design Handoff

基于五 Harness 真实差异产出后续 Component decomposition / Item promotion 设计入口、证据表和 v0.5 候选，不在 v0.4 实现 Universal* 或自动抽象。

### Dependencies / Execution Order

```text
v0.3.2 PASS -> T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08 -> T09 -> T10 -> Debugger
```

单 Coder 固定顺序：`T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10`。每个 Harness ticket 必须是可独立验证的垂直切片；若 upstream 不可用，交付 discovery/version/readiness 与 `runtime unavailable` 证据，不得改走 API 伪实现。

### Feature Acceptance Criteria

- 五个 target 均以平级 Native Harness 注册，并分别进入 `Crafting -> Runtime -> Entity -> Session`。
- Codex 保持官方 app-server baseline，无 legacy/API-proxy fallback；Grok/Kimi/Antigravity/DeepSeek 均使用真实官方/native runtime boundary。
- 五套 native session identity、resume/interrupt/cleanup、事件与错误均有审计证据；公共 UI 不吞掉 native-specific capability。
- Capability matrix 对每项能力给出明确状态、版本、证据和 unavailable 原因；不以“能聊天”代替 Harness compatibility。
- Account/Usage 只作为 profile/environment 输入；CLIProxyAPI 不在 execution path；旧 DSH 不复活。
- Coder 完成测试与证据后交 Debugger；Debugger PASS 前不得宣称 v0.4 PASS。

### Risks / Mitigations

- Upstream binary、认证或协议不可用：先做 probe/fake fixture，标记 unavailable，保留真实命令和版本证据。
- 共享 seam 被 Codex 语义污染：以第二个 Adapter 为门槛，禁止 provider `if/else` 扩散和 UI deep import。
- 事件/能力差异被统一 projection 丢失：保留 native envelope 与 provider-specific projection。
- 现有 v0.4 Codex account/sidecar 工作树修改与新目标错位：保留为外围基础/迁移输入，由 T09 决定接入，不删除或宣称完成。

### Coder Start

当前 Feature：`v0.4.0 — Native Multi-Harness Compatibility`。请先读取 `AGENTS.md`、`PROJECT_STATUS.md`、本文件 Part I/II 和 `.scratch/craftstation-0.4.0/issues/01-*.md`，确认并保护根仓库与 `craftstation/` 的未提交修改；随后严格按 `T01 → T10` 连续执行。不得复活旧 DSH、不得使用 CLIProxyAPI、不得以 Model API 伪造 Harness。

### Plan Handoff

- Plan Status：Ready for Coder
- Planned：2026-08-27
- Coder 起点：`v0.4/T01 — Native Harness Audit & Compatibility Matrix`
- Debugger：全部 Tickets 完成后进行 Feature-level 独立验收；真实 runtime 不可用时必须报告 unavailable/block，不得 synthetic PASS。
