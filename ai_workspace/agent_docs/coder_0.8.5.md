# CraftStation Coder 交付 — v0.8.5 Fix Cycle

Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`

工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`

分支：`feature/v0.8-opencode-native`

基线：`dev / 7ae6506ea01fc04029a10a711ebb0a65d7248e06`

状态：已完成 Debugger v0.8.5 要求的 F38/F40/F42/F44 工程修复和回归验证，交回同一配对 Debugger 独立复检。F37 官方 headless Server carrier 已验证；六条 Provider assistant response 因未提供对应凭据，仍保持 `unverified`，没有 synthetic PASS。

## Existing

- 保留既有 Crafting、Registry、Crafter、Native Harness、Supervisor IPC 和 UI seam。
- 保留 OpenCode 官方 `opencode serve` HTTP/OpenAPI + SSE machine-facing 边界；不抓 TUI、不注入键盘、不模拟屏幕。
- 保留六条 Model/Provider 组合及 Kimi 的 Moonshot-native / OpenAI-compatible 双 route 区分。
- 保留 v0.4/v0.5/v0.6/v0.7 的既有失败或阻塞口径；没有修改其他 Feature worktree、main、dev，也没有 commit/push/tag/merge。

## Fixed

### F38 — route-specific executable readiness gate

- `Crafter` 在 OpenCode Recipe compile 时消费显式 `checkExecutableReadiness`；未配置 provider 时默认 `unverified`，不生成 executable CraftPlan/ResultItem。
- `OpenCodeNativeRuntimeAdapter` 在 spawn/create/resume 三个边界再次执行 route-specific gate；静态 descriptor 和 Provider×Model×Auth readiness 均必须通过。
- 新增六路 route 的 `unverified` / `unavailable` 反向测试和 verified fixture 测试。未取得 assistant response 的 compatibility record 不可生成 executable Entity。

### F40 — Supervisor-owned auth/profile/server lifecycle

- 新增 `AccountStore.readCredentialEnvironment`，只读取 Supervisor 管理的 account credential scope；secret 不进入 Plan、Renderer、native envelope 或 diagnostic。
- 新增 `AccountStoreOpenCodeRuntimeBindingResolver`：校验 provider/account 对应关系，形成包含 workspace、credential scope、auth/profile ref 的隔离 key；未解析的 opaque ref 明确拒绝。
- 新增 `OpenCodeNativeServerPool`：相同隔离 binding 复用 server，不同 binding 分池；child exit 驱逐 poisoned entry，下一次 acquire 重建。
- `SupervisorRuntime` 持有 resolver/pool，并把 OpenCode provider account selection 接入现有 account resolver；dispose 时统一释放 pool。
- 按已核对 SDK v2 类型，`permission` 是当前 Session create 可证明应用的 option；MCP/Skills/context/compaction/custom settings/approval policy 未接入对应生产 resolver 时显式拒绝，不再静默忽略。

### F42 — typed permission/question response loop

- `CraftRequestResolution` 改为 discriminated union：permission `once/always/reject`、question `answers: string[][]`、question reject。
- permission 使用官方 `permission.reply`；question 使用独立官方 `question.reply` / `question.reject`，不再调用 deprecated `permissions.respond`。
- `question.asked` 安全投影保留 header、question、options、multiple、custom 和有限 tool context；未知字段和 nested secret 不进入公开 envelope。
- response/reject 成功后分别发出 `request.resolved` 的 accepted/answered/declined outcome。

### F44 — unified diagnostics

- 新增统一 `buildOpenCodeNativeDiagnostic`、`diagnosticPhase` 和安全 details projection。
- 精确覆盖 discovery、connect/readiness、server start/session create、resume、turn、interrupt、SSE reconnect、dispose、child exit operation mapping。
- 所有 Session callback 使用注入 correlation 后的最终 diagnostic record；Basic/Bearer、query、nested secret 和 `$1` replacement corruption 均有回归测试。

## Added

- `src/supervisor/runtime/openCodeNative/diagnostics.ts` / `diagnostics.test.ts`
- `src/supervisor/runtime/openCodeNative/runtimeBinding.ts` / `runtimeBinding.test.ts`
- `src/supervisor/runtime/openCodeNative/serverPool.ts` / `serverPool.test.ts`
- `src/supervisor/runtime/openCodeNative/adapter.test.ts`
- 扩展 `events.test.ts`、`session.test.ts`、`transport.test.ts`、`engineeringRegression.test.ts`，覆盖 F38/F40/F42/F44 正反向 contract。
- 修正 `ai_workspace/validation/v0.8.0-opencode-compatibility.json`：probe 为 `verified`，六路顶层为 `unverified`，并分别记录 `serverSessionLifecycle=verified`、`providerAssistantResponse=unverified`。

## Evidence

- OpenCode focused suite：8 files / 52 tests PASS。
- Broader Crafting/Native suite：16 files / 114 tests PASS。
- Real OpenCode smoke：2 files / 8 tests PASS；六路 matrix 的证据是实际 Server Session 创建、无凭据错误安全收口和清理，不是 Provider assistant response PASS。
- TypeScript：`pnpm exec tsc --noEmit -p tsconfig.json` PASS。
- Feature touched-file `oxlint --deny-warnings` PASS；Feature touched-file `oxfmt --check` PASS；`git diff --check` PASS。
- `package.json`、`pnpm-lock.yaml` 相对基线无 diff。
- compatibility artifact 当前计数：probe `verified`，records `6`，`available=0`，`unverified=6`，assistant response 未验证 `6`。
- 全仓既有 oxlint/oxfmt 阻断按 Debugger v0.8.5 原口径保留，不为全绿修改无关文件。

## Remaining

- F37 Provider assistant stream、后续 turn 以及适用 tool/usage/compaction 的真实六路 E2E 仍需对应官方凭据；在凭据可用前保持 `unverified`，不得升格 capability 或 compatibility record。
- 需要绑定 Debugger `Debugger-0.8-OpenCode Native` 独立复检 F38/F40/F42/F44；本交付没有宣称 Feature PASS。
- 未授权 commit、push、tag、Feature→Dev merge 或 main promotion。
