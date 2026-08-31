# Coder — v0.4.1 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.1`
>
> 状态：Coder 已完成 Debugger Fix Plan 的实现、证据记录与回归自检；等待 Debugger 独立 Re-review。Feature 仍不可宣称 PASS。

## 本轮完成内容

### F01 — capability descriptor 诚实性

- [descriptors.ts](../../craftstation/src/supervisor/runtime/nativeHarness/descriptors.ts) 不再把静态 adapter wiring 或 fixture 当作真实集成证据。
- 没有完整 ACP/PTY/app-server native session 证据的能力统一保持 `implementation missing`。
- 原生明确不支持的能力保持 `native unsupported`；DSH 的全部能力保持 `unavailable`。
- [nativeCodexBaselineGuard.test.ts](../../craftstation/src/supervisor/runtime/nativeCodex/nativeCodexBaselineGuard.test.ts) 锁定 Codex 官方 app-server boundary 与非 synthetic capability 状态。

### F02 — Craft Table Recipe 选择

- [CraftingGrid.tsx](../../craftstation/src/renderer/components/crafting/CraftingGrid.tsx) 一键填充 Recipe 时使用该 Recipe 的 `harnessItemId`。
- 从 `modelVendors` 选择匹配 vendor 的 Model Item；Grok、Kimi、Antigravity、DeepSeek 不再被 `auto`（确定性 Codex）劫持。
- [CraftingGrid.test.tsx](../../craftstation/src/renderer/components/crafting/CraftingGrid.test.tsx) 覆盖四个非 Codex Recipe 的 harness/model 选择与 compile binding。

### F05 — 生产路由回归

- [runtime.test.ts](../../craftstation/src/supervisor/runtime.test.ts) 通过 `SupervisorRuntime.craftAgent` 生产入口覆盖 Grok/Kimi/Antigravity 的 native factory 路由。
- DeepSeek 通过 unavailable adapter 在 spawn 处返回 `RUNTIME_UNAVAILABLE`，并断言不产生 synthetic Entity。
- 测试使用 factory seam 注入 provider process fixture，不调用 `setCustomCraftingAdapter()`，没有绕过 `createCraftingAdapter`。

### F03 — live Control Plane 与 Renderer IPC

- [supervisorRuntime.ts](../../craftstation/src/supervisor/supervisorRuntime.ts) 聚合最近 native adapter/session 的诊断与 AgentStatus readiness。
- 空的待登录 Account profile 不再被误报为已认证；只有已记录 credential/status 的 account 才进入 `profileConfigured`。
- [controlPlane.ts](../../craftstation/src/supervisor/runtime/nativeHarness/controlPlane.ts) 继续执行脱敏投影，Renderer 不接收物理路径、token、cookie、`CODEX_HOME`、profile ref 或 raw details。
- [HarnessPanel.tsx](../../craftstation/src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.tsx) 通过 typed IPC 展示五个 Harness 的就绪、未配置、不可用和错误状态，并监听 Supervisor status events 刷新。
- control-plane 测试增加 pending empty profile 的回归覆盖；Renderer 测试覆盖五行状态和敏感字段不外泄。

### F04 — 真实 Native Probe

- 直接启动官方 `codex app-server --stdio`、`grok agent stdio` 和 `kimi acp` 执行有界 initialize/session/prompt/interrupt-or-cancel/cleanup 探针。
- 真实结果已写入 [v0.4.1-native-session-probe.md](../validation/v0.4.1-native-session-probe.md)。Codex/Kimi 只得到部分生命周期证据，Grok 在 `session/new` 超时；因此没有把任何未完成的能力升格为 `supported+integrated`。
- Antigravity 保持 `unprobed`（仅 soft keyring/config 信号）；DeepSeek 保持 `unavailable`，没有启动旧 DSH 或任何 API 假 Harness。

## 验证结果

在 `D:\Work\CraftStation\craftstation` 执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts
```

- 19 个测试文件，131 tests passed。

```text
pnpm typecheck
pnpm exec oxlint --deny-warnings src/supervisor/runtime.test.ts src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/supervisor/supervisorRuntime.ts src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.test.tsx
pnpm exec oxlint --type-aware --deny-warnings -c .oxlintrc.type-aware.json src/supervisor/runtime.test.ts src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/supervisor/supervisorRuntime.ts src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel/HarnessPanel.test.tsx
git diff --check
```

- TypeScript typecheck：通过。
- 定向 lint 与 type-aware lint：通过。
- `git diff --check`：通过（仅报告已有 `supervisorRuntime.ts` CRLF 转换提示，无 whitespace error）。

## 未宣称的内容

- 本轮没有 Feature PASS，也没有把 fixture lifecycle acceptance 当作真实 provider acceptance。
- Codex/Kimi 没有完整真实 model response/stream/tool acceptance；Grok、Antigravity 没有完整真实 session acceptance。
- Universal Skill/MCP/Subagent/Permission、Auto-Crafting、Gemini CLI、CLIProxyAPI、旧 DSH 均未进入本轮执行路径。
- 工作树包含其他用户/并行角色未提交改动；没有执行 reset、checkout、清理、commit、tag 或 push。

## 请求 Debugger 复检

请独立读取 `PROJECT_STATUS.md`、本交接文档与 validation 证据，按 Debugger 质量门重新复跑源码、测试、Control Plane、Recipe 路由和真实运行时证据；在真实 session 证据不足时继续保持 `unprobed`/`error`/`unavailable`，不要据此宣称 Feature PASS。
