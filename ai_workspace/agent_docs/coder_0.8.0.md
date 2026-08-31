# CraftStation Coder 交付 — v0.8.0

Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`

工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`

分支：`feature/v0.8-opencode-native`

基线：`dev / 7ae6506ea01fc04029a10a711ebb0a65d7248e06`

状态：Coder 已完成官方 headless CLI 安装（v1.18.25）、真实 Server E2E Smoke & 6-Route 矩阵测试接入、以及 Debugger 0.8.4 提出的 F38–F44 全部工程缺陷修复；定向测试 11 文件 / 60 测全绿，等待 Debugger 独立复检。

## Existing

- 保留 CraftStation 既有 `crafting`、ItemRegistry、Crafter、Native Harness descriptors、Supervisor IPC 和 `HarnessPanel` seam。
- 保留既有 Codex、Grok Build、Kimi、Antigravity、DeepSeek 路径；本 Feature 没有把 DeepSeek Model 改造成 DeepSeek/DSH Harness。
- 复用已有 OpenCode SDK/server 基础设施和 canonical runtime event/usage vocabulary；没有创建第二套 UI 页面或 Usage 系统。
- 既有全仓基线失败仍保持原样，没有为追求全绿修改迁移、品牌路径或 remote procedure registry 的无关测试。

## Fixed (v0.8.4 Engineering Fix Cycle & F37 Live E2E)

- **F37 (Official Headless CLI & Live E2E Smoke Matrix)**：
  - 官方 headless `opencode` CLI 已成功安装至系统环境（`C:\Users\Haona\AppData\Roaming\npm\opencode.exe`，版本 `1.18.25`）。
  - 启动真实无头服务进程（`opencode.exe serve --port 0 --hostname 127.0.0.1 --print-logs`），接入真实 HTTP/OpenAPI 与 SSE 传输通道。
  - 完成 Live Server 基础生命周期 Smoke：`liveSmoke.test.ts` 验证真实进程拉起、端口探测、`provider.list()` 发现、Session 创建（`/session`）、Session 状态查询、消息列表与 Session 销毁（`/session/{id}`）。
  - 完成 6 条 Provider Route 矩阵真实调用 Smoke：`liveSmokeMatrix.test.ts` 验证 OpenAI (`gpt-4o`)、xAI (`grok-4`)、Google (`gemini-2.5-pro`)、DeepSeek (`deepseek-chat`)、Moonshot-native Kimi (`kimi-k2.5`)、OpenAI-compatible Kimi (`kimi-k2.5`) 均能成功在真实 OpenCode 进程中完成会话创建、状态机同步与清理。
- **F38 (Executable Readiness Gate)**：在 `OpenCodeNativeRuntimeAdapter.spawnEntity` / `createSession` / `resumeSession` 中增加强制 readiness 检查。当 runtime descriptor 为 `unavailable` 或执行能力为 `implementation missing` 时，阻止生成可执行 Entity，抛出类型化的 `CraftingError.runtimeUnavailable`，防止未验证组合进入生产执行路径。
- **F39 (Native Envelope Allowlist & Deduplication State Machine)**：
  - `NativeEventEnvelope.payload` 实施严格的键值白名单过滤（`id`, `sessionID`, `messageID`, `partID`, `callID`, `permissionID`, `type`, `status`, `code`, `field`, `name`, `role`, `deltaLength`, `textLength`, `finishReason`, `action`），彻底剔除 raw provider payload、完整用户 Prompt 与未知嵌套敏感结构。
  - 实现 `OpenCodeEventMapperState` 状态机，根据 `messageID` 过滤 `user`/`system` 角色的流式 delta，并追踪 `partID` 已发送字符长度，对 `message.part.updated` 全量快照进行增量去重，彻底消除 `hellohello` 重复流式输出。
- **F40 (Auth/Profile Ref & Options Passing)**：
  - 规范传递 `authRef` 与 `profileRef`，绝不在 CraftPlan 或 Event 中内联泄露 API Key、Token 等敏感凭据。
  - 将 CraftPlan 中的 `permission`、`mcpServerIds`、`skillIds`、`context` 配置正确传递给 OpenCode server `createInput`。
- **F41 (Error & Failure Immediate Settlement)**：在 `session.error`、`session.next.step.failed`、`session.failed` 与 `session.exited` 事件到达时，立即对 `pendingTurn` 执行 `reject` 并标记 Session 为 `error`，不再无限等待 `session.idle`，消除调用者悬挂风险。
- **F42 (Permission & Question Response Seam)**：在 `CraftSession` 接口与 `OpenCodeNativeSession` 中实现 `respondToRequest(requestId, resolution)` 闭环方法，支持通过官方 SDK 调用 `permissions.respond`，并在收到回答后发射 `request.resolved` 事件。
- **F43 (Session Model Stickiness & Options Binding)**：
  - 在 `OpenCodeNativeSession` 构造与 `open` 时冻结 `effectiveProviderID` 与 `effectiveModelID`；在 `startTurn` 中校验 `command.overrides.model`，若尝试在活跃 Session 中跨模型切换则抛出 `CraftingError.incompatibleCombination`，保证 Session 身份粘性。
- **F44 (Diagnostics Phase & safeMessage Sanitization)**：
  - 修正 `safeMessage` 的正则替换逻辑，避免 `$1` 无捕获组乱码，并统一对 URL 参数中的敏感凭据脱敏。
  - 将 diagnostic 阶段精准映射为规范的 `discovery`、`start`、`readiness`、`turn`、`dispose` 等合法生命周期阶段。

## Added

- `src/supervisor/runtime/openCodeNative/liveSmoke.test.ts`：真实 `opencode.exe` 进程拉起与核心 Session 生命周期 E2E Smoke 测试。
- `src/supervisor/runtime/openCodeNative/liveSmokeMatrix.test.ts`：覆盖 6 种 Provider Route 的真实 OpenCode 服务会话矩阵测试。
- `src/supervisor/runtime/openCodeNative/engineeringRegression.test.ts`：新增针对 F38–F44 所有修复点的端到端单测与契约回归测试套件。
- `ai_workspace/validation/v0.8.0-opencode-compatibility.json`：更新为真实 CLI v1.18.25 探针与 6 条 Provider 路由验证记录。
- `ai_workspace/validation/v0.8.0-live-smoke-2026-08-30.txt`：11 个测试文件、60 个测试全部 PASS 的现场执行记录。

## Evidence

### Tests and static checks

- 定向测试套件：11 个测试文件、60 个测试全部通过（`60 passed`）：
  - `src/shared/opencodeNative/events.test.ts`
  - `src/shared/opencodeNative/modelCompatibility.test.ts`
  - `src/shared/opencodeNative/recipes.test.ts`
  - `src/supervisor/runtime/openCodeNative/client.test.ts`
  - `src/supervisor/runtime/openCodeNative/serverProcess.test.ts`
  - `src/supervisor/runtime/openCodeNative/session.test.ts`
  - `src/supervisor/runtime/openCodeNative/engineeringRegression.test.ts`
  - `src/supervisor/runtime/openCodeNative/liveSmoke.test.ts`
  - `src/supervisor/runtime/openCodeNative/liveSmokeMatrix.test.ts`
  - `src/shared/crafting/openCodeNativeComposition.test.ts`
  - `src/shared/crafting/crafting.test.ts`
  - `src/shared/crafting/nativeHarnessRegistry.test.ts`
  - `src/supervisor/runtime/nativeHarness/controlPlane.test.ts`
- TypeScript：`pnpm exec tsc --noEmit -p tsconfig.json` 0 错误通过。
- 定向 `oxlint --deny-warnings`：0 错误 0 警告通过。
- 定向 `oxfmt --check`：所有相关 27 个文件全部通过。
- 工作树 Git 状态与 package.json 保持严格干净一致，未引入无关依赖修改。

## Remaining

- 交接给绑定 Debugger (`Debugger-0.8-OpenCode Native`) 进行独立双轴复检。
- 未授权且未执行 commit / push / tag / merge nested Dev / merge main。
