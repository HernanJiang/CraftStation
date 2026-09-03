# Manager — v1.2.0 Unified MCP + Skills Capability Foundation

> 当前 Feature 的单一 Manager 交接入口。Part I 记录 Ideate，Part II 记录 Plan。
> 本文件冻结产品意图、系统行为、架构边界、迁移方向、验收意图，以及可执行 Tickets。
> Coder 读取完整文档：用 Part I 理解为什么做和边界，用 Part II 按 Execution Order 连续执行。

## Part I — Ideate

- Status：Planned
- Ready for Plan：Yes
- Created：2026-09-03
- Last Updated：2026-09-03（Plan published）
- Roadmap Context：Phase 2 Native Composition Runtime 的能力基础设施。v1.0 建立 Model × Harness 组合 UX；v1.0.1 做 Native Profile Isolation；v1.1.0 做 Compatibility Bridge。本 Feature 不替代上述路径，而是把 Poracode 已有 MCP / Skills / Plugin / AgentAdapter 升级为 CraftStation 自己管理、可导入、可按运行模式注入的跨 Harness Capability Foundation。不进入 Phase 3 Auto-Crafting，不正式实现 Computer Use。
- Owner：Manager / Plan
- Relation to v1.0 / v1.1：
  - v1.0.0 的 `capabilityResolution` 描述的是 Model × Harness 兼容解析（NATIVE / CRAFTABLE / IMPOSSIBLE），不是 MCP/Skills 选择。本 Feature 新增的 Capability Resolver 不得复用或污染该语义。
  - v1.1.0 Compatibility Bridge 仍并行执行。本 Feature 不得修改 CLIProxyAPI sidecar、ExecutionRouteResolver 或 Compatibility Exporter。
  - v1.0.1 Native Profile Runtime 仍并行执行。本 Feature 不得破坏 `GROK_HOME` / leader socket / Codex home / Kimi profile 隔离。
- Execution Gate：`PLAN READY / EXECUTING`。worktree `.worktrees/v1.2.0-mcp-skills-capability` / 分支 `dev/v1.2.0-mcp-skills-capability`，基线 `main@f5a4bb2`（`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`）。尚未实现、未验收，不得表述为 PASS。本 Feature 并行执行，不 merge/tag/push `origin/main`。Manager 不预先创建 Debugger。

### Feature Intent

#### Problem

CraftStation 从 Poracode fork 而来，已经拥有成熟的 MCP / Skills / Plugin / AgentAdapter 基础设施，也已经能扫描外部 CLI 配置并导入。但当前能力管理与跨 Harness 注入仍不完整：

- CraftStation 还不是 MCP 和 Skills 的统一管理入口。用户能看到外部 CLI 配置，导入后却缺少稳定 origin / source provider metadata。
- MCP 导入目前把外部服务器追加成普通 `McpServer`，没有 `Managed / Built-in / Plugin / Imported / External` 区分，导入后无法追溯来源，也无法为后续模式选择提供稳定 ID。
- Skills 已经有 `origin` 和 copy/link import，但仍允许 `link` 回外部 CLI 原目录。这会把 ownership 和删除联动问题带进其他 Harness。
- Launch-time injection 已经存在，但 MCP/Skills 选择仍绑在 CraftPlan 显式 ID 上。Auto / Efficient / Creative 作为产品运行模式，还没有独立的 capability selection policy。
- 现有 Workbench 的 Efficient / Creative 是 Model × Harness 组合 UX，不是 MCP/Skills 注入策略。如果把两者混写，会污染 Recipe / Item 语义。
- 如果为此新建平行的 MCP/Skills/Plugin/Adapter 系统，会破坏 Poracode 已验证的 OAuth、probe、WSL、user/workspace scope、plugin skills、portable prompt injection 和各 AgentAdapter 的 provider-specific loading。

用户真正要的不是再实现一遍 Poracode，而是：

```text
External CLI capability
        ↓ Scan (read-only)
        ↓ Import selected / Import all
CraftStation Managed capability
        ↓ Capability Resolver (Auto / Efficient)
        ↓ ResolvedMcpServer[] + Skills
        ↓ existing AgentAdapter
Codex / Claude / Gemini / other existing harnesses
```

#### Why Now

- Poracode `reference/poracode` 基线 `a28b995` / v1.6.5 与 CraftStation main 的 MCP/Skills/Plugin/AgentAdapter 几乎同源。现在扩展，成本最低，破坏面最小。
- Computer Use 被明确留到下一阶段。如果现在不把 MCP + Skills 做成可管理、可选择、可注入的 Foundation，下一阶段只能把 Computer Use 写死进某个 Harness。
- v1.1 Compatibility Bridge 解决的是 Model × Harness 执行路由；它不能替代 MCP/Skills 管理。两者必须并行、互不污染。

#### Desired Outcome

CraftStation 1.2.0 成为基于 Poracode 成熟基础设施的统一 MCP + Skills 管理、导入、选择和跨 Harness 注入层。

完成后：

- 用户能在现有 MCP / Skills 设置页看到 Managed、Built-in、Plugin、External、Imported 来源。
- 外部 CLI 配置只扫描、展示，不由 CraftStation 拥有。
- 导入后复制/投影到 CraftStation 自己的 storage，CraftStation 成为该副本的 source of truth。
- Auto 注入当前环境所有 enabled + compatible + available 的 Managed MCP/Skills。
- Efficient 注入当前 Harness Profile 推荐的、同时 enabled + compatible + available 的 MCP/Skills。
- Creative 本版本不阻塞；保持现有行为或暂时复用 Efficient。
- Codex / Claude Code / Gemini 启动时都能收到正确解析后的 MCP/Skills。其他已有 Harness 不得被破坏。
- Computer Use 可以在后续版本作为 MCP Component + Skill Component + Runtime 自然接入，而不是现在实现。

### Expected Behavior

#### User Experience

- MCP 设置页继续基于现有 `McpServersSettings` / `McpServersManager` / `McpExternalImportModal`。
- Skills 设置页继续基于现有 `SkillsSettings` / `SkillsManager` / `SkillImportModal`。
- 用户可以：
  - 查看 CraftStation 管理的 MCP / Skills
  - 查看 Built-in 与 Plugin 提供的能力
  - 扫描外部 CLI 已配置 MCP / Skills
  - Import selected / Import all
  - Enable / Disable
  - 保持 user / workspace（Skills 的 global / project）scope
  - 看到 origin 与 source provider（Codex、Claude Code、Gemini、OpenCode 等）
- 第一版模式 UI 保持克制：只需要清楚表达 Auto 与 Efficient 的实际注入行为，不暴露大量 profile 参数。
- 不出现“Install to CLI / Native Deploy”。导入不会改 `~/.codex/config.toml`、Claude 配置或 Gemini 配置。

#### System Behavior

```text
Registry（Poracode canonical models + CraftStation metadata/policy）
        ↓
Capability Resolver（mode policy only）
        ↓
ResolvedCapabilities { mcpServers: ResolvedMcpServer[], skills: ... }
        ↓
existing AgentAdapter
        ↓
provider-native MCP/Skill loading
  or portable SKILL.md prompt injection fallback
```

- Native-capable agent 继续走 native skill root / provider-native MCP loading。
- 不能原生支持 Skills 的 Harness 继续走现有 portable prompt injection。
- AgentAdapter 不被替换。Resolver 只决定“这次给这个 Harness 哪些 MCP/Skills”。
- 明显只兼容某个 Harness 或当前环境不可用的 capability 不强制注入。
- secret / OAuth / auth 数据不得错误复制进 Managed 副本；日志禁止 token / cookie / api key。

#### Important Scenarios

1. 扫描 Codex / Claude / Gemini 已有 MCP，导入 selected 后成为 Managed 副本；删除 Managed 副本不影响外部 CLI 原配置。
2. 扫描外部 Skills，Import all 复制到 CraftStation storage；不再依赖外部 CLI 原目录。
3. Auto 模式下，Codex 启动只注入 enabled + Codex-compatible + available 的 MCP/Skills。
4. Efficient 模式下，Claude 启动只注入 Claude Efficient Profile 推荐且仍然 enabled/compatible/available 的能力。
5. 一个 stdio MCP 对 Gemini 可用，对某个只支持 HTTP 的 runtime 不可用时，后者不注入。
6. Built-in MCP 与 Plugin MCP 继续工作，不被 Managed import 覆盖。
7. 现有 OAuth、probe、disabled tools、WSL、user/workspace scope 行为保持。

### Scope

#### In Scope

- 复用并扩展现有 MCP / Skills / Plugin / AgentAdapter 基础设施。
- 为 MCP 增加 origin / source provider / import metadata，不新建平行数据模型。
- Skills 导入默认改为 CraftStation-owned copy/projection；External 只读扫描。
- 薄的 Capability Resolver 与 Harness Profile。
- Auto / Efficient 选择策略。
- 现有设置页扩展来源和管理状态。
- Codex / Claude Code / Gemini 的 launch-time 注入验证。
- 保持其他已有 Harness 不回归。
- 为未来 MCP Component / Skill Component / Computer Use Item 留出稳定 ID 与 Registry seam。
- 更新版本到 `1.2.0`，并补充现有 changelog 体系。
- Feature 分支提交；不 push、不 merge main、不打正式 tag。

#### Out of Scope

- 重新实现 MCP、Skills、Plugin、AgentAdapter 或 OAuth。
- 直接修改外部 CLI 配置（Install to CLI / Native Deploy）。
- 复杂 AI 动态能力选择、task understanding、模型能力预测。
- Creative Mode 的细粒度 MCP / Skill / Component 手工组合。
- 把全部 MCP/Skill 强行重构为 Item。
- 正式实现 / 迁移 Computer Use。
- 重做 Account Pool / Quota / Usage UI。
- 实现或接管 v1.1 Compatibility Bridge。
- 破坏 v1.0.1 Profile Isolation。
- merge/tag/push `origin/main`。

### Important Decisions

#### Product Decisions

1. **最大化复用 Poracode，不创建平行系统。** 保留 `McpServer`、`ResolvedMcpServer`、`SkillEntry`、`SkillsService`、`AgentAdapter`。
2. **External 只扫描，不拥有。Imported 之后才是 CraftStation source of truth。**
3. **导入必须复制/投影，不允许把外部 CLI path 当作 Managed Skill/MCP。** 现有 Skills `link` 模式在 Managed import 路径上关闭或降为非默认、不可用于跨 Harness 分发。
4. **Mode 只负责 capability selection。** Provider-specific 差异继续放在 AgentAdapter。
5. **Auto 不是无条件注入。** 必须经过 enabled + compatible + available。
6. **Efficient 使用静态 Harness Profile，不使用 AI。** 例如 Codex Efficient Profile / Claude Efficient Profile / Gemini Efficient Profile。
7. **Creative 本版本不阻塞。** 保持现有行为或暂时复用 Efficient。
8. **不做 Native Deploy。** 继续 launch-time injection。
9. **未来映射必须成立，但现在不落地 Item 化：** MCP Server → MCP Component；Skill → Skill Component。Computer Use 下一阶段再作为 Item 接入。
10. **现有 Workbench Efficient/Creative 语义保持。** 本 Feature 的 Auto/Efficient 是运行时 capability policy，不是四格配方工作台。

#### High-level Architecture Direction

- Poracode infrastructure = Runtime / Infrastructure。
- CraftStation 新增 = Capability policy / management / foundry semantics。
- Registry 与 injection policy 分离。
- 只有现有 abstraction 明显无法满足需求时，才增加新 abstraction。本版本允许新增的最小 abstraction 是 `Capability Resolver` + `Harness Profile` + MCP origin metadata。
- 继续使用 launch-time injection：`Import External → Manage in CraftStation → CraftStation launch → Dynamic injection`。

#### Trade-offs

- 接受本版本 Efficient Profile 是静态推荐列表，而不是智能选择。换来可验证、可诊断、不阻塞。
- 接受导入后出现一份 CraftStation 副本，而不是实时同步外部 CLI。换来 ownership 清晰，避免删除联动。
- 接受 Creative 细粒度组合延后。换来 v1.2.0 能完成 Foundation。
- 接受 MCP origin 字段是对现有 `McpServer` 的向后兼容扩展，而不是新模型。

### Constraints

- 只写本 Feature worktree，不写 Product Git Root `main`，不写 v1.0.1 / v1.1.0 / v0.9 / v0.10。
- `main` 工作区当前有 v1.1 未提交骨架污染；不得把那些文件带进本 Feature。
- 参考仓库 `reference/poracode` 只读。
- 不记录 secret。导入 MCP 时遇 credential-like fields 必须 fail-closed 或显式剥离，不得把 token 写入 Managed 配置。
- 保持 WSL、OAuth、probe、plugin、portable injection、user/workspace scope。
- Coder 默认 `gemini-3.8-flash` / `high`；Debugger 由 Coder 自检后创建，`gpt-5.6-sol` / `high`。
- 测试绿灯不等于 E2E PASS。Codex / Claude / Gemini 必须有启动时收到正确 MCP/Skills 的证据或诚实的 evaluated/not tested。

### Acceptance Intent

至少覆盖：

- CraftStation Managed MCP 正常保存/加载
- External MCP 扫描
- Codex / Claude / Gemini MCP import
- stdio / HTTP / SSE
- user/workspace scope
- enabled / disabled
- disabled tools
- built-in MCP
- plugin MCP
- secret/auth 数据不被错误复制
- Auto / Efficient resolution
- 不兼容 MCP 不注入
- Managed Skills
- External Skill discovery
- Codex / Claude / Gemini Skill import
- global/project scope
- enable/disable
- SKILL.md validation
- Plugin Skills
- native Skill loading
- portable prompt-injection fallback
- 现有主要 Harness 不回归

至少验证 Codex、Claude Code、Gemini 在 CraftStation 启动时都能收到正确解析后的 MCP / Skills。

### Open Questions

无会改变产品目标、用户行为或 Feature Scope 的未决问题。以下工程问题留给 Plan：

1. MCP origin metadata 是直接扩展 `mcpServerSchema`，还是 sidecar map 以减少旧配置迁移面。
2. Efficient Profile 的存储位置：现有 `agentProfiles.ts`、新的 capability profile 文件，还是 Settings 中的精简 include/exclude。
3. Auto/Efficient 运行模式如何接到现有 thread/workbench，而不污染 v1.0 四格配方 UX。
4. Skills `link` 模式是完全禁止 Managed import，还是仅禁止作为跨 Harness 分发源。
5. `package.json` 当前仍是 `0.6.0`；1.2.0 版本号更新的具体文件集合。

### Ideate Handoff

- Worktree：已创建 `.worktrees/v1.2.0-mcp-skills-capability` / `dev/v1.2.0-mcp-skills-capability`，基线 `main@f5a4bb2`。
- Coder 在本工作树连续执行 T01–T12；Manager 不预先创建 Debugger。
- Plan 已写入 Part II。

## Ideate → Plan Gate Check

### Feasibility

- 现有代码已覆盖 External MCP discovery、MCP OAuth/probe/tool filter、SkillsService scan/import/marketplace、plugin MCP/skills、AgentSkillSupport / AgentSkillRootSpec、portable skill prompt injection、launch-time MCP resolution。
- 缺口集中在：MCP origin metadata、Managed import ownership、Capability Resolver、Auto/Efficient policy、设置页来源展示、启动路径从“CraftPlan 显式 ID”升级为“mode-aware resolved capabilities”。
- 结论：可行，不需要平行系统。

### Practicality

- Poracode 与 CraftStation 核心文件行数几乎相同；`mcpServer.ts` 已被 CraftStation 扩展了 `McpRuntimeSupport`。应继续扩展，而不是替换。
- 风险是把 Workbench Efficient 和 Capability Efficient 写混，以及把 v1.1 Compatibility 路径卷进来。Plan 用独立 Resolver 隔离。

### Alignment

- 与用户目标一致：复用 Poracode，CraftStation 成为统一管理入口，导入后拥有副本，Auto/Efficient 做选择，不做 Native Deploy，不做 Computer Use，不阻塞于 Creative。

### Info Completeness

- 足够进入 Plan。保留的工程问题不影响产品意图。

Gate 结论：通过。无重大产品问题。小修复见 Tickets。

## Part II — Plan

### Planning Inputs

- Part I Ideate Brief（Ready for Plan）
- 真实 Repo：`main@f5a4bb2`
- 只读对照：`reference/poracode@a28b995`（PoraCode v1.6.5）
- 并行 Feature：v1.0.1、v1.1.0 不得写入

### Answers to Ideate Plan-Reserved Questions

1. **MCP origin metadata：** 向后兼容扩展 `mcpServerSchema` 可选字段（`origin`、`sourceProviderId`、`sourceProviderLabel`、`sourcePath`、`importedAt`）。旧配置缺省视为 `managed`。不新建平行模型。
2. **Efficient Profile 存储：** 新增薄的 capability profile 配置，按 `agentKind` 声明 include IDs / include tags / exclude IDs。不复用 `agentProfiles.ts`（那是 provider/auth profile），不复用 workbench `efficientDraftSchema`。
3. **运行模式接线：** 在 launch payload / CraftPlan runtime options 增加 `capabilityMode: auto | efficient | creative`。Creative 本版本映射到 Efficient 或现有显式 ID 行为，并在 UI/诊断中诚实标明。不修改四格配方工作台语义。
4. **Skills link：** External 扫描结果可以显示外部 path；Managed import 只允许 copy/projection。已有 link 作为只读/兼容保留，但新的 Import selected/all 不得创建跨 Harness 共享 link。
5. **版本号：** 更新 `package.json` 及相关应用版本源到 `1.2.0`；changelog 写入 `website/public/changelog.json` 的 draft/release 条目。正式网站发布仍等用户授权合入 main。

### KEEP / REPLACE / DELETE

| 现有能力                                                                                                           | 处理                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `ExternalMcpDiscoveryService`（Claude/Codex/Gemini/OpenCode/Cursor/Copilot/Grok/Antigravity/Command Code/VS Code） | KEEP，扩展使用，不重写解析器                                      |
| `McpOAuthService` / `McpProbeService` / `McpToolFilterService`                                                     | KEEP                                                              |
| `McpServer` / `ResolvedMcpServer` / stdio/HTTP/SSE                                                                 | KEEP + 可选 origin metadata                                       |
| `McpRuntimeSupport` / `isMcpServerSupportedByRuntime`                                                              | KEEP，作为 compatible 判断                                        |
| `McpServersManager` / `McpExternalImportModal` / Settings                                                          | KEEP + 来源展示和 Import 元数据                                   |
| `SkillsService` / `SkillEntry` origin/import/validation/marketplace                                                | KEEP；Managed import 改为 copy/projection                         |
| `skillPromptInjection` portable fallback                                                                           | KEEP，不得删除                                                    |
| `pluginSkillPolicy` / `PluginLoader` / `pluginMcpRuntime`                                                          | KEEP                                                              |
| `AgentAdapter` / `AgentSkillSupport` / `AgentSkillRootSpec`                                                        | KEEP，不新增另一套 Adapter                                        |
| `supervisorRuntime.resolveCraftingMcpServers` 显式 ID 路径                                                         | REPLACE 为 Resolver 输出；显式 ID 仅作为 Creative/legacy fallback |
| 把外部 skill path 当 Managed                                                                                       | DELETE from new import path                                       |
| 平行 MCP/Skills/Plugin 系统                                                                                        | 禁止                                                              |
| Computer Use 正式实现                                                                                              | 禁止                                                              |
| Native Deploy / 写外部 CLI 配置                                                                                    | 禁止                                                              |

### Current Architecture (repository-driven)

已有、必须复用：

- MCP：`src/supervisor/mcp/*`，`src/shared/contracts/mcpServer.ts`，`src/renderer/components/mcp/*`，`src/renderer/views/SettingsOverlay/parts/McpServersSettings.tsx`
- Skills：`src/supervisor/skills/*`，`src/shared/contracts/skill.ts`，`src/renderer/components/skills/*`，`src/renderer/views/SettingsOverlay/parts/SkillsSettings.tsx`
- Plugins：`src/supervisor/plugins/*`，`resources/plugins/`
- Adapters：`src/supervisor/agents/base/types.ts` 的 `AgentAdapter` / `AgentSkillSupport` / `AgentSkillRootSpec`；`codex` / `claude` / `gemini` 及其他现有 adapter
- Launch：`SupervisorRuntime` 已有 plugin MCP resolve、OAuth apply、tool filter、`resolveCraftingMcpServers`、`resolveCraftingSkills`、`skillsService.prepareForLaunch`
- 兼容性判断：`McpRuntimeSupport` 已能按 transport / headers / WSL / secret-free 过滤
- 外部 MCP 扫描已覆盖：Claude Code、Codex CLI、Gemini CLI、OpenCode、Cursor、GitHub Copilot、Grok、Antigravity、Command Code；workspace 另有 `.mcp.json`、VS Code
- Skills 扫描已按 adapter `skillSupport.roots` 分组，UI 已能按 provider 展示

缺口：

- `McpServer` 没有 origin / source provider
- MCP import 只是 `onChange([...servers, ...imported])`
- Skills Managed import 仍允许 link 到外部目录
- 没有独立 `resolveCapabilities({ agentKind, mode, projectLocation, environment })`
- Auto/Efficient 作为 capability policy 不存在；Workbench Efficient 是另一件事
- Crafting launch 只注入 CraftPlan 选中的 MCP/Skill IDs，空列表直接不注入
- `package.json` 仍为 `0.6.0`

### Objective

把 Poracode 已有 MCP + Skills 基础设施升级为 CraftStation 可管理、可导入、可按 Auto/Efficient 选择、并经现有 AgentAdapter 跨 Harness 注入的 Capability Foundation。

### Feature Spec

1. **Registry / metadata**
   - 保留 canonical 模型。
   - MCP 增加可选 origin：`managed | built-in | plugin | imported | external`。
   - Imported MCP 保存 `sourceProviderId/label` 与原始 sourcePath 的非 secret 引用；storage 是 CraftStation 配置，不再读外部文件作为运行时依赖。
   - Skills 已有 origin；Managed import 只 copy/projection，并保存来源 metadata。
2. **Import**
   - 继续用 `ExternalMcpDiscoveryService` 与 `SkillsService.scan/import`。
   - Import selected / Import all。
   - 导入时剥离/拒绝 credential-like env/headers/args；OAuth 仍走现有 `McpOAuthService`，不复制 refresh token 到另一份明文。
3. **Capability Resolver**
   - 新薄模块，建议 `src/supervisor/capabilities/resolveCapabilities.ts`（具体路径以不破坏现有 import 为准）。
   - 输入：`agentKind`、`capabilityMode`、`projectLocation`、environment/runtime support。
   - 输出：`ResolvedMcpServer[]` + 启动所需 Skills（native roots 与/或 portable injection）。
   - Auto：enabled ∩ compatible ∩ available。
   - Efficient：Profile include/exclude 后再走同一过滤。
   - Creative：本版本 fallback 到 Efficient 或显式 IDs，并标记 `degraded/not implemented`，不阻塞。
4. **Adapter injection**
   - Resolver 之后仍由现有 AgentAdapter 加载 MCP/Skills。
   - 原生 Skills：Managed copy 投影到 adapter 已声明的 projection/native roots（现有 `prepareForLaunch`）。
   - 非原生：portable SKILL.md prompt injection。
5. **UI**
   - 不重做页面。扩展来源标签、外部扫描分组、Import 后 origin。
   - 模式 UI 只表达 Auto / Efficient 的注入行为。
6. **Future Computer Use**
   - 不为 Computer Use 写死选择逻辑。
   - 稳定 ID 与 origin/policy 必须能被后续 Item/Component 消费。
   - `src/supervisor/agents/computerUseMcp` 本版本只保证不被破坏，不迁移为正式 Item。

### Tickets

#### T01 — Audit freeze / KEEP-REPLACE-DELETE

- Goal：冻结仓库事实，列出可复用 Poracode 基础设施与 CraftStation 缺口，禁止平行系统。
- Scope：对照 `reference/poracode` 与本 worktree；写下 KEEP/REPLACE/DELETE 到 `coder_1.2.0.md`。确认不写入 v1.1 Compatibility 或 v1.0.1 Profile Isolation。
- Depends on：无
- Acceptance：审计结论与本 Plan 一致；发现现有 abstraction 已覆盖的能力不得重写。

#### T02 — MCP origin metadata + Managed ownership

- Goal：扩展现有 `McpServer`，让 Managed/Imported/External/Built-in/Plugin 可区分，且导入后 CraftStation 成为副本 source of truth。
- Scope：`mcpServer.ts` 及配置读写；旧配置缺省 `managed`。导入后运行时不得再读外部 CLI 文件。
- Depends on：T01
- Acceptance：保存/加载 Managed MCP；Imported MCP 带 source provider；删除 Managed 不影响外部 CLI 原配置。

#### T03 — External MCP scan/import without rewriting parsers

- Goal：复用 `ExternalMcpDiscoveryService` 完成扫描与 Import selected/all。
- Scope：现有 MCP UI/manager；import 时写入 origin metadata；stdio/HTTP/SSE、user/workspace、enable/disable、disabled tools 保持。
- Depends on：T02
- Acceptance：至少 Codex、Claude、Gemini MCP 可扫描并导入；secret-like 字段不被错误复制；其他已有 discovery provider 不回归。

#### T04 — Skills Managed copy/projection import

- Goal：外部 Skills 只扫描展示；导入复制/投影到 CraftStation storage。
- Scope：`SkillsService.import` 的 Managed 路径禁止新的外部 link；保留 SKILL.md validation、global/project、plugin skills、marketplace。
- Depends on：T01
- Acceptance：Codex / Claude / Gemini Skill import 后 `origin=managed/imported`，`absolutePath` 位于 CraftStation storage；删除 Managed 副本不删除外部 CLI skill。

#### T05 — Capability Resolver + Harness Profiles

- Goal：新增薄 Resolver 与静态 Efficient Profile。
- Scope：`resolveCapabilities({ agentKind, mode, projectLocation, environment })`；Auto/Efficient 过滤；不替换 AgentAdapter。
- Depends on：T02、T04
- Acceptance：单测覆盖 enabled/compatible/available、profile include/exclude、不兼容不注入。

#### T06 — Launch-time injection via Resolver

- Goal：CraftStation 启动路径改为注入 Resolver 结果。
- Scope：`SupervisorRuntime` / thread spawn；继续 OAuth apply、tool filter、plugin MCP、`prepareForLaunch`、portable injection。Creative/legacy 显式 ID 仅作 fallback。
- Depends on：T05
- Acceptance：Auto 与 Efficient 在 Codex / Claude / Gemini 启动路径上产生正确 Resolved MCP/Skills；空 CraftPlan mcpServerIds 不再被误解释为“什么都不注入”（Auto 应注入过滤后的全集）。

#### T07 — Settings UI origin / source provider

- Goal：在现有 MCP/Skills 页面展示来源与管理状态。
- Scope：扩展现有组件，不重做 UI。第一版模式 UI 只清楚表达 Auto/Efficient。
- Depends on：T03、T04、T05
- Acceptance：能看出 Managed/Built-in/Plugin/External/Imported 以及 Codex/Claude/Gemini 等来源；Import selected/all 可用。

#### T08 — Compatibility / availability honesty

- Goal：不兼容或环境不可用的 capability 不注入，并在诊断中诚实表达。
- Scope：复用 `McpRuntimeSupport`、WSL、secret-free、adapter skill roots。
- Depends on：T05、T06
- Acceptance：只兼容某 Harness 的 MCP/Skill 不会被另一个 Harness 强制注入；诊断无 secret。

#### T09 — Native vs portable skill loading

- Goal：原生 Skills 走 adapter roots/projection；非原生走 portable prompt injection。
- Scope：不得删除 `skillPromptInjection`。
- Depends on：T04、T06
- Acceptance：Codex/Claude/Gemini 走 native/projection；至少一个非原生路径仍能 prompt-inject。

#### T10 — Computer Use seam only

- Goal：保证后续 Computer Use 可作 MCP + Skill + Runtime 注册，但不在本版本实现。
- Scope：稳定 ID、origin、Resolver 不写死 Computer Use；现有 `computerUseMcp` 不破坏。
- Depends on：T05
- Acceptance：文档/代码注释明确下一阶段接入点；无 Computer Use Item 迁移。

#### T11 — Version, changelog, cleanup

- Goal：版本到 `1.2.0`，补充 changelog，清理重复/临时代码。
- Scope：`package.json` 及相关版本源；`website/public/changelog.json`；不发布网站、不 push。
- Depends on：T06、T07
- Acceptance：版本号一致；changelog 说明 MCP/Skills 统一管理与 Auto/Efficient；无平行临时代码。

#### T12 — Verification + Feature self-check

- Goal：相关测试、typecheck、lint、build，以及 Codex/Claude/Gemini 启动注入验证；现有主要功能不回归。
- Scope：本 worktree。真实 CLI 不可用时标记 `not tested` / `RUNTIME_UNAVAILABLE`，不得伪装 PASS。
- Depends on：T01–T11
- Acceptance：写出 `coder_1.2.0.md`；更新本 worktree `PROJECT_STATUS.md`；然后创建 `Debugger-1.2-MCP Skills Capability`。

### Execution Order

```text
T01 Audit freeze
 → T02 MCP origin metadata
 → T03 External MCP import
 → T04 Skills copy/projection import
 → T05 Capability Resolver + Profiles
 → T06 Launch-time injection
 → T07 Settings UI
 → T08 Compatibility honesty
 → T09 Native vs portable skills
 → T10 Computer Use seam
 → T11 Version + changelog
 → T12 Verification + Debugger handoff
```

T03 与 T04 在 T01 后可并行于 MCP/Skills 两侧，但同一 Coder 仍按上序连续执行。T07 不得早于 T03/T04。Manager 不预先创建 Debugger。

### Coder Handoff

- 唯一工作区：`D:\Work\CraftStation\.worktrees\v1.2.0-mcp-skills-capability`
- 分支：`dev/v1.2.0-mcp-skills-capability`
- 基线：`main@f5a4bb2`
- 模型：`gemini-3.8-flash` / `high`
- Debugger 标题：`Debugger-1.2-MCP Skills Capability`；模型 `gpt-5.6-sol` / `high`
- 完成后提交 Git 到本 Feature 分支，不 merge main。
