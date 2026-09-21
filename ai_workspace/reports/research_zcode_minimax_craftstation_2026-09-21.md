# ZCode、MiniMax Code 对 CraftStation 的借鉴建议

调研日期：2026-09-21。CraftStation 本地版本：`1.4.4`。依据两个官方仓库当前公开源码、官方文档及 CraftStation 本地实现；未安装运行两个产品，未做模型质量、速度、成本或真实接入对测。本报告提出候选改进，不代表 Feature 已立项。

**判断**：MiniMax Code 最值得借鉴的是工具按需暴露、结构化上下文交接和精确的用量语义；ZCode 最值得借鉴的是工作流运行记录、产物来源与恢复状态的呈现。优先把这些机制补进 CraftStation 的现有边界，保留 `Item → Recipe → CraftPlan → Entity → Session` 的产品主线。

**两个项目的实际范围**

| 项目         | 已确认公开的内容                                                 | 对 CraftStation 的主要价值                                |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| ZCode        | Desktop、Web、共享服务与 UI、Agent CLI 和运行时                  | 桌面工作台、多 Agent 运行状态、工作流交付物的完整设计参考 |
| MiniMax Code | TUI、headless CLI、ACP、进程内运行时与工具；桌面端源码不在本仓库 | Harness 内部机制与协议接入参考                            |

范围来源：[ZCode README](https://github.com/zai-org/ZCode/blob/main/README.md)、[MiniMax README](https://github.com/MiniMax-AI/minimax-code/blob/main/README.md)、[MiniMax 源码边界](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/architecture.md)。MiniMax 的公开目标为 TUI `0.4.12`；官方明确区分当前源码验证和历史 `0.3.11` 在线服务验收，不能据此认定新版全部服务已经实测通过。[验证记录](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/verification.md)

**CraftStation 已有的基础**

以下功能均已查到实现，因此不作为“从零新增”建议；这不等于本次重新完成了所有运行时验收。

| 已有能力                                                           | 本地证据                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生运行时能力状态、诊断、Session 恢复与压缩接口                   | [nativeHarness.ts](../../src/shared/crafting/nativeHarness.ts)、[runtimeInterface.ts](../../src/shared/crafting/runtimeInterface.ts)                                                                                 |
| MCP 启动快照、工具禁用、跨 Harness 注入；Skills 原生加载与兼容注入 | [mcpServer.ts](../../src/shared/contracts/mcpServer.ts)、[McpToolFilterService.ts](../../src/supervisor/mcp/McpToolFilterService.ts)、[skillPromptInjection.ts](../../src/supervisor/skills/skillPromptInjection.ts) |
| 子 Agent、fallback、跨线程协作、工作流展示                         | [spawnPlan.ts](../../src/supervisor/crossagentMcp/spawnPlan.ts)、[workflowTranscript.ts](../../src/shared/contracts/workflowTranscript.ts)                                                                           |
| Git 检查点、跨 Harness Handoff、分段账本、切换失败回滚             | [checkpointService.ts](../../src/supervisor/git/checkpointService.ts)、[coordinator.ts](../../src/supervisor/sessionHandoff/coordinator.ts)                                                                          |
| 外围网络重试、续接提示                                             | [turnRetryCoordinator.ts](../../src/supervisor/runtime/threadSession/turnRetryCoordinator.ts)                                                                                                                        |
| 上下文占用分类、缓存命中率                                         | [threadContextUsage.ts](../../src/renderer/components/thread/threadContextUsage.ts)                                                                                                                                  |
| headless、移动端重连及事件恢复                                     | [createHeadlessRemoteHost.ts](../../src/server/createHeadlessRemoteHost.ts)、[remoteSocketCoordinator.ts](../../src/mobile/remoteSocketCoordinator.ts)                                                               |

因此，进一步增加 MCP、Skills、重试或再做一个普通上下文圆环，收益有限。更有价值的是减少工具开销、提高交接保真度，并让后台执行在重启后仍然可解释。

**建议一：工具按需暴露，先处理 CraftStation 自管 MCP（优先）**

MiniMax 的 `planMcpDisclosure` 会根据模型白名单、有效上下文窗口、工具数量和工具定义占用决定是否延迟暴露配置型 MCP 工具；调用链组装 `tool_search` / `mcp_invoke`。它保留固定内置工具的直接暴露。这是实际接入工具组装链路的机制。[策略实现](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/agent-tools/src/mcp-disclosure/plan.ts)、[组装入口](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts)

需要保留限定：其白名单默认为空，所以不能说所有模型默认已经启用。默认占比门槛也不应直接成为 CraftStation 的通用参数。工具调用还必须保留完整参数校验和实际目标工具的权限检查，不能因为统一成一个调用入口而跳过原有边界。

CraftStation 的 [StreamableHttpMcpIngress.ts:329](../../src/main/mcp/StreamableHttpMcpIngress.ts#L329) 当前在 `tools/list` 返回所有未禁用工具；[McpToolFilterService.ts](../../src/supervisor/mcp/McpToolFilterService.ts) 提供的是禁用过滤。这说明自管入口有进一步控制工具定义开销的空间；不代表每个原生 Harness 都会把列表原样塞进模型上下文。

最小落地建议：

1. 复用现有工具开关，为明确选择的 Recipe 配置必要工具集合；先测量列表大小和模型实际输入开销。
2. 对工具很多、原生 Runtime 又没有相应机制的组合，试验按需发现；记录搜索命中、调用失败、额外轮次和真实 token。
3. 已有原生按需发现的 Harness 保持原生行为；CraftStation 只管理自己提供的 MCP 表面。

验收应比较同一任务的完成率、工具选择准确性、输入 token 和总耗时，不能只凭列表缩短宣布提速。初期也无需引入自动推断任务意图的 Router。

**建议二：把 Handoff 升级为保留任务事实的交接包（优先）**

MiniMax 的 checkpoint 提示约定八类信息：目标、约束与偏好、完成事项、当前状态、阻塞、决定、待处理用户请求、关键上下文与文件；实际 Todo、后台任务和子 Agent 状态由宿主追加，避免模型摘要成为这些状态的唯一来源。[摘要约定](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/compaction/execution/checkpoint-prompt.ts)、[宿主状态组装](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/compaction/algorithm/checkpoint-format.ts)

CraftStation 的 [checkpointProjection.ts](../../src/supervisor/sessionHandoff/checkpointProjection.ts) 已有脱敏、预算、最近消息、计划与文件变更投影。但 `taskSummary` 主要取最近用户消息前段，`currentState` 主要取最近助手消息尾段。推断：当最近一句只是“继续”或“现在进展如何”，早期目标和约束未必能进入交接包。这是当前投影策略的限制，本次没有声称复现了实际丢失事故。

最小落地建议：在现有 `ConversationCheckpoint` 增加明确的原始目标、有效约束、未完成请求和关键文件锚点；保留出处 item ID。计划完成状态、测试结果、子 Agent 状态仍从宿主已有记录生成。摘要不可用时保留确定性投影并标记降级，不阻塞所有切换。

这属于跨 Harness 交接和恢复提示的改进。Codex 等原生 Runtime 的上下文压缩继续由其自身负责。

验收例：经过多轮讨论、一次“查看进展”、一次网络失败和一次 Harness 切换后，新 Session 仍能准确复述目标、禁止事项、已验证结果和待办，且不把旧工具输出当新指令。

**建议三：让工作流运行状态脱离界面存活（优先）**

ZCode 的工作流协议记录停止原因、`resumedFrom`、`supersededBy`、用量和 Runtime 判定的 `resumable`。前端使用 Runtime 给出的恢复能力，而不是自行根据失败文本推断能否恢复。[workflow-runs.ts](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/zcode-protocol-v4/workflow-runs.ts)

CraftStation 已有工作流阶段和子 Agent 展示。但 [threadLiveWorkflowStore.ts:19](../../src/renderer/state/threadLiveWorkflowStore.ts#L19) 明确说明：该前端追踪只覆盖本次已打开过的线程，未打开线程和应用重启后的覆盖需要 Supervisor 侧机制。这是一个直接可定位的补强点，而非泛泛要求再做多 Agent UI。

最小落地建议：把活动运行索引和状态恢复放到 Supervisor，由 Renderer 订阅投影；保留 run、thread、parent、attempt 和停止原因。重启后先检查真实进程、原生 Session 或可信执行记录，再显示运行、已结束、可恢复或状态未知。

必须区分“恢复展示状态”和“恢复执行”。找回日志不代表原进程仍活着；`resumable` 应由对应 Runtime 的能力与当前证据决定。无需为这一改进搬入 ZCode 的完整工作流编译器。

验收例：切换线程、关闭详情、重启应用后，仍能找到后台任务，知道谁在等待谁、哪次尝试失败、是否可恢复；不会仅因暂时无输出就错误结束任务。

**建议四：给产物补上运行来源和版本（后续）**

ZCode 将产物元数据、版本和内容分开：状态流传递轻量摘要，详情按需读取；产物带工作区路径、版本、发布时间和交付物标记。[workflow-artifacts.ts](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/zcode-protocol-v4/workflow-artifacts.ts)

CraftStation 已有文件与多种产物预览、工作流结果展示。当前检查的 [workflowTranscript.ts](../../src/shared/contracts/workflowTranscript.ts) 主要描述运行与阶段，适合增补明确的产物引用，而不是再建一套预览器。

最小落地建议：先记录文件由哪个 run / Session 产生、对应哪次尝试、是否被后续产物替代、有哪些实际验证记录；复用现有文件打开和预览能力。只有需要保留历史内容时再增加内容快照，避免把“版本元数据”误称为文件历史备份。

它也能为 Result Item 的来源追溯提供基础，但普通生成文件不自动等同于领域中的 Result Item。完整 Recipe Graph persistence 仍需另行立项。

**建议五：上下文与缓存统计增加来源和明确口径（后续）**

MiniMax 的上下文投影区分本地估算和由 provider usage 校准的数据，并呈现压缩状态；缓存统计使用 Runtime 已归一化的 fresh input、cache read、cache write 聚合。[context-snapshot.ts](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/runtime/projections/context-snapshot.ts)、[session-cache-metrics.ts](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/application/session-cache-metrics.ts)

CraftStation 已有分类和缓存命中率，不需要重复造面板。具体增量在 [runtimeEvent.ts:382](../../src/shared/contracts/runtimeEvent.ts#L382)：当前上下文契约的核心是 token 数和 breakdown，没有同等明确的来源、采样时刻与统计作用域。另在 [contextUsage.ts](../../src/supervisor/agents/contextUsage.ts) 和 [threadContextUsage.ts](../../src/renderer/components/thread/threadContextUsage.ts) 可见对 input 与 cache read 大小关系的兼容判断。

建议由各 Adapter 明确 input 是否包含缓存、统计属于单次请求还是整个 Session，并传递 `reported / estimated / unknown` 与更新时间。UI 只显示可证明的数据；来源不足时不合成精确比例。MiniMax 的相加方式成立于其归一化契约，不能直接套到所有 provider。

验收例：分别用“input 包含缓存”和“input 不含缓存”的真实协议形态验证，结果不能因数值大小改变语义；估算值和过期值有清楚标记。

**伴随前述改进：把能力声明关联到真实验证证据**

MiniMax 文档将实现、测试和在线服务验收分开列出，还保留明确的未运行范围。[能力覆盖](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/tui-capabilities.md)

CraftStation 已有非布尔能力状态、MCP launch snapshot、生命周期 fixtures 和真实 smoke 流程。建议在这些基础上关联“配置、已注入、已发现、调用结果”的证据，记录 Harness 版本、环境和时间；只在相应能力可观测时显示确认状态。协议握手成功不自动等于模型使用成功。

优先验收新会话、原生 resume、Handoff、网络重试、号池切换、子 Agent 启动六种路径上的 MCP 与 Skills 一致性。复用现有 smoke 能力即可，不必另建一个大型评测平台。

**插件方面值得借鉴，但不是当前第一优先级**

ZCode 对插件发现、安装、配置、启停、升级、持久化恢复和卸载给出完整生命周期，并区分商店展示信息与运行 manifest；还定义了来源删除但安装仍保留的插件状态。[插件领域说明](https://github.com/zai-org/ZCode/blob/main/CONTEXT.md)

CraftStation 已有 PluginRegistry、manifest、商店和安装状态。适合补充这些生命周期场景的验收，并让示例任务连到可用 Recipe。无需仅为追求同类功能再做一个插件市场，也不应把实现层 Plugin 直接等同于 Item。

**如果将两个项目接入为新 Harness**

| 对象         | 候选接入方式                                  | 当前判断                                                                                                                 |
| ------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| MiniMax Code | 官方 `mcode acp`，复用现有 ACP 接入设施       | 优先做小规模协议验收；源码有 Session load/resume、cancel、MCP、权限相关 handler 和测试，不能据此宣布 CraftStation 已支持 |
| ZCode        | 评估其机器协议、stdio 入口和 Session 生命周期 | 先确认协议边界与兼容策略，再决定 Adapter 范围；本次不假定它与 CraftStation 现有 ACP 协议一致                             |

MiniMax 依据：[ACP 实现](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/acp/agent.ts)、[ACP 测试](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/test/unit/acp-agent.test.ts)。CraftStation 可复用入口：[sessionFactory.ts](../../src/supervisor/agents/acp/sessionFactory.ts)。ZCode 依据：[协议入口](https://github.com/zai-org/ZCode/tree/main/apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4)、[CLI 源码](https://github.com/zai-org/ZCode/tree/main/apps/zcode-cli/packages/cli/src)。

Model Vendor 与 Harness Vendor 继续独立。接入 MiniMax 模型和接入 MiniMax Code Harness 是两件事。新组合在真实验证前保持 `EXPERIMENTAL` 或相应不可执行状态；通过后再提升兼容级别。

**推荐次序**

1. 先改进交接包，补上后台工作流在未打开线程与重启场景下的状态覆盖。这两项与本地明确存在的边界最直接相关。
2. 并行价值方向是 MCP 开销测量与受控按需发现；先验证收益，再扩大到更多组合。
3. 然后补充用量来源、产物来源和上述路径的验收证据。
4. 若需要新增 Harness，先验证 MiniMax ACP；ZCode 保留为运行记录与工作台设计的重要参考。

不建议当前引入完整工作流 DSL、自研通用 Agent Loop、替代原生压缩，或因发现某种上游能力就扩大到 Auto-Crafting / Learned Routing。上述大型机制均需单独讨论并立项。

**调研材料与边界**

- 外部源码事实及更多定位见 [来源笔记](research_zcode_minimax_sources_2026-09-21.md)。
- 使用 Repomix 打包两个远端仓库及 CraftStation 的 12 个聚焦文件；本地聚焦包为 20,571 tokens。临时包及外部源码提取目录位于 `%TEMP%`，不进入产品构建与 `reference/`。
- CodeGraph 检查指向 `D:\Work\CraftStation`，索引状态为最新；实际结论通过本地文件再次核对。
- 本次只新增调研文档，保留既有三个 `research_1.4.0_*.md` 修改；未修改产品源码、配置或动态项目状态，未启动发版或接入实现。
