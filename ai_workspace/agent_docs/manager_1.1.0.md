# Manager — v1.1.0 Compatibility Bridge & Model × Harness Composition

> 当前 Feature 的单一 Manager 交接入口。Part I 记录 Ideate，Part II 记录 Plan。
> 本文件只冻结产品意图、系统行为、架构边界、迁移方向和验收意图。
> 不包含 Tickets、文件级 Spec、Coder/Debugger 派发，也不进入实现。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-09-03
- Last Updated：2026-09-03（Plan published）
- Roadmap Context：Phase 2 Native Composition Runtime 之后，把已有的 Model × Harness 产品概念从“看起来可选、实际仍走厂商默认或无效兼容执行”推进为可验证的双路径执行：Native pairing 继续 100% Native；Cross pairing 才进入 CLIProxyAPI Compatibility Bridge，再投影到官方 Target Harness。本 Feature 不进入 Phase 3 Auto-Crafting。
- Owner：Manager / Plan
- Relation to v1.0.0：`ai_workspace/agent_docs/manager_1.0.0.md` 冻结了高效/兼容模式的组合 UX 与 CapabilityResolution 意图，但其“统一 Compatibility Layer 解析整个 Model × Harness matrix”的执行架构被本 Feature 取代。v1.0.0 历史不改写；组合产品概念保留，旧兼容执行机械待 Plan 审计后 REPLACE/DELETE。
- Execution Gate：`PLAN READY / EXECUTING`。worktree `.worktrees/v1.1.0-compatibility-bridge` / 分支 `dev/v1.1.0-compatibility-bridge`，基线 `main@f5a4bb2`（`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`）。v1.0.1 Native Profile Runtime 仍是产品当前执行 Feature，不得表述为 PASS。本 Feature 并行执行，不 merge/tag/push `origin/main`。Manager 不预先创建 Debugger。

### Feature Intent

#### Problem

CraftStation 已经把 Model 与 Harness 作为可独立选择的组合概念，也已经有多条官方 Native Harness 路径。但当前用户体验和执行现实经常脱节：

- Native pairing（例如 Codex Subscription + Codex Harness）必须继续走官方 Runtime，不能被统一架构拖进 CLIProxyAPI。
- Cross pairing（例如 Codex Subscription + OpenCode Harness）如果没有可靠 Compatibility Route，就会退化成假兼容、硬编码 pairing、旧 adapter fallback，或根本不执行。
- 旧 Model × Harness 实现可能“看起来存在但实际没用”：UI 能选，Recipe/Result 能显示，真正 spawn 时仍走默认 Native，或走无效 compatibility machinery。
- 如果把 CLIProxyAPI 当成统一执行底座，会污染 Native Route、Account Pool、Quota/Usage Authority 和 Session Sticky。

用户真正要的不是再发明一个 universal Agent Loop，而是：

```text
Native pairing  → 100% Native Route（永远绕过 CLIProxyAPI）
Cross pairing   → Compatibility Route
                → CLIProxyAPI Compatibility Bridge
                → 按 Target Harness 选择协议
                → Official Target Harness
```

#### Why Now

v1.0.0 Ideate 已经确认 Model × Harness 是产品能力，而不是某个 Harness 的换皮。v1.0.1 正在修复 Native CLI 多账号 Profile Isolation，使官方 Harness 真正按选中账号运行。下一步不能再靠“统一 Compatibility Layer”把 Native 和 Cross pairing 混成一条执行链。

现在冻结 v1.1.0，是为了在 Native Route 已经存在的前提下，单独引入 Compatibility Bridge：

- 保留现有 Native Harness 路径，不做重写。
- 只在非原生组合时使用 CLIProxyAPI。
- 用 Target Harness 官方支持的第三方 API / Base URL 跑官方 Target Harness。
- 替换并最终删除旧的无效 compatibility execution machinery，而不是删除 Model × Harness 产品概念。

如果现在不冻结双路径，后续 Plan 很容易把 CLIProxyAPI 塞进 Native、重做 Account/Usage，或把 HTTP 200 当成 Compatibility PASS。

#### Desired Outcome

用户选择 Model + Harness 后，系统通过 `ExecutionRouteResolver` 明确走 Native 或 Compatibility，并在 UI 上显式区分。Native 永远是默认和推荐路径。Compatibility 只服务非原生组合，且仍然 spawn 官方 Target Harness。Account Pool、Quota、Token Monitor、Tokscale 和官方 quota 查询保持现有权威，不被 CLIProxyAPI usage 替换。

最终形态：

```text
                         CraftStation

                    Model + Harness Selection
                              |
                              v
                    ExecutionRouteResolver
                              |
                +-------------+-------------+
                |                           |
                v                           v
           Native Route              Compatibility Route
                |                           |
                |                           v
                |                      CLIProxyAPI
                |                           |
                |                  Target Protocol
                |                           |
                v                           v
        Official Native Harness      Official Target Harness
```

Account & Usage Plane 独立保持：

```text
Account Pool
Official Quota Queries
Token Monitor
Tokscale
Session Account Binding
```

### Expected Behavior

#### User Experience

- 用户继续选择 Model 与 Harness，而不是选择 Subscription Item 或 Compatibility Account Item。
- 存在原生 pairing 时，对应 Harness 显示为 Native · Recommended，并作为默认。
- 非原生 pairing 明确显示 Compatibility；如存在非官方订阅访问 / ToS 风险，可标 Compatibility / Unofficial。具体文案由 Plan 决定，但不得把 Compatibility 伪装成 Native。
- 用户能看到当前组合走哪条 Route，而不是只看到“已选择”。
- Compatibility 不承诺 Full Native Parity。UI/产品状态应能表达 supported / degraded / unsupported / not tested / failed，而不是只有能跑/不能跑。
- Account Pool 排序、优先级、Round-Robin、Random、Session Sticky 的既有交互保持。Compatibility Route 不得让用户以为选了账号 A，实际跑了账号 B。
- Quota / Token Usage / Tokscale 继续展示 CraftStation 现有账号数据，不改成 CLIProxyAPI 自己的 usage 面板。

概念示例（文案非最终）：

```text
GPT / Codex Subscription
Harness:

* Codex
  Native · Recommended

o OpenCode
  Compatibility

o Kimi Code
  Compatibility
```

#### System Behavior

系统只承认两条执行路径，绝对不能混淆。

**Native Route**

如果当前 Model / Subscription 与 Harness 是原生组合，必须继续：

```text
CraftStation
-> Official Native Runtime
-> Official Native Harness
```

禁止经过 CLIProxyAPI。冻结的原生例子：

```text
Codex Subscription + Codex Harness
Kimi Subscription + Kimi Harness
Grok Subscription + Grok Build Harness
Antigravity Subscription + Antigravity Harness
```

OpenCode 的原生 pairing 同样走官方 OpenCode Runtime；只有非 OpenCode-native 的 Model/Subscription 配 OpenCode 时才进 Compatibility。

**Compatibility Route**

只有用户选择非原生组合时才进入 Compatibility Bridge：

```text
Subscription / Account
        ->
CLIProxyAPI
        ->
Target-compatible API Protocol
        ->
Official Target Harness
```

例如：

```text
Codex Subscription
-> CLIProxyAPI
-> OpenAI-compatible
-> Official OpenCode Harness
```

**ExecutionRouteResolver**

输入类似：selected Model、selected Harness、account/subscription binding、runtime capabilities。输出只能是 Native 或 Compatibility。基本规则：

```text
if native pairing:
    NativeRoute
else:
    CompatibilityRoute
```

具体 native pairing matrix 与 runtime capability 必须由 Plan 结合真实代码确定。Ideate 不提前写死文件名或模块拆分。

**Compatibility Exporter**

每个 Target Harness 需要一层很薄的 compatibility projection，把 Compatibility Bridge 投影成该 Harness 能理解的配置：

```text
Local Base URL
Local Compatibility API Key
Protocol
Model ID
Config file / environment
必要的 backup / restore / isolated runtime config
```

不要在 shared runtime 中散落大量 `if codex / if kimi / if grok`。不要重新实现目标 Harness Agent Loop。

**Credential 边界**

真实 Subscription Credential / OAuth / refresh token 只进入 CLIProxyAPI / Compatibility Credential Layer。Target Harness 和 Renderer 不得直接接触真正 subscription refresh token。Target Harness 只获得本地兼容 API 配置。

**Account pinning**

CraftStation Account Scheduler 继续负责选出 Account。Compatibility Route 必须把 `selectedAccountId` pin / scope 到确切的 CLIProxyAPI credential。不得同时开启 CraftStation scheduling 与 CLIProxyAPI 任意 credential scheduling。若当前 CLIProxyAPI 无法可靠 pin，Plan 再研究 isolated auth scope / isolated CPA instance / per-account credential namespace。Ideate 不选择具体实现。

**Antigravity**

Antigravity Compatibility Route 直接使用 CLIProxyAPI 的 Gemini-compatible `/v1beta`，再交给官方 Antigravity custom Gemini endpoint。禁止额外插入 OpenAI→Gemini translator/proxy。

**Capability**

Compatibility 不是 binary PASS。每个 Subscription/Model × Harness 组合都进入 Capability Matrix，至少评估：basic generation、streaming、multi-turn、tool calling、shell、file tools、thinking/reasoning、image input、web/search if native、MCP、skills、subagents、permissions、interrupt/stop、session resume、context compaction、model discovery。状态为 supported / degraded / unsupported / not tested / failed。HTTP 200 不等于 Compatibility PASS。

#### Important Scenarios

- Native Codex + Codex：走官方 Codex Runtime，进程路径上没有 CLIProxyAPI。
- Native Kimi / Grok / Antigravity：同样绕过 CLIProxyAPI，保持现有 Native Runtime。
- Cross pairing 第一条 tracer bullet：非 OpenCode-native subscription/model + OpenCode Harness，跑真正 Agent workflow，而不是只验证 API 200。
- Codex Subscription + Kimi / OpenCode / Grok / Antigravity：按目标 Harness 选择协议，而不是统一 Chat Completions。
- Antigravity cross pairing：CLIProxyAPI Gemini-compatible `/v1beta` → 官方 Antigravity custom Gemini endpoint；无第二层协议代理。
- 用户选账号 A 后建立 Compatibility Session：全程使用 A 对应 credential，不被 CPA 内部调度切到 B。
- 已绑定 Session 后用户改 Account Pool 排序：Session sticky 不变。
- Compatibility 下 Stop / Resume / Permission / Context 生命周期仍由官方 Target Harness 拥有，CraftStation 只做控制面。
- 某组合只能 streaming、不能 tools：标记 degraded，而不是伪装 Full Native Parity。
- Usage / quota 面板在 Compatibility Session 期间仍显示 CraftStation Account Plane 数据。
- 旧 Model × Harness UI/选择语义仍在；旧无效执行代码在新路径接管并回归后再删除。

### Scope

#### In Scope

- 冻结 Native Route 与 Compatibility Route 双路径架构。
- 保留 Model × Harness 产品概念、选择语义、Recipe/Result provenance 和 Session persistence 意图。
- 引入 `ExecutionRouteResolver` 概念：native pairing → Native；否则 → Compatibility。
- 引入 CLIProxyAPI 作为 Compatibility Bridge：credential consumption、OAuth/subscription access、protocol translation、model routing、compatible API exposure。
- 引入薄层 per-harness Compatibility Exporter：Codex、Kimi Code、OpenCode、Grok Build、Antigravity。
- v1.1.0 首批 Harness 仅这五个：Codex、Kimi Code、OpenCode、Grok Build、Antigravity。
- 按 Target Harness 选择最合适协议，而不是 Everything → OpenAI Chat Completions。概念矩阵如下，Plan 必须按当前 CLI 版本核验：

| Target Harness | Preferred Compatibility Protocol                      |
| -------------- | ----------------------------------------------------- |
| Codex          | OpenAI Responses / Codex-compatible                   |
| Kimi Code      | Responses / OpenAI / Anthropic / Gemini，根据能力选择 |
| OpenCode       | OpenAI-compatible / Responses                         |
| Grok Build     | 当前官方支持的 custom endpoint / Chat Completions 等  |
| Antigravity    | Gemini-compatible `/v1beta`                           |

- OpenCode 作为建议的第一条真实 Compatibility E2E tracer bullet。
- Compatibility Capability Matrix 与显式 Native/Compatibility UI 区分。
- 研究并核验 CLIProxyAPI、EasyCLIProxyAPI 行为，以及 `islee23520/cliproxy-api-provider` 对 Grok 的配置投影；许可证不清则不复制源码。
- Plan 阶段对旧 Model × Harness 实现做 KEEP / REPLACE / DELETE，迁移顺序建议为：Audit → Resolver → Native 接回现有 Runtime → Compatibility Bridge → OpenCode → Kimi → Codex → Grok → Antigravity → Capability Matrix → 删除旧 compatibility machinery。
- Native regression：Codex+Codex、Kimi+Kimi、Grok+Grok、Antigravity+Antigravity 仍走原生且无 CLIProxyAPI。
- Usage regression：现有 quota、reset、input/output、cache、account pool 不因 Compatibility Bridge 回归。

#### Out of Scope

- 重做 Account Pool、Quota UI、Tokscale、Token Monitor 或官方 quota 查询。
- 把 CLIProxyAPI 放进 Native Route，或让 CLIProxyAPI 成为 Usage Authority。
- 把 Account Scheduler 交给 CLIProxyAPI。
- 向各 Target Harness 分发真正的 OAuth / refresh token。
- 为 v1.1.0 创造 Subscription Item、Account Item、Quota Item 或 Compatibility Account Item。
- CraftStation 自己实现 universal Agent Loop，或重写官方 Harness 内部 loop。
- 重新发明 CLIProxyAPI。
- 增加本版本范围外的大量新 Harness。
- 强行保证所有 Model × Harness 功能完全一致。
- 为 Antigravity 再加一层 OpenAI→Gemini proxy。
- 在 Ideate 阶段决定 CLIProxyAPI 的部署方式（binary / sidecar / embedded SDK）、具体文件名、模块拆分或 Tickets。
- 在 Ideate 阶段选择 credential pinning 的具体实现。
- 执行源码、创建 v1.1.0 worktree、创建 Coder/Debugger、merge main、打正式 tag 或 push。
- 等待或接管当前 v1.0.1 Coder 的 Profile Isolation 实现。
- 先删除旧 compatibility 代码再补功能。

### Important Decisions

#### Product Decisions

- CraftStation 以后明确存在 Native Route 与 Compatibility Route；二者不得混淆。
- Native 永远是默认和推荐路径。存在原生 pairing 时不得为了统一架构自动进入 CLIProxyAPI。
- Compatibility 仅用于非原生 Model/Subscription × Harness。
- 保留 Model × Harness 产品概念；真正要替换的是旧 Compatibility Execution Machinery。
- Subscription / Account / Quota 仍属外围 Account / Runtime infrastructure，不进入核心 Item Ontology。核心组合保持 `Model + Harness → Result → Entity → Session`。
- UI 必须显式区分 Native 与 Compatibility，必要时可标 Unofficial；不得伪装。
- Compatibility 用 Capability Matrix 表达能力，而不是 binary PASS。
- OpenCode 是建议的首个 tracer bullet，因为它的 custom provider / Base URL / OpenAI-compatible 最容易验证真正 Agent workflow。
- Kimi 应充分利用其官方多 protocol 能力，并承认第三方 Provider 下部分 Kimi-native service 可能不可用。
- Grok Build 优先研究现有开源配置投影，但必须重新核验当前官方 custom endpoint seam。
- Antigravity 是本版本风险最高项，必须有真实 Capability E2E，且直接吃 Gemini-compatible `/v1beta`。

#### High-level Architecture Direction

- 新概念：`ExecutionRouteResolver` 决定 Route；Compatibility Bridge 由 CLIProxyAPI 承担；每个 Target Harness 只有薄层 Compatibility Exporter。
- Native Route 接回现有 Official Native Runtime，不经 Compatibility Bridge。
- Compatibility Route 即使跨厂商，也必须运行 Official Target Harness。
- CLIProxyAPI 只做 credential、protocol、model routing 和兼容 API 暴露，不做 CraftStation 的 execution ownership、usage authority 或 account scheduler。
- 真实凭据不出 Compatibility Credential Layer；Target Harness 只拿本地 Base URL、local compatibility API key、Model ID 和 protocol/config。
- Account pinning 是 Compatibility Route 的硬需求。实现方式留给 Plan：优先利用 CLIProxyAPI 已有 credential/model prefix、session affinity 或 credential routing；不可靠时再研究隔离实例/命名空间。
- EasyCLIProxyAPI 作为 Compatibility Exporter 的行为参考（Agent detection、config generation、backup/restore、model catalog sync）。若 LICENSE 不明确，不直接复制源代码。
- 旧代码迁移策略：先定位，再 KEEP/REPLACE/DELETE；禁止先删后补。KEEP 可能包括 Model/Harness 选择、Recipe/result provenance、Session persistence、UI composition semantics。REPLACE 可能包括旧 cross-provider runtime routing、假 compatibility adapter、旧 Base URL injection、硬编码 pairing。DELETE 只在新架构接管并通过回归后进行。

#### Trade-offs

- 双路径比“全部统一进 CLIProxyAPI”更复杂，但能保住 Native 语义、官方 Runtime 和现有 Account/Usage Plane。
- Compatibility 覆盖五个 Harness，而不是一次做全市场；范围足够证明 Model × Harness，又不把版本做成无限 provider 工程。
- 不承诺 Full Parity，避免把 degraded 组合包装成产品谎言。
- 不重做 Account/Usage，避免 Compatibility Bridge 变成另一次平台重写。
- 不在 Ideate 锁死 CPA 集成形状和 pinning 实现，避免在未知当前 CLIProxyAPI/仓库事实时制造假精确 Tickets。
- OpenCode 先做 tracer bullet，Antigravity 后做高风险验证：先拿到一条真 E2E，再扩展协议矩阵。
- 参考 EasyCLIProxyAPI / cliproxy-api-provider 的行为，但许可证未核验前不复制代码，避免污染产品仓。

### Constraints

- Native Model/Subscription + Native Harness 永远绕过 CLIProxyAPI。
- CLIProxyAPI 不得成为 Native Route 执行底座，也不得成为 Usage Authority。
- 不改变现有 Account Pool、Quota、Token Usage、Tokscale、Token Monitor integrations、Provider quota collectors、5h/weekly quota、reset time、input/output/cache statistics。
- Account Scheduler（Priority / Round-Robin / Random / Session Sticky）继续由 CraftStation 控制。
- Renderer 与 Target Harness 不接触真正 subscription refresh token / OAuth secret。
- 不向核心 ontology 增加 Subscription/Account/Quota Item。
- 不自己实现 universal Agent Loop。
- 不为 Antigravity 增加第二层 OpenAI→Gemini 代理。
- v1.1.0 不扩展五个 Harness 以外的目标。
- 不使用 HTTP 200 代替 Capability Matrix。
- EasyCLIProxyAPI 在 Plan 重新核验 LICENSE 前不得直接复制源码。
- Ideate 不得产出虚构 Tickets 或假精确文件级 Spec。
- Plan 必须先读本地仓库，才能产生真实 Spec 和 Tickets。
- 当前执行 Feature 仍是 v1.0.1；本 Ideate 不抢占其 worktree，不表述 v1.0.1 PASS。
- 未经用户明确授权，不得 merge main、打正式 tag 或 push `origin/main`。
- 本轮只写 Product Git Root 的 Ideate 文档与状态登记；不创建 `.worktrees/v1.1.0-*`。

### Acceptance Intent

v1.1.0 最终至少应证明以下意图。具体测试设计、命令和文件由 Plan 结合仓库给出，这里只冻结“证明什么”。

#### Native Regression

- Codex + Codex、Kimi + Kimi、Grok + Grok、Antigravity + Antigravity 仍然走原生 runtime。
- 这些 Native Session 的执行路径没有 CLIProxyAPI。
- 现有 Native 生命周期（spawn、interrupt/stop、resume、permissions、session identity）不因 Compatibility Bridge 回归。

#### Compatibility

- 至少证明 `Subscription A + Harness B` 可以真正运行目标 Harness Agent Loop。
- OpenCode compatibility 作为首个建议 PASS 目标。
- Kimi compatibility PASS。
- Codex compatibility PASS。
- Grok compatibility PASS。
- Antigravity compatibility evaluated，并给出真实 capability evidence。
- Antigravity 至少验证：non-native subscription → CLIProxyAPI Gemini-compatible `/v1beta` → Antigravity Harness，且无额外 OpenAI→Gemini proxy。

#### Route Integrity

- Native pairing 不会被自动重写成 Compatibility。
- Compatibility pairing 在 UI 上可被识别为 Compatibility。
- `ExecutionRouteResolver` 的选择可被 Session 持久化意图覆盖：route type、model、harness、account、compatibility protocol、native session id。具体字段落点由 Plan 决定。

#### Account / Usage Regression

- CraftStation 选出的 Account 必须是 Compatibility Route 实际使用的 credential。
- Session sticky 不被 Account Pool 后续排序或 CPA 内部调度破坏。
- quota / reset / input / output / cache / account pool 不因 Compatibility Bridge 发生回归。
- CLIProxyAPI 自己的 usage/token statistics 不替换 CraftStation Usage Authority。

#### Migration Integrity

- 旧 Model × Harness 产品概念仍在。
- 旧无效 compatibility execution machinery 被定位为 KEEP / REPLACE / DELETE。
- 新路径接管并通过回归前，不先删除旧功能。
- 不把 sacc/EasyCLIProxyAPI/CLIProxyAPI wrapper 变成 CraftStation Supervisor 的替代物；Supervisor 仍启动官方 Harness。

### Open Questions

以下问题会影响产品表达，但不阻止 Ideate 冻结双路径架构。Plan 可提出建议，仍需用户拍板的保持为产品问题。

- Compatibility / Unofficial 的最终用户文案、风险提示强度，以及是否按 Harness/订阅来源区分。
- Capability Matrix 在 UI 中展示到什么粒度：只在选择时提示，还是进入 Session 后持续可见。
- OpenCode tracer bullet 的第一条真实组合选哪个非原生 subscription/model；Ideate 不锁死具体账号来源。
- degraded 组合是否允许用户强制 Craft，还是只允许明确知情后继续。
- v1.0.0 的四格高效模式 / 九格自动模式 / CapabilityResolution 展示，哪些 UX 在 v1.1.0 必须一起落地，哪些可以继续留在 v1.0.0 历史 Ideate 中等待后续 Feature。
- Compatibility Session 失败时，错误是表现为 Route 错误、Harness 错误还是 Account 错误；需要统一用户可理解的诊断，但不能泄露 secret。

### Questions Reserved for Plan

进入 Part II 前，Manager / Plan 必须先结合本地真实仓库回答这些问题，再生成 Tickets。Ideate 不回答它们。

1. 当前 Model × Harness 到底已经实现到什么程度？
2. 为什么当前实现“看起来存在但实际没用”？
3. 当前 Native Recipe / Runtime 路由在哪里？
4. 当前是否已有 compatibility / custom provider abstraction？
5. 哪些旧代码应 KEEP / REPLACE / DELETE？
6. CLIProxyAPI 应以 binary、sidecar、embedded SDK 还是其它方式集成？
7. CraftStation 如何 pin CLIProxyAPI 的具体 account credential？
8. 五个 Harness 当前真实支持哪些 Base URL / protocol？
9. 如何给每个 Session 持久化：route type、model、harness、account、compatibility protocol、native session id？
10. Stop / Resume / Permission / Context 等能力如何在 Compatibility Route 中保持目标 Harness 的原生生命周期？
11. 哪些组合只是 degraded compatibility，而不是 full compatibility？
12. 如何迁移并最终删除旧 Model × Harness runtime 实现？

Plan 还必须重新核验：

- 当前 CLIProxyAPI 版本的 credential providers、subscriptions、OAuth、multi-account、credential pinning、model/provider prefix、session affinity、OpenAI/Responses/Claude/Gemini/Grok frontends、model catalog、protocol translators、embedding/deployment options 与 license。
- EasyCLIProxyAPI 的 LICENSE；不清则只参考行为，不复制源码。
- `islee23520/cliproxy-api-provider` 是否可在许可证允许下复用 Grok config projection。
- 五个官方 CLI 当前版本的 custom endpoint / `model_provider` / Base URL / Gemini `/v1beta` seam。
- 现有 Account Pool / Native Profile / Supervisor spawn 如何把 selectedAccountId 传到 Compatibility Route，而不破坏 v1.0.1 的 Native Profile Isolation 方向。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Ready
- Worktree：已创建 `.worktrees/v1.1.0-compatibility-bridge` / `dev/v1.1.0-compatibility-bridge`，基线 `main@f5a4bb2`。Coder 在本工作树连续执行 T01–T13；Manager 不预先创建 Debugger。
- Current executing Feature remains：`v1.0.1 — Native CLI Multi-Account Profile Runtime`
- Plan 已写入 Part II。Coder 读取本文件按 Execution Order 连续执行 T01–T13；Debugger 由 Coder 自检后创建。

冻结结论，供下一个 Manager / Plan 直接使用：

- v1.1.0 已冻结为 Native Route + CLIProxyAPI Compatibility Route 双路径架构。
- Native Model/Subscription + Native Harness 永远绕过 CLIProxyAPI。
- Compatibility 仅用于非原生 Model/Subscription × Harness。
- Account Pool、Quota、Token Monitor、Tokscale 和现有官方 quota 查询保持不变。
- CLIProxyAPI 不成为 Usage Authority。
- CLIProxyAPI 应直接向 Antigravity 提供 Gemini-compatible `/v1beta`，不要额外增加 OpenAI→Gemini proxy。
- 保留 Model × Harness 产品概念，替换并最终删除旧 Compatibility Execution Machinery。
- Plan 必须读取本地仓库后才能产生真实 Spec 和 Tickets。

## Ideate → Plan Gate Check

> Manager / Plan 在进入 Planning 前执行；结合真实 Repo 轻量核验，不全量扫描。2026-09-03 用户明确「开始plan」后完成。

- Feasibility：OK。Native spawn 路径已存在：`supervisorRuntime.ts` → `createNativeHarnessRuntimeAdapter` / `NativeCodexRuntimeAdapter`，官方 Codex/Kimi/Grok/OpenCode/Antigravity 均有 Native adapter。Compatibility Route **作为执行路径不存在**；`src/shared/crafting/compatibility.ts` 只是 UI/readiness。CLIProxyAPI 本地快照 `reference/CLIProxyAPI/` 为 MIT（Copyright Luis Pater / Router-For.ME），独立 Go sidecar，不是 TS SDK。
- Practicality：OK。Tickets 按 resolver + Native wireback → CPA sidecar/bridge → OpenCode tracer → 其余 exporter → Capability Matrix → 延迟 DELETE 排序。不重做 Account/Usage，不发明 universal Agent Loop。
- Alignment：OK。符合 Ideate 双路径、AGENTS.md Native Composition、v1.0.0 组合 UX KEEP；v1.0.0「统一 Compatibility Layer 执行整个 matrix」被本 Feature 取代，历史条目不改写。
- Info Completeness：OK。Plan-reserved 12 问已由仓库事实回答，见下文 Planning Inputs / Answers。剩余实现细节（Kimi 官方 CLI 配置字段名、Grok custom endpoint 当前字段、Antigravity Gemini env 官方名）留给对应 Ticket 按当前 CLI 核验，不在 Plan 发明。

结论：**OK**

OK（无重大问题）→ Manager 自行修复的小问题：

- Product Git Root `main` 工作区脏（`AGENTS.md` / `PROJECT_STATUS.md` / supervisor 与 scripts）。v1.1.0 worktree 从已提交 `main@f5a4bb2` 创建；Ideate 文件已复制进 worktree。禁止把 main 上未提交的 supervisor/script 改动混进本 Feature。
- v1.0.1 Native Profile Runtime 仍是产品当前执行 Feature（`PLAN READY / EXECUTING`，非 PASS）。v1.1.0 并行独立 worktree，不抢占、不表述 v1.0.1 PASS。
- EasyCLIProxyAPI / `islee23520/cliproxy-api-provider` **不在** `reference/`，LICENSE 未核验：Tickets 只允许行为参考，禁止复制源码，直到 LICENSE 核验为允许。
- 现有 OpenCode `NativeHarnessRecipe`（openai/xai/google/deepseek/kimi-for-coding/moonshot-openai-compatible）是官方 OpenCode 自有 provider 路径，KEEP；不是 CPA Compatibility Route。
- Native Recipe 对无 builtin recipe 的 cross pairing 当前 `recipeNotFound`。Plan 增加 Compatibility Recipe / route，但 Native pairing 不得改走 CPA。
- CPA `config.example.yaml` 自带 `routing.strategy` / `session-affinity` / `force-model-prefix`。这些不得成为 CraftStation Account Scheduler。默认 pin 策略：per-account CPA credential namespace（prefix 或隔离 auth-dir）；不足则隔离 CPA instance。禁止第二套调度器。

## Part II — Plan

### Planning Inputs

- `PROJECT_STATUS.md`（产品仓 + 本 worktree）
- 本文档 Part I — Ideate（Status 已切 Planned）
- Active Development Worktree / Branch：`D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge` / `dev/v1.1.0-compatibility-bridge`
- 基线：`main@f5a4bb276b22e664e7691e67b486e2b1252e5d9a`
- 当前真实 Repo（本 worktree，与 committed main 同源）：
  - `src/shared/crafting/compatibility.ts`
  - `src/shared/crafting/crafter.ts` / `registry.ts` / `recipes/nativeHarnessRecipe.ts`
  - `src/shared/crafting/types.ts`（`runtimeBindingSchema`）
  - `src/shared/crafting/runtimeInterface.ts`（`SessionSnapshot`）
  - `src/supervisor/supervisorRuntime.ts` spawn factory ~1720–1860
  - `src/supervisor/runtime/nativeHarness/index.ts`
  - `src/supervisor/runtime/accountStore.ts` / `accountResolver.ts`
  - `src/supervisor/runtime/openCodeNative/*`
  - `src/supervisor/runtime/openaiCompatibleProfiles.ts`（Settings/Token Plan，**不是** Compatibility Bridge）
  - `reference/CLIProxyAPI/`（MIT sidecar，baseline `a7e3596b` / `v7.2.140`）
- 并行执行 Feature（只读，禁止写入）：`.worktrees/v1.0.1-native-profile-runtime`
- 禁止写入：v0.9 / v0.10 / v1.0.0 / model-usage-ui-fix worktree；禁止 merge/tag/push `origin/main`

### Answers to Ideate Plan-Reserved Questions

1. **Model × Harness 实现到什么程度？**  
   UI 可选 Model + Harness；`resolveCompatibility()` 对 native pairing 标 `NATIVE`，对 cross pairing 标 `CRAFTABLE` / `source: "compatibility-layer"`，但**从不 spawn**。Crafter 只匹配 builtin Native Recipes。Supervisor 只创建 Native adapter。

2. **为什么“看起来存在但实际没用”？**  
   v1.0.0 留下了组合 UX 与 CapabilityResolution 意图，但“统一 Compatibility Layer 执行 matrix”从未接到 Entity/Session。UI 可显示可 Craft，compile 阶段 cross pairing `recipeNotFound`，spawn 仍只走 Native。

3. **Native Recipe / Runtime 路由在哪？**  
   `Crafter.validate/compile` → `registry.findMatchingRecipe` → `NativeHarnessRecipe` / `OpenAICodexNativeRecipe` → `CraftPlan.runtimeBinding` → `supervisorRuntime` spawn factory → `NativeCodexRuntimeAdapter` 或 `createNativeHarnessRuntimeAdapter(harnessKind)` → 官方进程。

4. **是否已有 compatibility / custom provider abstraction？**  
   有 UI compatibility seam；有 OpenCode native `providerID` / `AccountStoreOpenCodeRuntimeBindingResolver`；有 `openaiCompatibleProfiles.ts`（额度/设置账号池）。**没有** CLIProxyAPI bridge，没有 ExecutionRouteResolver，没有 Compatibility Exporter。

5. **KEEP / REPLACE / DELETE？** 见 T01 表。核心：KEEP Native 路径与 Account/Usage；REPLACE 撒谎的 UI resolver 与 spawn 分支；DELETE 仅在新路径拥有行为且 Native 回归之后。

6. **CPA 集成形状？**  
   **冻结：CraftStation-managed local sidecar（loopback，默认 port 8317 思路，具体端口可分配）。** TypeScript 只通过公开 HTTP/management seam 使用。不改写成 TS，不嵌入 renderer，不进 Native Route。

7. **如何 pin CPA credential？**  
   AccountResolver 仍是唯一选号源。Compatibility Route 把已选出的 `accountId` 投影到 **精确** CPA credential namespace。优先：CPA model/provider prefix 或 per-account auth-dir。CPA 默认 `routing.strategy: round-robin` 且 `session-affinity: false`，**必须关闭或绕过其任意调度**，避免 selected A、CPA 用 B。不足则 per-account 隔离 CPA instance。禁止第二调度器。

8. **五个 Harness 当前真实 protocol seam？**  
   当前代码全是 Native-only。Compatibility 要 **新增** 薄 exporter：
   - OpenCode：官方 server + custom provider（Base URL / local key / OpenAI-compatible 或 Responses）
   - Codex：官方 `model_provider` + `base_url` + Responses（`acp.ts` 已有 `model_provider` 可选字段，无 CPA 注入）
   - Kimi：官方 `openai_legacy` / `openai_responses` / `anthropic` / `gemini` / `vertexai`，按能力选，不锁死一种
   - Grok：官方 custom endpoint / Chat Completions；`cliproxy-api-provider` 仅行为参考直到 LICENSE 核验
   - Antigravity：CPA Gemini-compatible `/v1beta` → 官方 custom Gemini endpoint（`GEMINI_API_KEY` + `GOOGLE_GEMINI_BASE_URL` 或当前官方字段）。**禁止额外 OpenAI→Gemini translator**

9. **Session 持久化？**  
   扩展 `runtimeBindingSchema` + `SessionSnapshot`（secret-free）：`routeType`、model、harness、`accountId`（New Session sticky）、compatibility protocol、native session id/pid、CPA endpoint identity（host:port，无 secret）。Renderer 永不接触 refresh token / OAuth / raw auth。

10. **Stop / Resume / Permission / Context？**  
    Compatibility 仍走 **目标 Harness 官方生命周期**，经现有 Supervisor adapter。不发明 CraftStation agent loop。interrupt 必须 session-scoped，不得误杀另一 profile/runtime。

11. **degraded vs full？**  
    不以 HTTP 200 为 PASS。Capability Matrix：`supported` / `degraded` / `unsupported` / `not tested` / `failed`。OpenCode tracer 必须跑真实 Agent workflow。Antigravity 最高风险，允许 evaluated 而非假装 full parity。第三方协议下 Kimi-native 服务可能不可用，必须显式 degraded。

12. **如何迁移并删除旧 runtime？**  
    先接 ExecutionRouteResolver 与 Native wireback；再 CPA + OpenCode tracer；其余 exporter；Native 回归通过后，才删除假装可执行却无 CPA 的 dead fallback。不整文件删除 `compatibility.ts`；替换其内部。不删除 OpenCode native custom-provider，不删除 openai-compatible usage profiles。

### Objective

在完全保留现有 Native Harness 路径的前提下，落地 `ExecutionRouteResolver` + CLIProxyAPI Compatibility Bridge + 五个薄 Compatibility Exporter，使非原生 Model/Subscription × Harness 能通过目标 Harness 官方支持的第三方 API/Base URL 运行官方 Target Harness；Native pairing 永远绕过 CPA。

### Feature Spec

#### Goal

```text
Model + Harness
      ↓
ExecutionRouteResolver
      ↓
 Native Route          Compatibility Route
      ↓                        ↓
 official native            CLIProxyAPI sidecar
 harness                    ↓
                      Target protocol + local key/base URL
                            ↓
                      official target harness
```

Account / Usage Plane 独立保持：Account Pool、官方 quota、Token Monitor、Tokscale、Session Account Binding。

#### Expected Behavior

- Native pairing（Codex+Codex、Kimi+Kimi、Grok+Grok、Antigravity+Antigravity）默认且推荐，执行路径无 CPA。
- 已存在的 OpenCode official-provider Native Recipes 继续走 OpenCode native adapter，不经 CPA。
- Cross pairing 仅在 CPA + 对应 exporter 就绪时进入 Compatibility Route；否则 fail-closed，UI 不得再标假 `CRAFTABLE`。
- UI 显式区分 Native vs Compatibility；存在 ToS/非官方订阅风险时标 Compatibility / Unofficial（文案最小、诚实）。
- Compatibility Session 绑定一次 `accountId` + `NativeProfileSpec`/exporter projection；sticky；后续 send/interrupt/resume 不重选号。
- Target Harness 只拿到 loopback Base URL、local compatibility API key、model、protocol config。
- 身份不一致 fail-closed（`PROFILE_IDENTITY_MISMATCH` 的 compatibility 类比），禁止静默用错号。

#### Scope

In Scope：五个 Harness（Codex、Kimi Code、OpenCode、Grok Build、Antigravity）；ExecutionRouteResolver；Compatibility CraftPlan/Session 字段；CPA sidecar；per-harness exporter；OpenCode tracer E2E；Capability Matrix；Native vs Compatibility UI；Native 回归；延迟 DELETE。

Out of Scope：重做 Account Pool / Quota / Tokscale / Token Monitor；CPA 进 Native Route；自研 universal Agent Loop；把 Account/Subscription 变成核心 Item；扩展其他 Harness；复制 LICENSE 不明的 EasyCLIProxyAPI / cliproxy-api-provider 源码；CLIProxyAPI 作为 Usage Authority；sacc/wrapper 取代 Supervisor。

#### Constraints / Non-goals

- 不混淆两条 Route。
- 不向 renderer 或 target harness 分发真实 OAuth/refresh token。
- 不把一切协议压成 Chat Completions。
- Antigravity 不加第二层 OpenAI→Gemini proxy。
- 不把 CPA 自己的 usage 统计替换 CraftStation。
- 不把 CPA routing/round-robin 当成 Account Scheduler。
- 不抢占 v1.0.1 worktree；不在 main 混提交脏文件。

#### Acceptance Criteria

- [ ] Native Codex/Kimi/Grok/Antigravity 回归：路径无 CPA。
- [ ] OpenCode Compatibility tracer：非 OpenCode-native subscription + OpenCode Harness 真实跑 Agent Loop（非 API ping）。
- [ ] Kimi / Codex / Grok Compatibility exporter 落地；Antigravity Compatibility evaluated，证据诚实。
- [ ] selectedAccountId == Compatibility Route 实际 CPA credential。
- [ ] Session sticky；interrupt 不误杀其他 session。
- [ ] UI 不把 Compatibility 伪装成 Native。
- [ ] Identity mismatch fail-closed；日志无 secret。
- [ ] Account/Usage 无回归。
- [ ] 旧 fake executable compatibility 在新路径接管前不先删功能。

### Current Architecture (repository-driven)

```text
UI Model+Harness
→ resolveCompatibility()          # UI only; may lie CRAFTABLE
→ Crafter Native Recipes only     # cross pairing = recipeNotFound
→ CraftPlan.runtimeBinding        # no routeType
→ supervisorRuntime spawn         # always native adapter
→ official CLI / app-server / ACP
```

Account 选择：`AccountStore` + `AccountResolver`（Priority / RR / Random / Session Sticky）。OpenCode 另有 `isolationKey`。Grok/Codex managed env 已有 `GROK_*` / `CODEX_HOME` 方向（完整隔离是 v1.0.1 的工作，本 Feature 不得破坏）。

### KEEP / REPLACE / DELETE

#### KEEP

- Model / Harness 选择 UX、Recipe/Result provenance（`provenanceStore.ts`）
- `CapabilityResolution` / workbench types
- Native Recipes + Native adapters + Supervisor lifecycle
- Account Pool / Quota / Tokscale / Token Monitor / `openaiCompatibleProfiles.ts`（usage/settings）
- OpenCode native binding matrix（`src/shared/opencodeNative/binding.ts`）作为 **OpenCode native provider IDs**
- `runtimeInterface.ts` Entity/Session 与 `nativeSessionRef` / diagnostics
- DeepSeek API adapter：v1.1.0 harness 范围外，不扩展、不故意破坏

#### REPLACE

- `compatibility.ts` 内部：Native → Native Route；Cross → Compatibility 仅当 CPA+exporter ready，否则 fail-closed
- Crafter recipe matching：增加 Compatibility Recipe / route compilation，CraftPlan 带 `routeType: compatibility` + exporter projection，无真实 OAuth
- `supervisorRuntime.ts` spawn factory：按 ExecutionRouteResolver 分支；Native 分支禁止启动 CPA
- 任何把 vendor==harness 当成唯一可执行假设、却在 UI 假装 cross 可执行的逻辑

#### DELETE（仅 T13，新路径拥有行为 + Native 回归后）

- 假装 cross pairing 可执行却无 CPA 的 dead adapter / unused fallback
- 不整文件删除 `compatibility.ts`
- 不删除 OpenCode native custom-provider
- 不删除 openai-compatible usage profiles

### Tickets

#### T01 — Audit freeze / KEEP-REPLACE-DELETE

- Goal：把本 Plan 的仓库事实冻结进 `ai_workspace/agent_docs/manager_1.1.0.md` 本表与必要代码注释锚点，无行为变化。
- Scope：本 manager 文档；最多在 `compatibility.ts` / spawn factory 加指向 resolver 的非功能注释。禁止改 spawn 行为。
- Depends on：无
- Acceptance：表与真实文件路径一致；v1.0.1 不被改写为 PASS；LICENSE 不明仓库不复制。

#### T02 — ExecutionRouteResolver

- Goal：新增薄模块 `src/shared/crafting/executionRoute.ts`（文件名可按现有风格微调），输入 model/harness/account binding/runtime capabilities，输出 `native` | `compatibility` | fail-closed。
- Scope：接入 `compatibility.ts`，使 UI 停止对不可执行 cross pairing 撒谎。单测覆盖：native pairing → native；OpenCode official-provider native recipe → native（非 CPA）；cross pairing 未就绪 → fail-closed；cross pairing 就绪 → compatibility。
- Depends on：T01
- Acceptance：纯函数可测；不启动进程；不把 CPA 放进 Native。

#### T03 — Native Route wireback

- Goal：`supervisorRuntime.ts` spawn factory 在 resolver=native 时必须继续 `NativeCodexRuntimeAdapter` / `createNativeHarnessRuntimeAdapter`，**永不启动 CPA**。
- Scope：`src/supervisor/supervisorRuntime.ts` ~1720–1860；`src/supervisor/runtime/nativeHarness/index.ts`。Native 回归测试/断言：Codex/Kimi/Grok/Antigravity spawn 诊断无 CPA endpoint。
- Depends on：T02
- Acceptance：Native pairing 进程树/env/diagnostic 证明无 CLIProxyAPI。

#### T04 — Compatibility CraftPlan / Session persistence

- Goal：secret-free 持久化 route 身份。
- Scope：扩展 `src/shared/crafting/types.ts` `runtimeBindingSchema`；`runtimeInterface.ts` `SessionSnapshot`；必要时 `provenanceStore.ts`。字段至少：`routeType`、model、harness、`accountId`、compatibility protocol、native session id、CPA host:port（无 secret）。Session sticky：只在 New Session 解析账号。
- Depends on：T02
- Acceptance：类型与测试证明 Renderer 投影不含 token/cookie/api secret；resume 使用同一 route/account。

#### T05 — CLIProxyAPI sidecar bridge + account pin

- Goal：Supervisor 模块管理本地 CPA sidecar（loopback），并把 `selectedAccountId` pin 到精确 credential namespace。
- Scope：新建 supervisor 模块（建议 `src/supervisor/runtime/compatibilityBridge/`），非 renderer。spawn/stop sidecar、loopback bind、local api-keys、auth-dir 隔离、无 secret 诊断。CPA binary 来自官方 MIT 实现/sidecar，不改写成 TS。Pin：prefix 或 per-account auth-dir；CPA `routing.round-robin` 不得覆盖 CraftStation 选号。不足则隔离 instance。
- Depends on：T04
- Acceptance：选 A 则 CPA 只用 A 的 namespace；日志无 raw auth；Native Route 不启动该 sidecar。

#### T06 — OpenCode Compatibility Exporter（tracer bullet）

- Goal：非 OpenCode-native subscription → CPA → 官方 OpenCode custom provider，真实 Agent Loop。
- Scope：OpenCode exporter 把 CPA 投影为 Base URL / local key / model / protocol。复用 `openCodeNative` spawn（`adapter.ts` / `transport.ts` / `runtimeBinding.ts`），禁止 sacc/wrapper。E2E 证据：workflow 级，不只 HTTP 200。
- Depends on：T03、T05
- Acceptance：官方 OpenCode 进程跑起来；所用账号 = CraftStation selectedAccountId；Native OpenCode official-provider 路径不被这次改坏。

#### T07 — Kimi Compatibility Exporter

- Goal：按 Kimi 官方多协议能力投影 CPA，显式 capability degradation。
- Scope：Kimi exporter；实现时核验当前 Kimi CLI 配置字段（`openai_legacy` / `openai_responses` / `anthropic` / `gemini` / `vertexai`）。禁止假设 full native parity。
- Depends on：T05、T06（tracer 稳定后）
- Acceptance：至少一条 Compatibility Kimi Session 使用官方 Kimi CLI；缺失的 native 服务标 degraded/unsupported，不伪装 PASS。

#### T08 — Codex Compatibility Exporter

- Goal：官方 `model_provider` + `base_url` + Responses；Native Codex 完全不变。
- Scope：Codex exporter；`supervisor/agents/codex` 仅增加 Compatibility 投影所需配置 seam，不把 CPA 塞进 Native `codex app-server` 默认路径。
- Depends on：T05、T06
- Acceptance：Native Codex+Codex 无 CPA；Compatibility Codex 走官方 Codex + 本地 Base URL；`account/read` 类身份与 selected account 一致或显式 fail-closed。

#### T09 — Grok Compatibility Exporter

- Goal：官方 custom endpoint / Chat Completions；先 LICENSE 核验 `cliproxy-api-provider`，未允许则只参考行为。
- Scope：Grok exporter。不得破坏 v1.0.1 方向的 `GROK_HOME` / leader socket 隔离（若 v1.0.1 尚未合入，本 Ticket 也不得把多账号重新打回全局 `~/.grok`）。
- Depends on：T05；LICENSE 核验
- Acceptance：Compatibility Grok 使用官方 grok；Native Grok+Grok 无 CPA。

#### T10 — Antigravity Compatibility Exporter

- Goal：CPA Gemini-compatible `/v1beta` 直连官方 Antigravity custom Gemini endpoint。
- Scope：Antigravity exporter；核验 `agents/antigravity/detection.ts` 与当前官方字段（`GEMINI_API_KEY` / `GOOGLE_GEMINI_BASE_URL` 或现行名）。**禁止** OpenAI→Gemini 额外 proxy。
- Depends on：T05
- Acceptance：至少一条 evaluated E2E 证据；能力矩阵诚实（允许 degraded/failed/not tested）。

#### T11 — Native vs Compatibility UI

- Goal：选择组合时用户能看出 Native（Recommended）还是 Compatibility（必要时 Unofficial）。
- Scope：Crafting UI / IPC `resolveCraftingCompatibility` 结果展示。不重做 Account Pool UI，不重做 Quota/Tokscale。
- Depends on：T02、T04
- Acceptance：Native pairing 不显示为 Compatibility；不可执行 cross pairing 不显示假 CRAFTABLE。

#### T12 — Capability Matrix + diagnostics

- Goal：组合级能力矩阵 + 无 secret 运行诊断；身份 mismatch fail-closed。
- Scope：复用/扩展 `src/shared/crafting/nativeHarness.ts` 词汇；兼容状态 `supported|degraded|unsupported|not tested|failed`。诊断：provider、accountId、profilePath、routeType、CPA host:port、pid、nativeSessionId、native reported identity。禁止 token/cookie/api key。
- Depends on：T06 起各 exporter
- Acceptance：OpenCode tracer 有真实矩阵条目；mismatch 阻止错误账号 Session。

#### T13 — Native regression + delayed DELETE

- Goal：证明 Native 四条路径无 CPA；删除已接管的 dead fake compatibility machinery。
- Scope：回归 Codex+Codex、Kimi+Kimi、Grok+Grok、Antigravity+Antigravity；删除确认无引用的 dead fallback。Usage/quota 回归。
- Depends on：T03、T06，且 T07–T10 至少完成或明确 evaluated
- Acceptance：有真实证据；没有“先删再补”；OpenCode native official-provider 仍在。

### Execution Order

```text
T01 Audit freeze
 → T02 ExecutionRouteResolver + UI fail-closed
 → T03 Native wireback
 → T04 CraftPlan/Session persistence
 → T05 CPA sidecar + account pin
 → T06 OpenCode tracer bullet E2E
 → T07 Kimi exporter
 → T08 Codex exporter
 → T09 Grok exporter（LICENSE 核验后）
 → T10 Antigravity exporter
 → T11 Native vs Compatibility UI（可与 T06 后并行于 UI 层，但不得早于 T02）
 → T12 Capability Matrix
 → T13 Native regression + delayed DELETE
```

单 Coder 连续执行。Grok/Antigravity 在范围但 OpenCode 必须先 PASS tracer。Manager 不预先创建 Debugger。Coder 自检后创建 `Debugger-1.1-Compatibility Bridge`，模型 `gpt-5.6-sol` / `high`。

### Key Decisions

- CLIProxyAPI = 本地 loopback sidecar，不是 embedded SDK，不是 Native 底座。
- Account pinning = CraftStation selectedAccountId → 精确 CPA namespace；关闭/绕过 CPA 任意 round-robin 选号。
- 现有 OpenCode NativeHarnessRecipe 是 Native OpenCode provider 路径，不是 Compatibility。
- EasyCLIProxyAPI / cliproxy-api-provider：行为参考，未核验 LICENSE 前不复制代码。
- Compatibility Recipe 解决 `recipeNotFound`，但 Native pairing 不得改写进 CPA。
- v1.0.1 与 v1.1.0 并行；本 Coder 只写 v1.1.0 worktree。

### Risks

- CPA 多账号默认 round-robin 导致 selected A / actual B → T05 必须 pin，否则 Compatibility 全线假成功。
- 与 v1.0.1 profile isolation 竞态：本 Feature 不得把 Grok/Codex 打回全局 home。
- Antigravity / Grok protocol 字段随 CLI 版本漂移 → 实现时核验，矩阵允许 evaluated。
- 旧 UI CRAFTABLE 谎言若只改 spawn 不改 resolver，用户仍会以为 cross pairing 可用。
- 误把 OpenCode native openai provider 改成 CPA，会破坏已有 OpenCode native 路径。

### Handoff

- Gate Check：OK。自行修复小问题见 Gate Check 清单。
- Coder 起点：本 worktree 读取本文 Part II，按 Execution Order 从 T01 连续做到 T13。
- 工作树：`D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`
- 分支：`dev/v1.1.0-compatibility-bridge`
- 基线：`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`
- Coder 标题：`Coder-1.1-Compatibility Bridge`；模型 `gemini-3.8-flash` / thinking `high`
- Debugger：Coder 自检后创建，`gpt-5.6-sol` / `high`；Manager 不预创建
- 不要等待 Manager 查看进度；Plan 发布后连续执行
- 不要写入 v1.0.1 / v0.9 / v0.10 worktree
- 不要 merge/tag/push `origin/main`
