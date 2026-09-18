# AGENTS.md

本文件只保存 CraftStation 项目长期有效的事实、边界和约定。当前 Feature、Ticket、工作区状态与阻塞见 `PROJECT_STATUS.md`；外部仓库精确基线见 `reference/BASELINES.md`。

## Project Identity

- 项目名称：CraftStation。
- 产品定位：Agent Runtime Composition System，以 Minecraft Crafting System 作为组合语义，不是多模型 GUI、Harness 启动器、单纯 Router 或任一 Harness 的换皮。
- 长期目标：给定 Task、Model、Environment、Budget 与 Available Items，选择 Items、形成 Ingredients、匹配或生成 Recipe、得到 Result Item，并 spawn 为运行中的 Entity。
- V0 先证明可执行、可复现、可诊断的 Composition 基础链路；研究性能力必须由后续 Feature 明确立项。

## Repository Boundaries

```text
D:\Work\CraftStation\              # Product Git Root；main 源码、测试、配置与治理文档
├── .worktrees\
│   └── <version-feature>\          # 独立版本开发工作树；分支 dev/<version-feature>
├── reference\                      # 只读上游参考；每项为独立 Git 仓库/快照
├── 学习材料\                       # 旧资料，只读追溯
├── figures\                        # CraftStation 品牌源资源
└── ai_workspace\                   # 治理、报告与临时验证材料
```

- 产品源码、测试、配置与 `main` 分支直接位于 `D:\Work\CraftStation`，不再增加 `craftstation/` 包装层。
- Git 拓扑：`D:\Work\CraftStation` = Product Git Root / `main`；所有并行版本开发工作树直接位于 `D:\Work\CraftStation\.worktrees\<version-feature>`，对应分支统一为 `dev/<version-feature>`。本项目不维护共享 `dev` 分支或共享 Dev 工作树；该结构与 `my-workflow` 的默认拓扑一致。
- 一个版本 Feature 对应一个 `dev/<version-feature>` 分支与一个 `.worktrees/<version-feature>` 工作树。该版本的 Manager Plan、Coder 实现、Fix Cycle、Debugger 验收和用户候选试用均在同一工作树完成；不同版本可以并行，禁止跨 Feature worktree 写入。
- 已立项的版本 Feature 仍走独立 worktree；但本项目当前由用户明确覆盖：Bug、缺陷、hotfix 与可用性修复默认直接在 Product Git Root 的 `main` 修改与验证，不新建 Feature worktree。只有用户明确恢复 Feature 开发时，才使用独立 worktree。
- Debugger PASS 后在当前版本开发分支完成候选收口并通知 Manager，不再执行 Feature → 共享 Dev 合并。只有用户完成验收并明确授权后，Manager 才把该 `dev/<version-feature>` 分支收口到 `main`；Coder / Debugger 不得 merge main、打正式 tag 或 push `origin/main`。
- 旧 `D:\Work\CraftStation\dev`、`craftstation-dev` 与其中的工作树均为迁移残留，统一归档到仓库外备份；旧 `D:\Work\CraftStation\craftstation` 仅允许暂存被既有运行中产物占用的迁移残留。新开发不得使用这些旧路径。
- `reference/` 与 `学习材料/` 不进入产品构建、测试或 Product Git 的上游源码历史。
- 根目录旧 `deepseek-harness/` 路线已 `NOT PASSED / SUPERSEDED`，不得作为 Working Copy、测试目标、启动目标或架构事实来源；若本地遗留目录仍存在，直接忽略。
- `reference/` 只用于读取、搜索、比较和引用，不进入 CraftStation 可执行路径。
- `ai_workspace/` 不承载正式源码、正式测试、产品配置或长期启动脚本。

## Runtime and Toolchain

- Working Copy 基于 CraftStation 上游 `SDSLeon/craftstation` 渐进重构，采用 Strangler Refactor。
- 主语言与桌面应用：TypeScript、React、Electron、Node.js `>=24.10.0`。
- 包管理器：`pnpm@11.19.0`；精确版本与依赖以 Product Git Root 的 `package.json` 和 lockfile 为准。
- CLIProxyAPI 保持独立 Go implementation；TypeScript 层只通过公开 seam 使用它。
- 测试、类型检查、lint 与构建命令以 Product Git Root 的 `package.json` 为准。
- CodeGraph 只索引 `D:\Work\CraftStation` 产品源码；跨模块关系或影响分析前检查 `codegraph status`，不得误用旧路径索引。

## Reference Projects

参考项目只提供源码事实、能力对照和产品边界，不表示 CraftStation 已支持其能力。

- DeepSeek Harness：`reference/deepseek-harness/`，上游 `deepseek-ai/deepseek-harness`；只读研究 plugin-first Runtime、Cordis composition 与 Agent/Session/Tool 链路。
- Codex Harness：`reference/codex/`，固定指官方 `openai/codex`；研究 Codex CLI、app-server、JSON-RPC、工具、会话和执行协议。
- Harnss：`reference/harnss/`，上游 `OpenSource03/harnss`；研究多 CLI Agent 桌面执行、ACP、MCP、权限和工作区体验。
- CraftStation：`reference/craftstation/`，上游仓库实际为 `SDSLeon/craftstation`；是 CraftStation Product Git Root 的代码基线与主要实现参考。
- AionUI：`reference/aionui/`，上游 `iOfficeAI/AionUi`；研究 Cowork、多 Agent GUI、Team Mode、远程访问与自动化。
- CLIProxyAPI：`reference/CLIProxyAPI/`，上游固定为官方 `router-for-me/CLIProxyAPI`；研究 Subscription/OAuth 到 OpenAI-compatible API 的 provider concern。当前为官方 GitHub zipball 建立的本地 Git 快照，不具备完整上游历史。
- Token Monitor：`reference/token-monitor/`，上游 `Javis603/token-monitor`；研究认证登录、token / Coding Plan 监控与各家额度探测路径。只读对照，不进入 CraftStation 可执行路径。

更新规则与固定 commit 见 `reference/BASELINES.md`。更新前确认工作区干净，只允许 fast-forward；网络异常时保留已验证基线并记录获取方式，不推断更新成功。

## Domain Model

正式术语优先沿用：`Item`、`Metadata`、`Component`、`Ingredient`、`Slot`、`Crafting Grid`、`Recipe`、`Result`、`Crafter`、`Entity`、`Session`。

- `Item` 是可独立选择、替换、组合并作为 Recipe 输入或输出的最小决策单位；内部可包含多个 Components。
- `Metadata` 负责 identity、display、version、vendor、source、description 与 registry 信息，不承载 Runtime 执行逻辑。
- `Component` 描述 Item 的属性、能力、行为和实现；底层 Plugin/Adapter 可以实现 Component，但不等同于 Item 或 Ingredient。
- `Ingredient` 是 Item 在特定 Recipe 中承担的输入角色，不是 Item 的子类。
- `Recipe` 描述 Ingredients 如何组合并产生 Result；`Result` 仍是 Item，可继续参与后续 Recipe。
- `Crafter` 是 deterministic resolver、validator 与 compiler，输出 `CraftPlan`；不操作进程、transport、RPC 或 UI。
- `Entity` 是 Result Item 被 instantiate、spawn、start 后的运行实例。
- `Session` 是 Agent Entity 的连续工作过程，不等同于单条消息或单次模型请求。
- `auto` 是 Slot 的 deterministic resolution mode，不是 Item 或 Router。

对话默认路径是 Auto：Muse Spark / Meta 默认走 OpenCode 原生兼容，DeepSeek 默认走 dsh。Muse Code 仅作为用户显式选择的 Recipe（Windows 通过 WSL）保留。用户在合成台指定或合成的结果是 Recipe。对用户与文档只称 Auto 与 Recipe；实现层可保留 `efficient` / `creative` 作为合成台入口 id。

## Product and Architecture Boundaries

- v0.1.0 的原生链路为 `OpenAI Model Item + Codex Harness Item -> Recipe -> Crafter -> Result Item -> CraftPlan -> Entity -> Session`。
- Model Vendor 与 Harness Vendor 保持独立；未验证组合不得进入可执行路径。
- 兼容状态统一使用 `NATIVE`、`SUPPORTED`、`EXPERIMENTAL`、`INCOMPATIBLE`。
- CraftStation 的 Desktop、IPC、workspace、terminal、git/worktree 与 persistence 等通用基础设施可以在 Strangler Refactor 期间继续复用；Harness-specific Runtime 只作为迁移参考，不预设为 CraftStation 的永久生产依赖。
- 保持 domain terminology 与 implementation terminology 分离；`adapter`、`transport`、`client`、`server`、`protocol`、`process` 在实现层可继续使用。

当前 Feature 优先建立四个逻辑 Module：

- `crafting`：小 Interface 暴露 `resolve -> validate -> compile`，隐藏 Recipe 匹配、校验和 CraftPlan 编译。
- `registry`：管理 Item、Recipe 与 runtime binding；与 CraftStation 的 AgentAdapter registry 分离。
- `harness-runtime`：最重要的 execution seam。上层只提交 CraftPlan、Workspace、可选 Session ref 与 Prompt，并接收 Entity/Session identity、runtime events 和 lifecycle operations。
- `provider/API`：隔离 CLIProxyAPI 或原生 provider/auth concern，不与 Harness process execution 混为一体。

Codex app-server、stdio、JSON-RPC、server pool 与 Codex-specific session 都属于 `harness-runtime` 内的 Codex Adapter。React UI、Crafting domain 和 Crafter 不得深度导入这些 implementation。

从 v0.3.0 起，Codex 生产路径由 CraftStation-owned Codex Runtime Module 直接驱动官方 `codex app-server`。最终产品路径不得依赖或 fallback 到 CraftStation 的 `ThreadSessionManager`、`SpawnPipeline`、`AgentAdapter`、`CodexStructuredSession`、canonical event mapping 或 Codex hook plugin；迁移期间可以保留隔离的 legacy implementation 作为对照，只有新路径取得真实验收证据后才移除。Codex 的 Agent Loop、上下文管理与压缩、工具执行、MCP、Skills、子 Agent 和原生 Session 语义继续由官方 Codex Runtime 拥有，CraftStation 不重写这些内部能力。

CLIProxyAPI 在 v0.1.0 不预设为 Codex 必经路径，也不重写为 TypeScript；是否使用只由 provider/auth 需求决定。

**Craft-Harness**（v1.3.1 起正式引入）：跨 Harness 的外围 runtime 管理层，由 CraftStation 统一实现，承载所有「不涉及 Agent 核心特性」的通用机制——自动重试、重试间隔、续接 Prompt 注入、内置 MCP 服务器的统一管理与注入（浏览器、Own Subagents、Chrome、计划、应用控制、计算机操作等）等。Craft-Harness 不做 per-agent 特性适配：只依赖所有 structured harness 共用的 seam（`StructuredSessionHandle` 失败冒泡、session/new 的 MCP 注入通道），配额/鉴权仍归 pool failover 与 fail-closed 语义，用户主动中断永不被重试；内置 MCP 必须对所有支持的 Harness 一视同仁地注入，不允许出现「面板显示已启用但实际未注入」的盲区。首个落地能力：structured turn 因网络/传输中断失败时，按「设置 → 一般 → 重试次数 / 重试间隔」自动重试并注入续接 Prompt（实现：`src/supervisor/runtime/threadSession/turnRetryCoordinator.ts`）。纯终端（PTY-only）路径无 per-turn 失败信号，不在 Craft-Harness 重试覆盖范围。

Auto-Crafting、Model Fingerprint、Active Probing、Compatibility Prediction、复杂 Context Strategy、Tool Policy Composition、Learned Routing、Recipe Search 与完整 Recipe Graph persistence 仅在对应 Feature 立项后实现。

## Engineering and Observability

- 修改前检查目标仓库 Git 状态；保留用户与其他角色已有修改。根仓库、Working Copy 与各参考仓库分别执行 Git 命令。
- 优先通过小而稳定的 Interface 获得 deep implementation；调用者与测试跨同一 seam，避免 accidental deep imports。
- 新功能先定义错误语义和关键日志事件，再实现业务路径。
- 关键路径至少表达 `phase`、`operation`、`status`、相关对象 ID、稳定错误 `code`、原因与排查方向。
- 跨组件流程携带 correlation/request id；错误保留原始异常上下文。
- 日志覆盖成功、跳过、降级与失败，不记录 API key、Token、Cookie、完整敏感 Prompt 或其他凭据。

## Workflow

仅当用户明确调用 `$my-workflow` 或指定其 `Architect`、`Manager`、`Coder`、`Debugger`、`Assistant` 角色时启用大型项目工作流。

- 生命周期：`Architect Brief -> Manager Feature Spec/Tickets -> Coder (Stage 1/2) -> Debugger (Stage 1/2) ⇄ Coder (Stage 1/2) [Mutual Loop] -> DEV PASS`。
- 双阶段互审与修复机制：
  - **Coder 双阶段**：Stage 1 连续执行全部 Tickets（T01 → Tn）/ 反向审查 Debugger 修复改动；Stage 2 自我审查自修 / 亲自修复审出的回归缺陷并验证。
  - **Debugger 双阶段**：Stage 1 独立审查与测试/Runtime 验证；Stage 2 亲自直接修复自己在 Stage 1 审出的缺陷并全量回归验证。
  - **互审互修循环（最多 3 轮）**：遵循「谁发现、谁在 Stage 2 修复」，杜绝只出报告让对方猜题。循环上限为 3 轮。
  - **终极攻坚与阻断**：若 3 轮后仍有未能解决的 bug，由 Debugger 和 Coder 启动 Matt 的 `diagnosing-bugs` 与 `tdd` 技能进行最后一轮终极联合攻坚修复，再修不好则标记 `BLOCKED` 上报用户；若遇到**需要用户配合才能解决**的问题（缺少凭据/配置/权限/需人工决策），**立即标记 `BLOCKED` 直接上报用户**，严禁空耗互审轮次。
  - **双向 PASS 收尾**：当 Coder 与 Debugger 在互审中均判定 0 Findings（达成双向 PASS）时，由 Debugger 在当前版本 Dev 分支完成候选收口（状态进入 `DEV PASS / USER ACCEPTANCE PENDING`），生成 `report_X.Y.md`，并启动产物引导用户进行 Smoke 验收。
- 配对规则：每个 Feature 的 Coder 必须在完成全部 Ticket 与 Stage 2 自查自修后，自动创建并交接一个对应的 Debugger 任务；Manager 不预先创建 Debugger。Debugger 只验收其绑定 Coder 的同一 Feature worktree。
- 角色默认模型：Coder 默认使用 `gpt-6-astra`（ChatGPT-6 Astra），推理强度 `medium`；Debugger 默认使用 `grok-4.6`（Grok 4.6），推理强度 `high`。创建或继续角色线程时使用上述配置，除非用户另行指定。
- 问题修复分流：本项目当前默认直接在 `main` 修复用户确认的问题、缺陷与 hotfix；Coder 与 Debugger 使用独立线程，但按批次串行操作同一 main 工作区，避免并发写冲突。
- Manager：每项目唯一，标题固定 `Manager`，不绑 Feature 版本；负责与用户讨论并下发计划，跨 Feature 复用同一会话。Plan 发布并完成 Coder 派发后立即收口本轮，不持续等待、轮询或查看 Coder 进度；Coder 连续执行全部 Tickets 并自行创建 Debugger。仅当用户明确要求查看进度、出现阻塞/Re-plan，或用户授权 Dev → Main 收口时，Manager 才再介入。
- 线程隔离：每个 Coder、其配对 Debugger，以及 Assistant 都必须是独立线程；每个 Coder 只配对一个 Debugger，Debugger 不预先复用其他 Feature 的线程。main 修复批次完成后再进入下一批，确保同一工作区只有一个写入者。
- Coder / Debugger / Assistant 会话命名：`{Role}-{Version}-{ShortDesc}`，例如 `Coder-0.7-OpenCode Native`、`Debugger-0.6-Provider Auth`。`Version` 用 Feature `X.Y`，不要加 `v`。
- 新建角色会话必须绑定本项目（`projectId` `16cc8579-4db8-4ce6-89c3-a12a48187705` / `D:\\Work\\CraftStation`），禁止 projectless 会话。同一角色多个 Feature 会话时按版本匹配，不得复用其他版本的 Debugger，也不得新建第二个 Manager。
- 双向 PASS 达成后，由 Debugger 在当前 `dev/<version-feature>` 分支完成候选收口，通知 Manager，并打开该版本工作树产物给用户看；不再合入共享 Dev。用户验收并明确授权后，版本开发分支 → `main` 由 Manager 执行；发生冲突时保留现场并向用户说明，不强制覆盖。
- 版本：`vX` Major Stage、`vX.Y` Feature Version、`vX.Y/Tnn` Ticket、`vX.Y.Z` 互审与修复 Cycle。
- 动态状态只维护在 `PROJECT_STATUS.md`。
- 角色文档写入 `ai_workspace/agent_docs/{role}_X.Y.Z.md`。
- Feature 最终双向 PASS 后，Debugger 生成 `ai_workspace/reports/report_X.Y.md`。

## Common Commands

在 Product Git Root 内执行：

```powershell
cd D:\Work\CraftStation
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

GitHub CLI 仓库检索使用 `fullName`：

```powershell
gh search repos "关键词" --limit 20 --json fullName,url,description,updatedAt,pushedAt,stargazersCount,isFork,visibility
```

## Portable Release

- 默认每次发版同时打便携版与 NSIS 安装包（均为 x64）：先 `pnpm dist:win` 再 `pnpm dist:win:portable`，产物均位于 `D:\Work\CraftStation\release\`。注意不要用 `pnpm dist:win:all`——它会连带打 arm64，本机 node-gyp 编不过。
- `release\` 下便携版仅保留最新和上一个版本稳定版共两份备份；旧版本目录（`release-portable*`）、中间产物（`win-unpacked/`、`builder-debug.yml` 等）打包完成后即删除。
- NSIS 安装包（`CraftStation-Setup-*.exe`）连同 `latest.yml` / blockmap 随版本发布到 GitHub Release（updater feed 所需），不属于便携版备份计数，不得顺手删除。
- 用户确认的 main 修复、缺陷与 hotfix 收口后，默认执行双包构建；用户只说“打包”时同样默认双包，不再单独确认 NSIS。

## Assistant Knowledge Capture

仅在用户指定 Assistant 角色并要求知识沉淀时应用：

- 通用知识写入 `D:\Apps\Obsidian\Hernan\知识库\` 下对应领域文档。
- CraftStation 架构、实现、Bug、配置和决策写入 `D:\Apps\Obsidian\Hernan\科研和项目\CraftStation\`。
- 对应分类或项目文档不存在时，先提醒用户确认，再协助创建。
