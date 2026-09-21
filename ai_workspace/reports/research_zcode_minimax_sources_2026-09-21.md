# ZCode 与 MiniMax Code：外部源码调研证据

调研日期：2026-09-21。用途：为 CraftStation 的对比分析提供一手事实和实现定位。本文只核对两个外部项目；对 CraftStation 的具体缺口应以主报告的本地源码核对为准。

结论：两者当前均已公开真正的 Harness 相关源码。最值得借鉴的是 MiniMax Code 的 MCP 渐进暴露和有损可感知的上下文检查点，以及 ZCode 的持久运行关系与版本化产物。普通的 MCP、Skills、多 Agent、恢复会话、SSH/WSL 或产物预览本身，不能据此判定 CraftStation 缺失。

## 1. 公开范围与证据等级

| 项目         | 当前公开范围                                                                                                           | 需要保留的边界                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| ZCode        | Electron Desktop、Web、HTTP/WebSocket 服务、共享 UI、Agent CLI/TUI/runtime 都有源码。`apps/zcode-cli` 是仓库普通目录。 | 第一方 Apache-2.0；第三方组件另有条款。本次没有构建或运行产品，源码存在不能证明所有发行形态都已验收。                                    |
| MiniMax Code | 当前为 0.4.12 source preview，包含 TUI、headless CLI、ACP、本地运行时和分发工具。                                      | 不包含 Desktop 应用源码；`mcode-tools` 是来自公开 npm 包的独立制品，不应称为全部工具源码均开放。第一方默认 MIT，第三方与文件级许可保留。 |

来源：[ZCode README](https://github.com/zai-org/ZCode/blob/main/README.md)、[ZCode 声明](https://github.com/zai-org/ZCode/blob/main/NOTICE.md)、[MiniMax README](https://github.com/MiniMax-AI/minimax-code/blob/main/README.md)、[MiniMax source status](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/open-source-status.md)、[MiniMax 许可范围](https://github.com/MiniMax-AI/minimax-code/blob/main/LICENSE-STATUS.md)。

本文中的“实现”指读到了执行路径；“测试覆盖”指读到了仓库测试；“官方验收”只转述官方记录；“建议”是面向 CraftStation 的推断。没有做性能比较或效果排名。

## 2. MiniMax：MCP 工具按需发现，而非每轮携带全部 schema

**源码事实。** `planMcpDisclosure` 先检查开关、模型白名单、有效 context window，再估计配置型 MCP 工具定义的体积；超过阈值才把候选移入 deferred registry。其他工具仍保持直接暴露。实际 production composition 使用这条组装路径，不只是孤立实验文件。[决策函数](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/agent-tools/src/mcp-disclosure/plan.ts#L31)、[运行时组装](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts#L189)、[生产装配入口](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/production-composition.ts#L403)。

发现入口 `tool_search` 支持 BM25 关键词检索、中文、正则和结果数量限制，返回匹配工具的完整定义，再通过 `mcp_invoke` 调用。[搜索入口](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/agent-tools/src/mcp-disclosure/tool-search.ts#L5)。

**默认值不能误读。** 组装器的 enabled 缺省为 true，工具占上下文阈值为 15%，默认返回 5 个、最多 20 个；但是 `modelWhitelist` 缺省为空，因此没有配置白名单时不会对所有模型自动启动渐进暴露。[配置解析](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/agent-host/assembly/local-turn-tool-catalog.ts#L480)。

**实现限制。** `mcp_invoke` 区分普通 `tool_name` 和插件交付的 `tool_ref`。后者要求 Host policy 准入，并校验参数快照；前者遇到 TypeBox 无法处理原始 JSON Schema 的异常时，`schemaMismatch` 会返回无错误，而不是普遍 fail-closed。不能把它概括成所有 MCP 参数都已强校验。[调用网关及 schema 校验](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/agent-tools/src/mcp-disclosure/mcp-invoke.ts)。

**对 CraftStation 的建议。** 优先让 Recipe 裁剪 CraftStation 自己管理的工具集合，然后在明确验证的模型/Harness 组合上尝试搜索入口；保持真实目标权限、禁用工具检查和可靠的 JSON Schema 校验。收益假设是减少不相关工具定义占用，实际节省与选工具准确率仍需测量。不应干预 Codex 原生工具发现或把开关统一强加给所有 Harness。

## 3. MiniMax：把长期工作状态与模型生成摘要分开保存

**源码事实。** 检查点提示要求分别保留目标、约束与偏好、已完成工作、当前状态、阻塞、关键决策、未回答请求、关键上下文与文件。历史被作为待概括资料处理；摘要步骤不调用工具。Todo/Plan 等运行状态由宿主另行提供，而非让摘要模型猜测。[检查点提示及预算](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/compaction/execution/checkpoint-prompt.ts#L1)。

`checkpoint-format` 检查生成结果的终态、输出大小和内容类型，区分 `exact` 与 `soft_fallback`；再从历史投影出 Todo、后台任务状态，并附加近期用户请求和子 Agent 状态。格式不符并非一律拒绝，不能宣传成严格无损压缩。[格式与状态拼接](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/local-runtime-v2/src/service/turn-system/compaction/algorithm/checkpoint-format.ts#L39)。

**对 CraftStation 的建议。** 将这一模式用于 CraftStation 自己拥有的跨 Harness Handoff：显式保存长期目标、用户约束、关键决策、待办与验证证据，模型只负责叙述摘要。保留原始记录引用和回滚，不把最近一条消息当作整个任务。不替代 Codex 等原生 Harness 的内部压缩算法。

## 4. MiniMax：上下文数字应说明来源与时效

**源码事实。** TUI context projection 除分项外，还区分 `LOCAL_ESTIMATE` 与 `PROVIDER_USAGE_ANCHORED`，以及 `loading`、`empty`、`stale`、`live` 状态；压缩另有 running/completed/failed 状态。[上下文投影](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/runtime/projections/context-snapshot.ts#L15)。

缓存统计将 fresh input、cache read、cache write 分开，Session 比率由 Runtime 聚合值导出。[缓存统计](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/application/session-cache-metrics.ts#L3)。

**对 CraftStation 的建议。** 如果已有分项面板和命中率，增量仅是计量来源、更新时间、有效性和不同 provider 缓存字段的语义归一化。缺失数据应呈现未知，不用零或精确百分比掩盖。不能由这段 UI 实现推断 MiniMax 的缓存效率高于其他 Harness。

## 5. ZCode：运行恢复与执行关系有持久化语义

**源码事实。** Dynamic Workflow 将纯编译/分析/引擎与具体执行 driver 分开；公开接口包含 journal port。恢复身份不直接依赖画面上的节点位置，ask 缓存按 actor、调用顺序和输入摘要核对。[模块边界与站点身份](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/dynamic-workflow/README.md)。

运行投影包含 `resumedFrom`、`supersededBy`、停止原因和 usage。UI 时间线的摘要同时表达阶段、活跃 Agent、完成步骤、轮次、token 和产物数量。[运行 schema](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/zcode-protocol-v4/workflow-runs.ts#L312)、[时间线统计](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/components/workflow-timeline/timeline-summary.ts#L150)。

**对 CraftStation 的建议。** 借鉴持久事实到 UI 投影的关系：任务运行记录应跨重启可读，能够追到原运行、接续运行、子 Agent、停止原因、产物和验证证据。可以在已有 Supervisor 事件与 Handoff 数据上补充这些关系；不必先引入 ZCode 的 TypeScript 工作流语言、编译器或完整执行引擎。

**恢复边界。** 可重放 journal 不等于任意 Shell、网络写入都能恰好执行一次，也不意味着外部副作用可撤销；本次没有运行崩溃恢复实验。

## 6. ZCode：产物是有版本和来源的交付记录

**源码事实。** 用户面产物区分 file/markdown 与 chart/table/metrics/board；后者的数据来自带标签的 journal report。产物保存版本、发布时间、字节数、类型、原路径和存储引用；高频状态只发送摘要，详情与内容按需读取。读取内容前要求对应 `(artifactId, version)` 有 completed journal 记录。[产物协议](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/zcode-protocol-v4/workflow-artifacts.ts#L55)。

发布路径先分配版本、记录 running，再存内容和结算；恢复命中已有记录时核对输入，直接复用原成功或原失败，不重发发布事件。失败不会被恢复过程偷偷变成重新执行。[发布与重放](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/dynamic-workflow/src/engine/engine-artifacts.ts#L27)。

**对 CraftStation 的建议。** 在已有产物预览上增加“由哪次运行/哪位 Agent 产生、哪一版、通过何种验证”的元数据和结果历史；将文件变成 Recipe/Session 的可追踪交付物。无需一开始就增加四种看板模板。

## 7. MiniMax：ACP 已具备值得接入验证的具体协议面

**源码事实。** CLI 提供 `mcode acp`；实际 handler 包含能力声明、会话加载/恢复、客户端 MCP 传入和取消。协议扩展还涉及 steer、queue、Goal、delegation，但这些不都属于所有 ACP 客户端天然支持的标准能力。[ACP agent 实现](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/src/acp/agent.ts)。

同一测试文件可定位以下场景：持久 Session list/load/resume/close（1368）、按时间重放（1543）、生命周期串行准入（1694）、MCP 替换失败解绑（1985）、迟到权限决策失败关闭（2466）、session/cancel（3269）、stdio MCP（3424）、HTTP/SSE MCP（3467）、fork（3960）、扩展控制（4163）。这是测试源码证据，本次没有执行这些测试。[ACP 测试](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/tui/test/unit/acp-agent.test.ts)。

**官方验收边界。** `docs/verification.md` 记录新版本地门禁结果；`tui-capabilities.md` 明确历史线上验收来自 0.3.11，不能据此宣称 0.4.12 的全部在线服务已重新通过验证，也不能宣称 CraftStation 与其已兼容。[验证记录](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/verification.md)、[能力验收说明](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/tui-capabilities.md)。

**对 CraftStation 的建议。** 如果新增 MiniMax Harness，优先通过 ACP 做薄适配，沿用现有 native Harness 能力状态和验收框架；先验证 new/load/resume/stop、权限与问答、真实 MCP 注入，再考虑专有扩展。源码调研只能支持“接入候选”，不支持直接标记 `SUPPORTED`。

## 8. 两点不应照搬

- ZCode 当前 `compact-active.ts` 仍有 ToolSearch/deferred tools 完成前的临时处理注释：工具过多时压缩请求不带工具。不能把渐进 MCP 暴露归为 ZCode 已验证优势。[对应实现](https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/packages/core/src/runtime/methods/compact-active.ts#L251)。
- MiniMax 的工具子进程通过短期 access-token lease 取得权限，refresh token 和凭据存储归宿主。这是可参考的扩展分发边界，但是否为 CraftStation 的缺口仍需核对本地凭据设计，不能仅因另一项目有这个模块就新增一套。[mcode-tools-host](https://github.com/MiniMax-AI/minimax-code/blob/main/packages/mcode-tools-host/README.md)。

## 调研方法与材料

使用官方 GitHub/raw 文档与源码，按 `research` 和 `repomix-explorer` 技能调研。没有检查 commit SHA，没有安装或启动 ZCode/MiniMax 产品，没有运行上游测试，没有修改 CraftStation 产品代码及已有三份 `research_1.4.0_*.md`。

Repomix 首次全量文本索引：ZCode 6,876 文件，约 11,404,639 token、40,652,421 字符；MiniMax 4,181 文件，约 13,016,309 token、48,427,083 字符。数字包含资源和第三方代码，仅说明检索材料规模，不能用于比较项目代码质量。未将全量内容交给模型通读；随后检索目标路径，提取文件并对目标模块生成压缩索引。

临时材料均位于 `C:/Users/Haona/AppData/Local/Temp/`：`ZCode-analysis.xml`、`minimax-code-analysis.xml`，源码定位副本 `ZCode-research-source/`、`minimax-code-research-source/`，聚焦压缩索引 `ZCode-research-focused.xml`、`minimax-code-research-focused.xml`。它们不属于 Product Git，不接入运行时。文中链接指向当前 `main`，未来上游改动可能使行号移动。
