# v1.4.0 重构研究附录：现有功能与不可丢失契约

配套阅读：[架构与性能研究主文档](research_1.4.0_architecture.md) · [版本演进与 Bug 防御清单](research_1.4.0_history.md)。

研究日期：2026-09-19。研究对象为 Product Git Root `D:/Work/CraftStation` 中版本号 `1.3.4` 的当前源码。本文件只做功能盘点与后续验收指导，不修改产品、不宣布 `1.4.0` 已实现，也不把历史验收当作当前复测结果。

## 阅读与使用规则

- 每行 `F-域-编号` 是可独立追踪的行为；允许以后拆出子 ID，不应因为实现合并就删除 ID。表格中的并列行为需要分别保留断言。
- **S**：读到当前实现与契约；**T**：找到相关测试，但本次没有运行；**H**：历史报告有验收记录，效力只限记录的环境/组合；**P**：规划或未来能力，不能标成当前可用。默认所有表项为 S，测试证据集中在每节前，未逐项证明端到端。
- 入口、异常与降级也是功能。方法、文件夹、数据库表、DTO 可以重组；用户选择、权限边界、原生 Session 身份、持久化数据与错误语义不能被“统一”抹掉。
- 本清单不是封闭世界：实施 Agent 必须追加新发现的 UI、IPC、MCP、remote API、迁移与隐藏行为。后附从源码提取的 IPC / MCP 清单用于防止功能遗漏，不等于每个接口都已真机通过。
- `reference/`、上游宣传、旧 `deepseek-harness/` 和标记 SUPERSEDED 的方案不是当前实现证据。历史计划与源码不一致时，保留差异记录并回溯最新修复，不能直接照旧计划回退。

## 1. Composition、Auto 与 Recipe

证据：[`types.ts`](../../src/shared/crafting/types.ts)、[`crafter.ts`](../../src/shared/crafting/crafter.ts)、[`registry.ts`](../../src/shared/crafting/registry.ts)、[`runtimeInterface.ts`](../../src/shared/crafting/runtimeInterface.ts)、[`autoHarnessResolver.ts`](../../src/shared/autoHarnessResolver.ts)、[`nativeHarness.ts IPC`](../../src/shared/ipc/procedures/nativeHarness.ts)、[`capabilityResolver.ts`](../../src/supervisor/capabilities/capabilityResolver.ts)、[`workbench`](../../src/renderer/components/crafting/workbench/)。T：[`boundaryGuard.test.ts`](../../src/shared/crafting/boundaryGuard.test.ts)、[`accountBoundaryGuard.test.ts`](../../src/shared/crafting/accountBoundaryGuard.test.ts)、[`autoHarnessResolver.test.ts`](../../src/shared/autoHarnessResolver.test.ts)、[`capabilityResolver.test.ts`](../../src/supervisor/capabilities/capabilityResolver.test.ts)。

| ID         | 触发与已有行为                                                            | 边界及不可丢契约                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-CRAFT-01 | Item 的 identity、Metadata、Components、version、vendor/source 与兼容状态 | Model Vendor 与 Harness Vendor 分离；Item 不是 Adapter 的别名；Metadata 不含进程和凭据。                                                            |
| F-CRAFT-02 | Slot 接受 Item、形成 Ingredient，再匹配 Recipe                            | Ingredient 是输入角色；`auto` 是确定性解析模式，不是新的 Model Item。                                                                               |
| F-CRAFT-03 | `resolve -> validate -> compile` 生成 Result Item / CraftPlan             | Crafter 不做 IO、RPC、启动进程；缺 Item、缺绑定、不兼容要可解释失败。                                                                               |
| F-CRAFT-04 | Registry 管 Item、Recipe、runtime binding                                 | 保留稳定 ID、查找/校验能力；不能与 CLI Agent registry 混为一个“供应商列表”。                                                                        |
| F-CRAFT-05 | `NATIVE/SUPPORTED/EXPERIMENTAL/INCOMPATIBLE` 组合预览                     | 只读 preview 不 spawn Entity/Session、不暗换模型；实验状态不等于真实可执行。                                                                        |
| F-CRAFT-06 | Harness control-plane、模型 inventory 与真实机器 readiness                | 未安装、未登录、不可用、能力缺失分别展示；打开/刷新要触发实际检测，不能仅重复读取旧 projection。                                                    |
| F-CRAFT-07 | Auto 依据模型来源、协议、能力、安装环境选择 Harness                       | 家族名称只提供偏好；显式选择不可静默换 Harness。第三方 Gemini 的 OpenAI 协议不能假装 Antigravity 原生。                                             |
| F-CRAFT-08 | 默认 Muse Spark / Meta 走 OpenCode；DeepSeek 走官方 dsh                   | Muse Code 保留为显式 Recipe、Windows 经 WSL；DSH 上游受阻必须报真实原因，不以普通 API 冒充。                                                        |
| F-CRAFT-09 | Model / Harness / 组件管理 inventory 与四格工作台                         | 管理目录保留已安装但未配置的渠道；这不等于聊天 picker 全展示：picker 默认隐藏未配置渠道、当前选中项豁免（见 F-CHAT-02）；功能入口不能只有视觉反馈。 |
| F-CRAFT-10 | Recipe 保存、读取、覆盖前确认、快速列表                                   | 名称、显式选择、引用与 provenance 不能在刷新/重新载入后丢失；不能把保留的 Recipe 变成 Auto。                                                        |
| F-CRAFT-11 | `compositionProvenance` 跟随持久 Thread                                   | recipe/version、ingredient version、runtime binding 可恢复；兼容旧记录缺少新增字段。                                                                |
| F-CRAFT-12 | `craftAgent` 与 `resumeCraftAgent` 运行接口                               | 上层提交计划/工作区/prompt/可选 Session 引用；Entity 与 Session 身份要可追踪，恢复不得偷换 credential source。                                      |
| F-CRAFT-13 | OpenCode route-specific executable readiness                              | providerID/modelID/authRef/profileRef 对应精确组合；没有验证时 fail-closed，不能因某个 provider 可用而放行所有模型。                                |
| F-CRAFT-14 | Auto/Efficient 注入已启用 MCP、技能与平台内建能力                         | 推荐列表是 affinity 信息，不是限制其他 Harness 的白名单；未注入必须有原因。                                                                         |
| F-CRAFT-15 | Creative 显式能力选择及缺省处理                                           | 当前无显式 ID 的 Creative 会映射 Efficient；显式缺失/禁用 ID 必须诊断，不能声称完整自由 Recipe 图已实现。                                           |
| F-CRAFT-16 | Compatibility Bridge 的状态、安装、启动、停止、ensure                     | 独立 Go CLIProxyAPI；readiness 经认证探测；状态 projection 不泄漏 token；读取状态不能启动 sidecar。                                                 |
| F-CRAFT-17 | 兼容链 Model × Harness 明确 routeType/protocol/account                    | native 与 compatibility 可追溯；不把桥接当普遍必经路径；第三方来源保持独立。                                                                        |

## 2. Harness 与协议差异保全

证据：[`registry.ts`](../../src/supervisor/agents/registry.ts)、[`AgentCapability`](../../src/shared/contracts/agent.ts)、[`StructuredSessionHandle/Adapter`](../../src/supervisor/agents/base/types.ts)、[`agents/`](../../src/supervisor/agents/)、[`nativeCodex/`](../../src/supervisor/runtime/nativeCodex/)、[`openCodeNative/`](../../src/supervisor/runtime/openCodeNative/)。各 provider 的 `index.ts`、`detection.ts`、`argv.ts` 与相邻测试是进一步细审入口；下面只列源码支持面，不能推断全部厂商已真实验收。

| ID           | 触发与已有行为                                                                  | 边界及不可丢契约                                                                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F-HARNESS-01 | Codex 官方 app-server/native runtime：JSON-RPC、thread/turn、原生请求与子 Agent | CraftStation-owned runtime 是架构目标；既有 legacy 对照不能在重构中再成为生产 fallback；保留官方 Agent Loop、压缩、MCP、Skills、native Session 语义。                                                                                                                                                        |
| F-HARNESS-02 | Codex 模型目录、reasoning、service tier、context 与权限控制                     | 模型/档位以运行时能力为准；不把 shared 的小枚举当所有 provider 的硬上限；完整保留 native goal、fork/rollback 等已接线能力。                                                                                                                                                                                  |
| F-HARNESS-03 | Claude 的 structured/SDK 与终端运行面、多个 profile                             | profile 隔离、权限问答、计划/思考/工具/subagent 事件；一个坏 profile 不能让整个 registry 崩溃。                                                                                                                                                                                                              |
| F-HARNESS-04 | Cursor GUI SDK 与终端运行面、runtime 安装和 profile                             | SDK worker、Cursor 扩展通知、稀疏 tool payload 补齐；不能统一成普通 ACP 后丢掉 task 元数据。                                                                                                                                                                                                                 |
| F-HARNESS-05 | OpenCode 原生 server/session/event transport 与 provider/model binding          | GUI 与 PTY 的 acquisition/release 不同；保留服务池、原生事件、订阅凭据、第三方配置及 resume。                                                                                                                                                                                                                |
| F-HARNESS-06 | Kimi 原生 CLI/ACP、模型档位、计划与用户问题                                     | API Key/profile OAuth、原生 quota 语义、FS home 特例；402 及明确 usage-limit 的 403 `provider.auth_error` 均可表示配额耗尽，真实 forbidden/401/普通 429 不能误判。证据：[sessionErrors](../../src/supervisor/agents/acp/sessionErrors.ts)、[session.test](../../src/supervisor/agents/acp/session.test.ts)。 |
| F-HARNESS-07 | Grok 原生与兼容路由、登录、模型控制、会话媒体                                   | token refresh/quota 路径、图片/媒体、原生资源；不要把 auth 问题伪装成“暂无回复”。                                                                                                                                                                                                                            |
| F-HARNESS-08 | Gemini ACP/native 能力、Antigravity 官方 agy 载体                               | 两者身份与配置分别保留；模型真实支持的 thought/effort、容量重试噪声过滤、思考收尾必须一致。                                                                                                                                                                                                                  |
| F-HARNESS-09 | DeepSeek 官方 dsh 与独立 DeepSeek API Adapter                                   | 原生 CLI 崩溃/依赖缺失如实报告；strict model binding 不准服务端默认模型静默替代用户模型；API 证据不能替代 dsh 证据。                                                                                                                                                                                         |
| F-HARNESS-10 | Muse MSP/WSL、显式 Recipe、foreign endpoint 兼容路径                            | Windows/WSL 凭据与路径、plan 关闭/跨轮新 ID、输出顺序保持；上游重放排序限制不能靠删工具记录规避。                                                                                                                                                                                                            |
| F-HARNESS-11 | Devin 原生登记、一键安装、ACP、认证、动态模型                                   | 默认隐藏细分模型、显式管理模型、team settings 代理/超时处理、PowerShell 回退；MCP 注入同等覆盖。                                                                                                                                                                                                             |
| F-HARNESS-12 | Qwen Code、Qoder、Copilot、Command Code                                         | 均有实际 registry entry；分别保留各自 detection/argv/auth/model/permission/structured 或 terminal 能力，不能按名统一后假定协议完全相同。                                                                                                                                                                     |
| F-HARNESS-13 | Pi、Factory provider                                                            | 同样属于现存运行面；Pi 的 GUI session 与终端区分、Factory 凭据和更新行为需逐厂商回归。                                                                                                                                                                                                                       |
| F-HARNESS-14 | 用户登记 generic ACP 实例、ACP marketplace 安装/升级/删除                       | 实例 ID 独立；disabled 实例不生成 adapter；重复 kind 拒绝；registry 下载/可执行路径/认证失败可诊断。                                                                                                                                                                                                         |
| F-HARNESS-15 | ACP initialize/probe/new/load 与实时能力更新                                    | auth_required 信号优先于本地文件启发式；动态 model/configOptions/effort 映射不能丢；probe 不应永久阻塞应用。                                                                                                                                                                                                 |
| F-HARNESS-16 | ACP FS、terminal、permission、elicitation、plan 与 subagent 通道                | 工作区外 provider home 白名单、ENOENT 语义、输出截断、安全文件路径；不支持 client FS 的厂商不能硬开。                                                                                                                                                                                                        |
| F-HARNESS-17 | ACP vendor extension 转标准 update、原始错误回调                                | 共享 mapper 保持协议中立，厂商 quirks 保留局部入口；空 end_turn 没活动可能是错误不能当成功。                                                                                                                                                                                                                 |
| F-HARNESS-18 | MCP transport 乐观注入与兼容失败后 retry set                                    | 只在明确协议不兼容时降级指定 transport；不能对所有错误删 MCP 重试而让“已启用”失真。                                                                                                                                                                                                                          |
| F-HARNESS-19 | Native/WSL 探测、CLI 安装、版本探测、更新                                       | PATH 缓存与注册表 PATH 刷新、WSL home 自定义 binary 路径、官方安装器优先；update 成功但版本没变需 fallback 验证。                                                                                                                                                                                            |
| F-HARNESS-20 | 统一 baseSpawnEnv 与 detection-only probeEnv                                    | updater/telemetry opt-out 要覆盖登录/PTY/one-shot/subagent 等；探测临时目录不能泄漏进正常运行；显式升级可以调用 updater。                                                                                                                                                                                    |
| F-HARNESS-21 | Qwen 专属：ACP update bridge、native session UUID、Token Plan 子 provider       | 终端/GUI、agent/plan、resume/one-shot/context extraction 均保留；不同账号来源的模型目录不合并丢失。证据：[index](../../src/supervisor/agents/qwen/index.ts)、[detection](../../src/supervisor/agents/qwen/detection.ts)。                                                                                    |
| F-HARNESS-22 | Qoder 专属：ACP 与终端、模型/permission/plan、resume                            | `session/new` 未登录也可能成功，不能拿该结果当 authenticated；保留凭据 probe 与 prompt 错误边界。证据：[detection](../../src/supervisor/agents/qoder/detection.ts)、[index](../../src/supervisor/agents/qoder/index.ts)。                                                                                    |
| F-HARNESS-23 | Copilot 专属：per-session MCP 文件、agent/plan/autopilot、动态 model/effort     | TUI mode 与 ACP mode 不等价；hook 没有 agentStop，sessionEnd 只表示全 Session 终止；不能用统一 hook 假造每轮终态。证据：[index](../../src/supervisor/agents/copilot/index.ts)、[detection](../../src/supervisor/agents/copilot/detection.ts)。                                                               |
| F-HARNESS-24 | Command Code 专属：structured/terminal、实际 session discovery、精确 resume     | CLI 不预分配/报告 Session ID，要发现真实 ID；one-shot 的 no-session/trust/yolo 与交互路径区别保留。证据：[index](../../src/supervisor/agents/commandcode/index.ts)、[structuredSession.test](../../src/supervisor/agents/commandcode/structuredSession.test.ts)。                                            |
| F-HARNESS-25 | Pi 专属：已安装 CLI 的 `--mode rpc` GUI、终端和 session files                   | 不硬依赖一个替代 SDK；安装环境不支持 GUI 时只展示 terminal；text-only one-shot/resume 保留。证据：[detection](../../src/supervisor/agents/pi/detection.ts)、[rpcSession.test](../../src/supervisor/agents/pi/rpcSession.test.ts)。                                                                           |
| F-HARNESS-26 | Factory 专属：Droid ACP、GUI、原生 subagent transcript 与 HTTP MCP              | probe 未报告 HTTP 能力但 session/new 实际支持的差异需保留适配；402/403 agent_message 错误识别与空结束防假成功。证据：[index](../../src/supervisor/agents/factory/index.ts)、[acpUserVisibleErrors.test](../../src/supervisor/agents/acp/acpUserVisibleErrors.test.ts)。                                      |

## 3. Thread、Session、Turn 与流式生命周期

证据：[`thread.ts`](../../src/shared/contracts/thread.ts)、[`threadSessionManager.ts`](../../src/supervisor/runtime/threadSessionManager.ts)、[`threadSession/`](../../src/supervisor/runtime/threadSession/)、[`sessionHandoff`](../../src/shared/sessionHandoff.ts)、[`coordinator`](../../src/supervisor/sessionHandoff/coordinator.ts)、[`thread IPC`](../../src/shared/ipc/procedures/thread.ts)。T：[`poolFailover`](../../src/supervisor/runtime/threadSessionManager.poolFailover.test.ts)、[`handoff coordinator`](../../src/supervisor/sessionHandoff/coordinator.test.ts)、[`runtimeEventSlice`](../../src/renderer/state/slices/runtimeEventSlice.test.ts)。

| ID           | 触发与已有行为                                                         | 边界及不可丢契约                                                                                                |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| F-SESSION-01 | 新建 Thread，绑定项目/工作区、provider config、展示模式                | 持久 Thread、运行 Entity、原生 Session、单次 turn 各有身份，不能折叠成一个 sessionId。                          |
| F-SESSION-02 | GUI 与 PTY 两种 presentation，并按 provider 记忆选择                   | 能力不支持时说明；PTY 无 structured per-turn 信号，不能虚构同等生命周期。                                       |
| F-SESSION-03 | 首轮、后续轮、结构化 turn 排队                                         | prompt、segments、userMessageItemId、turnId 关联稳定；重复/延迟事件不能重复用户消息。                           |
| F-SESSION-04 | 输入工作中提交为 steer、暂存/替换/清除 pending steer                   | 单槽 replace-latest 不是无限队列；保留附件、skill、diff segment；准备超时仍需可发出。                           |
| F-SESSION-05 | provider 原生 steer 与 interrupt-and-drain 降级                        | idle/needs_reply/error 均可 drain；旧 prepare 回调不能中断已经开始的新 turn；按 session instance 验证。         |
| F-SESSION-06 | 用户 Stop / interrupt、watchdog 强制收尾                               | 用户中断绝不触发自动网络重试；确认取消后才能执行依赖中断的后续行为。                                            |
| F-SESSION-07 | `working/needs_approval/needs_reply/idle/error/finished/inactive` 状态 | 中途等待权限/问题不算 turn 完成；attention 与 status 不等价；错误要保留原因。                                   |
| F-SESSION-08 | structured delta、snapshot、item started/updated/completed 路由        | 不能重复拼接快照与增量；旧 session 事件不得覆盖当前；父子工具关系与原始错误可追溯。                             |
| F-SESSION-09 | 网络/transport 自动重试次数与间隔设置                                  | 有上限；dead transport 重建，普通网络错误可同 handle 重试；capacity/auth/quota 走各自 owner。                   |
| F-SESSION-10 | 重试注入续接说明与 transcript preface                                  | 只进入实际发送 prompt，不污染用户画面的原文；原生 resume 不应重复注入完整历史。                                 |
| F-SESSION-11 | Session 恢复、无效 session 自动重建与上下文提取                        | 原生 session 不可恢复时保留可解释上下文接续；丢失/失效要区别；取消 extract 不影响原会话。                       |
| F-SESSION-12 | 原生 session path 解析、历史会话引用持久化                             | 不同 provider 的原生存储格式不能统一成假路径；Windows/WSL/native profile 分别处理。                             |
| F-SESSION-13 | 运行中换模型/effort/fast/权限配置                                      | 同 Harness 可原位更新能力；不支持时明确重建/交接；失败不能先破坏原 session。                                    |
| F-SESSION-14 | 跨 Harness Session Switch，同一 Thread 分段继续                        | 支持 after-current-turn、abort-current-turn；安全边界外排队；目标未 ready 不切 active。                         |
| F-SESSION-15 | RuntimeSegment、checkpoint、CAS 激活与失败回滚                         | segmentId/runtimeSessionId/bindingEpoch 不匹配拒绝；旧事件隔离；bootstrap 失败恢复 source；目标计划必须可恢复。 |
| F-SESSION-16 | 历史上下文 checkpoint：摘要、状态、决定、结果、近轮、工作区变化        | 字符预算/截断/redaction 显式记录；不把完整秘密或原始 runtime 对象塞到 DTO。                                     |
| F-SESSION-17 | rollback 对话、fork turn 与文件 checkpoint                             | 对话回滚和磁盘恢复是不同动作；失败/不支持要解释；历史 turn anchor 不能漂移。                                    |
| F-SESSION-18 | /goal 持久目标、暂停/继续/停止、native goal 映射                       | 只有显式 /goal 创建/替换；关闭删除 goal；跨恢复/切模型保留；原生 goal 与 fallback owner 分离。                  |
| F-SESSION-19 | 计划步骤卡、状态胶囊、跨轮重开                                         | turn 关闭时撤 dock 但保留真实未完成步骤；不伪造全 completed；复用 ID 的 plan 重开必须有效。                     |
| F-SESSION-20 | Thread 分组/父子、置顶/收藏、已完成/归档/恢复/删除                     | pin 只影响排列不改项目归属；archivedAt 独立，保留 legacy starred 映射。                                         |
| F-SESSION-21 | 活跃/最近轮开始结束时间、耗时与标题生成                                | 等待状态与结束时间不能相互混淆；标题生成失败不能妨碍对话。                                                      |
| F-SESSION-22 | 不活跃线程卸载、进程清理、应用恢复快照                                 | 释放 runtime 不等于删历史；重启恢复需处理旧 pending/working 状态、孤儿进程和订阅。                              |

## 4. Composer、聊天展示、文件媒体与 Side Chat

证据：[`composer/`](../../src/renderer/components/composer/)、[`ThreadView`](../../src/renderer/components/thread/ThreadView.tsx)、[`ChatPane`](../../src/renderer/components/thread/ChatPane/)、[`sideChatActions`](../../src/renderer/actions/sideChatActions.ts)、[`threadAttachments`](../../src/supervisor/runtime/threadAttachments.ts)、[`attachments`](../../src/main/attachments/)。T：[`sideChatActions.test`](../../src/renderer/actions/sideChatActions.test.ts)、[`ItemMarkdown.test`](../../src/renderer/components/thread/ChatPane/parts/items/ItemMarkdown.test.ts)、[`ItemMarkdownInner.test`](../../src/renderer/components/thread/ChatPane/parts/items/ItemMarkdownInner.test.tsx)、[`threadTodoState.test`](../../src/renderer/components/thread/threadTodoState.test.ts)。

| ID        | 触发与已有行为                                                      | 边界及不可丢契约                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-CHAT-01 | 首页/项目/线程 draft、编辑与发送                                    | 草稿按目标隔离；切线程、切模型、发送失败不应把未发送内容清空或错投。                                                                                                                                                                                                                                                                                                  |
| F-CHAT-02 | 模型选择、最近/收藏/顺序、show/hide/custom model                    | provider inventory 保留安装与配置标记，聊天 picker 默认过滤未配置渠道，当前选中项（含 accountId）豁免；locked provider 情况独立处理。显式可见性优先厂商默认隐藏。证据：[buildItems](../../src/renderer/components/common/ProviderModelMenu/parts/buildItems.ts)、[buildItems.test](../../src/renderer/components/common/ProviderModelMenu/parts/buildItems.test.ts)。 |
| F-CHAT-03 | 模型独有 effort、thinking、context size、fast/service tier          | 不支持选项不可残留到启动参数；能力刷新后保持合法选项；不把某个厂商 high 的可用性推广到全部模型。                                                                                                                                                                                                                                                                      |
| F-CHAT-04 | 文件 @mention、技能 /mention、MCP mention、slash commands           | 序列化为类型化 segments；路径/skill source/plugin 来源不丢；普通文本与命令参数区别保留。                                                                                                                                                                                                                                                                              |
| F-CHAT-05 | 文件拖入/选择、粘贴图片、附件删除与预览                             | MIME/path/本地复制/WSL 重写与 native image 支持分别处理；空内容和不存在文件不能静默发送成功。                                                                                                                                                                                                                                                                         |
| F-CHAT-06 | 浏览器选择元素/截图成为 composer 附件                               | selector、sourceUrl、rect、文件路径相关联；取消 picker 不残留附件。                                                                                                                                                                                                                                                                                                   |
| F-CHAT-07 | 本地语音录音、麦克风选择、语言/model/WebGPU 设置                    | 权限拒绝、模型加载、取消、转写失败反馈；懒加载避免拖慢首次启动。                                                                                                                                                                                                                                                                                                      |
| F-CHAT-08 | user/assistant/reasoning/tool/file-change/error/web-search 等可视项 | 不同 item 内容与 lifecycle 保留，工具组和子 Agent不能被统一成不可读文本流。                                                                                                                                                                                                                                                                                           |
| F-CHAT-09 | Markdown、GFM 表格、代码块、高亮、复制                              | 代码内不能做公式/HTML 归一化；不完整流式 fence 与结束后稳定渲染都需要保持。                                                                                                                                                                                                                                                                                           |
| F-CHAT-10 | `$...$`/`$$...$$`/`\(...\)`/`\[...\]` 数学公式                      | `y_{<t}`、`x<y`、entity 解码、remend 防截断；普通转义括号/代码/比较文案不能误判公式。                                                                                                                                                                                                                                                                                 |
| F-CHAT-11 | Mermaid 声明、flowchart/graph fence 别名                            | 仅真正图代码归一化；普通代码语言不改变；失败不能吞正文。                                                                                                                                                                                                                                                                                                              |
| F-CHAT-12 | pseudo-XML 占位符、URL 自动链接、项目绝对/相对路径链接              | sanitizer 不吃 `<name>` 文本；路径行号点击定位；代码和真实链接不得二次破坏。                                                                                                                                                                                                                                                                                          |
| F-CHAT-13 | 本地图片、远程 imageRef、剪贴板、lightbox                           | 远程客户端不能拿主机裸路径直接读；图片 payload 大小与引用投影、失效回退要保留。                                                                                                                                                                                                                                                                                       |
| F-CHAT-14 | PDF、Office 文本、文件 diff 与文件 chip 展示                        | 文件类型入口各自保留；未知/二进制/大文件明确降级；不为简化聊天删预览。                                                                                                                                                                                                                                                                                                |
| F-CHAT-15 | 思考展开/收起、stream viewport 与 turn 末关闭                       | 容量重试/系统信封/后台任务回执不冒充模型正文；不重复贴末次完整快照。                                                                                                                                                                                                                                                                                                  |
| F-CHAT-16 | 长时间线虚拟列表、懒载历史、测量缓存与滚动锚点                      | 正在底部才跟随、阅读历史不被拉走；缩放/字体/图片增高需校正；搜索定位不能跳到错误消息。                                                                                                                                                                                                                                                                                |
| F-CHAT-17 | 聊天搜索、导航轨、返回最新、用户消息操作                            | 折叠与虚拟化后仍能定位、复制、fork；搜索不应纳入隐藏内部信封。                                                                                                                                                                                                                                                                                                        |
| F-CHAT-18 | 权限审批、用户问题、多选/自由文本、结构化 elicitation               | approval/requestId 对准原 native 请求；取消/过期/多问题分步处理；不能用一段文本代替协议响应。                                                                                                                                                                                                                                                                         |
| F-CHAT-19 | 工具输出折叠、命令输出 viewport、diff、web search source            | 输出限额/折叠保留可诊断信息；FileChange 与 CommandExecution 类型语义不合并丢失。                                                                                                                                                                                                                                                                                      |
| F-CHAT-20 | Subagent 活动块/进度、详情 overlay、workflow transcript             | 父子 ID 与 live/history 订阅一致；结束后保持结果，关闭面板只解除订阅不终止任务。                                                                                                                                                                                                                                                                                      |
| F-CHAT-21 | Side Chat：从现有完整上下文派生临时分支                             | memory-only，不入 SQLite/侧栏/全局搜索/相邻线程导航；分支时复制 goal 快照，此后各自独立。                                                                                                                                                                                                                                                                             |
| F-CHAT-22 | Side Chat：并排打开正式线程、临时分支转正式                         | 打开正式线程不复制；临时关闭清行与 runtime；正式侧视图关闭不删原线程；保存后归入父线程组。                                                                                                                                                                                                                                                                            |
| F-CHAT-23 | runtime debug、模型切换标记、segment 标记、错误 dock                | 用户可追溯什么时候换了模型/账号/运行段；日志诊断不输出凭据或完整敏感 prompt。                                                                                                                                                                                                                                                                                         |

## 5. 账户、渠道、配额与第三方认证

证据：[`accounts contract`](../../src/shared/contracts/accounts.ts)、[`accountBinding`](../../src/shared/contracts/accountBinding.ts)、[`AccountStore`](../../src/supervisor/runtime/accountStore.ts)、[`AccountResolver`](../../src/supervisor/runtime/accountResolver.ts)、[`usage IPC`](../../src/shared/ipc/procedures/usage.ts)、[`thirdPartyValidation`](../../src/shared/thirdPartyValidation.ts)、[`thirdPartyRouting`](../../src/shared/thirdPartyRouting.ts)、[`usageLogin`](../../src/main/usageLogin/)、[`agents-usage`](../../packages/agents-usage/)。T：[`poolFailover.test`](../../src/supervisor/runtime/threadSessionManager.poolFailover.test.ts)、[`accountBindingSecretBoundary.test`](../../src/shared/accountBindingSecretBoundary.test.ts)、[`thirdPartyValidation.test`](../../src/shared/thirdPartyValidation.test.ts)。

| ID           | 触发与已有行为                                      | 边界及不可丢契约                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-ACCOUNT-01 | 多账户新增/移除/重命名/启停/排序/选中               | 稳定 accountId 与 provider、native profile 绑定；删除显示行不是泄漏或改写其他账号凭据。                                                                                                                             |
| F-ACCOUNT-02 | priority / round-robin / random 池调度              | 只挑 enabled 且 available/quota-low 且凭据存在的候选；同 turn tried 列表排除已尝试账号。                                                                                                                            |
| F-ACCOUNT-03 | explicit、preferred、legacy selected 与默认池模式   | explicit 绝不静默回退；preferred/selected 不可用可按契约回池；不能将三种语义压成“优先账号”。                                                                                                                        |
| F-ACCOUNT-04 | Session 绑定不可变账号、profile home 隔离           | 之后 UI 切选中账号不改已运行 Session；账号切换以明确新绑定/新 segment 表达。                                                                                                                                        |
| F-ACCOUNT-05 | quota 耗尽同 turn failover、转移上下文              | 仅匹配 pool quota shapes；Kimi 402 或含明确订阅窗口 usage-limit 的 403/Codex usage-limit/Antigravity quota 特判；不能仅凭 `auth_error` 名字拒绝 Kimi 配额切换，也不能把真实 forbidden/401/普通 429/model 错误误切。 |
| F-ACCOUNT-06 | failover 预算、失效绑定、全部池耗尽诊断             | bounded attempts、防循环；告知每账号状态/原因与恢复方向；重启失败不能发成功切换通知。                                                                                                                               |
| F-ACCOUNT-07 | quota 刷新、低额/耗尽/鉴权失效状态及恢复            | 原始 provider 行为与余额窗口区别保留；刷新后可用性不能被 stale 响应覆写。                                                                                                                                           |
| F-ACCOUNT-08 | Codex profile 创建/导入/专属登录                    | 登录写 CraftStation 账户根；宿主 `~/.codex` 登录不能假装隔离 profile 已授权；空 profile 不能当可用。                                                                                                                |
| F-ACCOUNT-09 | Kimi profile 创建/导入/API Key/完成登录             | native home 与 API Key 来源不混；WSL/Windows 的 profile 路径正确传递。                                                                                                                                              |
| F-ACCOUNT-10 | Grok profile 浏览器登录、轮询、完成、取消           | token refresh、原生 quota 与 fallback 来源可诊断；取消不遗留待完成登录。                                                                                                                                            |
| F-ACCOUNT-11 | Antigravity profile 导入与应用到 host 登录          | hosted subscription 与第三方 API 配置分开；用户选择哪个 profile 可见；不误写宿主其他账号。                                                                                                                          |
| F-ACCOUNT-12 | Provider 通用 OAuth/终端登录/API Key/Cookie/确认    | 凭据输入 Modal 首击生效、状态更新可取消；终端 shell 失效有 fallback；不在日志/Renderer DTO 返回 secret。                                                                                                            |
| F-ACCOUNT-13 | Volcengine AK/SK 与 OpenAI-compatible baseURL/key   | 分别校验字段；不能把任意 AK/SK 当 API Key；HTTPS/endpoint/model provenance 可追溯。                                                                                                                                 |
| F-ACCOUNT-14 | 第三方渠道模型列表、单模型验证、能力/协议绑定       | 通过验证的 protocol 才决定 route；有模型名不等于兼容；错误保留 server 响应诊断。                                                                                                                                    |
| F-ACCOUNT-15 | 第三方 session sticky credential source、绕过订阅池 | 新建/恢复/模型切换/failover 都不得落入 subscription pool；不因余额低暗换付费来源。                                                                                                                                  |
| F-ACCOUNT-16 | Provider 用量概览、窗口条/环、余额、estimated cost  | 支持未知/不可查询/过期状态；不把未知显示为 0；金额与 token 不混算；手动/自动刷新频率保留。                                                                                                                          |
| F-ACCOUNT-17 | Token usage 按设备/账号/模型、日期统计与 capability | native local logs 与 provider API 的来源、去重与精度不同；cost 为估算时保持标记。                                                                                                                                   |
| F-ACCOUNT-18 | 停用 provider、侧栏显示/隐藏/顺序/折叠与管理模型    | 控制面显示和执行可用性是不同状态；禁用会影响候选，折叠不能影响 runtime。                                                                                                                                            |
| F-ACCOUNT-19 | HTTP 系统代理、provider 原生配置与 WSL 环境         | Devin team settings/native CLI 等不能遗漏代理；credentials/proxy concern 不渗入 Crafter。                                                                                                                           |
| F-ACCOUNT-20 | 凭据 vault、安全存储与 secret-free projections      | key/token/cookie 不进 CraftPlan、Recipe、日志、远端公开快照；原始 secret 只在执行边界解析。                                                                                                                         |

## 6. Skills、MCP、插件与能力投影

证据：[`MCP contract`](../../src/shared/contracts/mcpServer.ts)、[`SkillsService`](../../src/supervisor/skills/SkillsService.ts)、[`skillPromptInjection`](../../src/supervisor/skills/skillPromptInjection.ts)、[`MCP services`](../../src/supervisor/mcp/)、[`PluginRegistry/Loader`](../../src/supervisor/plugins/)、[`harnessProfiles`](../../src/supervisor/capabilities/harnessProfiles.ts)。T：[`SkillsService.test`](../../src/supervisor/skills/SkillsService.test.ts)、[`skillPromptInjection.test`](../../src/supervisor/skills/skillPromptInjection.test.ts)、[`McpOAuthService.test`](../../src/supervisor/mcp/McpOAuthService.test.ts)、[`plugin conformance`](../../src/supervisor/plugins/conformance.test.ts)。

| ID       | 触发与已有行为                                                                         | 边界及不可丢契约                                                                                             |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| F-CAP-01 | 技能扫描：global/project/provider/plugin scopes                                        | scope/source/path 稳定；同名技能消歧与禁用优先级；不能把上游 skills 文件默认写入产品工作区。                 |
| F-CAP-02 | 技能查看、启停、删除、导入与 marketplace 安装                                          | 删除/安装明确目标；失败可诊断；插件提供技能的归属与生命周期保持。                                            |
| F-CAP-03 | 技能在 slash picker/mention/prompt 的交付                                              | 原生支持交付与 portable prompt fallback 保留；steer 同样注入；仅 UI 看见技能不算执行接收到。                 |
| F-CAP-04 | 自定义 MCP server：stdio/http/sse、args/env/header                                     | secretRef 解析只在 supervisor；不同 runtime 支持矩阵与 WSL 支持检查。                                        |
| F-CAP-05 | 全局/项目 MCP 配置与启停、内建 server/单 tool 开关                                     | launcher 采用有效快照；UI、Agent tools/list 与真实调用一致；不让关闭的工具仍执行。                           |
| F-CAP-06 | 外部 MCP 发现、导入 destination、server 编辑/重载                                      | 导入来源、全局/项目路径、重复 server ID 与 rename 一致；重载失败不宣称新配置生效。                           |
| F-CAP-07 | MCP probe worker、timeout、工具列表与过滤                                              | probe 不阻塞核心 supervisor；server 不可达/协议错误与零工具区别；worker/process 结束清理。                   |
| F-CAP-08 | MCP OAuth begin/wait/status/clear、登录取消                                            | 保存 refresh/auth 状态、过期与取消反馈；跨账号/项目不得混用凭据。                                            |
| F-CAP-09 | 内建 Browser、Chrome、Computer Use、App Controls、Schedule、crossagents、own_subagents | 全部支持的 structured Harness 按同一外围 policy 注入；disabled、不兼容、endpoint 不可用逐一有理由。          |
| F-CAP-10 | Plugin 发现、刷新、详情、marketplace、OAuth 与文件夹入口                               | Plugin 不是 Item 的同义词；其 MCP/Skills/runtime contribution 均需保留；路径 containment、坏 manifest 隔离。 |
| F-CAP-11 | Capability diagnostics 与 runtime 实际 effective launchConfig                          | 禁用、缺失、排除、不兼容、不可用可辨；不能以一个通用 unavailable 掩盖配置错误。                              |
| F-CAP-12 | Built-in 工具 schema、annotations、namespace 与兼容别名                                | readOnly/destructive/idempotent hints 不等于实际权限；rename 必须兼容历史设置与已运行客户端。                |

## 7. Own Subagents、持久 peer 与跨线程协作

证据：[`crossagentMcp/`](../../src/supervisor/crossagentMcp/)、[`thread-messaging/`](../../src/main/thread-messaging/)、[`ThreadCollaborationService`](../../src/main/thread-collaboration/ThreadCollaborationService.ts)、[`threadCollaboration`](../../src/shared/threadCollaboration.ts)、[`crossagentRanking`](../../src/shared/crossagentRanking.ts)。T：[`SubagentRunManager.test`](../../src/supervisor/crossagentMcp/SubagentRunManager.test.ts)、[`SubagentAttemptRunner.test`](../../src/supervisor/crossagentMcp/SubagentAttemptRunner.test.ts)、[`ThreadCollaborationService.test`](../../src/main/thread-collaboration/ThreadCollaborationService.test.ts)。

| ID          | 触发与已有行为                                                                            | 边界及不可丢契约                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-COLLAB-01 | Own Subagents list_agents/get_agent 发现可委派 Agent                                      | 已安装、启用、模型、effort、权限与可用性真实；不可用 provider 不出假可选项。                                                                                                                                     |
| F-COLLAB-02 | 临时 spawn_agent、历史别名 run/spawn_agents/wait_for_agents                               | 独立任务上下文、runId、父项和进度；别名只有实现中保留的才算兼容；不能因目录叫 crossagent 就误删。                                                                                                                |
| F-COLLAB-03 | 临时 run 等待/状态/列表/取消/超时/失败重试                                                | wait timeout 不自动终止任务；取消应清理子进程；父 turn 与子 run 终态不能互相覆写。                                                                                                                               |
| F-COLLAB-04 | 路由偏好/标签/记忆、暂停 provider、隐藏模型、路由顺序                                     | 显式覆盖与学习历史区别；移除覆盖/修改标签可持久化；用户配置不被重新排名吞掉。                                                                                                                                    |
| F-COLLAB-05 | 原生 subagent 与 CraftStation own-subagent 路线                                           | 两套 owner 和能力不可强行压到共同最小集；保留原生优先顺序设置。                                                                                                                                                  |
| F-COLLAB-06 | 持久 crossagents peer：list/status/send/ask/reply/inbox                                   | 以原生地址和长期线程联系；与临时独立委派是不同产品能力，不得以“重复聊天”合掉。                                                                                                                                   |
| F-COLLAB-07 | peer wake/spawn/model switch/stop、地址绑定恢复                                           | thread/native ID 变化后地址正确；不能唤醒错会话；Schedule 自动线程与人工研究 peer 区分。                                                                                                                         |
| F-COLLAB-08 | 对话对象候选、同项目/不同 worktree 提醒                                                   | 拒绝自己、跨项目、无授权 source；同 Model×Harness 仅在可证明原生线程不同才可选。                                                                                                                                 |
| F-COLLAB-09 | Portable context capsule 与摘要/所选消息/近期轮                                           | 上限、redaction、来源类型和截断保持；不复制完整秘密或共享原生 session。                                                                                                                                          |
| F-COLLAB-10 | 同一 conversation link 连续交互、request/reply 锚点                                       | 捕获 delivery baseline 之后完成的 assistant turn；不能把旧回复或工具日志算作这次答案。                                                                                                                           |
| F-COLLAB-11 | 并发 delivery claim、idempotency key、hop/队列约束                                        | 同幂等键不同参数拒绝；不确定已发送的过期 claim 要失败而不是盲目补发；防因果循环。                                                                                                                                |
| F-COLLAB-12 | 发送中断模式、取消等待、timeout 与晚到回复                                                | interrupt 必须确认；取消等待不随意中断目标；超时后合法晚到回复仍可归档。                                                                                                                                         |
| F-COLLAB-13 | ThreadCollaborationService 的 busy/needs_reply 即时 inject 与历史 after-current-turn 命名 | 当前该 service 测试表达普通发送可即时注入 busy 目标，不能只凭旧 mode 名回退；这不自动代表另一条 InterHarnessMessageBus peer 链已满足同契约，后者历史 queued/delivered 的既有失败需复现并裁决，不能写成当前通过。 |
| F-COLLAB-14 | 崩溃恢复未完成 exchange、启动依赖                                                         | 必须先启动 supervisor 再恢复需要 supervisor IPC 的 exchange；不能重现启动 gate 互等死锁。                                                                                                                        |

## 8. 项目、工作区、Git、Worktree 与实验比较

证据：[`Project`](../../src/shared/contracts/project.ts)、[`Git IPC`](../../src/shared/ipc/procedures/git.ts)、[`git services`](../../src/supervisor/git/)、[`Github IPC`](../../src/shared/ipc/procedures/github.ts)、[`experiment`](../../src/shared/contracts/experiment.ts)、[`Git state`](../../src/main/gitState/)、[`experimentJudge`](../../src/supervisor/experimentJudge.ts)。T：[`git.test`](../../src/supervisor/git.test.ts)、[`worktreeService.test`](../../src/supervisor/git/worktreeService.test.ts)、[`copyIgnoredFiles.test`](../../src/supervisor/git/copyIgnoredFiles.test.ts)、[`experimentJudge.test`](../../src/supervisor/experimentJudge.test.ts)、[`github.test`](../../src/supervisor/github.test.ts)。

| ID        | 触发与已有行为                                                            | 边界及不可丢契约                                                                                            |
| --------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| F-WORK-01 | 新建/打开/克隆项目，native/WSL/remote location                            | 文件目录创建与数据库项目登记对应；取消/失败不残留虚假项目；同一路径的规范化与归属稳定。                     |
| F-WORK-02 | Home scope、项目分组 workspace、切换/禁用项目                             | 无归属或 dangling workspace 项目保持可见；线程 projectId 不能随侧栏分组变化。                               |
| F-WORK-03 | 项目图标 auto/lucide/file，浏览候选/显示                                  | file 图标是项目相对路径；不存在文件/远端读取失败应降级，不能影响项目打开。                                  |
| F-WORK-04 | 项目 lastDraftConfig、搜索覆盖、MCP 覆盖、GitHub 账号                     | 项目级 override 与全局默认不同；MCP 按名称大小写不敏感覆盖；不污染其他项目。                                |
| F-WORK-05 | setup/cleanup script、自定义项目 action 与图标                            | 执行时对应工作区/WSL/shell；检测脚本不等于自动运行；失败可诊断不吞用户输出。                                |
| F-WORK-06 | 新 worktree：base branch/ref、新分支、global/project-relative、自定义路径 | 每项目 override，native 与 WSL basePath 语义；路径冲突/无效 ref/被占用分支不能覆盖现有工作树。              |
| F-WORK-07 | worktreeCopyPatterns 复制被忽略文件                                       | pattern 与 gitignore 语义、路径穿越/符号链接/同路径保护；不因为“忽略文件不重要”删此能力。                   |
| F-WORK-08 | worktree 列表、批量状态、owner/source branch、清理/prune/删除             | owner token 验证，禁止误删用户自己的工作树；dirty/占用状态保留确认/拒绝语义。                               |
| F-WORK-09 | status、diff、batch diff、文件内容与项目 snapshot                         | staged/unstaged/untracked/rename/conflict/binary 分别表达；中文路径、NUL parsing、Windows 编码不可退化。    |
| F-WORK-10 | 单文件/all stage、unstage、discard，提交与提交后动作                      | discard 属破坏动作；操作失败不清 staged 状态；提交/commit-push 的用户配置不丢。                             |
| F-WORK-11 | init/add remote/branch create/switch/delete/fetch/pull/rebase/push/sync   | shell 参数数组防注入；分支 checkout 与 worktree owner 约束；远端失败不假成功。                              |
| F-WORK-12 | merge-to-source / pull-from-source、abort/finish merge                    | 冲突现场和用户改动保留；不能为了统一错误处理自动 reset；有明确继续/取消入口。                               |
| F-WORK-13 | AI commit message、thread title、PR summary、冲突解决                     | 可选 provider/model/effort/fast、Git 文案语言、WSL 独立配置；辅助生成失败不阻断人工流程。                   |
| F-WORK-14 | 文件 checkpoint create/finalize/list/restore                              | 对话 turn anchor 与文件快照关联；恢复只触及对应 checkpoint 语义；路径/argv 安全。                           |
| F-WORK-15 | Git watch/project/worktree interests 与读取模型                           | watcher 事件合并、订阅/取消、窗口/远端兴趣隔离；无效缓存不能让界面永久陈旧。                                |
| F-WORK-16 | 项目 relocate                                                             | 工程目录、线程/worktree metadata、remote/native location 同步；部分失败要可恢复，不能只改 UI 文本。         |
| F-WORK-17 | Experiment 2–8 候选模型，同 prompt 独立 worktree 并行                     | 每候选 owner token/branch/base commit 独立；重复候选拒绝；一个失败不抹掉其他候选。                          |
| F-WORK-18 | Experiment 比较 changes/responses、snapshot、AI judge/取消、手动 crown    | 大 diff/response/untracked 限制显式；winner 必属候选，decided 与 crown 一致；过期快照不能覆盖新决定。       |
| F-WORK-19 | 实验候选统计、持久化恢复、清理候选工作树                                  | 远端 ownership 与本地不混；只清自己拥有且明确选择的 worktree；失败后可重进实验。                            |
| F-GH-01   | gh 可用性、账号/仓库列表、按项目账号调用                                  | 未登录与无仓库权限分别反馈；自动发现不能越过项目指定账号。                                                  |
| F-GH-02   | PR 新建/列表/详情/分支关联/draft→ready/close/reopen/merge                 | merge method、base/head、标题正文与权限保持；不将 draft PR 自动发布。                                       |
| F-GH-03   | PR checks、files/diff、review comments、评论/提交 review、更新分支        | 保留逐行评论与未解决 thread 信息；获取失败不能展示“全部通过”。                                              |
| F-GH-04   | PR Watch 自动检查、agent 同步、merge 后标记 thread done                   | blocked reason 与 automation mode 持久；手动/自动完成语义清楚，不能影响别的线程。                           |
| F-GH-05   | GitHub Actions workflow 列表/定义/dispatch/run/job/log/detail             | workflow inputs、分支与账号上下文不丢；rerun/cancel/delete 各自权限与失败反馈；不能因默认快捷键隐藏而删除。 |

## 9. 文件、编辑器、终端、Notes 与搜索

证据：[`projectTree IPC`](../../src/shared/ipc/procedures/projectTree.ts)、[`projectTree`](../../src/supervisor/projectTree.ts)、[`ProjectSearchIndex`](../../src/supervisor/ProjectSearchIndex.ts)、[`LSP`](../../src/supervisor/lsp/)、[`XTermSurface`](../../src/renderer/components/terminal/XTermSurface.tsx)、[`notes contract`](../../src/shared/contracts/notes.ts)、[`NotesPanel`](../../src/renderer/views/MainView/parts/RightPanel/parts/NotesPanel/)、[`terminal MCP instructions`](../../src/main/app-controls/mcp/toolRegistry.ts)。T：[`projectTree.test`](../../src/supervisor/projectTree.test.ts)、[`lsp/index.test`](../../src/supervisor/lsp/index.test.ts)、[`notesActions.test`](../../src/renderer/actions/notesActions.test.ts)。

| ID          | 触发与已有行为                                             | 边界及不可丢契约                                                                                                            |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| F-FILE-01   | 项目树懒展开、文件名搜索、全文搜索与 ignore/exclude        | 全局+项目覆盖、case/path 规范化、WSL/remote；被忽略规则不能简单统一成永远隐藏。                                             |
| F-FILE-02   | 读项目文件/绝对文件/外部文件、写回与编辑器 tabs            | 项目内外读写权限区别；二进制/不存在/超大文件错误透明；不能覆盖未保存用户编辑。                                              |
| F-FILE-03   | 新建文件/目录、重命名、移动、删除、系统打开/reveal         | containment 与同名冲突；失败不更新成已成功树；路径中空格/中文/大小写保持。                                                  |
| F-FILE-04   | Monaco/LSP start/stop/message 与诊断/补全/导航入口         | 项目/server 生命周期与取消；LSP 可关闭；没有 server 时仍可编辑，不能阻塞整个应用。                                          |
| F-FILE-05   | 图片/PDF/Office 文本提取和外部文件预览                     | 按类型路由与可行动错误；外部文档引用不能让任意读文件越权。                                                                  |
| F-TERM-01   | 开工作区 shell、多个 terminal panes 与历史输出             | terminalId 与 agent threadId 分开；native/WSL/cwd 对准当前 exact worktree。                                                 |
| F-TERM-02   | shell 选择、用户参数、internal shell 与 fallback           | pwsh 路径失效回 Windows PowerShell/cmd；用户 shell 与内部命令 shell 配置不混。                                              |
| F-TERM-03   | PTY write/resize、scrollback、ANSI、OSC/link、退出清理     | 尺寸 fallback/上下限、UTF 编码与分片、超长输出；关闭 UI 和停止进程的语义分离。                                              |
| F-TERM-04   | terminal 预热、字体/颜色/滚动、复制与链接打开              | 隐藏/切 tab 不丢输出；缩放后 geometry 正确；链接不应执行危险 URL scheme。                                                   |
| F-TERM-05   | @Terminal 给 Agent 读真实集成终端                          | list_terminals 自动按 caller project/worktree 限定；read_terminal 必须用返回 terminalId，不能读 Agent 自己 TUI 或另一项目。 |
| F-NOTE-01   | 项目 Notes 编辑、保存/恢复                                 | 按 project 持久；并发编辑/加载顺序不覆盖新内容；空笔记合法。                                                                |
| F-NOTE-02   | Notes TODO 创建/编辑/完成/删除/排序                        | TODO 状态不等于 Agent plan；移动端与桌面数据同源；不能把二者合并后丢手写笔记。                                              |
| F-SEARCH-01 | Thread 全局搜索、文件搜索、Git search、App Controls search | 各自范围和 cursor/焦点保持；临时 Side Chat 不进入 durable 搜索；隐藏折叠不等于不可搜。                                      |

## 10. 浏览器、Chrome 与 Computer Use

证据：[`BrowserPanelManager`](../../src/main/browser/BrowserPanelManager.ts)、[`browser IPC`](../../src/shared/ipc/procedures/browser.ts)、[`browser CDP`](../../src/main/browser/cdp/)、[`chromeTools`](../../src/main/browser/external/chromeTools.ts)、[`Computer Use tools`](../../src/main/computer-use/mcp/toolRegistry.ts)、[`drivers`](../../src/main/computer-use/drivers/)。T：[`chromeTools.test`](../../src/main/browser/external/chromeTools.test.ts)、[`ComputerUseMcpIngress.test`](../../src/main/computer-use/ComputerUseMcpIngress.test.ts)、[`windowsRealGui.e2e.test`](../../src/main/computer-use/windowsRealGui.e2e.test.ts)。H：[`report_release_1.0.0`](report_release_1.0.0.md) 记录 Windows 真 GUI；本次没有重跑。

| ID            | 触发与已有行为                                                         | 边界及不可丢契约                                                                                 |
| ------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| F-BROWSER-01  | 内置多 tab、新建/关闭/激活/重排、前进后退/刷新/hard reload             | 活动 tab 状态稳定；打开窗口/内嵌 panel 两种展示与配置保留。                                      |
| F-BROWSER-02  | tab group、rename/color/collapse/ungroup/close group/new tab           | threadId 关联、分组显示状态与实际 tab 生命周期分开；关闭组不能误操作其他线程页面。               |
| F-BROWSER-03  | 地址建议、历史/书签/书签栏、清理历史/cookie/cache                      | 各自数据生命周期保留；清理 cookie 是显式动作不连带账号 vault。                                   |
| F-BROWSER-04  | DevTools、截屏复制、preview、extract window/reinject                   | webContents 转移后 browser state 一致；窗口关闭/主窗重建时 listener 清理。                       |
| F-BROWSER-05  | DOM query/snapshot/inspect/find/get/is、wait_for/URL/text/JS           | CSS/@ref、frame、元素不存在/超时与陈旧引用可诊断；不以 sleep 代替所有等待语义。                  |
| F-BROWSER-06  | click/dblclick/focus/type/fill/check/uncheck/select/hover/press/scroll | type 追加与 fill 覆盖区别；页面动作失败保留原因；不跨 tab 跑错动作。                             |
| F-BROWSER-07  | console/network/dialog/frames、eval/addscript/addstyle                 | eval/data access 设置分别生效；权限关闭时 fail-closed；完整访问能力不能简单删掉以“安全统一”。    |
| F-BROWSER-08  | cookies/storage、登录捕获与隔离 partition                              | 仅按配置权限使用；应用登录捕获与普通浏览 context 区分，避免账号串用。                            |
| F-BROWSER-09  | picker 选元素/region/cancel 与 thread 附件                             | coordinate/DPR 与截图一致；跨窗口和移动镜像不能用错坐标。                                        |
| F-CHROME-01   | 外部真实 Chrome bridge/status/enable/disable/list/open/attach          | 与内置 browser 是两个真实功能，不是重复 UI；没有扩展/桥接有可行动错误。                          |
| F-CHROME-02   | Chrome 导航/读取/DOM/ref/截图/点击/输入/等待                           | attachment tab 绑定正确；新建 workspace tab 与复用现有 tab 分别支持；stale connection 不假成功。 |
| F-CHROME-03   | Chrome eval 与 cookie 访问                                             | 沿用明确开关；不能因 browser driver 合并而解除外部浏览器权限边界。                               |
| F-COMPUTER-01 | api/enable/disable、list_apps/list_windows、launch/activate window     | Host 能力、desktop 解锁与平台支持真实反映；Windows/macOS driver 存在不等于两者都已真实验收。     |
| F-COMPUTER-02 | get_window/get_window_state 包含可操作窗口/截图状态                    | handle/屏幕/DPI/坐标一致；不可见/最小化/失效窗口有诊断。                                         |
| F-COMPUTER-03 | click、press_key、type_text、scroll、drag 与 pointer motion            | 前台 window/键盘修饰键/鼠标释放；取消/异常必须 cleanup，不能遗留按键按下状态。                   |
| F-COMPUTER-04 | 操作 overlay 与交互能力识别                                            | read-only 获取状态与真实输入分别管控；overlay 不截获自己的交互；平台缺能力不做假调用。           |

## 11. Schedule 与 App Controls

证据：[`Schedule contract`](../../src/shared/contracts/schedule.ts)、[`ScheduleService`](../../src/main/schedules/ScheduleService.ts)、[`ScheduleRunCoordinator`](../../src/main/schedules/ScheduleRunCoordinator.ts)、[`ScheduleExecutionResolver`](../../src/main/schedules/ScheduleExecutionResolver.ts)、[`App Controls`](../../src/main/app-controls/mcp/toolRegistry.ts)。T：上述类对应 `.test.ts`，以及 [`Schedule tools`](../../src/main/schedules/mcp/toolRegistry.test.ts)、[`SchedulesView`](../../src/renderer/views/SchedulesView/SchedulesView.test.tsx)。

| ID           | 触发与已有行为                                                | 边界及不可丢契约                                                                                           |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| F-SCHED-01   | Schedule 创建/读取/编辑/删除、暂停/恢复、立即执行             | GUI 与 MCP 共用 host capability；不是仅在 renderer 存活时运行。                                            |
| F-SCHED-02   | hourly/weekly/once/interval、IANA timezone 与 next occurrence | 每 1–1440 分钟原生 interval，不能退回自我链式 once 任务；时区无效拒绝、DST/重启补偿保持。                  |
| F-SCHED-03   | Recipe/model/harness 配置与运行时解析                         | 只存 secret-free 引用，不存进程/原生 session 对象；指定项目缺失就失败，不暗换 Home。                       |
| F-SCHED-04   | existing thread 绑定执行为原线程 follow-up                    | 缺失/归档/done/busy/发送失败明确失败，绝不悄悄新建“幽灵线程”；旧注释中 fallback 说明不应胜过现有严格实现。 |
| F-SCHED-05   | new thread 每次创建真实 GUI Thread，命名与 scheduleOrigin     | 先落库再镜像再启动；可无窗口运行；自动线程不混入研究 peer 候选。                                           |
| F-SCHED-06   | run history、成功/失败/interrupted、terminal result           | needs_approval/needs_reply 是中间暂停，不能提前 settle；摘要和实际结束线程关联正确。                       |
| F-SCHED-07   | occurrence claim、host provenance、重启恢复与清理             | 同一次触发不重复执行；desktop/headless/remote 不各自跑一份；原生地址绑定失败不掩盖运行结果。               |
| F-CONTROL-01 | Agent 读当前/其他 thread、创建/发送/更新/打开/等待/中断/停止  | caller identity 与授权源可追溯；不能 stop/interrupt/wait 自己；用户重要操作保留授权规则。                  |
| F-CONTROL-02 | Agent 读写项目/设置、用量、搜索、通知、检查更新               | settings 只允许可更新白名单与脱敏 projection；MCP 配置走专门工具，不能经 update_settings 绕过。            |
| F-CONTROL-03 | Agent 文件/Git/PR/worktree/MCP/skill 操作工具                 | 与 GUI 使用同样 scope/数据契约/保护；不是另一套弱校验实现；全部工具名见附录。                              |

## 12. Remote、Mobile、SSH 与 headless

证据：[`RemoteAccessServer`](../../src/main/remote/RemoteAccessServer.ts)、[`RemoteAuthStore`](../../src/main/remote/auth.ts)、[`security`](../../src/main/remote/server/security.ts)、[`remote protocol`](../../src/shared/remote/)、[`mobile`](../../src/mobile/)、[`SshConnectionManager`](../../src/main/ssh/SshConnectionManager.ts)、[`headless host`](../../src/server/createHeadlessRemoteHost.ts)、[`relay`](../../src/server/relay/)。T：[`remoteProtocol.perf.test`](../../src/mobile/remoteProtocol.perf.test.ts)、[`headless test`](../../src/server/createHeadlessRemoteHost.test.ts)、[`relayServer.test`](../../src/server/relay/relayServer.test.ts)、各 remote/mobile 相邻测试。存在 iOS/Android build 脚本不等于本次已真机验证。

| ID          | 触发与已有行为                                                     | 边界及不可丢契约                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-REMOTE-01 | 开启/关闭远程访问、配对码/链接刷新、设备会话撤销                   | 默认开关与有效期、一次性 pairing credential；撤销后 HTTP/WS 访问失效；服务端 access-session 持久化 token hash，客户端确实持有 bearer（包括 renderer localStorage），不能把“hash-only”推广到全系统。证据：[REMOTE_ARCHITECTURE](../../docs/REMOTE_ARCHITECTURE.md)。 |
| F-REMOTE-02 | Bearer scopes、WS ticket、过期/一次性消费与 CORS                   | 浏览器来源与原生 WebView 来源区分；不能因为 UI 统一删服务端 scope；null/untrusted origin 被拒绝。                                                                                                                                                                   |
| F-REMOTE-03 | 每客户端 token exchange 限流、可信 loopback forwarding             | relay 后实际访客归属，LAN 不信任伪造 forwarded header；代理缺头能降级不崩。                                                                                                                                                                                         |
| F-REMOTE-04 | desktop/headless server、LAN/Tailscale HTTPS/advertised URL        | HTTPS/可达性/端口冲突可诊断；headless 无 Electron window 仍能 runtime/DB/schedule。                                                                                                                                                                                 |
| F-REMOTE-05 | SSH config host 发现、connect/disconnect、部署 runtime/端口 tunnel | 同 host 连接去重；远端依赖/native bundle/安装路径/配对 credential；失败回收子进程。                                                                                                                                                                                 |
| F-REMOTE-06 | relay host/server、远端重连、主机更新后恢复                        | stable host identity、backoff、不可达/升级状态；不能错误绑定旧配对 host。                                                                                                                                                                                           |
| F-REMOTE-07 | 远端 project/thread 镜像、remoteId/remoteServerId 映射             | 远端行是 server-owned；不能写进本地错误项目、ID 冲突或误删除服务器真实线程。                                                                                                                                                                                        |
| F-REMOTE-08 | 远程命令幂等回执与无 renderer 路径                                 | HTTP retry 不重复启动 turn/项目；main 持久化是稳定来源，窗口未打开不等于请求丢失。                                                                                                                                                                                  |
| F-REMOTE-09 | WS event 压缩/大小守卫/兴趣过滤/慢客户端/backpressure              | 不丢终态/错误/身份；超大媒体引用化；断线补快照与序列追踪，不能靠截断正文优化。                                                                                                                                                                                      |
| F-REMOTE-10 | 远程终端 feed、只订阅关注 terminal、scrollback                     | thread 与 terminal 分离；读历史与 live 拼接去重；取消订阅清理内存。                                                                                                                                                                                                 |
| F-REMOTE-11 | Git summaries/read-model 兴趣、remote project commands             | 一个 client 的兴趣不能关闭另一个订阅；server snapshot 与 live change 顺序稳定。                                                                                                                                                                                     |
| F-REMOTE-12 | Remote browser mirror、截图/imageRef 与 port forwarding            | 只代理允许的 loopback target；主机文件不能任意暴露；截图/点击坐标一致。                                                                                                                                                                                             |
| F-REMOTE-13 | 移动导航、浮动 composer、软键盘/焦点/滚动锁、sheet                 | Android/iOS/浏览器差异保留；输入中文/粘贴/长文/旋转/返回不丢草稿。                                                                                                                                                                                                  |
| F-REMOTE-14 | 移动聊天、文件、Git、Notes、Schedule、桌面 panel 投影              | 通过共享契约保持能力；desktop-only 入口明确不可用，不能放空按钮；远端数据更新一致。                                                                                                                                                                                 |
| F-REMOTE-15 | 推送注册、任务完成/attention 通知、redactContent                   | 设备去重、token 撤销、隐私开关；推送失败不使任务失败。                                                                                                                                                                                                              |
| F-REMOTE-16 | native Live Activities/设备状态相关支持                            | 仓库含设计与 native 集成，需按实际接线和平台验证；不能仅凭设计文档宣称跨平台均可用。                                                                                                                                                                                |

## 13. 持久化、迁移、设置、诊断与分发

证据：[`DB migrations`](../../src/main/db/migrations.ts)、[`runtimeItems`](../../src/main/db/runtimeItems.ts)、[`dbStorage`](../../src/renderer/state/dbStorage.ts)、[`shared settings`](../../src/shared/settings.ts)、[`SettingsOverlay`](../../src/renderer/views/SettingsOverlay/)、[`autoUpdater`](../../src/main/updates/autoUpdater.ts)、[`package.json`](../../package.json)。T：[`migrations.test`](../../src/main/db/migrations.test.ts)、[`settings.test`](../../src/shared/settings.test.ts)、[`archiveRetention.test`](../../src/shared/archiveRetention.test.ts)、[`autoUpdater.test`](../../src/main/updates/autoUpdater.test.ts)、[`privacy`](../../src/shared/diagnostics/sentryPrivacy.test.ts)。

| ID           | 触发与已有行为                                                      | 边界及不可丢契约                                                                                                                                          |
| ------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-DATA-01    | SQLite 项目/线程/配置/notes/runtime/turn/usage 存储                 | 事务边界、顺序、ID 稳定；无 UI 时主进程写入不能被旧 renderer snapshot 覆盖。                                                                              |
| F-DATA-02    | Runtime items 增量写、批量替换/截断、completed turns 原子快照       | timeline parent/child 与锚点一起恢复；replace 不应移除只存在主进程的新事件。                                                                              |
| F-DATA-03    | 历史分页按可视 timeline entry 而非纯数据库行                        | 隐藏 reasoning/子项/工具组不能让一页变成空白；cursor 稳定、hasMore 真实。                                                                                 |
| F-DATA-04    | 大 command/file-change 输出压缩与兼容读取                           | 明确可诊断截断/存储限制；消息正文/原始功能不因性能治理丢失。                                                                                              |
| F-DATA-05    | append-only schema migrations                                       | 不能重排/复用版本；empty model 修复、contextSize suffix、account binding、segment、collaboration、native session history、goal、schedule claim 均须保留。 |
| F-DATA-06    | JSON 设置 normalize/default、legacy 字段迁移                        | 单字段错误不抹全部配置；crossagents→own_subagents、旧 Qwen model 等迁移是业务防线。                                                                       |
| F-DATA-07    | 归档保留期/完成后自动归档与清理                                     | 依据 archivedAt 而非 updatedAt；旧 archived 行回填；pin/archive/done 三种状态独立。                                                                       |
| F-DATA-08    | Atomic file、secret store、profile/userData 路径                    | portable exe 与用户数据分离；写失败/损坏文件可恢复；WSL/native profile 不串。                                                                             |
| F-SET-01     | light/dark/system、theme preset、半透明/玻璃色、zoom/font           | 全局语义色和浅色覆盖用量/顶栏/侧栏/模型管理；字体缩放需同步虚拟测量。                                                                                     |
| F-SET-02     | locale/system、中文/英文 UI、chat/global prompt、Git 文案语言       | 系统和用户语言设置优先级保留；内部提示不要可见污染用户消息。                                                                                              |
| F-SET-03     | 通知启停/声音/filter/status、CLI L2 通知、remote push               | done/needsAttention/error 各别控制；点击通知定位正确线程，不能跨 project。                                                                                |
| F-SET-04     | keybindings 编辑、全局快捷键暂停、顶栏/侧栏快捷入口顺序             | 拖动/重排/隐藏不删功能；冲突/无效 keybinding 有诊断；输入表单不被全局快捷键误截。                                                                         |
| F-SET-05     | launch at startup/start minimized/close to tray/prevent sleep       | while-working/while-remote-access/always 分别解释；退出必须释放 power blocker/进程/监听。                                                                 |
| F-SET-06     | 搜索设置、Agent 设置、AI 辅助 provider、浏览器/音频/开发/关于       | 设置搜索 registry 与实际页面一致；未配置设置不造成死路；可迁移旧 settings。                                                                               |
| F-SET-07     | Profile identity/devices/activity/model/plugin/token usage 分享图   | 主机账号与 app profile identity 分开；分享内容按实际统计，不能泄漏凭据。                                                                                  |
| F-OBS-01     | phase/operation/status/object IDs/code/cause/remediation 日志       | 隔离预期错误与程序缺陷；不把所有 catch 改吞错；敏感 prompt/key/token/cookie 不记录。                                                                      |
| F-OBS-02     | Sentry/privacy/analytics、renderer crash/startup recovery           | 日志可关闭/脱敏；telemetry 失败不拖死启动；错误风暴与 dev orphan watchdog 保留。                                                                          |
| F-OBS-03     | Supervisor bootstrap、IPC schema/routing/failure/reconnect          | 不让恢复逻辑 await 尚未放行的 startedGate；requestId/correlationId 贯通，坏 payload 在边界拒绝。                                                          |
| F-RELEASE-01 | 应用更新检查、下载状态、错误/超时、portable 行为                    | updater source 是本产品；8s 检查超时及 portable 打开 Releases 不自覆盖；应用更新与 CLI 更新不能混。                                                       |
| F-RELEASE-02 | CLI update menu、版本检查/升级后状态重读                            | trigger 只开菜单，更新恰好执行一次；稳定数组身份防 popover 闪退；安装/升级失败可重试。                                                                    |
| F-RELEASE-03 | Windows x64 NSIS + portable、latest.yml/blockmap、数据不随 exe 删除 | 双包构建/官方更新 feed/历史数据路径兼容；旧包清理规则不删除安装包更新资产。                                                                               |
| F-RELEASE-04 | in-app + website changelog、中英发行说明、首次加载/恢复页面         | 版本/下载/帮助入口一致；不能为了缩短启动删除必要恢复界面。                                                                                                |

## 14. 证据等级、已知限制与进一步核验

1. 以上功能行是 **源码保全清单**，不是本次验收报告。本次没有启动 Electron、调用模型、登录 OAuth、运行测试或改动用户数据。相邻单测能证明某些行为设计成可测试；不能据此填“真机 PASS”。
2. 当前同时存在 crafted-native、generic structured、PTY、SDK、ACP、native CLI、兼容 bridge 等执行面。目录重叠不能推出“其中一份是垃圾代码”；实施需用实际调用图与路由测试判定可删除的实现，同时保留对应功能 ID。
3. 历史 `report_release_1.0.0.md` 记录其当时全量测试与 Windows Computer Use；后续 `PROJECT_STATUS.md` 又记录特定批次既有失败及外部阻塞。两者并不矛盾，**不得把 1.0.0 全绿数字当 1.3.4 基线**。
4. DeepSeek dsh、某些 CPA 授权、Muse 原生流排序等历史有环境/上游约束，当前是否仍受阻必须实际验证。缺凭据时标 BLOCKED 并保留测试，不能删功能、切普通 API 或编造 PASS。
5. Schedule `sendFollowUp` 早期字段注释仍写 fallback，新段落与当前测试强调 existing thread strict failure；跨线程 `after-current-turn` 名称也不能替代当前 immediate injection 实现证据。这两类冲突值得在重构时澄清契约和注释，不要回退历史修复。
6. 全部 provider 的模型/effort/权限/transport/resume 真值应在实施时导出能力快照并逐厂商对照。本报告没有穷举动态模型 ID，它们由运行时目录变化，不能固化成封闭模型名单。
7. **P 范围**：Auto-Crafting、Model Fingerprint、Active Probing、Compatibility Prediction、Learned Routing、完整 Recipe Graph 等长期研究能力，除非当前源码已明确接线并有证据，不能标成已有功能，也不能作为“统一架构必须完成”的额外门槛。
8. 每个 ID 后续建议追加 `旧路径/新路径/状态/测试入口/实际结果/失败原因/历史 Bug ID`。对行为有争议时记录具体输入输出与用户意图；允许新的模块方案，不允许通过修改测试期望掩盖功能缩减。

## 15. 接口逐项保全索引（由当前源码提取）

这些索引是上述业务行的补充证据，不另算独立业务功能。每个 `I-*` / `M-*` 都必须在重构映射表中找到去向；允许内部改名/合并，但现有客户端与调用方要有兼容迁移。每个 IPC 都应检查合法输入、schema 非法输入、目标缺失、错误传播、取消/超时以及适用的权限/幂等/陈旧对象处理；每个 MCP 工具还需检查工具开关、caller identity、可见 scope 和实际副作用。

### 15.1 IPC procedure 清单

**app** — [app.ts](../../src/shared/ipc/procedures/app.ts)

| 保全 ID                              | 已注册入口                       |
| ------------------------------------ | -------------------------------- |
| I-app-remoteHttpRequest              | `remoteHttpRequest`              |
| I-app-pickFolder                     | `pickFolder`                     |
| I-app-pickFiles                      | `pickFiles`                      |
| I-app-detectProjectIcon              | `detectProjectIcon`              |
| I-app-listProjectIconFiles           | `listProjectIconFiles`           |
| I-app-saveClipboardImage             | `saveClipboardImage`             |
| I-app-saveHandoffContext             | `saveHandoffContext`             |
| I-app-saveImageFile                  | `saveImageFile`                  |
| I-app-copyImageToClipboard           | `copyImageToClipboard`           |
| I-app-readLocalImageFile             | `readLocalImageFile`             |
| I-app-createProjectDirectory         | `createProjectDirectory`         |
| I-app-listWslDistros                 | `listWslDistros`                 |
| I-app-openExternal                   | `openExternal`                   |
| I-app-openExternalNative             | `openExternalNative`             |
| I-app-openMicrophoneSettings         | `openMicrophoneSettings`         |
| I-app-focusWindow                    | `focusWindow`                    |
| I-app-showNotification               | `showNotification`               |
| I-app-relaunchApp                    | `relaunchApp`                    |
| I-app-getHomeScopeLocation           | `getHomeScopeLocation`           |
| I-app-getKeybindings                 | `getKeybindings`                 |
| I-app-setKeybindings                 | `setKeybindings`                 |
| I-app-setGlobalShortcutsSuspended    | `setGlobalShortcutsSuspended`    |
| I-app-getRemoteAccessPairing         | `getRemoteAccessPairing`         |
| I-app-refreshRemoteAccessPairing     | `refreshRemoteAccessPairing`     |
| I-app-setRemoteAccessEnabled         | `setRemoteAccessEnabled`         |
| I-app-revokeRemoteAccessSession      | `revokeRemoteAccessSession`      |
| I-app-getRemoteAccessTailscaleStatus | `getRemoteAccessTailscaleStatus` |
| I-app-setRemoteAccessTailscaleHttps  | `setRemoteAccessTailscaleHttps`  |
| I-app-startTailscale                 | `startTailscale`                 |
| I-app-setRemoteAccessAdvertisedUrl   | `setRemoteAccessAdvertisedUrl`   |
| I-app-publishRemoteGitSummaries      | `publishRemoteGitSummaries`      |

**browser** — [browser.ts](../../src/shared/ipc/procedures/browser.ts)

| 保全 ID                                | 已注册入口                     |
| -------------------------------------- | ------------------------------ |
| I-browser-browserGetState              | `browserGetState`              |
| I-browser-browserCreateTab             | `browserCreateTab`             |
| I-browser-browserCloseTab              | `browserCloseTab`              |
| I-browser-browserActivateTab           | `browserActivateTab`           |
| I-browser-browserMoveTab               | `browserMoveTab`               |
| I-browser-browserSetGroupCollapsed     | `browserSetGroupCollapsed`     |
| I-browser-browserUngroupGroup          | `browserUngroupGroup`          |
| I-browser-browserCloseGroup            | `browserCloseGroup`            |
| I-browser-browserNewTabInGroup         | `browserNewTabInGroup`         |
| I-browser-browserRenameGroup           | `browserRenameGroup`           |
| I-browser-browserSetGroupColor         | `browserSetGroupColor`         |
| I-browser-browserNavigate              | `browserNavigate`              |
| I-browser-browserBack                  | `browserBack`                  |
| I-browser-browserForward               | `browserForward`               |
| I-browser-browserReload                | `browserReload`                |
| I-browser-browserHardReload            | `browserHardReload`            |
| I-browser-browserToggleDevTools        | `browserToggleDevTools`        |
| I-browser-browserClearHistory          | `browserClearHistory`          |
| I-browser-browserClearCookies          | `browserClearCookies`          |
| I-browser-browserClearCache            | `browserClearCache`            |
| I-browser-browserCopyScreenshot        | `browserCopyScreenshot`        |
| I-browser-browserCapturePreview        | `browserCapturePreview`        |
| I-browser-browserAttachWebContents     | `browserAttachWebContents`     |
| I-browser-browserStartPicker           | `browserStartPicker`           |
| I-browser-browserCancelPicker          | `browserCancelPicker`          |
| I-browser-browserSuggest               | `browserSuggest`               |
| I-browser-browserAddBookmark           | `browserAddBookmark`           |
| I-browser-browserRemoveBookmark        | `browserRemoveBookmark`        |
| I-browser-browserSetBookmarkBarVisible | `browserSetBookmarkBarVisible` |
| I-browser-browserRecentHistory         | `browserRecentHistory`         |
| I-browser-browserExtractToWindow       | `browserExtractToWindow`       |
| I-browser-browserInjectToMain          | `browserInjectToMain`          |

**collaboration** — [collaboration.ts](../../src/shared/ipc/procedures/collaboration.ts)

| 保全 ID                                        | 已注册入口                       |
| ---------------------------------------------- | -------------------------------- |
| I-collaboration-listThreadCollaborationTargets | `listThreadCollaborationTargets` |
| I-collaboration-requestThreadDialogue          | `requestThreadDialogue`          |
| I-collaboration-listThreadExchanges            | `listThreadExchanges`            |
| I-collaboration-readThreadExchange             | `readThreadExchange`             |
| I-collaboration-waitForThreadExchange          | `waitForThreadExchange`          |
| I-collaboration-cancelThreadExchange           | `cancelThreadExchange`           |

**db** — [db.ts](../../src/shared/ipc/procedures/db.ts)

| 保全 ID                             | 已注册入口                       |
| ----------------------------------- | -------------------------------- |
| I-db-dbGetProjects                  | `dbGetProjects`                  |
| I-db-dbGetThreads                   | `dbGetThreads`                   |
| I-db-dbGetState                     | `dbGetState`                     |
| I-db-dbSetState                     | `dbSetState`                     |
| I-db-dbUpsertProject                | `dbUpsertProject`                |
| I-db-dbUpsertThread                 | `dbUpsertThread`                 |
| I-db-dbDeleteThread                 | `dbDeleteThread`                 |
| I-db-dbDeleteProject                | `dbDeleteProject`                |
| I-db-dbSyncAll                      | `dbSyncAll`                      |
| I-db-dbPersistExperimentState       | `dbPersistExperimentState`       |
| I-db-dbGetThreadRuntimeItems        | `dbGetThreadRuntimeItems`        |
| I-db-dbGetThreadRuntimeItemsPage    | `dbGetThreadRuntimeItemsPage`    |
| I-db-dbTruncateThreadRuntimeAfter   | `dbTruncateThreadRuntimeAfter`   |
| I-db-dbReplaceThreadRuntimeItems    | `dbReplaceThreadRuntimeItems`    |
| I-db-dbGetThreadCompletedTurns      | `dbGetThreadCompletedTurns`      |
| I-db-dbReplaceThreadCompletedTurns  | `dbReplaceThreadCompletedTurns`  |
| I-db-dbReplaceThreadRuntimeSnapshot | `dbReplaceThreadRuntimeSnapshot` |
| I-db-dbGetThreadContextUsage        | `dbGetThreadContextUsage`        |
| I-db-dbInsertThreadNativeSession    | `dbInsertThreadNativeSession`    |
| I-db-dbListThreadNativeSessions     | `dbListThreadNativeSessions`     |
| I-db-dbGetProjectNotes              | `dbGetProjectNotes`              |
| I-db-dbSetProjectNotes              | `dbSetProjectNotes`              |

**experiment** — [experiment.ts](../../src/shared/ipc/procedures/experiment.ts)

| 保全 ID                                  | 已注册入口                    |
| ---------------------------------------- | ----------------------------- |
| I-experiment-createExperimentWorktrees   | `createExperimentWorktrees`   |
| I-experiment-removeExperimentWorktrees   | `removeExperimentWorktrees`   |
| I-experiment-captureExperimentSnapshot   | `captureExperimentSnapshot`   |
| I-experiment-judgeExperimentSnapshot     | `judgeExperimentSnapshot`     |
| I-experiment-getExperimentCandidateStats | `getExperimentCandidateStats` |
| I-experiment-cancelJudgeExperiment       | `cancelJudgeExperiment`       |

**git** — [git.ts](../../src/shared/ipc/procedures/git.ts)

| 保全 ID                          | 已注册入口                   |
| -------------------------------- | ---------------------------- |
| I-git-createFileCheckpoint       | `createFileCheckpoint`       |
| I-git-finalizeFileCheckpoint     | `finalizeFileCheckpoint`     |
| I-git-listFileCheckpoints        | `listFileCheckpoints`        |
| I-git-restoreFileCheckpoint      | `restoreFileCheckpoint`      |
| I-git-getGitStatus               | `getGitStatus`               |
| I-git-getGitDiff                 | `getGitDiff`                 |
| I-git-getGitDiffBatch            | `getGitDiffBatch`            |
| I-git-getGitFileContent          | `getGitFileContent`          |
| I-git-gitStage                   | `gitStage`                   |
| I-git-gitUnstage                 | `gitUnstage`                 |
| I-git-gitRevert                  | `gitRevert`                  |
| I-git-gitStageAll                | `gitStageAll`                |
| I-git-gitUnstageAll              | `gitUnstageAll`              |
| I-git-gitRevertAll               | `gitRevertAll`               |
| I-git-gitCommit                  | `gitCommit`                  |
| I-git-gitInit                    | `gitInit`                    |
| I-git-gitDescribe                | `gitDescribe`                |
| I-git-gitAddRemote               | `gitAddRemote`               |
| I-git-generateCommitMessage      | `generateCommitMessage`      |
| I-git-generateTitle              | `generateTitle`              |
| I-git-generatePrSummary          | `generatePrSummary`          |
| I-git-gitListBranches            | `gitListBranches`            |
| I-git-gitFetch                   | `gitFetch`                   |
| I-git-gitListWorktrees           | `gitListWorktrees`           |
| I-git-gitAddWorktree             | `gitAddWorktree`             |
| I-git-gitRemoveWorktree          | `gitRemoveWorktree`          |
| I-git-gitPruneWorktrees          | `gitPruneWorktrees`          |
| I-git-gitDeleteBranch            | `gitDeleteBranch`            |
| I-git-gitSwitchBranch            | `gitSwitchBranch`            |
| I-git-gitPull                    | `gitPull`                    |
| I-git-gitPullRebase              | `gitPullRebase`              |
| I-git-gitPush                    | `gitPush`                    |
| I-git-gitSync                    | `gitSync`                    |
| I-git-gitSyncRebase              | `gitSyncRebase`              |
| I-git-gitProjectSnapshot         | `gitProjectSnapshot`         |
| I-git-gitWorktreeStatusBatch     | `gitWorktreeStatusBatch`     |
| I-git-gitGetWorktreeSourceBranch | `gitGetWorktreeSourceBranch` |
| I-git-gitGetWorktreeOwner        | `gitGetWorktreeOwner`        |
| I-git-gitMergeToSource           | `gitMergeToSource`           |
| I-git-gitPullFromSource          | `gitPullFromSource`          |
| I-git-gitAbortMerge              | `gitAbortMerge`              |
| I-git-gitFinishMerge             | `gitFinishMerge`             |
| I-git-gitWatchProject            | `gitWatchProject`            |
| I-git-gitWatchWorktrees          | `gitWatchWorktrees`          |
| I-git-gitUnwatchProject          | `gitUnwatchProject`          |
| I-git-relocateProject            | `relocateProject`            |

**github** — [github.ts](../../src/shared/ipc/procedures/github.ts)

| 保全 ID                          | 已注册入口                |
| -------------------------------- | ------------------------- |
| I-github-ghCheckAvailable        | `ghCheckAvailable`        |
| I-github-ghCreatePr              | `ghCreatePr`              |
| I-github-ghGetPrForBranch        | `ghGetPrForBranch`        |
| I-github-ghListPrs               | `ghListPrs`               |
| I-github-ghListPullRequests      | `ghListPullRequests`      |
| I-github-ghListWorkflows         | `ghListWorkflows`         |
| I-github-ghListWorkflowRuns      | `ghListWorkflowRuns`      |
| I-github-ghGetWorkflowRun        | `ghGetWorkflowRun`        |
| I-github-ghGetWorkflowDefinition | `ghGetWorkflowDefinition` |
| I-github-ghDispatchWorkflow      | `ghDispatchWorkflow`      |
| I-github-ghRerunWorkflowRun      | `ghRerunWorkflowRun`      |
| I-github-ghCancelWorkflowRun     | `ghCancelWorkflowRun`     |
| I-github-ghDeleteWorkflowRun     | `ghDeleteWorkflowRun`     |
| I-github-ghMergePr               | `ghMergePr`               |
| I-github-ghClosePr               | `ghClosePr`               |
| I-github-ghReopenPr              | `ghReopenPr`              |
| I-github-ghMarkPrReady           | `ghMarkPrReady`           |
| I-github-ghGetPrChecks           | `ghGetPrChecks`           |
| I-github-ghGetPrFiles            | `ghGetPrFiles`            |
| I-github-ghGetPrDiff             | `ghGetPrDiff`             |
| I-github-ghSubmitPrReview        | `ghSubmitPrReview`        |
| I-github-ghUpdatePrBranch        | `ghUpdatePrBranch`        |
| I-github-ghGetPrDetails          | `ghGetPrDetails`          |
| I-github-ghGetPrReviewComments   | `ghGetPrReviewComments`   |
| I-github-ghPostPrComment         | `ghPostPrComment`         |
| I-github-ghListAccounts          | `ghListAccounts`          |
| I-github-ghListRepos             | `ghListRepos`             |
| I-github-cloneRepo               | `cloneRepo`               |

**lsp** — [lsp.ts](../../src/shared/ipc/procedures/lsp.ts)

| 保全 ID              | 已注册入口       |
| -------------------- | ---------------- |
| I-lsp-lspStart       | `lspStart`       |
| I-lsp-lspStop        | `lspStop`        |
| I-lsp-lspSendMessage | `lspSendMessage` |

**mcp** — [mcp.ts](../../src/shared/ipc/procedures/mcp.ts)

| 保全 ID                                  | 已注册入口                           |
| ---------------------------------------- | ------------------------------------ |
| I-mcp-confirmOwnSubagentsRoutingOverride | `confirmOwnSubagentsRoutingOverride` |
| I-mcp-discoverExternalMcpServers         | `discoverExternalMcpServers`         |
| I-mcp-probeMcpServer                     | `probeMcpServer`                     |
| I-mcp-reloadAgentMcpServers              | `reloadAgentMcpServers`              |
| I-mcp-beginMcpServerOauth                | `beginMcpServerOauth`                |
| I-mcp-waitMcpServerOauth                 | `waitMcpServerOauth`                 |
| I-mcp-clearMcpServerOauth                | `clearMcpServerOauth`                |
| I-mcp-getMcpOauthStatus                  | `getMcpOauthStatus`                  |

**nativeHarness** — [nativeHarness.ts](../../src/shared/ipc/procedures/nativeHarness.ts)

| 保全 ID                                      | 已注册入口                     |
| -------------------------------------------- | ------------------------------ |
| I-nativeHarness-getNativeHarnessControlPlane | `getNativeHarnessControlPlane` |
| I-nativeHarness-getCraftingModelInventory    | `getCraftingModelInventory`    |
| I-nativeHarness-resolveCraftingCompatibility | `resolveCraftingCompatibility` |
| I-nativeHarness-getCompatibilityBridgeStatus | `getCompatibilityBridgeStatus` |
| I-nativeHarness-startCompatibilityBridge     | `startCompatibilityBridge`     |
| I-nativeHarness-stopCompatibilityBridge      | `stopCompatibilityBridge`      |
| I-nativeHarness-installCompatibilityBridge   | `installCompatibilityBridge`   |
| I-nativeHarness-ensureCompatibilityBridge    | `ensureCompatibilityBridge`    |

**plugins** — [plugins.ts](../../src/shared/ipc/procedures/plugins.ts)

| 保全 ID                     | 已注册入口          |
| --------------------------- | ------------------- |
| I-plugins-listPlugins       | `listPlugins`       |
| I-plugins-refreshPlugins    | `refreshPlugins`    |
| I-plugins-openPluginsFolder | `openPluginsFolder` |

**profile** — [profile.ts](../../src/shared/ipc/procedures/profile.ts)

| 保全 ID                        | 已注册入口             |
| ------------------------------ | ---------------------- |
| I-profile-getProfileCoreStats  | `getProfileCoreStats`  |
| I-profile-getProfileDevices    | `getProfileDevices`    |
| I-profile-getProfileTokenStats | `getProfileTokenStats` |
| I-profile-getProfileIdentity   | `getProfileIdentity`   |
| I-profile-setProfileIdentity   | `setProfileIdentity`   |
| I-profile-copyShareImage       | `copyShareImage`       |
| I-profile-appendUsageEvents    | `appendUsageEvents`    |

**projectTree** — [projectTree.ts](../../src/shared/ipc/procedures/projectTree.ts)

| 保全 ID                                  | 已注册入口                   |
| ---------------------------------------- | ---------------------------- |
| I-projectTree-searchProjectFiles         | `searchProjectFiles`         |
| I-projectTree-listProjectTree            | `listProjectTree`            |
| I-projectTree-browseHostDirectory        | `browseHostDirectory`        |
| I-projectTree-searchProjectTree          | `searchProjectTree`          |
| I-projectTree-readProjectFile            | `readProjectFile`            |
| I-projectTree-readAbsoluteFile           | `readAbsoluteFile`           |
| I-projectTree-readExternalFile           | `readExternalFile`           |
| I-projectTree-writeProjectFile           | `writeProjectFile`           |
| I-projectTree-writeExternalFile          | `writeExternalFile`          |
| I-projectTree-createProjectEntry         | `createProjectEntry`         |
| I-projectTree-renameProjectEntry         | `renameProjectEntry`         |
| I-projectTree-moveProjectEntry           | `moveProjectEntry`           |
| I-projectTree-deleteProjectEntry         | `deleteProjectEntry`         |
| I-projectTree-revealProjectEntry         | `revealProjectEntry`         |
| I-projectTree-openProjectEntryWithSystem | `openProjectEntryWithSystem` |
| I-projectTree-extractOfficeDocumentText  | `extractOfficeDocumentText`  |
| I-projectTree-detectSetupScript          | `detectSetupScript`          |

**prWatches** — [prWatches.ts](../../src/shared/ipc/procedures/prWatches.ts)

| 保全 ID                      | 已注册入口         |
| ---------------------------- | ------------------ |
| I-prWatches-getPrWatch       | `getPrWatch`       |
| I-prWatches-checkPrWatch     | `checkPrWatch`     |
| I-prWatches-upsertPrWatch    | `upsertPrWatch`    |
| I-prWatches-deletePrWatch    | `deletePrWatch`    |
| I-prWatches-syncPrWatchAgent | `syncPrWatchAgent` |

**schedules** — [schedules.ts](../../src/shared/ipc/procedures/schedules.ts)

| 保全 ID                     | 已注册入口        |
| --------------------------- | ----------------- |
| I-schedules-getSchedules    | `getSchedules`    |
| I-schedules-getSchedule     | `getSchedule`     |
| I-schedules-createSchedule  | `createSchedule`  |
| I-schedules-updateSchedule  | `updateSchedule`  |
| I-schedules-deleteSchedule  | `deleteSchedule`  |
| I-schedules-runScheduleNow  | `runScheduleNow`  |
| I-schedules-pauseSchedule   | `pauseSchedule`   |
| I-schedules-resumeSchedule  | `resumeSchedule`  |
| I-schedules-getScheduleRuns | `getScheduleRuns` |

**settings** — [settings.ts](../../src/shared/ipc/procedures/settings.ts)

| 保全 ID                                      | 已注册入口                          |
| -------------------------------------------- | ----------------------------------- |
| I-settings-getSharedSettings                 | `getSharedSettings`                 |
| I-settings-setSharedSettings                 | `setSharedSettings`                 |
| I-settings-setAgentSecretSetting             | `setAgentSecretSetting`             |
| I-settings-removeOwnSubagentsRoutingOverride | `removeOwnSubagentsRoutingOverride` |
| I-settings-removeOwnSubagentsMemoryEntry     | `removeOwnSubagentsMemoryEntry`     |
| I-settings-updateOwnSubagentsMemoryEntryTags | `updateOwnSubagentsMemoryEntryTags` |
| I-settings-setProfileEnvironment             | `setProfileEnvironment`             |
| I-settings-createProfile                     | `createProfile`                     |
| I-settings-setWindowChrome                   | `setWindowChrome`                   |

**skills** — [skills.ts](../../src/shared/ipc/procedures/skills.ts)

| 保全 ID                          | 已注册入口                |
| -------------------------------- | ------------------------- |
| I-skills-scanSkills              | `scanSkills`              |
| I-skills-setSkillEnabled         | `setSkillEnabled`         |
| I-skills-deleteSkill             | `deleteSkill`             |
| I-skills-importSkills            | `importSkills`            |
| I-skills-listSkillMarketplace    | `listSkillMarketplace`    |
| I-skills-installMarketplaceSkill | `installMarketplaceSkill` |

**ssh** — [ssh.ts](../../src/shared/ipc/procedures/ssh.ts)

| 保全 ID                | 已注册入口         |
| ---------------------- | ------------------ |
| I-ssh-sshDiscoverHosts | `sshDiscoverHosts` |
| I-ssh-sshConnect       | `sshConnect`       |
| I-ssh-sshDisconnect    | `sshDisconnect`    |

**thread** — [thread.ts](../../src/shared/ipc/procedures/thread.ts)

| 保全 ID                             | 已注册入口                   |
| ----------------------------------- | ---------------------------- |
| I-thread-getOwnSubagentsRouting     | `getOwnSubagentsRouting`     |
| I-thread-getAgentStatuses           | `getAgentStatuses`           |
| I-thread-refreshAgentStatuses       | `refreshAgentStatuses`       |
| I-thread-getAgentHookPluginStatuses | `getAgentHookPluginStatuses` |
| I-thread-installAgentHookPlugin     | `installAgentHookPlugin`     |
| I-thread-uninstallAgentHookPlugin   | `uninstallAgentHookPlugin`   |
| I-thread-listAcpRegistry            | `listAcpRegistry`            |
| I-thread-installAcpRegistryAgent    | `installAcpRegistryAgent`    |
| I-thread-updateAcpRegistryAgent     | `updateAcpRegistryAgent`     |
| I-thread-updateAgentBinary          | `updateAgentBinary`          |
| I-thread-getLatestAgentVersion      | `getLatestAgentVersion`      |
| I-thread-resolveAgentAccount        | `resolveAgentAccount`        |
| I-thread-removeAcpRegistryAgent     | `removeAcpRegistryAgent`     |
| I-thread-setAcpRegistryAgentAuth    | `setAcpRegistryAgentAuth`    |
| I-thread-authenticateAcpAgent       | `authenticateAcpAgent`       |
| I-thread-logoutAcpAgent             | `logoutAcpAgent`             |
| I-thread-getThreadSnapshots         | `getThreadSnapshots`         |
| I-thread-getTerminalShellSnapshots  | `getTerminalShellSnapshots`  |
| I-thread-getAvailableWindowsShells  | `getAvailableWindowsShells`  |
| I-thread-startThread                | `startThread`                |
| I-thread-craftAgent                 | `craftAgent`                 |
| I-thread-resumeCraftAgent           | `resumeCraftAgent`           |
| I-thread-requestSessionSwitch       | `requestSessionSwitch`       |
| I-thread-cancelSessionSwitch        | `cancelSessionSwitch`        |
| I-thread-readSessionSwitchState     | `readSessionSwitchState`     |
| I-thread-sendThreadInput            | `sendThreadInput`            |
| I-thread-interruptThread            | `interruptThread`            |
| I-thread-controlThreadGoal          | `controlThreadGoal`          |
| I-thread-rollbackThreadConversation | `rollbackThreadConversation` |
| I-thread-setPendingSteer            | `setPendingSteer`            |
| I-thread-clearPendingSteer          | `clearPendingSteer`          |
| I-thread-writeTerminal              | `writeTerminal`              |
| I-thread-stageThreadInput           | `stageThreadInput`           |
| I-thread-resizeTerminal             | `resizeTerminal`             |
| I-thread-resolveThreadServerRequest | `resolveThreadServerRequest` |
| I-thread-closeThread                | `closeThread`                |
| I-thread-switchThreadProvider       | `switchThreadProvider`       |
| I-thread-resolveNativeSessionPaths  | `resolveNativeSessionPaths`  |
| I-thread-startShell                 | `startShell`                 |
| I-thread-extractContext             | `extractContext`             |
| I-thread-cancelExtractContext       | `cancelExtractContext`       |
| I-thread-readTerminalScrollback     | `readTerminalScrollback`     |
| I-thread-readTerminalSize           | `readTerminalSize`           |
| I-thread-subagentSubscribe          | `subagentSubscribe`          |
| I-thread-subagentUnsubscribe        | `subagentUnsubscribe`        |
| I-thread-workflowGetRun             | `workflowGetRun`             |
| I-thread-workflowAgentChat          | `workflowAgentChat`          |

**updates** — [updates.ts](../../src/shared/ipc/procedures/updates.ts)

| 保全 ID                       | 已注册入口            |
| ----------------------------- | --------------------- |
| I-updates-checkForUpdate      | `checkForUpdate`      |
| I-updates-startUpdateDownload | `startUpdateDownload` |
| I-updates-installUpdate       | `installUpdate`       |

**usage** — [usage.ts](../../src/shared/ipc/procedures/usage.ts)

| 保全 ID                                   | 已注册入口                          |
| ----------------------------------------- | ----------------------------------- |
| I-usage-startUsageLogin                   | `startUsageLogin`                   |
| I-usage-cancelUsageLogin                  | `cancelUsageLogin`                  |
| I-usage-clearUsageLogin                   | `clearUsageLogin`                   |
| I-usage-submitUsageApiKey                 | `submitUsageApiKey`                 |
| I-usage-submitVolcengineCredentials       | `submitVolcengineCredentials`       |
| I-usage-submitOpenAiCompatibleCredentials | `submitOpenAiCompatibleCredentials` |
| I-usage-submitUsageCookie                 | `submitUsageCookie`                 |
| I-usage-resolveUsageLoginConfirmation     | `resolveUsageLoginConfirmation`     |
| I-usage-getUsageLoginState                | `getUsageLoginState`                |
| I-usage-getProviderUsage                  | `getProviderUsage`                  |
| I-usage-refreshProviderUsage              | `refreshProviderUsage`              |
| I-usage-forgetProviderUsage               | `forgetProviderUsage`               |
| I-usage-importAntigravityProfile          | `importAntigravityProfile`          |
| I-usage-importOpenAiCompatibleProfile     | `importOpenAiCompatibleProfile`     |
| I-usage-getOpenAiCompatibleProfile        | `getOpenAiCompatibleProfile`        |
| I-usage-listChannelModels                 | `listChannelModels`                 |
| I-usage-verifyChannelModel                | `verifyChannelModel`                |
| I-usage-listAccounts                      | `listAccounts`                      |
| I-usage-addAccount                        | `addAccount`                        |
| I-usage-removeAccount                     | `removeAccount`                     |
| I-usage-selectAccount                     | `selectAccount`                     |
| I-usage-setAccountEnabled                 | `setAccountEnabled`                 |
| I-usage-renameAccount                     | `renameAccount`                     |
| I-usage-reorderAccounts                   | `reorderAccounts`                   |
| I-usage-setAccountPoolScheduling          | `setAccountPoolScheduling`          |
| I-usage-getAccountPoolScheduling          | `getAccountPoolScheduling`          |
| I-usage-resolveAccount                    | `resolveAccount`                    |
| I-usage-getTokenUsageCapabilities         | `getTokenUsageCapabilities`         |
| I-usage-getTokenUsage                     | `getTokenUsage`                     |
| I-usage-refreshTokenUsage                 | `refreshTokenUsage`                 |
| I-usage-createCodexProfile                | `createCodexProfile`                |
| I-usage-importCodexProfile                | `importCodexProfile`                |
| I-usage-startCodexProfileLogin            | `startCodexProfileLogin`            |
| I-usage-createKimiProfile                 | `createKimiProfile`                 |
| I-usage-importKimiProfile                 | `importKimiProfile`                 |
| I-usage-importKimiApiKey                  | `importKimiApiKey`                  |
| I-usage-startKimiProfileLogin             | `startKimiProfileLogin`             |
| I-usage-completeKimiProfileLogin          | `completeKimiProfileLogin`          |
| I-usage-createGrokProfileLogin            | `createGrokProfileLogin`            |
| I-usage-startGrokProfileLogin             | `startGrokProfileLogin`             |
| I-usage-completeGrokProfileLogin          | `completeGrokProfileLogin`          |
| I-usage-cancelGrokProfileLogin            | `cancelGrokProfileLogin`            |
| I-usage-pollGrokProfileLogin              | `pollGrokProfileLogin`              |
| I-usage-refreshAccountQuota               | `refreshAccountQuota`               |
| I-usage-applyAntigravityHostLogin         | `applyAntigravityHostLogin`         |

### 15.2 内建 MCP server/tool 清单

来源：[BUILT_IN_MCP_SERVER_TOOL_NAMES](../../src/shared/contracts/mcpServer.ts)。这是公开声明面；实施需与各真实 toolRegistry / dispatch 比对，任何声明与实际支持差异都作为待修缺陷，不能标成验证通过。

**browser**

| 保全 ID                 | 已声明工具      |
| ----------------------- | --------------- |
| M-browser-api           | `api`           |
| M-browser-enable        | `enable`        |
| M-browser-disable       | `disable`       |
| M-browser-list_tabs     | `list_tabs`     |
| M-browser-new_tab       | `new_tab`       |
| M-browser-open          | `open`          |
| M-browser-activate_tab  | `activate_tab`  |
| M-browser-close_tab     | `close_tab`     |
| M-browser-navigate      | `navigate`      |
| M-browser-back          | `back`          |
| M-browser-forward       | `forward`       |
| M-browser-reload        | `reload`        |
| M-browser-get_url       | `get_url`       |
| M-browser-get_title     | `get_title`     |
| M-browser-screenshot    | `screenshot`    |
| M-browser-query         | `query`         |
| M-browser-wait_for      | `wait_for`      |
| M-browser-click         | `click`         |
| M-browser-dblclick      | `dblclick`      |
| M-browser-focus         | `focus`         |
| M-browser-type          | `type`          |
| M-browser-fill          | `fill`          |
| M-browser-check         | `check`         |
| M-browser-uncheck       | `uncheck`       |
| M-browser-select        | `select`        |
| M-browser-eval          | `eval`          |
| M-browser-snapshot      | `snapshot`      |
| M-browser-inspect       | `inspect`       |
| M-browser-get           | `get`           |
| M-browser-is            | `is`            |
| M-browser-find          | `find`          |
| M-browser-hover         | `hover`         |
| M-browser-press         | `press`         |
| M-browser-wait          | `wait`          |
| M-browser-scroll        | `scroll`        |
| M-browser-wait_for_url  | `wait_for_url`  |
| M-browser-wait_for_text | `wait_for_text` |
| M-browser-wait_for_js   | `wait_for_js`   |
| M-browser-console       | `console`       |
| M-browser-requests      | `requests`      |
| M-browser-cookies       | `cookies`       |
| M-browser-storage       | `storage`       |
| M-browser-dialog        | `dialog`        |
| M-browser-frames        | `frames`        |
| M-browser-addscript     | `addscript`     |
| M-browser-addstyle      | `addstyle`      |

**crossagents**

| 保全 ID                         | 已声明工具          |
| ------------------------------- | ------------------- |
| M-crossagents-list_peers        | `list_peers`        |
| M-crossagents-send_message      | `send_message`      |
| M-crossagents-ask               | `ask`               |
| M-crossagents-reply             | `reply`             |
| M-crossagents-inbox             | `inbox`             |
| M-crossagents-get_peer_status   | `get_peer_status`   |
| M-crossagents-wake_peer         | `wake_peer`         |
| M-crossagents-spawn_peer        | `spawn_peer`        |
| M-crossagents-switch_peer_model | `switch_peer_model` |
| M-crossagents-stop_peer         | `stop_peer`         |

**own-subagents**

| 保全 ID                                   | 已声明工具                  |
| ----------------------------------------- | --------------------------- |
| M-own-subagents-list_agents               | `list_agents`               |
| M-own-subagents-get_agent                 | `get_agent`                 |
| M-own-subagents-spawn_agent               | `spawn_agent`               |
| M-own-subagents-list_routing_preferences  | `list_routing_preferences`  |
| M-own-subagents-set_routing_preference    | `set_routing_preference`    |
| M-own-subagents-remove_routing_preference | `remove_routing_preference` |
| M-own-subagents-wait_for_agent            | `wait_for_agent`            |
| M-own-subagents-get_status                | `get_status`                |
| M-own-subagents-list_runs                 | `list_runs`                 |
| M-own-subagents-cancel                    | `cancel`                    |

**chrome**

| 保全 ID                    | 已声明工具          |
| -------------------------- | ------------------- |
| M-chrome-chrome_status     | `chrome_status`     |
| M-chrome-enable            | `enable`            |
| M-chrome-disable           | `disable`           |
| M-chrome-chrome_list_tabs  | `chrome_list_tabs`  |
| M-chrome-chrome_open       | `chrome_open`       |
| M-chrome-chrome_attach     | `chrome_attach`     |
| M-chrome-chrome_navigate   | `chrome_navigate`   |
| M-chrome-chrome_reload     | `chrome_reload`     |
| M-chrome-chrome_get_url    | `chrome_get_url`    |
| M-chrome-chrome_get_title  | `chrome_get_title`  |
| M-chrome-chrome_snapshot   | `chrome_snapshot`   |
| M-chrome-chrome_find       | `chrome_find`       |
| M-chrome-chrome_get        | `chrome_get`        |
| M-chrome-chrome_is         | `chrome_is`         |
| M-chrome-chrome_click      | `chrome_click`      |
| M-chrome-chrome_fill       | `chrome_fill`       |
| M-chrome-chrome_type       | `chrome_type`       |
| M-chrome-chrome_press      | `chrome_press`      |
| M-chrome-chrome_wait       | `chrome_wait`       |
| M-chrome-chrome_screenshot | `chrome_screenshot` |
| M-chrome-chrome_eval       | `chrome_eval`       |
| M-chrome-chrome_cookies    | `chrome_cookies`    |

**computer-use**

| 保全 ID                         | 已声明工具         |
| ------------------------------- | ------------------ |
| M-computer-use-api              | `api`              |
| M-computer-use-enable           | `enable`           |
| M-computer-use-disable          | `disable`          |
| M-computer-use-list_apps        | `list_apps`        |
| M-computer-use-list_windows     | `list_windows`     |
| M-computer-use-launch_app       | `launch_app`       |
| M-computer-use-get_window       | `get_window`       |
| M-computer-use-get_window_state | `get_window_state` |
| M-computer-use-activate_window  | `activate_window`  |
| M-computer-use-click            | `click`            |
| M-computer-use-press_key        | `press_key`        |
| M-computer-use-type_text        | `type_text`        |
| M-computer-use-scroll           | `scroll`           |
| M-computer-use-drag             | `drag`             |

**app-controls**

| 保全 ID                              | 已声明工具              |
| ------------------------------------ | ----------------------- |
| M-app-controls-get_current_thread    | `get_current_thread`    |
| M-app-controls-list_threads          | `list_threads`          |
| M-app-controls-get_thread            | `get_thread`            |
| M-app-controls-read_thread           | `read_thread`           |
| M-app-controls-create_thread         | `create_thread`         |
| M-app-controls-send_to_thread        | `send_to_thread`        |
| M-app-controls-send_thread_message   | `send_thread_message`   |
| M-app-controls-ask_thread            | `ask_thread`            |
| M-app-controls-read_thread_exchange  | `read_thread_exchange`  |
| M-app-controls-wait_for_thread_reply | `wait_for_thread_reply` |
| M-app-controls-interrupt_thread      | `interrupt_thread`      |
| M-app-controls-stop_thread           | `stop_thread`           |
| M-app-controls-wait_for_thread       | `wait_for_thread`       |
| M-app-controls-update_thread         | `update_thread`         |
| M-app-controls-open_thread           | `open_thread`           |
| M-app-controls-list_terminals        | `list_terminals`        |
| M-app-controls-read_terminal         | `read_terminal`         |
| M-app-controls-steer_thread          | `steer_thread`          |
| M-app-controls-stage_thread_input    | `stage_thread_input`    |
| M-app-controls-rollback_thread       | `rollback_thread`       |
| M-app-controls-list_projects         | `list_projects`         |
| M-app-controls-get_project           | `get_project`           |
| M-app-controls-create_project        | `create_project`        |
| M-app-controls-update_project        | `update_project`        |
| M-app-controls-get_settings          | `get_settings`          |
| M-app-controls-update_settings       | `update_settings`       |
| M-app-controls-get_usage             | `get_usage`             |
| M-app-controls-search                | `search`                |
| M-app-controls-get_app_info          | `get_app_info`          |
| M-app-controls-notify_user           | `notify_user`           |
| M-app-controls-check_for_update      | `check_for_update`      |
| M-app-controls-list_project_files    | `list_project_files`    |
| M-app-controls-read_project_file     | `read_project_file`     |
| M-app-controls-find_files            | `find_files`            |
| M-app-controls-list_installed_agents | `list_installed_agents` |
| M-app-controls-git_status            | `git_status`            |
| M-app-controls-git_diff              | `git_diff`              |
| M-app-controls-git_stage             | `git_stage`             |
| M-app-controls-git_commit            | `git_commit`            |
| M-app-controls-git_discard           | `git_discard`           |
| M-app-controls-git_branch            | `git_branch`            |
| M-app-controls-git_sync              | `git_sync`              |
| M-app-controls-list_worktrees        | `list_worktrees`        |
| M-app-controls-remove_worktree       | `remove_worktree`       |
| M-app-controls-merge_worktree        | `merge_worktree`        |
| M-app-controls-gh_list_prs           | `gh_list_prs`           |
| M-app-controls-gh_get_pr             | `gh_get_pr`             |
| M-app-controls-gh_create_pr          | `gh_create_pr`          |
| M-app-controls-gh_pr_comment         | `gh_pr_comment`         |
| M-app-controls-gh_merge_pr           | `gh_merge_pr`           |
| M-app-controls-gh_update_pr          | `gh_update_pr`          |
| M-app-controls-list_mcp_servers      | `list_mcp_servers`      |
| M-app-controls-probe_mcp_server      | `probe_mcp_server`      |
| M-app-controls-add_mcp_server        | `add_mcp_server`        |
| M-app-controls-update_mcp_server     | `update_mcp_server`     |
| M-app-controls-remove_mcp_server     | `remove_mcp_server`     |
| M-app-controls-list_skills           | `list_skills`           |
| M-app-controls-set_skill_enabled     | `set_skill_enabled`     |

**schedule**

| 保全 ID              | 已声明工具  |
| -------------------- | ----------- |
| M-schedule-list      | `list`      |
| M-schedule-get       | `get`       |
| M-schedule-create    | `create`    |
| M-schedule-update    | `update`    |
| M-schedule-pause     | `pause`     |
| M-schedule-resume    | `resume`    |
| M-schedule-run_now   | `run_now`   |
| M-schedule-delete    | `delete`    |
| M-schedule-list_runs | `list_runs` |

### 15.3 用户设置键保全索引

来源：[sharedSettingsSchema](../../src/shared/settings.ts)。这些是用户可持久化偏好或系统保存状态。重构可以变更存储形式，但迁移后必须保持同一有效行为；保留未知/旧字段兼容策略和单字段解析失败的默认语义。分项边界见 F-SET/F-ACCOUNT/F-CAP/F-SESSION 等行。

| 保全 ID                                       | 配置键                                |
| --------------------------------------------- | ------------------------------------- |
| S-setting-themeMode                           | `themeMode`                           |
| S-setting-themePreset                         | `themePreset`                         |
| S-setting-locale                              | `locale`                              |
| S-setting-gitTextLanguage                     | `gitTextLanguage`                     |
| S-setting-customGlobalPrompt                  | `customGlobalPrompt`                  |
| S-setting-terminalPosition                    | `terminalPosition`                    |
| S-setting-windowsShellPath                    | `windowsShellPath`                    |
| S-setting-windowsInternalShellPath            | `windowsInternalShellPath`            |
| S-setting-windowsShellArguments               | `windowsShellArguments`               |
| S-setting-commitGenProvider                   | `commitGenProvider`                   |
| S-setting-commitGenModel                      | `commitGenModel`                      |
| S-setting-commitGenEffort                     | `commitGenEffort`                     |
| S-setting-commitGenFast                       | `commitGenFast`                       |
| S-setting-titleGenProvider                    | `titleGenProvider`                    |
| S-setting-titleGenModel                       | `titleGenModel`                       |
| S-setting-titleGenEffort                      | `titleGenEffort`                      |
| S-setting-titleGenFast                        | `titleGenFast`                        |
| S-setting-conflictResolverProvider            | `conflictResolverProvider`            |
| S-setting-conflictResolverModel               | `conflictResolverModel`               |
| S-setting-conflictResolverEffort              | `conflictResolverEffort`              |
| S-setting-conflictResolverFast                | `conflictResolverFast`                |
| S-setting-experimentJudgeProvider             | `experimentJudgeProvider`             |
| S-setting-experimentJudgeModel                | `experimentJudgeModel`                |
| S-setting-experimentJudgeEffort               | `experimentJudgeEffort`               |
| S-setting-experimentJudgeFast                 | `experimentJudgeFast`                 |
| S-setting-conflictResolverPresentationMode    | `conflictResolverPresentationMode`    |
| S-setting-wslCommitGenProvider                | `wslCommitGenProvider`                |
| S-setting-wslCommitGenModel                   | `wslCommitGenModel`                   |
| S-setting-wslCommitGenEffort                  | `wslCommitGenEffort`                  |
| S-setting-wslCommitGenFast                    | `wslCommitGenFast`                    |
| S-setting-wslTitleGenProvider                 | `wslTitleGenProvider`                 |
| S-setting-wslTitleGenModel                    | `wslTitleGenModel`                    |
| S-setting-wslTitleGenEffort                   | `wslTitleGenEffort`                   |
| S-setting-wslTitleGenFast                     | `wslTitleGenFast`                     |
| S-setting-wslConflictResolverProvider         | `wslConflictResolverProvider`         |
| S-setting-wslConflictResolverModel            | `wslConflictResolverModel`            |
| S-setting-wslConflictResolverEffort           | `wslConflictResolverEffort`           |
| S-setting-wslConflictResolverFast             | `wslConflictResolverFast`             |
| S-setting-wslConflictResolverPresentationMode | `wslConflictResolverPresentationMode` |
| S-setting-agentSettings                       | `agentSettings`                       |
| S-setting-defaultPermissionMode               | `defaultPermissionMode`               |
| S-setting-hiddenModels                        | `hiddenModels`                        |
| S-setting-shownModels                         | `shownModels`                         |
| S-setting-customModels                        | `customModels`                        |
| S-setting-disabledAgents                      | `disabledAgents`                      |
| S-setting-defaultModels                       | `defaultModels`                       |
| S-setting-providerOrder                       | `providerOrder`                       |
| S-setting-acpRegistryInstalledAgents          | `acpRegistryInstalledAgents`          |
| S-setting-agentInstances                      | `agentInstances`                      |
| S-setting-collapseTerminalComposer            | `collapseTerminalComposer`            |
| S-setting-cliPickerTarget                     | `cliPickerTarget`                     |
| S-setting-staleThreadUnloadMinutes            | `staleThreadUnloadMinutes`            |
| S-setting-turnRetryMaxAttempts                | `turnRetryMaxAttempts`                |
| S-setting-turnRetryIntervalSeconds            | `turnRetryIntervalSeconds`            |
| S-setting-autoArchiveDoneAfterDays            | `autoArchiveDoneAfterDays`            |
| S-setting-archiveRetention                    | `archiveRetention`                    |
| S-setting-scrollSpeed                         | `scrollSpeed`                         |
| S-setting-agentTerminalFontSize               | `agentTerminalFontSize`               |
| S-setting-guiChatFontSize                     | `guiChatFontSize`                     |
| S-setting-zoomFactor                          | `zoomFactor`                          |
| S-setting-terminalPanelFontSize               | `terminalPanelFontSize`               |
| S-setting-preventSleep                        | `preventSleep`                        |
| S-setting-launchAtStartup                     | `launchAtStartup`                     |
| S-setting-startMinimized                      | `startMinimized`                      |
| S-setting-closeToTray                         | `closeToTray`                         |
| S-setting-remoteAccessEnabled                 | `remoteAccessEnabled`                 |
| S-setting-remoteAccessTailscaleHttps          | `remoteAccessTailscaleHttps`          |
| S-setting-remoteAccessAdvertisedUrl           | `remoteAccessAdvertisedUrl`           |
| S-setting-threadRemoveAction                  | `threadRemoveAction`                  |
| S-setting-autoMarkDoneOnPrMerge               | `autoMarkDoneOnPrMerge`               |
| S-setting-newThreadMode                       | `newThreadMode`                       |
| S-setting-homeScopeEnabled                    | `homeScopeEnabled`                    |
| S-setting-sidebarHiddenShortcuts              | `sidebarHiddenShortcuts`              |
| S-setting-sidebarShortcutOrder                | `sidebarShortcutOrder`                |
| S-setting-topShortcutOrder                    | `topShortcutOrder`                    |
| S-setting-sidebarTranslucency                 | `sidebarTranslucency`                 |
| S-setting-sidebarGlassTint                    | `sidebarGlassTint`                    |
| S-setting-autoShowTerminalPanel               | `autoShowTerminalPanel`               |
| S-setting-worktreeStorageMode                 | `worktreeStorageMode`                 |
| S-setting-worktreeBasePath                    | `worktreeBasePath`                    |
| S-setting-wslWorktreeBasePath                 | `wslWorktreeBasePath`                 |
| S-setting-gitReviewMode                       | `gitReviewMode`                       |
| S-setting-prCreateMode                        | `prCreateMode`                        |
| S-setting-prAutomationDefault                 | `prAutomationDefault`                 |
| S-setting-prMergeMethod                       | `prMergeMethod`                       |
| S-setting-commitDefaultAction                 | `commitDefaultAction`                 |
| S-setting-providerConfigs                     | `providerConfigs`                     |
| S-setting-providerModelPreferences            | `providerModelPreferences`            |
| S-setting-lastPresentationModeByAgent         | `lastPresentationModeByAgent`         |
| S-setting-lastUsedProjectDirs                 | `lastUsedProjectDirs`                 |
| S-setting-editorLspEnabled                    | `editorLspEnabled`                    |
| S-setting-searchUseIgnoreFiles                | `searchUseIgnoreFiles`                |
| S-setting-searchExclude                       | `searchExclude`                       |
| S-setting-notificationsEnabled                | `notificationsEnabled`                |
| S-setting-notificationSound                   | `notificationSound`                   |
| S-setting-notificationFilter                  | `notificationFilter`                  |
| S-setting-notificationStatuses                | `notificationStatuses`                |
| S-setting-notifyL2Cli                         | `notifyL2Cli`                         |
| S-setting-remotePushEnabled                   | `remotePushEnabled`                   |
| S-setting-remotePushRedactContent             | `remotePushRedactContent`             |
| S-setting-workspaces                          | `workspaces`                          |
| S-setting-favoriteModels                      | `favoriteModels`                      |
| S-setting-recentModels                        | `recentModels`                        |
| S-setting-agentSelectionUsage                 | `agentSelectionUsage`                 |
| S-setting-ownSubagentSelectionUsage           | `ownSubagentSelectionUsage`           |
| S-setting-ownSubagentRoutingOverrides         | `ownSubagentRoutingOverrides`         |
| S-setting-ownSubagentPausedProviders          | `ownSubagentPausedProviders`          |
| S-setting-ownSubagentHiddenModels             | `ownSubagentHiddenModels`             |
| S-setting-ownSubagentsRouteOrder              | `ownSubagentsRouteOrder`              |
| S-setting-disableCliHookPlugin                | `disableCliHookPlugin`                |
| S-setting-dismissedHookInstallProposals       | `dismissedHookInstallProposals`       |
| S-setting-agentHookSupport                    | `agentHookSupport`                    |
| S-setting-enabledMcpServers                   | `enabledMcpServers`                   |
| S-setting-mcpServers                          | `mcpServers`                          |
| S-setting-disabledBuiltInMcpServers           | `disabledBuiltInMcpServers`           |
| S-setting-disabledBuiltInMcpTools             | `disabledBuiltInMcpTools`             |
| S-setting-installedPlugins                    | `installedPlugins`                    |
| S-setting-browser                             | `browser`                             |
| S-setting-audio                               | `audio`                               |
| S-setting-usage                               | `usage`                               |
| S-setting-ownSubagentRoutingGuide             | `ownSubagentRoutingGuide`             |

## 16. 本次盘点规模

- 业务行为：_*235 个 F-* ID_*。
- 注册 IPC：_*344 个 I-* ID_*。
- 声明的内建 MCP 工具：_*169 个 M-* ID_*。
- 顶层持久设置：_*121 个 S-setting-* ID_*。
- 本次执行性质：只读研究与文档生成；没有运行功能测试，因此“发现源码/测试入口”与“验收通过”严格分开。
