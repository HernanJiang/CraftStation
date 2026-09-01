# AGENTS.md

本文件只保存 CraftStation 项目长期有效的事实、边界和约定。当前 Feature、Ticket、工作区状态与阻塞见 `PROJECT_STATUS.md`；外部仓库精确基线见 `reference/BASELINES.md`。

## Project Identity

- 项目名称：CraftStation。
- 产品定位：Agent Runtime Composition System，以 Minecraft Crafting System 作为组合语义，不是多模型 GUI、Harness 启动器、单纯 Router 或任一 Harness 的换皮。
- 长期目标：给定 Task、Model、Environment、Budget 与 Available Items，选择 Items、形成 Ingredients、匹配或生成 Recipe、得到 Result Item，并 spawn 为运行中的 Entity。
- V0 先证明可执行、可复现、可诊断的 Composition 基础链路；研究性能力必须由后续 Feature 明确立项。

## Repository Boundaries

```text
CraftStation/                  # 根 Git：治理文档、自有资源与长期脚本
├── craftstation/              # 唯一产品 Working Copy；独立 Git 仓库
├── reference/                 # 只读上游参考；每项为独立 Git 仓库/快照
├── 学习材料/                 # 旧资料，只读追溯
├── figures/                   # CraftStation 品牌源资源
└── ai_workspace/
    ├── agent_docs/            # 当前 Feature 的角色文档
    ├── reports/               # 已 PASS Feature 的压缩报告
    ├── validation/            # 临时验证证据
    ├── scripts/               # AI 辅助脚本
    ├── temp/                  # 一次性文件
    └── handoffs/              # 旧工作流历史交接
```

- 产品源码、测试和配置只在 `craftstation/` 中开发。
- 根仓库不吸收 `craftstation/`、`reference/` 或 `学习材料/` 的源码与 Git 历史。
- 根目录旧 `deepseek-harness/` 路线已 `NOT PASSED / SUPERSEDED`，不得作为 Working Copy、测试目标、启动目标或架构事实来源；若本地遗留目录仍存在，直接忽略。
- `reference/` 只用于读取、搜索、比较和引用，不进入 CraftStation 可执行路径。
- `ai_workspace/` 不承载正式源码、正式测试、产品配置或长期启动脚本。

## Runtime and Toolchain

- Working Copy 基于 CraftStation 上游 `SDSLeon/craftstation` 渐进重构，采用 Strangler Refactor。
- 主语言与桌面应用：TypeScript、React、Electron、Node.js `>=24.10.0`。
- 包管理器：`pnpm@11.19.0`；精确版本与依赖以 `craftstation/package.json` 和 lockfile 为准。
- CLIProxyAPI 保持独立 Go implementation；TypeScript 层只通过公开 seam 使用它。
- 测试、类型检查、lint 与构建命令以 `craftstation/package.json` 为准。
- CodeGraph 只索引 `craftstation/`；跨模块关系或影响分析前检查 `codegraph status`。

## Reference Projects

参考项目只提供源码事实、能力对照和产品边界，不表示 CraftStation 已支持其能力。

- DeepSeek Harness：`reference/deepseek-harness/`，上游 `deepseek-ai/deepseek-harness`；只读研究 plugin-first Runtime、Cordis composition 与 Agent/Session/Tool 链路。
- Codex Harness：`reference/codex/`，固定指官方 `openai/codex`；研究 Codex CLI、app-server、JSON-RPC、工具、会话和执行协议。
- Harnss：`reference/harnss/`，上游 `OpenSource03/harnss`；研究多 CLI Agent 桌面执行、ACP、MCP、权限和工作区体验。
- CraftStation：`reference/craftstation/`，上游仓库实际为 `SDSLeon/craftstation`；是 `craftstation/` 的代码基线与主要实现参考。
- AionUI：`reference/aionui/`，上游 `iOfficeAI/AionUi`；研究 Cowork、多 Agent GUI、Team Mode、远程访问与自动化。
- CLIProxyAPI：`reference/CLIProxyAPI/`，上游固定为官方 `router-for-me/CLIProxyAPI`；研究 Subscription/OAuth 到 OpenAI-compatible API 的 provider concern。当前为官方 GitHub zipball 建立的本地 Git 快照，不具备完整上游历史。

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

- 生命周期：`Architect Brief -> Manager Feature Spec/Tickets -> Coder -> Debugger`。
- Debugger `PASS` 后完成 Feature Closeout；`FAIL` 后进入 Fix Cycle，Manager 仅在 `Requires Manager Re-plan: Yes` 时重规划。
- 版本：`vX` Major Stage、`vX.Y` Feature Version、`vX.Y/Tnn` Ticket、`vX.Y.Z` Fix Cycle。
- 动态状态只维护在 `PROJECT_STATUS.md`。
- 角色文档写入 `ai_workspace/agent_docs/{role}_X.Y.Z.md`。
- Feature 最终 PASS 后，Debugger 生成 `ai_workspace/reports/report_X.Y.md`。

## Common Commands

在 Working Copy 内执行：

```powershell
cd .\craftstation
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

## Assistant Knowledge Capture

仅在用户指定 Assistant 角色并要求知识沉淀时应用：

- 通用知识写入 `D:\Apps\Obsidian\Hernan\知识库\` 下对应领域文档。
- CraftStation 架构、实现、Bug、配置和决策写入 `D:\Apps\Obsidian\Hernan\科研和项目\CraftStation\`。
- 对应分类或项目文档不存在时，先提醒用户确认，再协助创建。

## GitHub

- Product Working Copy remote: `origin` = `https://github.com/HernanJiang/CraftStation.git`
- Default branch: `main`
- This file is the CraftStation governance overlay; CraftStation `AGENTS.md` in the same repo remains the implementation working rules.

## Git Worktree Topology

- Product Git Root：`D:\Work\CraftStation\craftstation`。
- Main Worktree：`D:\Work\CraftStation\craftstation`，分支 `main`，稳定产品线；用户用 main 版 CraftStation 长期开发其它项目（dogfooding）。
- Dev Worktree：`D:\Work\CraftStation\craftstation-dev`，分支 `dev`，当前 Feature 的唯一默认开发线。
- Remote：`origin = https://github.com/HernanJiang/CraftStation.git`；`main` 与 `dev` 均跟踪对应远端分支。
- 当前 Feature 的 Manager、Coder、Debugger 只在 Dev Worktree 工作；不得把当前 Feature 源码写入 Main Worktree。
- 用户验收 dev candidate 后，Manager 才能执行 `dev -> main` fast-forward、正式 tag/push，并将 dev 同步到新的 main 基线。
