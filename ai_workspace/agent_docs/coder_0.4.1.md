# Coder — v0.4.1

## 修复循环范围

本报告对应 Debugger `v0.4.0` 的 FAIL Fix Plan，当前 Fix Cycle 为 `v0.4.1`。本轮未改变 Feature 目标，也未回滚或清理并行 UI、数据库、sidecar 或其他工作树修改。

本轮执行的修复范围是 Codex 独立 Profile 登录端到端 seam、跨平台安全校验、Account ontology 守卫和回归测试。右侧面板、Composer、Git Review 等并行 UI 布局文件没有修改。

## 已完成修复

### F01/F03 — 独立 Profile 登录端到端接线

- Renderer `createAndRunCodexProfileLogin` 先调用 `createCodexProfile`，再使用返回的 `accountId` 调用 `startCodexProfileLogin`。
- 已授权/未授权的既有 Codex 账号继续复用 `runCodexProfileLogin`。
- 登录过程复用 `LoginTerminalOverlay` 和既有 routed terminal completion marker；成功后按顺序刷新 `refreshAccountQuota({ accountId })` 与 `listAccounts({ provider: "codex" })`。
- completion 非零退出会标记 Overlay 失败；shell 在 marker 缺失时退出也会把真实退出码传给失败处理。
- Overlay 取消、后端启动失败和重复点击均有幂等处理；不会重复启动或留下未关闭的 profile login shell。
- 既有 Sidebar 按钮接线保留，未回滚提交 `2109352` 的行为。

### Supervisor / shared 安全 seam

- `SupervisorRuntime.startCodexProfileLogin` 按 `accountId` 校验账号存在、provider、enabled 状态与 host-native project location。
- Windows managed `CODEX_HOME` 不会被投影到 WSL；WSL/宿主不匹配返回 `ACCOUNT_RUNTIME_UNSUPPORTED`，且不会 spawn PTY。
- managed `CODEX_HOME` 只进入 supervisor-owned PTY 的环境，不进入 renderer payload、返回值或登录脚本。
- Supervisor 在启动后写入登录脚本失败时主动关闭该 shell，再将原始错误透传给调用方，避免孤儿 PTY。
- `startCodexProfileLogin` 继续通过 shared Zod contract 与 supervisor-only IPC 暴露：

```ts
{
  accountId,
  shellId,
  projectLocation,
  completionToken,
  windowsShellRuntime?: "preferred" | "powershell"
}
```

返回：

```ts
{
  (shellId, label, completionToken);
}
```

### F02 — Account ontology 边界守卫

- `src/shared/crafting/accountBoundaryGuard.test.ts` 现在递归扫描整个 `src/shared/crafting` 非测试 TypeScript 源码。
- 守卫拒绝 `AccountStore`、`AccountResolver`、`TokenUsage`、`peripheralSidecar`、`CODEX_HOME` 和 `accountBinding` 进入 Crafting core。
- 同时继续守卫 official Codex runtime 不依赖 CLIProxyAPI。

## Regression Validation

已执行并通过：

- `pnpm exec vitest run --configLoader runner src/renderer/actions/agentLoginActions.test.ts src/supervisor/runtime.test.ts src/shared/crafting/accountBoundaryGuard.test.ts src/supervisor/runtime/codexProfiles.test.ts`：4 files / 67 tests passed。
- 后端/共享 targeted：9 files / 76 tests passed。
- Renderer/Overlay/IPC targeted：3 files / 23 tests passed。
- `pnpm exec tsc --noEmit -p tsconfig.json`：PASS。
- 受影响文件 `oxlint --deny-warnings`：PASS。
- 受影响文件 `oxfmt --check`：PASS。
- 全项目 `pnpm run lint`：PASS。
- `git diff --check`：PASS。
- `cargo check --manifest-path native/peripheral-sidecar/Cargo.toml`：PASS。
- `cargo test --manifest-path native/peripheral-sidecar/Cargo.toml`：PASS（该 crate 当前无 Rust unit test，运行结果 0 passed / 0 failed）。
- 独立复跑既有 `src/supervisor/agents/cursor/sdkWorkerClient.test.ts`：8 passed / 2 skipped。

全量 Vitest 曾在并发运行期间先报告既有 Cursor SDK case `surfaces deployment and boot protocol failures without hanging` 失败，随后长时间无进展而中止；该文件独立复跑通过，不能把这次不稳定的全量尝试写成全量 PASS。受影响 targeted suite 是本轮可复核的回归证据。

## 未完成与诚实边界

- 真实两个官方 Codex Profile 的浏览器/Device 登录、独立 quota、sticky Session、quota-exhausted fallback 仍需要具备真实账号凭据的人工验收。
- 本轮没有把 synthetic PTY/IPC 测试当作真实官方 Codex round-trip 证据，也没有把 Feature 标记为 PASS。
- Debugger F01 的真实证据要求仍保持 BLOCKED，直到用户或 Debugger 在安全环境中完成真实凭据验收。

## 交接状态

Coder 已完成本轮 Fix Plan 和 Regression Validation，当前状态为 `READY FOR DEBUGGER RE-REVIEW`。请 Debugger 独立复核源码、测试、跨平台错误语义和真实双 Profile 验收边界；不要依据本报告自述直接关闭 Feature。
