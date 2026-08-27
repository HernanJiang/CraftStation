# Coder — v0.4.7 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.7`
>
> 状态：已按 `debugger_0.4.7-native-harness.md` Fix Plan 完成 F14 / F12 / F13。等待 Debugger 独立复检。v0.4 Feature 仍不可宣称 PASS。

## F14 — Codex profile login 三个用例 + Work profile 按钮回归（本轮改动文件必须修绿）

### 修复内容

- `agentLoginActions.test.ts`：
  - 「marks an isolated profile login failed」：改为先启动 `runCodexProfileLogin`（不 await）、等 `startCodexProfileLogin` 被调用、emit completion/exit 后再 `await` 结果。之前 `await runCodexProfileLogin(...)` 会等 `loginFinished` 才继续，而 emit 在其后 → 死锁超时。
  - 「cancels the profile shell」：同样改为先启动、等 open、触发 `onForceClose`、断言 `closeThread`，最后 `await` 结果。
  - 「rejects repeated profile login starts」：前两段逻辑保持；因用例 1 不再死锁，`codexProfileLoginStartInFlight` 不再被卡住污染后续断言。
- `agentLoginActions.ts`：`runCodexProfileLoginInternal` 的 `onForceClose` 现在**立即 settle login**（`settleLogin(false)`），不再等 pending `startCodexProfileLogin` IPC 往返；用户取消视角是同步的，`loginFinished` 一定 resolve。
- `SidebarProviderAccounts.tsx`：`signedInCodexAccounts` 过滤从「仅 maskedIdentity/providerAccountId」放宽为「credentialScopeRef 或 maskedIdentity 或 providerAccountId」，使 `auth-expired` 等未认证但已受管的 Codex 账号出现在账号池，并可点击「登录授权」按钮（`CODEX_LOGIN_REQUIRED_STATUSES` 已含 auth-expired）。

### 结果

- `agentLoginActions.test.ts`：22/22 passed。
- `SidebarProviderAccounts.test.tsx`：8/8 passed。

## F12 — Grok 添加账号对齐 Codex isolated profile

### 生产路径（已接 IPC/UI）

```text
Sidebar Grok 卡片
→ createAndRunGrokProfileLogin (renderer action)
→ createGrokProfileLogin (supervisor) 建 pending managed GROK_HOME（不落 AccountStore）
→ startGrokProfileLogin (supervisor)：GROK_HOME=<pending> 下跑官方 grok login --device-auth
→ 用户完成 device-auth（auth.x.ai / accounts.x.ai）
→ completeGrokProfileLogin (supervisor)：读 pending home 的 auth.json，
    有 email/principal_id/user_id 才 importAuthJson → 落 AccountStore 行
失败 / 取消 / 无 identity → cancelGrokProfileLogin，不落行
```

### 新增

- `src/shared/contracts/grokProfiles.ts`：`grokProfileLoginCreatePayload/Result`、`grokProfileLoginPayload/Result`、`grokProfileCompletePayload`、`grokProfileCancelPayload`。
- `SupervisorRuntime`：
  - `createGrokProfileLogin({ label })` → `grokPendingLogins` Map（`pendingRef → { label, home, createdAt }`），home 由 `createPendingGrokHome` 建，**不写 AccountStore**。
  - `startGrokProfileLogin({ pendingRef, shellId, projectLocation, completionToken })` → 校验 pending、host-native、用 `managedGrokProcessEnvironment(home)` 启动官方 `grok login --device-auth`。
  - `completeGrokProfileLogin({ pendingRef })` → `grokProfileService.importAuthJson({ label, profileRoot: home })`，identity 门控，成功落行 + emit；无 identity 抛错不落行并清理 pending。
  - `cancelGrokProfileLogin({ pendingRef })` → 移除 pending，不落行。
- IPC procedures（usage.ts）：`createGrokProfileLogin`、`startGrokProfileLogin`、`completeGrokProfileLogin`、`cancelGrokProfileLogin`；ipcHandlers 注册。
- Renderer action：`createAndRunGrokProfileLogin`（pending → start → watch completion → complete/cancel，复用 login terminal 与 completion 协议）。
- Sidebar：Grok 卡片 `handleAccountAction` 走 `createAndRunGrokProfileLogin`，不再走普通 `runAgentLoginCommand`；`CLI_LOGIN_COMMANDS` 移除 grok。

### 测试（runtime.test.ts Grok profile login，5 用例）

1. 创建 pending 不落 AccountStore 行。
2. 启动官方 device-auth，spawn env 的 `GROK_HOME=<pending home>`，且不含 `GROK_API_KEY`/`XAI_API_KEY`。
3. 完成且带官方 identity → 落行（status available、maskedIdentity、emit usage-accounts、pending 清空）。
4. 完成但无 identity → 抛错、不落行、pending 清空。
5. 取消 → 不落行、pending 清空。

## F13 — Grok spawn env 必须来自 managedGrokProcessEnvironment

- `createCraftingAdapter` 的 grok 分支：`baseSpawnEnv` 从 `{ GROK_HOME: accountRoot }` 改为 `managedGrokProcessEnvironment(accountRoot)`。
- 该函数剥离 `GROK_API_KEY` / `XAI_API_KEY` / `CLIPROXY*` / `CODEX_ROUTER*` / `MODEL_CATALOG*`，并固定 `GROK_HOME=<managed root>`，宿主 Router/CLIProxy/API-key 不会泄漏进 spawn。
- `runtime.test.ts` 的 Grok account control plane 黄金测试已覆盖 baseSpawnEnv（含 GROK_HOME 指向对应 managed root）；新增「启动登录 spawn env 不含 API-key」断言。

## F08 保持

- Grok 卡片不再打开 `grok.com`；登录走官方 `grok login --device-auth`（现在在 managed GROK_HOME 内）。`agentLoginActions.test.ts` 的 device URL（`accounts.x.ai/oauth2/device`，不含 grok.com）测试保持通过。

## F09 边界

- 未读取/复制/导入 Codex Router `xai-*.oauth.json`、cookie、refresh token。
- 未把 CLIProxyAPI 接入 Native Grok Adapter。
- 未把 `~/.grok/auth.json` 全局覆盖当作默认切号；受管 Session 一律 `GROK_HOME=<managed home>`。

## 验证记录

- 定向回归（nativeHarness/nativeCodex/crafting/CraftingGrid/HarnessPanel/runtime.test/SidebarProviderAccounts/agentLoginActions/grokProfiles/accountStore/accountResolver）：**24 files / 187 passed**。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `git diff --check`：无 whitespace error（仅既有 CRLF 提示）。
- F04 五 Harness 仍 BLOCKED（Grok 官方余额、Kimi AUTH_REQUIRED、Antigravity unprobed、DSH unavailable），不宣称 Feature PASS。
