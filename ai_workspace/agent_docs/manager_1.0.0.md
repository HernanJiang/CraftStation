# CraftStation Manager Ideate — v1.0.0

## Feature

**v1.0.0 — Efficient Model × Harness Composition**

状态：`IDEATE COMMITTED / NOT EXECUTING`

本文件是 v1.0.0 的 Manager / Ideate Brief。当前只记录产品意图与待决策问题，不创建 Coder，不创建 Debugger，不修改 v0.6/v0.7/v0.8 的执行状态，也不执行源码实现。

## Part I — Ideate Brief

### Roadmap Context

v1.0.0 位于 Runtime Foundation 与 Native Composition Runtime 之后，目标是把已经存在的 Model Item、Harness Item、Recipe、Crafter 和 CraftPlan 变成用户可控的组合体验。它不是 Auto-Crafting 研究，也不是重写任一官方 Harness。

### Feature Intent / Why Now

当前 CraftStation 已经有多个 Harness Runtime 和多个模型 Provider 的独立接入，但用户仍然主要通过厂商默认路径使用它们。下一步需要把“模型选择”和“Harness 选择”从固定绑定提升为显式、可解释、可验证的组合能力：同一个 Model Item 可以尝试放入不同 Harness，系统通过 Compatibility Layer 判断这组组合是否可执行，并生成可追踪的 Recipe 与 CraftPlan。

### Product Modes

CraftStation 保留三个模式，但本 Feature 只完善高效/兼容模式：

1. **自动模式（Automatic Mode）**
   - 用户主要选择 Model Item。
   - CraftStation 按 Native Recipe 和兼容矩阵自动解析默认 Harness。
   - 工作台使用九格布局，展示自动解析出的完整组合视图；九格的细粒度编辑能力留给后续 Feature，不在本 Feature 开放任意 Item 搜索。

2. **高效模式 / 兼容模式（Efficient / Compatibility Mode）**
   - 用户显式选择 Model Item 与 Harness Item。
   - 工作台使用四格布局，实时显示组合状态、适配路径、Recipe 和 CraftPlan 预览。
   - 这是 v1.0.0 的唯一实现重点。

3. **创造模式（Creative Mode）**
   - 未来允许用户加入更多细粒度 Item/Component，例如 Context、Tool Policy、Permission、Memory、Compaction、Verifier、Sandbox、Subagent Strategy 与 Session Strategy。
   - 本 Feature 只为这些扩展保留稳定 seam，不实现创造模式。

### Efficient Mode — Four-cell Workbench

高效模式建议先采用四格 Crafting Grid：

```text
┌─────────────────────┐
│ Model Item          │  必填：模型身份与模型 ID
├─────────────────────┤
│ Harness Item        │  必填：官方 Harness Runtime
├─────────────────────┤
│ Provider/Auth       │  可选：opaque profile/auth reference
├─────────────────────┤
│ Runtime Profile     │  可选：权限、上下文、工具等运行配置引用
└─────────────────────┘
```

适配器不作为新的一级 Domain Item。`Compatibility Adapter` 是 implementation-level Component/Module，由 Model 与 Harness 的组合自动解析；工作台显示它的名称、级别和原因，但不把它伪装成用户必须单独选择的 Item。

高效模式右下角固定显示：

```text
Recipe 配置名称 · 模型名称
```

其中 Recipe 配置名称来自确定的 Recipe/配置 profile，模型名称来自 Model Item 的 display metadata。名称必须随当前四格选择实时更新，并在 CraftPlan、Session 和历史记录中保留同一 provenance。

### Workbench Configuration and Capability Display

高效模式的工作台是配置的唯一编排入口。用户在四格中放入或替换 Item/Profile 后，系统对当前完整组合立即执行一次 deterministic compatibility resolution，并生成一份绑定当前配置的 `CapabilityResolution`；这份结果不是静态目录标签，也不是运行后才产生的隐藏状态。

```text
四格配置
  Model Item
  Harness Item
  Provider/Auth Profile
  Runtime Profile
      ↓
Compatibility Resolver
      ↓
CapabilityResolution
      ↓
Workbench 展示：状态、来源、能力、差异、诊断
      ↓（用户明确 Craft）
Recipe → CraftPlan → Entity / Session
```

工作台至少展示：

- 当前组合的兼容状态：`NATIVE`、`SUPPORTED`、`EXPERIMENTAL`、`INCOMPATIBLE` 或 `UNAVAILABLE`；
- 每项能力的解析结果：`Native Harness`、`CraftStation Managed`、`Fallback Harness` 或 `Unavailable`；
- 能力集合与差异：streaming、tool calling、MCP、permissions、subagents、session persistence、context/compaction、usage 等；
- 适配器 ID/版本、Provider/Model identity、Profile 引用和稳定诊断；
- 右下角的 `Recipe 配置名称 · 模型名称`。

`CapabilityResolution` 必须与当前四格配置的版本化 identity 绑定。用户替换任一格时，旧结果立即失效并重新解析；不能沿用上一次组合的能力状态。结果中的 secret 仍只保留 opaque reference，不向 Renderer、持久化明文或日志泄露凭据。`CapabilityResolution` 是预览和执行前门禁，不会改变用户选择，也不会静默切换到其他 Model 或 Harness。

### Compatibility Matrix Intent

v1.0.0 的目标是让矩阵中的每一个 `Model × Harness` 对都能进入同一套兼容判定与配置投影流程，而不是为每一对组合复制一套 Runtime：

```text
Model Item × Harness Item
          ↓
Compatibility Resolver
          ↓
Compatibility Decision
          ↓
Recipe
          ↓
Crafter → CraftPlan → Harness Runtime → Entity / Session
```

矩阵中的每一对组合都必须得到一个明确状态：

- `NATIVE`：官方 Harness 原生接受该 Model/Provider 配置；
- `SUPPORTED`：官方 Harness 提供允许的兼容配置，Harness 的 Agent Loop、Context、Tools、MCP、Permissions、Session 语义仍由官方 Runtime 管理；
- `EXPERIMENTAL`：协议或配置可以接通，但真实能力证据不完整；
- `INCOMPATIBLE`：官方 Harness 没有允许该 Model 进入执行路径的配置；
- `UNAVAILABLE`：理论上可兼容，但本机 executable、凭据、模型或服务不可用。

“矩阵可兼容使用”在产品层表示：所有组合都可被显式尝试、解释和记录；只有通过真实兼容与运行门禁的组合才允许 Craft。不能因为目录中存在 Model 或 Harness 就自动宣称所有矩阵单元可执行。

### Model Adaptation Layer — Proposed Design

建议把模型适配层拆成四个稳定对象，避免出现“每个模型复制一套 Harness”或“把 Adapter 伪装成 Model Item”的问题：

1. **Model Descriptor**
   - `modelItemId`、vendor、canonical model ID、display metadata、模型能力声明。
   - 不拥有进程、Session、Transport 或 Harness 生命周期。

2. **Harness Descriptor**
   - `harnessItemId`、runtime kind、官方启动/连接协议、Harness 能力声明和可接受的 Model Binding surface。
   - 不拥有 Provider API 的实现。

3. **Compatibility Adapter**
   - 以 `(Model Descriptor, Harness Descriptor, Provider Profile, Runtime Profile)` 为输入。
   - 输出 `CompatibilityDecision` 与 `NativeModelBinding`，包括状态、原因、需要的配置字段、能力差异和稳定错误码。
   - 只做 deterministic resolution / validation / projection；不重写 Agent Loop，不偷偷替换模型，不执行网络请求。

4. **Provider/Auth Profile**
   - 通过 `authRef/profileRef` 指向安全存储或官方 Harness 支持的配置。
   - API Key、OAuth Token、Cookie、Base URL 中的敏感部分不能进入 Renderer、CraftPlan 持久化明文或日志。
   - Profile 由 provider/API seam 投影到 Harness 的原生配置入口；CraftStation 不把所有厂商 API 统一重写成自己的第二套 API。

适配级别建议如下：

```text
Level 0  Native pass-through
         官方 Harness 直接识别 provider/model/auth。

Level 1  Official provider configuration
         使用 Harness 官方支持的 provider、model 或 OpenAI-compatible 配置，
         仍由官方 Harness 负责请求塑形和 Agent Loop。

Level 2  Official extension / protocol bridge
         仅当 Harness 官方公开扩展点允许时使用；需要独立真实 E2E 证据。

Level 3  Incompatible
         没有官方允许的进入路径时 fail closed，不用 TUI 抓屏、键盘注入或
         CraftStation 私自伪造的 Provider API 作为“兼容”。
```

推荐的 `CompatibilityDecision` 最小语义：

```text
status
adapterId / adapterVersion
modelRef
harnessRef
providerRef / authRef（仅 opaque reference）
nativeConfigProjection（脱敏后的非 secret 配置）
capabilityDelta
diagnostics[]
```

同一 Model 可以被多个 Harness 使用；同一 Harness 也可以接受多个 Model。组合差异收敛在 Adapter/Binding 层，而不是散落在 Renderer、Crafter 或各个 Runtime 中。

### Scope

- 建立通用 `Model × Harness` Compatibility Layer seam 和 deterministic matrix resolver。
- 在四格高效模式工作台中显式选择 Model 与 Harness，并显示适配状态和诊断。
- Provider/Auth 与 Runtime Profile 使用安全 opaque reference 接入，不暴露 secret。
- 为每个矩阵单元生成稳定的 Recipe/Binding identity 和 provenance。
- 生成并预览 `CraftPlan`，右下角显示“Recipe 配置名称 · 模型名称”。
- 保持现有官方 Codex、OpenCode、Grok Build、Kimi Code、Antigravity、DeepSeek/DSH 等 Harness 的独立 Runtime 边界；具体组合是否可执行必须按官方事实和真实证据判定。
- 对至少一条跨厂商组合完成真实 streaming、多轮、生命周期和错误语义验证；最终矩阵覆盖范围由 Plan 根据实际 executable/credential 条件细化。

### Non-goals

- 不在本 Feature 实现九格创造模式的任意细粒度 Item 编辑。
- 不实现 Auto-Crafting、Recipe Search、Learned Router、Interaction-Aware Optimization 或批量实验矩阵。
- 不重写 Codex/OpenCode/Grok/Kimi/Antigravity/DeepSeek 的 Agent Loop、Context、Compaction、Tools、MCP、Permissions、Subagents 或 Session persistence。
- 不为每个 Model 复制一个 Harness Runtime，不把 CLI/TUI 屏幕模拟当作结构化兼容。
- 不把 CLIProxyAPI、私有代理或未经官方允许的协议桥接作为默认兼容路径。

### Important Decisions / Trade-offs

- **兼容层不是 Router**：它只判断和投影用户已经选定的 Model × Harness，不在运行中静默换模型或换 Harness。
- **Adapter 不是一级 Item**：避免污染 CraftStation 的 Domain Model；用户选择 Model/Harness，适配器由组合规则确定。
- **全矩阵可解释优先于全矩阵强行可运行**：每个组合都有状态和诊断，但只有真实通过门禁的单元才能 Craft。
- **官方 Runtime 优先**：只使用 Harness 的官方 machine-facing interface 或官方 provider configuration；适配层不夺取 Harness 的内部 Agent 能力。
- **四格布局是当前稳定 UX**：先让用户可控地选择和预览两类核心 Item，其他配置通过 profile/config 引用接入；九格自动布局保留为后续扩展面。

### Acceptance Intent

用户在高效模式中选择任意已注册 Model Item 和 Harness Item 后，应看到：

1. 该矩阵单元的真实、可解释兼容状态；
2. 采用的 Adapter/Binding、Provider/Model identity 和能力差异；
3. 右下角的 `Recipe 配置名称 · 模型名称`；
4. 可审计的 Recipe 与 CraftPlan 预览；
5. 只有状态允许且运行条件满足时，才能创建 Entity / Session；
6. 运行时保留所选 Model 与 Harness，不发生静默 fallback；
7. Renderer/IPC/日志没有 API Key、OAuth Token、Cookie 或 raw credential payload。

### Open Questions — 需要用户拍板

1. **四格的第三、第四格**：是否接受“Provider/Auth Profile + Runtime Profile”的建议，还是希望四格全部显示可拖拽 Item？我的建议是 Adapter 不做 Item，第三/第四格用 profile/config 引用。
2. **九格自动模式**：九格是只读展示自动填充的九类配置，还是允许用户在自动模式中替换其中部分 Slot？我的建议是 v1.0 只读展示，避免自动模式变成第二个高效模式。
3. **矩阵的执行语义**：是否同意“所有组合可尝试并有明确状态，但不保证所有组合都可执行”，而不是对所有 Model × Harness 强行标记 `SUPPORTED`？这是官方能力和安全边界所必需的区分。
4. **Adapter 的持久化**：是否只持久化 `adapterId + adapterVersion + opaque refs`，运行时重新生成脱敏 projection？我的建议是这样做，避免配置漂移和 secret 泄露。
5. **Recipe 配置名称来源**：是否由用户为每个组合命名，还是由系统生成 `Model + Harness + Profile` 的稳定名称？我的建议是系统先生成稳定默认名，同时允许用户另存为显示名。
6. **首条真实 tracer bullet**：是否指定一个当前可用的 Model × Harness 组合先打通，再扩展矩阵？我的建议是先选一个已有官方 executable 与凭据可验证的组合，不预设 Kimi 或某个特定厂商。

已确认：每次四格配置变化都在工作台生成并展示一份当前组合的 `CapabilityResolution`；它随配置 identity 失效和重算，用户明确 Craft 后才进入 Recipe/CraftPlan 执行。

### Questions Reserved for Plan

- 真实 Repo 中现有 `CraftPlan`、`NativeModelBinding`、provider registry、Workbench UI 和各 Harness adapter 的边界如何落位。
- Compatibility Matrix 的数据模型、版本化、缓存失效和 migration 方案。
- 四格/九格 UI 的现有组件复用、拖拽状态、空槽、错误态、i18n 和可访问性。
- 每个官方 Harness 的 provider/model binding surface、能力声明和真实 E2E 证据格式。
- 如何保持 `Crafter` 纯 deterministic，以及如何把 CompatibilityDecision 编译为 Runtime 可消费的 CraftPlan。

### Status

`IDEATE COMMITTED / NOT EXECUTING / NOT READY FOR PLAN`

进入 Plan 前需要先解决上面的产品问题，至少确认四格槽位、九格自动模式是否可编辑、矩阵“可尝试但不保证可执行”的语义，以及 Adapter 是否保持为 implementation-level seam。
