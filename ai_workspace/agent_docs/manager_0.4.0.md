# Manager — v0.4.0 Native Multi-Harness Compatibility

> 当前 Feature 的单一 Manager 交接入口。Part I 记录已批准的 Ideate；进入 Manager / Plan 后再在本文件补充 Part II。

## Part I — Ideate

- Status：Ideated
- Ready for Plan：Yes
- Created：2026-08-27
- Last Updated：2026-08-27
- Roadmap Context：Phase 1 — Runtime Foundation 向 Phase 2 — Native Composition Runtime 扩展；以 Codex 原生运行时为 baseline，证明 CraftStation 可以并列承载多个完整 Native Harness，而不是退化为单一 Codex GUI 或通用 Agent Loop wrapper
- Owner：Manager / Ideate

### Feature Intent

#### Problem

CraftStation 当前已经围绕 Codex 建立并持续收敛一条原生 Harness execution path：

```text
Model
+
Codex Harness
-> Crafting
-> CraftPlan
-> CraftStation-owned Codex Runtime
-> official codex app-server
-> Entity
-> Session
```

这证明了 CraftStation 可以把 Minecraft/Crafting composition model 连接到一个真实、完整、由上游官方 Runtime 拥有 Agent Loop 的 Harness。

但只完成 Codex 仍不足以证明 CraftStation 是跨 Harness 的 Runtime Composition System。若后续所有能力都围绕 Codex 特性继续生长，CraftStation 很容易重新退化为“Codex GUI + 自定义外围能力”；反过来，如果现在为了支持更多 Harness 就提前把 Skill、MCP、Subagent、Permission、Context 等能力抽成统一实现，也会在没有足够跨 Harness 证据时形成错误抽象。

本 Feature 因此需要建立第二阶段关键证据：让以下五个 Native Harness Target 在 CraftStation 中作为平级运行后端存在，并尽可能完整保留各自原生 Harness 语义：

```text
1. Codex
2. Grok Build
3. Kimi Code
4. Antigravity
5. DeepSeek / DSH
```

这里的“五个”是五个 Harness/runtime target，不是五个 Model。Model 与 Harness 仍是不同概念。

#### Why Now

- Codex 已经形成可复用的 Native Harness baseline，正是验证 runtime seam 是否真正跨 Harness 的最佳时机。
- Grok Build、Kimi Code、Antigravity 都存在厂商提供的原生 Agent Harness/runtime 与 machine-facing integration boundary，适合作为独立后端，而不是通过模型 API 重写 Agent Loop。
- DeepSeek / DSH 是 CraftStation 既定方向中的 Harness target，但旧 `deepseek-harness/` working copy 已被标记为 `NOT PASSED / SUPERSEDED / DO NOT USE`；本 Feature 必须重新确认真实 upstream/runtime boundary，而不是复活旧路径。
- 五个完整 Harness 并列运行以后，CraftStation 才有足够事实去比较 Session、Skill、MCP、Subagent、Permission 等概念的真实语义差异，并决定后续哪些 Component 值得晋升为稳定 primitive / Item。
- 在五个 Harness 尚未跑通前提前做 Universal Skill、Universal MCP、Universal SubAgent 等抽象，会把未经验证的相似命名误当成相同语义。

#### Desired Outcome

目标产品结构：

```text
                         CraftStation
                              │
                        Crafting System
                              │
                      Harness Runtime Seam
                              │
      ┌────────────┬───────────┬───────────┬──────────────┬─────────────┐
      │            │           │           │              │
      ▼            ▼           ▼           ▼              ▼
    Codex      Grok Build   Kimi Code  Antigravity  DeepSeek / DSH
      │            │           │           │              │
      ▼            ▼           ▼           ▼              ▼
   Native        Native      Native      Native         Native
   Harness       Harness     Harness     Harness        Harness
```

五个 Harness 必须平级；Antigravity 不是其它 Harness 的汇聚点或下游。

CraftStation 成为这些 Harness 的：

```text
composition plane
runtime lifecycle host
session binding layer
workspace host
GUI / presentation plane
control plane
native event projection layer
account/profile preparation consumer
```

而不是：

```text
自建通用 Agent Loop
模型 API proxy
CLIProxyAPI gateway
厂商 Harness 的替代实现
```

本 Feature 完成以后，CraftStation 应能在同一套 Crafting / Entity / Session 生命周期中启动、控制、恢复和展示五个原生 Harness，同时保留各自原生 Agent Loop、Tools、Skills、MCP、Subagents、Permissions、Context 和其它特有语义。

### Expected Behavior

#### User Experience

- 用户始终只使用 CraftStation UI，不需要手动打开 Codex、Grok、Kimi、Antigravity 或 DeepSeek 的可见终端/TUI 窗口。
- CraftStation 的 Harness 选择面能够并列呈现五个 Harness target。
- 第一阶段只承诺已验证的 native pairing；不因为 Harness 数量增加就默认任意 Model × Harness 都可组合。
- 用户选择某个 Harness 并启动工作后，CraftStation 在后台启动对应官方/原生 runtime 的 machine-facing mode，并将其原生事件实时映射到现有 UI。
- 用户看到统一的公共展示骨架，例如 assistant output、tool activity、file changes、permission、status、error、session lifecycle；但 Harness 特有能力可以使用 provider-specific/native-specific UI，不因统一视觉而丢失语义。
- 某项能力如果上游原生支持，CraftStation 应尽量完整暴露；如果上游原生不存在，则明确显示 `native unsupported`；如果上游存在但 CraftStation 还没接，则显示 `implementation missing`，不能把二者混为一个状态。
- 不允许 CraftStation 为了“看起来功能一致”而自建一个假的 Skill、MCP、Subagent、Permission 或 Context 实现来补齐另一个 Harness。

#### System Behavior

- 所有 Harness execution 遵循 **Official / Native Harness Runtime First**：优先使用厂商或项目上游提供的 CLI machine mode、App Server、ACP、stdio RPC、Local Server、SDK/runtime boundary 等最稳定的程序化入口。
- “使用 ACP / App Server”不等于绕过官方 CLI/Harness。若该协议由官方 CLI binary 暴露，则 CraftStation 仍由 Supervisor 在后台启动官方 CLI 进程，只是不打开用户可见 TUI。
- Renderer 不直接 spawn Harness process；所有 Harness process 继续由 Supervisor/runtime layer 管理。
- CraftStation 不重写各 Harness 内部 Agent Loop，不通过模型 API 模拟原生 Harness 行为。
- 每个 Harness adapter 在 provider boundary 内处理其 native protocol、events、capabilities、auth/profile、errors 和 process lifecycle；共享 runtime 不出现不断增长的 provider-specific `if/else`。
- CraftStation Session 绑定对应 native session/thread/conversation identity，并保存恢复所需的最小 native metadata；CraftStation 不要求五家的 native Session 内部实现一致。
- Runtime 可以使用长生命周期的 machine-facing process，支持双向事件和控制；不要求所有 Harness 都通过相同 transport。
- 对未知 native event、schema/version mismatch、process crash、auth failure、rate limit 和 capability 缺失给出可诊断状态，不静默吞掉。

#### Important Scenarios

1. 用户选择 Codex，CraftStation 使用现有 official Codex runtime / app-server 路径启动原生 Codex Harness，并保持当前 parity baseline。
2. 用户选择 Grok Build，CraftStation 后台启动 official `grok` binary 的 machine-facing mode；优先评估 `grok agent stdio` / ACP 作为长期双向 host boundary，同时允许使用官方 CLI commands 处理 discovery、models、sessions、MCP 等更适合命令式调用的辅助操作。
3. 用户选择 Kimi Code，CraftStation 使用 Kimi 官方最完整、最稳定的 machine-facing runtime/interface（例如官方 local server / structured protocol，最终以 Plan 阶段实测能力为准）承载 Native Kimi Harness。
4. 用户选择 Antigravity，CraftStation 使用 Official Antigravity Runtime 的最佳 machine-facing boundary。Antigravity 与 Codex、Grok、Kimi、DeepSeek 平级，并作为 Google/Gemini 生态这一侧当前优先支持的 Harness；本 Feature 不优先适配旧 Gemini CLI。
5. 用户选择 DeepSeek / DSH，Plan 阶段重新审计当前真实 upstream/native Harness 与 machine-facing boundary；不得复用已 superseded 的旧 `deepseek-harness/` 路径，也不得用 DeepSeek Model API 伪装成 Harness。
6. 同一 CraftStation Session 完成多轮交互，并能根据 native runtime 能力执行 resume、interrupt、permission response、tool activity 和 cleanup。
7. 某 Harness 具有独特 Plan、Task、Memory、Hooks、Subagent 或其它状态时，CraftStation 保留其 native semantics，而不是为了统一 UI 删除或重解释。
8. 某 Harness 不具备另一个 Harness 的能力时，系统正常运行并明确标注 capability 状态，不将缺失能力视为整个 Harness 失败。

### Scope

#### In Scope

- 五个平级 Native Harness Target：Codex、Grok Build、Kimi Code、Antigravity、DeepSeek / DSH。
- Codex 作为已有 baseline 继续保留，不在本 Feature 重写其 Agent Loop 或 native capabilities。
- 为 Grok Build、Kimi Code、Antigravity、DeepSeek / DSH 建立 CraftStation-owned native runtime adapter / module。
- 为每个 Harness 选择并验证最合适的 official/native machine-facing integration boundary。
- 一个非常薄的 Multi-Harness Runtime Seam，用于 CraftStation 必须掌握的 lifecycle，而不是统一 Harness 内部能力。
- CraftStation Session 与 native session/thread/conversation identity 的绑定、持久化、恢复与 cleanup。
- Native events 到 CraftStation presentation contract 的最小必要 projection，同时保留 raw/native envelope 或等价诊断信息以应对协议演进。
- Common runtime health/status：installed、version、authenticated/runtime-ready、capability availability、process/runtime error。
- 统一 capability acceptance matrix，用同一组问题验收五个 Harness，但允许答案不同。
- 与上一阶段外围 Account & Usage 能力对接：Harness 启动前消费已选择的官方 account/profile/environment；Harness runtime 不负责账号排序、额度 fallback 或账号池策略。
- provider-specific integration 保持 self-contained，新增 Harness 不要求修改现有其它 provider adapter 的内部实现。

#### Out of Scope

- 将 Skill、MCP、Subagent、Permission、Hook、Context、Memory 等立即升级为跨 Harness 一级 Item。
- 构建 `UniversalSkillAdapter`、`UniversalMCPRuntime`、`UniversalSubAgentEngine`、`UniversalPermissionSystem` 等大统一能力层。
- 把五个 Harness 拆碎后重新实现为一个 CraftStation-owned universal Harness。
- 通过模型 API 重写 Agent Loop、Tools、Session 或 Permission。
- CLIProxyAPI、OpenAI-compatible gateway、subscription-to-API proxy 或其它替代官方 Harness 的代理执行路径。
- 默认支持任意 Model × Harness 跨厂商组合；未验证 pairing 不进入本 Feature 的完成条件。
- 为 UI 一致性删除或降格 vendor-specific native capability。
- Auto-Crafting、Model Fingerprint、Interaction-Aware Search、Learned Router、trajectory DB、memory research 或 Phase 3/4 算法。
- 在本 Feature 内完成更深层 Component Promotion / Item decomposition；这些属于五 Harness 完整运行后的后续工作。
- 优先适配旧 Gemini CLI。Google/Gemini 这一侧当前 Harness target 固定为 Antigravity。

### Important Decisions

#### Product Decisions

1. **五个 Harness 平级。** Codex、Grok Build、Kimi Code、Antigravity、DeepSeek / DSH 都是 CraftStation 的并列 runtime target；不存在 Antigravity 作为其它 Harness 汇聚点的关系。
2. **Antigravity 而不是 Gemini CLI。** Google/Gemini 生态当前优先支持 Antigravity Harness；旧 Gemini CLI 不进入本 Feature 的核心范围。
3. **Harness 与 Model 分离。** 五个 target 是 Harness/runtime，不是五个 Model。Model selection 与 Harness selection 继续保持概念边界。
4. **Native pairing first。** 本阶段优先支持明确、经过验证的原生组合，不把任意 Model × Harness 组合能力作为完成条件。
5. **Official / Native Harness Runtime First。** CraftStation 必须依赖上游真实 Harness runtime；ACP、App Server、headless/streaming、stdio RPC、Local Server、SDK 等只是不同 machine-facing boundary，不能被误解为 CraftStation 自建 Harness。
6. **完整 Harness 优先于能力抽象。** 先让五个完整 Harness 原生跑通，再基于真实差异决定哪些 Component 可以抽象或晋升。
7. **统一验收问题，不统一内部实现。** Capability Matrix 用同一组问题比较五个 Harness，但不要求它们具有完全相同能力。
8. **公共 UI shell + native-specific semantics。** 共享视觉容器可以统一，但原生语义和独特能力必须保留。
9. **Account Pool 是外围输入。** Account & Usage 模块负责账号、额度、优先级和 fallback；Harness runtime 只消费最终选定的官方 profile/environment 并执行 Agent。
10. **Codex 是 baseline，不是模板强制复制。** 其它 Harness 不需要照抄 app-server architecture，只需满足相同级别的 native compatibility / lifecycle acceptance。

#### High-level Architecture Direction

CraftStation 只抽取它必须掌握的最薄 runtime seam。概念上允许类似：

```text
start(...)
resume(...)
send(...)
interrupt(...)
dispose(...)
```

以及 UI / lifecycle 必须消费的少量公共状态与事件，例如：

```text
message
status
tool activity
permission request
error
session lifecycle
```

这不是最终 API 设计；具体 interface、event envelope、command/snapshot model 留给 Plan 根据当前仓库与五个 runtime 实际协议确定。

Provider/native adapter 方向：

```text
Codex Adapter
-> official codex binary/runtime
-> app-server
-> Native Codex Harness

Grok Adapter
-> official grok binary
-> ACP / agent stdio 为首选候选 runtime boundary
-> 官方 CLI commands 可作为 discovery / management 辅助
-> Native Grok Build Harness

Kimi Adapter
-> official Kimi runtime
-> 选择最完整稳定的 machine-facing boundary
-> Native Kimi Code Harness

Antigravity Adapter
-> official Antigravity runtime
-> 选择最完整稳定的 machine-facing boundary
-> Native Antigravity Harness

DeepSeek / DSH Adapter
-> 重新审计当前真实 upstream/native runtime
-> 选择其稳定 machine-facing boundary
-> Native DeepSeek / DSH Harness
```

统一 runtime seam 之下，每个 adapter 独立拥有自己的：

```text
protocol / transport
process architecture
session identity mapping
native event parsing
capability discovery
permission semantics
auth/profile handling
error normalization
version/schema compatibility
```

CraftStation 不要求 ACP、App Server、REST/WebSocket、stdio JSON-RPC 或 SDK 被统一成同一种底层 transport。

#### Trade-offs

- 先做五个完整 Harness 会增加本版本集成工作量，但能获得真正的跨 Harness 证据，避免以后围绕 Codex 做错误泛化。
- 保持 native semantics 会使 UI projection 与 persistence contract 比“最低公分母”更丰富，但可以防止高级能力被削平。
- 极薄 runtime seam 可能在接入第 4/5 个 Harness 时继续调整；这是预期行为，优先让真实实现驱动抽象，而不是提前冻结巨大 interface。
- 不在本版本做跨厂商 Model × Harness pairing 会减少组合数量，但能把风险集中在 Harness native compatibility；跨 pairing 应在 native baseline 稳定后单独验证。
- DeepSeek / DSH 的实际 runtime boundary 尚需重新审计，因此它比另外四个 target 存在更高的 upstream uncertainty；该不确定性不能通过复用 superseded 旧实现或改走 Model API 来“解决”。

### Constraints

- 当前仓库仍处于 v0.3.x Codex Native Runtime feature/fix-cycle closeout；v0.4 产品实现不得破坏尚未关闭的 Codex baseline。
- `PROJECT_STATUS.md` 明确标记旧 `deepseek-harness/` 为 `NOT PASSED / SUPERSEDED / DO NOT USE`；v0.4 不得把它重新当作产品 working copy。
- Renderer 不得直接启动任何 Harness process；Supervisor/runtime layer 继续拥有 agent process lifecycle。
- Shared runtime / UI 必须 provider-agnostic；provider-specific logic 保持在 self-contained adapter/plugin boundary，不在共享层累积 provider `if/else`。
- 每个 compatibility boundary（persisted state、native session ref、wire protocol、cache、helper binary 等）都必须有明确版本策略和迁移/失效处理。
- 不记录或暴露 access token、refresh token、cookie、API key 或 raw credential；account/profile 只作为安全的 runtime preparation 输入。
- 不能用“能聊天”作为 Harness 完成标准；必须有 native lifecycle、tool/event、session/resume、error/cleanup 等真实证据。
- 未取得真实 upstream runtime 证据前，不得声称对应 Harness parity/compatibility PASS。

### Acceptance Intent

五个 Harness 使用同一份 capability acceptance matrix。该矩阵统一“要问什么”，不要求“答案必须一样”。至少覆盖：

- [ ] Runtime discovery / installed / version / readiness
- [ ] Native authentication / profile binding
- [ ] Start Session / Thread / Conversation
- [ ] Resume existing native session
- [ ] Multi-turn interaction
- [ ] Streaming / incremental output
- [ ] Tool call / tool result projection
- [ ] Shell / command execution（若 native 支持）
- [ ] File read / edit / change projection（若 native 支持）
- [ ] Permission / approval request-response（若 native 支持）
- [ ] Interrupt / cancel
- [ ] Workspace / cwd binding
- [ ] Skills discovery/use（若 native 支持）
- [ ] MCP discovery/use/lifecycle（若 native 支持）
- [ ] Subagents / delegated agent activity（若 native 支持）
- [ ] Instructions / project guidance semantics
- [ ] Context / compaction 或 native equivalent
- [ ] Plan / task / goal 或 native equivalent
- [ ] Native errors / auth failure / rate limit / unsupported capability
- [ ] Process crash / protocol mismatch diagnostics
- [ ] Runtime cleanup / no leaked process
- [ ] Persistence of native session identity and restart/resume path

Capability 状态至少区分：

```text
supported + integrated
native unsupported
implementation missing
runtime unavailable / not configured
error
```

Feature 级完成意图：

- [ ] Codex 继续通过 official Codex Runtime / app-server 达到现有 baseline，不出现 legacy/API-proxy fallback。
- [ ] Grok Build 通过 official Grok runtime 的 machine-facing boundary 运行完整 Native Harness；ACP / `agent stdio` 是首选候选，但最终以 capability audit 的真实完整性决定。
- [ ] Kimi Code 通过 official Kimi runtime 的最佳 machine-facing interface 运行 Native Harness。
- [ ] Antigravity 通过 official Antigravity runtime 运行 Native Harness，并与其它四个 target 平级；不以 Gemini CLI 替代。
- [ ] DeepSeek / DSH 完成新的 upstream/runtime audit，并通过真实 native Harness boundary 运行；不复活 superseded `deepseek-harness/`，不使用纯 Model API 替代 Harness。
- [ ] 五个 Harness 都能进入 CraftStation 的 `Crafting -> Runtime -> Entity -> Session` 生命周期。
- [ ] Shared runtime seam 不实现或拥有各 Harness 内部 Agent Loop、Skills、MCP、Subagents、Permissions、Context 等能力。
- [ ] Harness-specific native capability 能在 CraftStation UI 中忠实展示，不因统一 UI 被静默丢弃。
- [ ] Session/native session binding、resume、interrupt、cleanup 和真实 error propagation 均有可审计证据。

### Open Questions

没有阻塞 Feature Intent 的产品问题。

已知但可留给 Plan / 实施审计确认的问题：

- Grok Build 最终是 ACP 作为主 runtime boundary，还是 ACP + 官方 CLI commands 的混合方式；选择标准是 native capability 暴露完整性与稳定性，而不是“协议越统一越好”。
- Kimi Code 当前哪个官方 machine-facing interface 最适合作为长期 desktop host boundary，以及其稳定性/versioning 要求。
- Antigravity 当前 CLI/runtime/SDK 中哪个官方入口最完整且最适合 CraftStation Supervisor 长生命周期控制。
- DeepSeek / DSH 当前应绑定哪个真实 upstream/native Harness；旧 superseded `deepseek-harness/` 明确不作为默认答案。
- 五个 runtime 接完以后，当前 HarnessRuntime seam 是否需要最小调整；任何调整必须由真实实现差异驱动。

### Questions Reserved for Plan

- 当前仓库 `harness-runtime` interface 哪些部分可以直接复用，哪些需要为了第二、第三、第四、第五个 implementation 做最小演化。
- 每个 Harness 的官方 binary/runtime discovery、version check、auth/profile discovery 和 capability probe 的具体调用链。
- Grok ACP、Kimi official protocol、Antigravity official runtime、DeepSeek / DSH native runtime 的 transport host 如何组织进 Supervisor。
- Native event envelope 与 CraftStation normalized presentation contract 的边界；哪些 event 必须持久化，哪些只需 transient projection。
- CraftStation Session 如何持久化每个 native runtime 的 session/thread/conversation ref 以及 resume metadata。
- Per-Harness capability descriptor 如何表示 `supported / native unsupported / implementation missing / unavailable / error`，同时不把 capability 本身提升为 Item。
- Account & Usage peripheral 如何在 spawn 前为各 Harness 提供 selected official profile/environment，而不让 Harness runtime 承担 account resolver 职责。
- Harness-specific UI 如何复用现有公共 message/tool/permission shell，同时允许 native-specific panel/card。
- 五个 Harness 的真实 integration/e2e fixtures、fake server/process seam、version matrix 与跨平台测试如何组织。
- Feature 实施顺序和 Ticket 切分；建议 Codex baseline 不重做，新增 target 依次以 Grok Build、Kimi Code、Antigravity、DeepSeek / DSH 形成独立 tracer bullet，最后做 5-Harness compatibility review 与 seam cleanup，但最终顺序由 Plan 结合仓库真实依赖确认。

### Ideate Handoff

- Ready for Plan：Yes
- Plan Status：Not Started
- Notes：本 Part I 已收敛并冻结 2026-08-26 至 2026-08-27 关于下一阶段 Multi-Harness 的批准讨论。核心决策是：Codex、Grok Build、Kimi Code、Antigravity、DeepSeek / DSH 五个 Harness 平级；Google/Gemini 侧使用 Antigravity 而不是旧 Gemini CLI；所有 execution 采用 Official / Native Harness Runtime First；先完成五个完整 Harness 的真实原生适配，再讨论更深层 capability decomposition / Item promotion。后续 Manager / Plan 应先做 repository + upstream capability audit，再补 Part II，不应重新开启已经冻结的产品方向讨论。
