# CraftStation v1.5.0 — MiniMax Code、ZCode 与可恢复工作流

## 用户可见

- 新增 MiniMax Code：可使用官方 `mcode acp` 运行结构化会话，并支持 TUI、无头模式、会话恢复、MCP 与 Skills。
- 新增 ZCode 实验性 Recipe：可通过官方终端 Harness 使用 GLM-5.3，支持无头 JSON、会话恢复、状态与权限识别。
- 内置 MCP 支持渐进式工具发现：Agent 可先用 `craftstation_tool_search` 搜索中文或英文能力，再用 `craftstation_tool_invoke` 调用，减少大型工具目录占用的上下文。
- Handoff 会保留原始目标、约束、待回答问题、阻塞项和关键文件；运行中的 Workflow 可跨渲染器重启恢复，并展示续接关系、停止原因与可恢复状态。
- Artifact 增加版本、来源、生产者、尝试次数、验证结果与状态；上下文用量增加来源、范围、测量时间、新鲜度、缓存语义与压缩状态。

## 实现

- MiniMax Code 以结构化 ACP Adapter 接入；ZCode 以 PTY Terminal Adapter 接入，并保持其 Protocol v4 与 ACP 的边界。
- 六类 CraftStation 内置 MCP ingress 统一接入渐进式工具目录，同时保留原有权限检查和输入 Schema 校验。
- Handoff checkpoint、Workflow transcript/index、Artifact 与 Context Usage 合约补齐可恢复性和来源元数据，并在桌面与移动界面展示关键状态。

## 验证

- MiniMax Code、ZCode、MCP 渐进式目录、Handoff、Workflow、Artifact 与 Context Usage 的目标测试通过。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过。
- 完整测试执行中 12005 项通过、66 项跳过；另有 1 项未改动的 Windows 临时目录清理钩子超过 15 秒超时，目标测试不受影响。

Windows x64 提供 NSIS 安装包和便携版。

---

# CraftStation v1.5.0 — MiniMax Code, ZCode, and recoverable workflows

## User-facing

- Added MiniMax Code with structured sessions through the official `mcode acp` runtime, plus TUI, headless mode, session resume, MCP, and Skills support.
- Added an experimental ZCode Recipe using the official terminal harness with GLM-5.3, headless JSON, session resume, status reporting, and permission recognition.
- Built-in MCP servers now support progressive tool discovery: agents can search Chinese or English capabilities with `craftstation_tool_search` and call them with `craftstation_tool_invoke`, reducing the context cost of large tool catalogs.
- Handoffs retain the original goal, constraints, unanswered requests, blockers, and critical files. Active workflows survive renderer restarts and expose resume lineage, stop reasons, and resumability.
- Artifacts now carry version, source, producer, attempt, validation, and status metadata. Context usage reports its source, scope, measurement time, freshness, cache semantics, and compaction state.

## Implementation

- MiniMax Code is integrated as a structured ACP adapter. ZCode is integrated as a PTY terminal adapter while keeping its Protocol v4 boundary distinct from ACP.
- Six CraftStation-managed MCP ingress surfaces share one progressive tool catalog while preserving permission checks and input schema validation.
- Handoff checkpoints, workflow transcripts and indexes, artifacts, and context-usage contracts now carry the metadata needed for recovery and source-aware UI status.

## Verification

- Targeted MiniMax Code, ZCode, progressive MCP catalog, handoff, workflow, artifact, and context-usage tests pass.
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` pass.
- The full test run completed with 12,005 passing and 66 skipped tests; one unchanged Windows temporary-directory cleanup hook exceeded its 15-second timeout. Targeted coverage is unaffected.

Windows x64 NSIS installer and portable builds are provided.
