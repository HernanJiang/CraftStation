# v1.5.0 Harness Evolution 实施报告

日期：2026-09-21  
分支：`dev/1.5.0-harness-evolution`  
工作树：`D:\Work\CraftStation\.worktrees\1.5.0-harness-evolution`

## 完成范围

本轮将 ZCode 与 MiniMax Code 调研中确定的五项机制落实到 CraftStation，并新增两个 Harness 的产品接入。实现保持 CraftStation 的 `Item → Recipe → CraftPlan → Entity → Session` 主线，没有把上游 Agent Loop 搬进 CraftStation。

### 1. CraftStation 自管 MCP 渐进暴露

- `StreamableHttpMcpIngress` 支持按工具数量和 schema 总体积决定是否延迟暴露。
- 工具很多时，`tools/list` 只公开 `craftstation_tool_search` 与 `craftstation_tool_invoke`；搜索结果再返回真实工具定义。
- 搜索支持英文 token 与中文双字片段，默认最多返回 5 项。
- `craftstation_tool_invoke` 重新经过禁用工具、已知工具、线程上下文、参数解包、JSON Schema 校验和原始 dispatch 边界。
- Browser、Chrome、Computer Use、App Controls、Crossagents、Schedule 六类 CraftStation 内置 MCP 入口已启用；直接调用真实工具仍保留兼容性。

### 2. Handoff 任务事实包

- `ConversationCheckpoint` 新增带原始 item 锚点的长期目标、约束、未回答请求、阻塞和关键文件。
- 目标取最早用户请求，避免“继续”“查看进度”等最近消息覆盖原始任务。
- 约束、错误与文件事实由宿主账本确定性投影，仍经过脱敏和总字符预算。
- 目标 Harness 收到的 checkpoint 文本会分区呈现这些事实；旧 schema 继续兼容。

### 3. 可恢复的工作流运行索引

- 新增持久运行索引，保存 thread、item、manifest、工作区位置、run identity、状态、停止原因、`resumedFrom`、`supersededBy` 与 `resumable`。
- Renderer 重启后会恢复 `running/unknown` 记录，并在打开任何线程前继续轮询真实 manifest。
- 显式终态和 manifest 超时会写回持久索引；Windows、POSIX、WSL 工作区位置均使用正式 schema 校验。
- 该实现恢复运行事实和 UI 可见性，不承诺恢复已经终止的外部副作用。

### 4. 产物来源、版本和验证摘要

- Workflow manifest 可声明轻量 `artifacts` 元数据，包含类型、标题、版本、原路径、内容状态、生成 run/Agent/attempt 以及验证结果。
- transcript reader 只读取元数据，不把产物内容塞入状态事件。
- Workflow Overlay 展示产物数量、版本、生成者和验证计数；内容仍沿用现有文件/预览能力按需读取。

### 5. 上下文用量口径

- `ThreadContextUsage` 新增来源、作用域、采样时间、过期状态、缓存输入语义和压缩状态。
- Provider 映射会明确标记 `provider-reported + turn + unknown cache semantics`；未知信息不伪装成精确值。
- 缓存命中率按 Adapter 声明的 `input-includes-cache` 或 `fresh-excludes-cache` 计算，不再根据数字大小猜语义。
- Thread Context UI 展示来源、作用域、过期和压缩状态。

## MiniMax Code 接入

- 新增 `minimax` Agent Adapter、安装/登录检测、官方安装脚本入口、TUI 与 headless 命令。
- Structured Runtime 使用官方 `mcode acp`，复用 CraftStation ACP Session seam，支持 Supervisor 解析后的 MCP 注入、Skills、resume、interrupt 与诊断。
- 新增 `MiniMax M3` Model Item、`MiniMax Code Harness` Item 和 `recipe:minimax-code-native`。
- 新增 Renderer provider manifest、图标、设置页注册和 native capability descriptor。

## ZCode 接入

- 新增 `zcode` Agent Adapter、源码构建安装入口、登录检测、TUI、resume、direct input、headless JSON 命令和终端状态识别。
- 新增 `GLM-5.3` Model Item、`ZCode Harness` Item 和实验性 `recipe:zai-zcode-native`。
- 新增 Renderer provider manifest、图标、设置页注册和 native capability descriptor。
- 当前通过官方 PTY 入口接入。ZCode 的 `ZCode Protocol v4 app-server` 是自有协议，并非 ACP；本轮没有把它伪装成 ACP，也没有声明尚未实现的结构化事件能力。

## 验证

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm build`：通过；Vite 仅保留仓库已有的 CSS pseudo-element、sourcemap 和 chunk-size 警告。
- 全量 Vitest：`12005 passed`、`66 skipped`、`1 failed`。唯一失败为未修改的 `src/supervisor/native/runtime/index.test.ts` 在 Windows 清理临时 native runtime 目录时超过 15 秒 hook timeout；单独复跑仍是同一清理超时。
- 本轮新增和直接受影响的 MCP、Handoff、workflow、context、Agent registry、provider manifest、Crafting registry 与 native adapter 测试均通过。

## 尚需真实环境验收的边界

当前开发机未用真实 MiniMax/ZCode 账户执行在线任务，因此以下仍需候选试用：MiniMax ACP 登录、新建/恢复 Session、真实 MCP 调用与 Stop；ZCode TUI 登录、resume、权限提示和 headless 输出。代码会在未安装或未登录时通过既有检测与诊断暴露状态，不会静默退回其他 Harness。
