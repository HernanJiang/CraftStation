# Manager — v0.5.0 Account & Usage Stabilization

> 当前 Feature 的单一 Manager 交接入口。Part I 记录已批准的 Ideate；进入 Manager / Plan 后再在本文件补充 Part II。

## Part I — Ideate

- Status：Ideated
- Ready for Plan：Yes
- Created：2026-08-27
- Last Updated：2026-08-27
- Roadmap Context：在 v0.4 Native Multi-Harness Compatibility 之后，对已经大部分存在的 Account & Usage 外围能力进行 repository-driven audit、修复、补齐和真实多账号 E2E 验证；本 Feature 以稳定化和收口为主，不重新设计一套账户/用量架构
- Owner：Manager / Ideate

### Feature Intent

#### Problem

CraftStation 已经拥有一套相当完整的“模型与用量 / Account & Usage”基础设施与 UI，并且用户确认相关功能当前已经实现了绝大部分。历史讨论中已经明确了该功能的目标架构：

```text
React / 现有「模型与用量」UI
        ↓
readBridge()
        ↓
existing IPC
        ↓
Supervisor
        ├── Existing UsageService
        │    └── Provider quota collectors
        │
        └── Account / Peripheral capability
             ├── Multi-account store
             ├── account/profile isolation
             ├── provider pool scheduling mode
             ├── ordered account priority / round-robin cursor
             ├── session stickiness
             └── token usage / Tokscale integration
```

这套能力属于 CraftStation 的外围产品功能，而不是 CraftStation Core Composition Domain。Account、Quota、Token Usage、Fallback Priority 都不得被包装成 `Item`、`Ingredient`、`Recipe`、`Crafter` 或其它 Minecraft 核心 ontology。

当前问题已经不再是“从零实现 Account & Usage”，而是：

1. 现有仓库中的实际实现与批准设计之间可能仍有行为缺口、半实现 TODO、重复逻辑、边界不清或真实运行问题；
2. 多账号功能如果只依赖 mock、fixture 或单账号环境，无法证明 official/native Harness 在真实多个账号下真的能隔离、选择、fallback 和保持 Session identity；
3. 用户只有一个 Codex 账号，因此 Codex 不适合作为本 Feature 的唯一真实多账号 E2E 基准；
4. 用户拥有多个 Grok 账号，而 v0.4 已将 Grok Build 作为平级 Native Harness target，因此 Grok 是 v0.5 最合适的真实多账号 reference implementation / validation target；
5. Provider Quota 与 Token Usage 是不同数据域，现有 quota 查询、缓存和刷新逻辑不应因 Tokscale/本地 usage 统计而被推翻或塞进一个巨大 universal snapshot。

#### Why Now

- v0.4 先完成 Codex、Grok Build、Kimi Code、Antigravity、DeepSeek/DSH 的 Native Harness 适配，使 v0.5 可以在真实 Harness runtime 上验证账号/profile 注入，而不是先猜不同 CLI 如何切换账号。
- Grok 将提供真实多账号测试条件，能够验证 `Account Pool -> selected profile -> Official Grok Runtime -> Native Grok Harness` 的完整闭环。
- 当前 Account & Usage 已大部分实现，继续按旧“新建模块 Phase 1/2/3”式计划会造成重复建设；本版本应先审计真实代码，再按 `DONE / FIX / MISSING` 收口。
- 把 stabilization 放在多 Harness 之后，可以让账号池成为所有 Harness 的外围输入，而不是反过来让账户系统定义 Harness architecture。

#### Desired Outcome

v0.5 完成后，CraftStation 的现有“模型与用量”应该成为可真实使用、可诊断、可验证的外围功能：

```text
模型与用量

[账号与额度]
├── Provider / Harness A
│   ├── Account A
│   ├── Account B
│   └── Account C
│
└── 选择 / 排序 / 启用禁用 / 独立 quota / reset / status

[Token 用量]
├── Today
├── Month
├── All Time
├── By Tool
├── By Model
├── By Project
└── By Session
```

执行链必须保持：

```text
Account & Usage Peripheral
        ↓
resolve pool/explicit native profile
        ↓
Official / Native Harness Runtime
        ↓
Provider
```

不得变成：

```text
Account Pool
↓
CLIProxyAPI / API proxy
↓
Provider
```

本 Feature 的主要真实验证对象是 Grok 多账号；Codex 继续保持单账号真实验证和多账号 architecture/fixture coverage，不要求为了验收人为准备第二个 Codex 账号。

### Expected Behavior

#### User Experience

- 用户继续使用现有“模型与用量”入口，不新增一套独立 Accounts 页面或第二个重复 Usage 系统。
- “账号与额度”中，同一个 Provider/Harness 可以展示 0/N 个账号；每个账号显示自身 identity、plan、quota windows、reset、状态和必要操作。
- 用户可以添加/导入账号、删除账号、刷新额度、启用/禁用账号，并通过拖拽维护账号池顺序；Provider Card 拖拽只维护展示顺序。
- 产品不再提供 `selectedAccountId` / “设为首选”语义。Auto 使用每个 Provider Pool 的调度模式；显式账号只存在于创建新 Session 的 override。
- 显式 per-run/account override 不可用时，CraftStation 明确报错，不偷偷替换成其它账号。
- Auto/default 模式允许按明确规则 fallback。
- 已经运行的 Session 默认保持账号 sticky；某账号后续额度耗尽，不允许后台悄悄把正在运行的 Session 切到另一个账号。
- Token Usage 与 Quota 在同一产品入口中呈现，但语义分开：Quota 表示“还能用多少”，Token Usage 表示“历史用了多少”。
- Token Usage 数据必须能标识 `exact / derived / estimated` 等质量，不能把估算结果伪装成官方精确数据。

#### System Behavior

- 现有 provider quota infrastructure、UsageService、cache-first、stale-while-revalidate、background refresh、request coalescing、429/Retry-After 等已存在能力优先复用；本 Feature 不重写第二套 quota collector framework。
- Plan 首先审计当前仓库真实实现，输出 `DONE / FIX / MISSING` Gap Matrix，再决定实际改动；禁止按照历史讨论假设“某模块还没做”而重建已存在代码。
- Account Resolver 保持简单、确定性，不演化为智能调度器、cost optimizer 或跨 Provider load balancer；Round-Robin 仅是 Provider Pool 的显式模式。
- 默认 resolve 语义：

```text
explicit per-session override
  ├── usable -> use it
  └── unusable -> explicit unavailable error, no silent fallback

otherwise provider pool scheduling mode
  ├── priority -> first usable account in Account Row order
  ├── round-robin -> next usable account in persisted ring
  └── random -> random usable account
```

- `quota-low` 只是 warning，仍允许使用；只有 provider-specific evidence 表明真正 exhausted/unavailable 时才进入 fallback。
- Account status 由 service/account layer 基于 user-enabled state、auth state、quota state 和 provider-specific facts 推导；Renderer 不用简单 `usedPercent >= 100` 自己判断 exhaustion。
- Quota reset 到期并刷新成功后，账号可从 `quota-exhausted` 自动恢复为可用，无需用户手动重新启用。
- 每个新 Session 在启动 native Harness 前解析最终账号/profile，并把官方 profile/environment 注入对应 Harness adapter；Account Pool 不拥有 Agent Loop，也不接管 Harness runtime 内部行为。
- Renderer/IPC view 永远不暴露 access token、refresh token、cookie、API key 或 raw auth file。

#### Important Scenarios

1. Grok Account A 与 Account B 均通过官方 Grok account/profile mechanism 可被 CraftStation 管理和识别。
2. A/B 各自显示独立 plan/quota/reset/status；刷新 A 不覆盖 B，刷新 B 不污染 A。
3. 用户将顺序设为 `B > A`，Auto 新 Session 默认使用 B。
4. 用户显式选择 A，新 Session 使用 A；若 A 此时 unavailable，则明确报错，不偷偷改用 B。
5. Auto 模式下 Pool 当前模式选择的账号耗尽或 unavailable，新 Session 按该 Pool 的规则选择下一个可用账号。
6. 已经绑定 A 的运行中 Session 在 A 后续 exhausted 时仍保持 A；新的 Auto Session 才允许选择 B。
7. 重启 CraftStation 后，account list、enabled state、selection、order 等非敏感管理状态保持一致。
8. Quota reset 后刷新，账号自动恢复可用状态。
9. Codex 只有一个真实账号时仍可通过真实 single-account path 验证 profile/runtime 兼容；Codex multi-account isolation/fallback 可由 fixture/integration test 证明架构行为，不作为唯一 Feature E2E blocker。
10. Token Usage 能读取当前集成的本地历史数据并按 Today / Month / All Time、Tool / Model / Project / Session 聚合；不同来源保留 provenance/quality，避免重复计数。
11. 应用打包后 sidecar/helper/Tokscale 或现有等价实现仍能在支持平台被正确定位和运行，不仅 dev 环境可用。

### Scope

#### In Scope

- 对当前仓库已经存在的 Account & Usage 实现做完整 repository-driven audit。
- 输出 `DONE / FIX / MISSING` capability matrix，并仅修复/补齐真实 gap。
- 继续复用现有“模型与用量”UI 和快速 UsagePanel；允许内部拆 component，但不新建重复产品入口。
- Multi-account list、identity、enabled state、ordering、remove/import/add/refresh 等已批准行为的修复与收口；创建 Session 时支持 explicit override。
- Account Pool Resolver 的 deterministic mode + ordered account 行为。
- Session sticky account binding。
- Per-account quota isolation、status、reset recovery 和错误语义。
- Grok 作为 primary real-world multi-account reference implementation / E2E validation target。
- Codex single-account real validation + multi-account architecture/fixture/integration coverage。
- v0.4 已支持的其它 Harness 若当前已有 account/profile adapter，可做必要接线和稳定化；但不要求所有 provider 在 v0.5 都完成真实多账号 E2E。
- Token Usage / Tokscale 或当前仓库已实现的等价本地 usage scanner integration 的审计、修复、normalization、quality/provenance 和 UI 收口。
- Quota 与 Token Usage contract 的清晰分离。
- persistence、atomic credential/profile operations、refresh coordination、security、diagnostics 和 packaging 的修复。
- 真实 Grok 多账号 E2E evidence、自动测试和回归覆盖。

#### Out of Scope

- 把 Account、Quota、Usage、Fallback Priority 建模为 CraftStation Item / Ingredient / Recipe / Component。
- 重写现有 UsageService 或创建第二套 Provider Quota framework。
- 重新设计一套新的 Accounts 页面或替换现有“模型与用量”入口。
- Round-robin per request、智能评分、cost-aware routing、load balancing、AI account scheduler。
- 运行中 Session 的静默 hot account migration。
- 为显式指定但不可用的账号自动 fallback。
- 为 v0.5 强制所有 provider 都完成真实多账号 E2E。
- 为了验证 Codex 多账号而要求用户额外准备第二个 Codex 账号。
- CLIProxyAPI、OpenAI-compatible gateway、subscription-to-API proxy 或自建模型请求代理。
- 云端 credential/account sync。
- 将 Token Usage 与 Quota 强行塞入一个巨大 `UsageSnapshot`。
- v0.4 Multi-Harness runtime architecture 重构；v0.5 只消费其稳定 account/profile injection seam。
- Auto-Crafting、Model Fingerprint、Router、trajectory DB、research algorithm。

### Important Decisions

#### Product Decisions

1. **v0.5 是 Stabilization Feature，不是从零建设。** 用户确认绝大部分功能已经实现；Plan 必须先读真实仓库，再决定哪些模块保留、修复或补齐。
2. **Grok 是真实多账号验收基准。** 因用户拥有多个 Grok 账号，v0.5 的 production-level multi-account E2E 以 Grok 为 primary reference implementation。
3. **Codex 不再承担唯一多账号 E2E 证明。** Codex 继续保证 architecture compatibility、single-account real path 和 multi-account automated coverage。
4. **Explicit override 不 silent fallback。** 用户明确指定 Account A 时，A 不可用就报错；只有 Auto/default resolve 才允许 fallback。
5. **Pool Mode 与 Order 是唯一 Auto 语义。** `selectedAccountId` / “设为首选”从产品模型移除；Account Row 顺序在 Priority/Round-Robin 中承担调度语义，Random 中只影响展示。
6. **三种 Pool Mode。** 每个 Provider 独立支持 Priority、Round-Robin、Random，默认 Priority；调度只发生在新 Session。
7. **Session Sticky。** Pool mode 只影响新 Session，不默认改变运行中 Session 的账号 identity。
8. **Quota Exhaustion 是 provider-aware service decision。** Renderer 不通过单一百分比自行推断。
9. **Quota 与 Token Usage 分离。** 现有 quota snapshot 保持其职责；Token history 使用独立 contract/store/normalization。
10. **本 Feature 是外围能力。** 不污染 CraftStation Core domain ontology。
11. **Official / Native Harness Runtime 仍是唯一 execution path。** Account system 只准备并选择官方 profile/environment。

#### High-level Architecture Direction

保持并优先复用当前已有结构，概念上仍为：

```text
Renderer
  ↓ readBridge / existing IPC
Supervisor
  ├── Existing UsageService
  │    └── provider quota collection + cache/refresh
  │
  ├── Account orchestration / existing equivalent
  │    ├── account views
  │    ├── pool scheduling mode + ordered accounts
  │    ├── provider-scoped profile refs
  │    └── status derivation
  │
  └── Peripheral/local service / existing equivalent
       ├── local credential/profile operations
       ├── atomic writes / refresh locks
       ├── persistence
       └── Tokscale / token usage scanning
```

这不是要求仓库必须存在名为 `AccountService`、`PeripheralService` 或 Rust sidecar 的特定文件；Plan 必须以当前实现为准。如果等价能力已经在其它模块中稳定存在，应复用而不是为了匹配旧讨论重命名/重建。

Harness integration 方向：

```text
Account Resolver
  ↓
selected native profile/environment
  ↓
v0.4 Harness Adapter
  ↓
Official / Native Harness Runtime
```

Account & Usage 只负责选择和准备，不拥有 Harness execution。

#### Trade-offs

- 把 Grok 设为真实多账号 blocker，而不是 Codex，可以获得真实 E2E 证据，同时避免人为制造测试账号条件。
- 不要求所有 provider 都在 v0.5 完成真实多账号，会牺牲“全平台一次完成”的表面完整度，但能控制 scope，并让 shared account architecture 先经过一个真实强验证。
- 保留 quota 与 token usage 两套独立 contract 会增加少量状态/IPC surface，但能避免不同语义互相污染。
- 先 audit 再修复会减少“看起来进度快”的新代码量，但更符合当前实现已经大部分完成的现实，也能显著降低重复架构风险。
- Session sticky 牺牲在运行中自动换号的表面便利，换取身份一致性、可恢复性和 native Harness session 语义安全。

### Constraints

- v0.5 产品实现依赖 v0.4 至少已经为 Grok 提供可用的 Official / Native Harness runtime 和可注入 account/profile seam；若 v0.4 尚未满足这一点，真实 Grok multi-account E2E 不能伪造通过。
- 当前仓库实际实现优先于历史对话中的文件名、模块名和旧计划；Plan 不得假设 Rust sidecar、Tokscale wrapper、store 或 IPC 尚未实现。
- Renderer 不得获得 credential secret；任何 token/cookie/API key/raw auth body 不进入 renderer-facing state、IPC result、logs 或 crash diagnostics。
- 删除 CraftStation managed account 不能删除或破坏用户原始官方 CLI profile/home，除非用户明确选择并存在清晰安全语义。
- credential/profile 写入必须 atomic；OAuth/refresh-token rotation 场景必须有 scoped lock/reconciliation 或当前实现中的等价安全机制。
- provider-specific profile/account 细节保持在 adapter/provider boundary；shared resolver 不累积 vendor-specific switch logic。
- 所有持久化 state、cache、IPC/wire/helper protocol 的兼容边界继续遵守仓库 versioning 规则。
- UI 修改继续遵守现有 HeroUI、i18n 和 provider-agnostic shared UI 约束。

### Acceptance Intent

#### Repository Audit Gate

Plan / implementation 开始时必须先建立基于当前 `main` / 实际 working baseline 的 Gap Matrix：

```text
Capability | Current Evidence | Expected | DONE / FIX / MISSING | Action
```

至少覆盖：

- [ ] existing Model & Usage dialog / account UI
- [ ] quick UsagePanel shared backend
- [ ] account list / N-account rendering
- [ ] add/import/remove
- [ ] enable/disable
- [ ] pool scheduling mode / account order persistence
- [ ] drag/order persistence
- [ ] per-account quota isolation
- [ ] status derivation
- [ ] ordered fallback
- [ ] explicit override behavior
- [ ] session sticky binding
- [ ] auth/profile isolation
- [ ] reset recovery
- [ ] Token Usage / Tokscale
- [ ] token quality/provenance
- [ ] renderer secret isolation
- [ ] diagnostics/log redaction
- [ ] packaged helper/runtime resolution

不得在完成这个 audit 前按旧计划批量新建重复模块。

#### Grok Real Multi-Account Blocker

v0.5 不得 Feature PASS，除非至少两个真实 Grok 账号完成以下 official/native Harness E2E：

- [ ] Account A、Account B 都能被 CraftStation 安全识别/管理。
- [ ] A/B 的 credential/profile scope 不串号。
- [ ] A/B 独立显示 quota/status/reset；刷新互不覆盖。
- [ ] 用户可以改变账号池模式与 Account Row order，重启后保持。
- [ ] Auto + `B > A` 时，新 Grok Session 实际由 B 的官方 profile 启动。
- [ ] 显式选择 A 时，新 Session 实际由 A 启动。
- [ ] 显式 A 不可用时明确报错，不 silent fallback。
- [ ] Auto 当前账号 exhausted/unavailable 时，新 Session 按 order fallback 到另一个可用账号。
- [ ] 已在 A 上运行的 Session 不因 A 后续 exhausted 而静默切 B。
- [ ] 整个执行路径仍为 Official Grok Runtime / Native Grok Harness，不存在 CLIProxyAPI 或模型 API 代理替代。

#### Codex Compatibility

- [ ] 现有 Codex 单账号真实 runtime path 不被 v0.5 破坏。
- [ ] Codex multi-profile architecture/contract 可通过 fixture/integration test 覆盖 add/select/order/isolation/fallback semantics。
- [ ] 不因为缺少第二个真实 Codex 账号而阻塞 Grok 已经证明的 shared account architecture。

#### Quota & Token Usage

- [ ] Quota 继续使用或复用现有 provider-specific collector + cache/refresh infrastructure。
- [ ] Account status 至少区分 `available / quota-low / quota-exhausted / auth-expired / disabled / unavailable / error` 或仓库中语义等价的明确状态。
- [ ] quota-low 不触发 fallback；真实 exhausted/unavailable 才触发。
- [ ] reset 后 refresh 可以恢复账号可用状态。
- [ ] Token Usage 独立于 quota snapshot，可展示 Today / Month / All Time 和现有可支持的 Tool / Model / Project / Session breakdown。
- [ ] Token data 保留 `exact / derived / estimated` 或语义等价的数据质量标记。
- [ ] native Harness usage 与 local scanner 重叠时有明确 provenance/dedup 规则，不重复计数。

#### Security / Reliability

- [ ] Renderer/IPC 不包含 secret fields。
- [ ] credential/profile write atomic。
- [ ] refresh/token rotation 有 scoped coordination。
- [ ] account removal 不破坏用户原始官方 profile。
- [ ] logs/crash diagnostics 不泄漏 credential。
- [ ] restart 后管理状态稳定恢复。
- [ ] packaged build 中相关 helper/scanner/service 可定位并正常运行。

### Open Questions

无阻塞产品问题。

当前只保留实施审计型问题：

- 当前仓库实际已经完成哪些 Account Pool、Tokscale、Rust/peripheral、store、IPC、UI 和 provider adapter 能力；哪些旧讨论已被实现替代。
- Grok 当前官方 profile/account isolation 的真实机制在 v0.4 adapter 中如何暴露给 v0.5，是否需要最小补充 seam。
- 当前实现中的 `selected account` 遗留状态如何迁移为 pool mode / explicit override；如不一致，以本 Ideate 冻结语义为准修复。
- 当前 Token Usage 是否已经完整使用 Tokscale、部分 parser、或其它等价实现；Plan 只修真实缺口，不强制为了名称一致做迁移。

### Questions Reserved for Plan

- 以当前仓库为准，哪些模块是 `DONE`、哪些必须 `FIX`、哪些真正 `MISSING`。
- 当前 account/profile persistence 与 provider quota snapshot 的数据模型是否已支持 per-account identity，若已支持则如何最小修复；若未支持则在哪个 boundary 增量扩展。
- Grok 两个真实账号应如何安全建立可重复的测试夹具/人工 E2E 步骤，避免测试破坏用户官方 profile。
- Session account binding 目前保存在哪里，以及如何证明 restart/resume 后不发生 identity drift。
- 当前 quota collectors 与 account-scoped credential resolver 如何复用，避免按账号复制一整套 provider collector。
- 当前 Token Usage scanner 的 normalization/provenance/dedup 如何落到既有 contract/store/UI。
- 哪些 provider 在 v0.5 顺手完成 adapter 收尾，哪些明确延期，以避免“所有厂商多账号”无限扩 scope。
- packaging、cross-platform path、helper binary/version boundary 和 migration 的真实缺口。
- 修复顺序、Ticket 切分和 regression matrix；应以 audit 发现的风险排序，而不是照搬历史 Phase 计划。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Not Started
- Notes：本 Part I 冻结 v0.5 的产品与验收方向。该 Feature 不是重新开发 Account & Usage，而是基于当前仓库已大部分存在的实现进行审计、修复、补齐和真实验证。核心架构沿用既定方向：复用现有“模型与用量”UI、existing IPC、Supervisor、UsageService 和 provider collectors；Account Pool 作为外围能力提供账号/profile selection、ordered fallback 和 Session stickiness；Quota 与 Token Usage 分离；Official / Native Harness Runtime 保持唯一执行路径。Grok 因具备多个真实账号，成为 v0.5 multi-account 的 primary E2E reference implementation；Codex 保持 single-account real validation 与 multi-account automated architecture coverage。后续 Manager / Plan 必须首先读取当前仓库并形成 `DONE / FIX / MISSING` Gap Matrix，再拆 Plan/Tickets，不得按旧对话假设重建已经实现的模块。

---

## Part II — Manager Plan

### Plan Gate Check（2026-08-28）

结论：**OK，进入 Plan**。

- **Feasibility**：现有 AccountStore、managed profile、sticky binding、UsageService、TokenUsage contract、Renderer-safe projection 与 CodeGraph 已存在；新增能力可放在现有 IPC/Supervisor/UI seam，不需要改写 Harness loop。
- **Practicality**：先做调度与 Grok tracer bullet，再完成 UI/数据和 Tokscale packaging，最后做真实 E2E；单 Coder 可按序执行。
- **Alignment**：Account & Usage 保持外围能力；Official / Native Harness only；不污染 Item/Recipe/Crafter，不复活 CLIProxyAPI。
- **Info completeness**：Part I 已冻结产品行为，无阻塞产品问题；实现不确定性由审计型 Ticket 收敛。

### Current Implementation Gap Matrix

| Capability                                                        | 当前事实                                                       | Verdict     | 计划动作                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| AccountStore 持久化、启用/禁用、重命名、排序、atomic write/backup | 已存在                                                         | DONE        | 保留并补回归                                                             |
| Grok/Codex managed profile 与基础 Session binding                 | 已存在；Grok 使用隔离 `GROK_HOME`，Codex 使用隔离 `CODEX_HOME` | DONE        | 接入调度与 E2E 证据                                                      |
| selected/首选账号语义                                             | `selected`、`selectAccount`、`selectedAccountId` 和 UI 仍存在  | FIX         | 删除产品层 preferred 语义，迁移为 pool mode + explicit override          |
| 新 Session 账号传递                                               | `craftAgent` 当前主要只传 `craftPlan/projectLocation/prompt`   | FIX         | 在新 Session seam 解析并持久绑定最终 account/profile                     |
| Priority / Round-Robin / Random                                   | resolver 只有 selected + priority fallback                     | MISSING     | 新增 provider-scoped scheduling contract、cursor 与 resolver             |
| hard-error 与 quota-low 过滤                                      | 现有 `error` 会停止 fallback                                   | FIX         | usable filtering：quota-low 可用，hard-error 跳过并保留诊断              |
| Provider Card display order                                       | 未持久化，排序硬编码                                           | MISSING     | presentation-only order store 与 DnD                                     |
| Account Row order                                                 | 有 reorder，但 Codex/Grok drop provider 参数接反               | FIX         | 修复 scope，明确只影响 pool scheduling order                             |
| Identity / alias                                                  | UI 主副文本反向；Grok 默认 alias 不合约                        | FIX         | identity 大字、alias 小字、`<Provider> Account N` 默认生成               |
| Account Row 2×2 usage grid                                        | 当前无固定 per-account grid                                    | MISSING     | 在现有 Modal/UsagePanel 增量接入                                         |
| Account-scoped quota/reset/status                                 | quota refresh 固定走 Codex collector，Grok 行会错 provider     | FIX/MISSING | provider-aware collectors、独立 snapshot、reset recovery                 |
| Token usage/cache hit                                             | TokenUsage contract 存在，UI/account 聚合未完整接线            | FIX         | account-scoped summary、quality/provenance、无数据显示 `—`               |
| Tokscale                                                          | sidecar 明确返回未 bundled                                     | MISSING     | 正式 adapter、binary/version/capabilities/schema normalization、打包验证 |
| 删除/refresh 安全                                                 | managed-scope 基础已有；active Session 防护和 Grok reauth 仍缺 | FIX         | binding guard、per-account refresh lock、原账号 reauth                   |
| Renderer secret isolation                                         | Renderer-safe view 不含 credential secret                      | DONE        | 维持并加负向测试                                                         |
| Real Grok multi-account E2E                                       | 尚无至少两个账号的完整产品级证据                               | MISSING     | v0.5 blocking acceptance                                                 |

### Deep Module Seams

1. **Provider Presentation Ordering**：`readOrder()` / `reorder(providerIds)`。只负责 UI 展示顺序，不可被 Runtime resolver 读取。
2. **Account Pool Scheduling**：`resolveForNewSession(providerId, explicitAccountId?)`。隐藏 mode、usable filtering、priority/RR/random、cursor 与持久化；返回最终 binding，Session 生命周期内不再次调度。
3. **Token Usage Scanner**：`inspectCapabilities()` / `scan(scope)`。隐藏 Tokscale binary、profile scope、版本兼容、normalization、provenance 和错误映射；Renderer 只消费 CraftStation `TokenUsageResponse`。

### Feature Spec

#### 目标行为

- 现有“模型与用量”入口改为左侧 4 列已认证 Provider Pool、右侧 1 列未认证 Provider；Provider Card DnD 只改变展示顺序。
- 每个 Pool 支持 `priority`（默认）、`round-robin`、`random`；Account Row 顺序在 priority/RR 中有运行语义，在 random 中仅为展示。
- 调度只发生在新 Session；显式账号不可用返回稳定错误，Auto 才能按 pool 规则 fallback；运行中 Session 永远 sticky。
- identity/email 为主文字，用户 alias 为副文字；账号右侧固定 2×2 显示 5h quota、weekly quota、Input/Output Token、Cache Hit Rate。
- Quota 与 Token Usage 使用独立 contract；所有 quota reset 保留 `resetsAt`；未知 cache 数据显示 `—` 并标明 unavailable/quality。
- Tokscale 或等价 scanner 通过正式 Adapter 接入，支持 profile-aware scope、能力探测、打包后二进制定位和 schema normalization。
- 全执行链仍为 Official / Native Harness Runtime；不得引入 CLIProxyAPI；Renderer/IPC/logs 不得泄露 secret。

#### 错误语义与可观测性

- `explicit_account_unavailable`：显式账号不可用，不 fallback。
- `pool_exhausted`：Auto pool 没有 usable account。
- `account_hard_error_skipped`：hard-error 被跳过并保留原始原因。
- 关键事件至少携带 `phase`、`operation`、`providerId`、`accountId`、`sessionId`、`requestId`、`status` 和稳定 `code`；禁止 token/cookie/auth body。

### Tickets / Dependencies / Execution Order

以下 Tickets 是单 Coder 的 tracer-bullet 顺序；每项都要求跨 contract、IPC/service、UI（若涉及）与测试的完整可验证切片。

| Ticket | 标题                                  | Blocked by          | 交付与验收重点                                                                                             |
| ------ | ------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| T01    | Audit baseline 与迁移契约             | None                | 固化 Gap Matrix；定义 selected→mode/explicit 迁移、持久化版本和兼容回归；无 secret 进入投影。              |
| T02    | Account Pool scheduling contract      | T01                 | provider-scoped mode、ordered accounts、usable filtering、稳定错误；默认 priority。                        |
| T03    | Priority tracer 与 Session sticky     | T02                 | 新 Session 真实绑定 profile；priority fallback、显式不可用报错、resume/restart sticky。                    |
| T04    | Round-Robin / Random                  | T02,T03             | RR cursor/顺序持久化策略、随机只取 usable、测试不依赖具体随机序列。                                        |
| T05    | Provider presentation order 与 4/1 UI | T01                 | Provider DnD 持久化且不影响 runtime；认证/未认证左右区域和响应式滚动。                                     |
| T06    | Identity、alias 与 Account Row 2×2    | T02,T05             | 主副文字、默认 alias、编辑持久化、优先级文案和四格 usage view model。                                      |
| T07    | Account-scoped quota/status/reset     | T02,T03,T06         | provider-aware collector；A/B quota、reset、status 独立；刷新不串号。                                      |
| T08    | Tokscale adapter 与 packaging         | T01,T06,T07         | capability/version/binary resolution、profile scope、normalization/provenance、打包产物验证。              |
| T09    | Security、删除与 refresh hardening    | T03,T07,T08         | active binding guard、原账号 reauth、atomic/lock、managed-only 删除、日志脱敏。                            |
| T10    | Grok 双账号真实 E2E 与回归            | T03,T04,T07,T08,T09 | 至少两个真实 Grok 账号完成 Priority/RR/explicit/sticky/quota/profile/native runtime 全链路；形成独立证据。 |

### Detailed Acceptance Criteria

- [ ] `selectedAccountId`/“设为首选”不再作为产品调度语义；迁移后 Auto 使用 provider pool mode。
- [ ] Provider Card 顺序与 Account Row 顺序分别持久化，二者互不改变对方语义。
- [ ] Priority、Round-Robin、Random 仅在新 Session 解析；Session 后续 prompt/resume 保持同一 account binding。
- [ ] explicit account unavailable 返回稳定错误，不 silent fallback；Auto 跳过 disabled、auth-expired、quota-exhausted、runtime-unavailable、hard-error，保留 quota-low。
- [ ] identity/email 大字、可编辑 alias 小字；默认 alias 为 `<Provider> Account N`，重启保持。
- [ ] 每个账号独立展示 5h/weekly quota 与可靠 `resetsAt`、Input/Output token、cache hit（无可靠数据为 `—`）。
- [ ] Quota 与 Token Usage contract 分离；Tokscale/等价 scanner 通过 adapter 接入，标记 exact/derived/estimated，禁止重复计数。
- [ ] UI/IPC/logs/crash diagnostics 不包含 access token、refresh token、cookie、API key 或 raw auth 文件。
- [ ] 删除只作用于 managed profile；active Session 有明确阻止/停止流程；refresh 具备 per-account lock 和 atomic write。
- [ ] 至少两个真实 Grok 账号在 Official Grok Harness Runtime 上完成独立 profile、quota、Priority/RR/explicit/sticky E2E；否则 Feature 保持 NOT PASS。

### Definition of Done / Quality Gate

Feature 只有在 T01–T10 全部完成、`pnpm typecheck`、`pnpm lint`、相关 Vitest/integration tests 通过，并由 Debugger 在 dev 独立复现 Grok 双账号 E2E 后才可标记 `DEV PASS / USER ACCEPTANCE PENDING`。绿测、文档或 commit 单独不足以证明完成；缺少真实账号/官方 runtime 证据时必须保持 `FAIL / BLOCKED`。

### Published Tickets

本次采用仓库本地 tracker；票据将发布到 `.scratch/craftstation-0.5.0/issues/`，编号按依赖顺序 `01`–`10`，状态统一为 `ready-for-agent`。Coder 从 `01-audit-baseline.md` 开始，按表中顺序连续执行。

### Plan Handoff

- Plan Status：**Ready for Coder**
- Active Development Branch：`dev`
- Dev Worktree：`D:\Work\CraftStation\craftstation-dev`
- Main Worktree：`D:\Work\CraftStation\craftstation`
- Coder 必须在 dev 工作树读取本文件 Part II、`PROJECT_STATUS.md` 与票据，完成 T01→T10；不得修改 main。
