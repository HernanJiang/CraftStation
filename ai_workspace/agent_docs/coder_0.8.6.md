# CraftStation Coder 交付 — v0.8.6 Fix Cycle

Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`

工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`

分支：`feature/v0.8-opencode-native`

基线：`dev / 7ae6506ea01fc04029a10a711ebb0a65d7248e06`

状态：已连续完成 Debugger v0.8.5 最终 Fix Plan 的 F40 credential process boundary、F42 生产 IPC 与 SDK v2 request event 闭环、F44 diagnostic redaction，并保持 F38 readiness、server pool/restart、diagnostic phase/correlation 回归。当前交回原配对 Debugger 独立复检；本文件不宣称 Feature PASS。

## Existing

- 保留官方 `opencode serve` HTTP/OpenAPI + SSE machine-facing transport，不使用 TUI、键盘注入或屏幕模拟。
- 保留 F38 route-specific fail-closed executable readiness gate；未验证或不可用 route 不能编译或实例化为 executable CraftPlan/Entity。
- 保留 F39 mapper role state、snapshot/delta 去重和 native envelope allowlist，F41 pending turn error settlement，F43 Session provider/model 粘性与 unsupported option 显式拒绝。
- 保留 F40 Supervisor-owned binding/server pool 的同 scope reuse、跨 scope 隔离、connection rejection/child exit 驱逐和 restart recovery。
- 保留六条 Model/Provider route，以及 Kimi 的 Moonshot-native 与 OpenAI-compatible 双 route；DeepSeek Model 不绑定 DeepSeek Harness。

## Fixed

### F40 — child credential process boundary

- `OpenCodeNativeTransport` 不再用 `{ ...process.env, ...command.env }` 启动 child；改为 allowlist-first 的最小系统环境。
- 只向 child 注入当前 Supervisor account 投影环境和 server 自身认证变量；无关 Provider key、其他 account marker 与 `NODE_OPTIONS` 不可见。
- `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、XDG 路径与 `OPENCODE_CONFIG_DIR` 指向当前 transport 的私有 runtime root。
- 受管 account 使用其 credential root；匿名 carrier 使用临时私有 root，并在 dispose 时按已校验的临时目录边界清理。

### F42 — production IPC request routing

- `createSupervisorIpcHandlers.resolveThreadServerRequest` 现在通过 `SupervisorRuntime` 分流，不再固定进入 legacy `ThreadSessionManager`。
- crafted Session 的 `request.opened` 安全上下文按 thread/request identity 保存；Renderer 的 permission/question response 被转换为 typed `CraftRequestResolution` 后送达 `CraftSession.respondToRequest`。
- legacy thread 继续委托原 `ThreadSessionManager`；unknown/expired request、未知 permission decision、禁止 custom 的未知 question option 均 fail closed。
- request resolved 或 Session release 后清理 pending request context。

### F42 — official SDK v2 request events

- canonical mapper 支持 `permission.v2.asked/replied` 与 `question.v2.asked/replied/rejected`。
- permission 安全投影 action/resources/source；question 安全投影 questions/options/`multiSelect`/custom/tool context。
- permission allow-once/always/reject 分别进入官方 `permission.reply`；question answer/reject 分别进入官方 `question.reply` / `question.reject`。
- v2 replied/rejected 发出 canonical `request.resolved`，并正确区分 accepted/answered/declined。

### F44 — diagnostic redaction

- 修复 Authorization Bearer/Basic、Proxy-Authorization、独立 Bearer/Basic、query secret、JSON key/value 和 camelCase `apiKey` 的脱敏。
- nested `auth`、`oauth`、`credential`、password/token/cookie/secret 等字段在 diagnostic details 中整体脱敏。
- replacement 使用 callback，避免无捕获组配合 `$1` 造成泄漏或替换污染。

## Added

- `src/supervisor/runtime/craftedRequestResolution.ts`：Renderer 通用 response 到 typed native request resolution 的生产边界。
- `transport.test.ts`：当前 account/server env 可见、宿主无关 Provider/account marker 不可见的负向断言。
- `runtimeBinding.test.ts` / `serverPool.test.ts`：credential root、scope reuse/isolation、rejected connection 与 child-exit recovery。
- `events.test.ts`：SDK v2 permission/question asked/replied/rejected contract。
- `src/shared/ipc.test.ts` / `src/supervisor/runtime.test.ts`：handler-level crafted request routing、permission/question resolution 与 legacy fallback。
- `diagnostics.test.ts`：Debugger reverse probe 对应的 header/JSON/nested secret 无泄漏断言。

## Evidence

- Debugger focused：8 files / 56 tests PASS。
- 用户定向套件：15 files / 104 tests PASS。
- Broader Crafting/Native/IPC：18 files / 193 tests PASS。
- 真实官方 OpenCode carrier smoke：2 files / 8 tests PASS；`opencode.exe 1.18.25` 的 serve、HTTP/OpenAPI、SSE、Session create/get/messages/error/delete lifecycle 通过。
- Feature source 41 files：`oxlint --deny-warnings` PASS；`oxfmt --check` PASS。
- TypeScript：`pnpm exec tsc --noEmit -p tsconfig.json` PASS。
- `git diff --check` PASS；`package.json`、`pnpm-lock.yaml` 相对 HEAD 无差异。
- smoke 后无残留 `opencode` 进程。
- compatibility artifact：`probe.status=verified`，records=6，available=0，unverified=6，`providerAssistantResponse=unverified`=6。
- 全仓 oxlint/oxfmt 仍存在 Debugger 已记录的非 v0.8 既有阻断；本轮没有为全仓全绿修改无关文件。

详细命令与边界见 `ai_workspace/validation/v0.8.6-coder-fix-evidence-2026-08-30.txt`。

## Remaining

- F37 六条 route 的真实 Provider assistant stream、成功后续 turn，以及适用的 tool/usage/compaction 仍缺对应 Provider credentials；当前只能证明真实 Server Session/error lifecycle。
- compatibility 六路必须继续保持 `unverified`；不得把 carrier smoke、contract tests 或 catalog 记录升格为 Provider E2E PASS。
- 等待原配对 `Debugger-0.8-OpenCode Native` 独立复检 F38/F40/F42/F44；Debugger PASS 前不得 Feature→Dev merge。
- 未执行 commit、push、tag、merge dev/main；Main promotion 仍为 `NOT AUTHORIZED`。
