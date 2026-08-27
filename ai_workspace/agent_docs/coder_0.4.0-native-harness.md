# Coder — v0.4.0 Native Multi-Harness Compatibility

## 交接状态

Coder 已按 Manager `v0.4.0` Execution Order 连续完成 T01 → T10，并完成
Feature-level self-check。当前交给 Debugger 做独立 Feature Review；Coder 不将
本交接文档或自动化测试结果当作最终 PASS。

## 交付范围

- T01：五个平级目标的 Native Harness audit 与 capability matrix，明确
  Antigravity 是 Google/Gemini 侧目标、Gemini CLI 不在范围；DeepSeek/DSH 当前
  `runtime unavailable`，没有使用旧 DSH、CLIProxyAPI 或 Model API 伪造。
- T02：`Crafting -> CraftPlan -> Native Harness Runtime -> Entity -> Session`
  最小 seam，保留 profile/environment binding、native event envelope、诊断和
  稳定错误码；共享层不拥有 provider Agent Loop。
- T03：官方 Codex `codex app-server --stdio` baseline guard，保留 native
  thread/session identity、resume、stream、interrupt、cleanup 和 native event。
- T04/T05：Grok Build 官方 ACP/stdio、Kimi Code 官方 ACP 的独立 Adapter、
  session/resume/stream/cleanup fixture 与 provider-specific capability state。
- T06：Antigravity 官方 `agy` PTY Adapter，覆盖 PTY stream、interrupt、crash、
  cleanup；provider keyring 认证仍只作为 soft signal。
- T07：DeepSeek/DSH 保留独立 unavailable adapter 和稳定
  `RUNTIME_UNAVAILABLE` 诊断，不创建 synthetic Entity/Session。
- T08：五 Harness lifecycle acceptance matrix，覆盖 discovery、start/resume、
  multi-turn、stream、interrupt、cleanup 及无泄漏进程约束。
- T09：新增 Supervisor-owned 安全 control-plane projection 与 typed IPC
  procedure `getNativeHarnessControlPlane({ harnessKind? })`。Renderer 只获得
  脱敏 descriptor、transport、capability state、ready/not-configured/unavailable/
  error、profileConfigured、environment kind 和稳定诊断；不获得 profileRef、
  credentialScopeRef、`CODEX_HOME`、executablePath、token、cookie、providerCode、
  原始 details、完整 prompt 或 runtime object。
- T10：完成 Component 候选、Adapter 保留边界、Item promotion 门槛和 v0.5
  Ideate handoff；没有实现 Universal*、Auto-Crafting、Recipe Search 或 Learned
  Router。

## 关键交付文件

- `craftstation/src/shared/crafting/runtimeInterface.ts`
- `craftstation/src/shared/crafting/nativeHarness.ts`
- `craftstation/src/shared/crafting/nativeHarnessArchitectureGuard.test.ts`
- `craftstation/src/supervisor/runtime/nativeHarness/`
- `craftstation/src/supervisor/runtime/nativeHarness/controlPlane.ts`
- `craftstation/src/supervisor/runtime/nativeHarness/controlPlane.test.ts`
- `craftstation/src/supervisor/runtime/nativeCodex/`
- `craftstation/src/shared/ipc/procedures/nativeHarness.ts`
- `craftstation/src/shared/ipc/procedureMap.ts`
- `craftstation/src/supervisor/ipcHandlers.ts`
- `craftstation/src/supervisor/supervisorRuntime.ts`
- `ai_workspace/validation/v0.4.0-native-harness-audit.md`
- `ai_workspace/validation/v0.4.0-capability-decomposition-handoff.md`

## 验证证据

已执行并通过：

- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/supervisor/runtime.test.ts`
  —— 17 个测试文件、116 个测试全部通过。
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/nativeHarnessLifecycleAcceptance.test.ts`
  —— 5 个测试通过。
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/controlPlane.test.ts`
  —— 4 个测试通过。
- `pnpm typecheck` —— 通过。
- `pnpm lint` —— 通过。
- `pnpm build` —— renderer 与 Electron 主进程均构建通过；仅有既有 Vite/CSS
  兼容性、sourcemap 与 chunk size warnings，无构建错误。
- `git diff --check` —— 通过。
- `codegraph sync` —— 同步 8 个变更文件。
- `codegraph status` —— `Index is up to date`（2,889 files、40,313 nodes、151,311 edges）。

本轮回归修复：control-plane 在原生协议/进程错误已投影为 `error` 时不再追加
误导性的 `RUNTIME_NOT_CONFIGURED` readiness fallback；对应 Native Harness 回归
已重新全量通过。

真实 provider login、认证握手和模型 response 本轮没有主动执行；应由 Debugger
独立判断是否需要 opt-in smoke，并将未执行项记录为 `unprobed`，不能把 fixture
通过解释为真实 runtime PASS。

## 并行修改保护

本轮未修改或提交并行前端正在处理的 Thread、SidebarProviderAccounts、
UnifiedRightPanel、GitReviewOverlay 等文件；工作树中的其它用户/角色修改均保留。

## Debugger 下一步

请读取 `PROJECT_STATUS.md`、本交接文档、Manager 文档和两份 validation 文档，
按 Manager acceptance matrix 对源码、测试、CodeGraph、安全 IPC 投影及真实
runtime evidence 做独立验收。当前只申请 Review，不宣称 v0.4.0 PASS。
