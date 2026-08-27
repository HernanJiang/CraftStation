# Coder — v0.4.8 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.8`
>
> 状态：已按 `debugger_0.4.8-native-harness.md` Fix Plan 修复 F13。等待 Debugger 独立复检。v0.4 Feature 仍不可宣称 PASS。

## F13 — Grok spawn env 必须真正隔离宿主变量（关闭）

### 根因（Debugger 独立复核确认）

`managedGrokProcessEnvironment` 之前只是 `omit`（跳过）`GROK_API_KEY / XAI_API_KEY / CLIPROXY / CODEX_ROUTER / MODEL_CATALOG`。但：

- ACP spawn（`agents/acp/session.ts`）构造 env 为 `{ ...process.env, TERM, ...command.env }`；
- 登录 shell（`threadSessionManager.startShellWithEnvironment`）构造为 `{ ...sanitizedProcessEnv, ...terminalEnv, ...extraEnvironment }`。

两者都先 spread `process.env` 再叠加传入 env，因此「省略」不会覆盖宿主值——宿主 key 会原样漏回 child。原测试未 seed 宿主 key，属于假阴性。

### 修复

- `managedGrokProcessEnvironment` 从「省略」改为「**显式设空**」：命中屏蔽前缀的 key 在原 key 名下写入 `""`（空字符串）。
- 因为 ACP/login 的 env 合并是「后 spread 覆盖」，`""` 会可靠地把宿主泄漏值替换为空；`GROK_HOME` 仍在最后固定为 managed/pending 目录。

### 测试（不再假阴性）

- `grokProfiles.test.ts`：
  - `pins GROK_HOME and blanks CLIProxy/Router/API-key overrides`：断言 `GROK_API_KEY/XAI_API_KEY/CLIPROXY_HOME/CODEX_ROUTER_HOME/MODEL_CATALOG_PATH` 均为 `""`（不再是 absent）。
  - 新增 `overwrites seeded host API-key / Router vars after the ACP process.env merge`：seed 宿主 key 后模拟 `{ ...hostEnv, ...isolated }`，断言全部被空值覆盖且 `GROK_HOME` 指向 managed root。
- `runtime.test.ts`（Grok profile login）：`startGrokProfileLogin` 测试现在**先 seed `process.env.GROK_API_KEY="host-leak"` 等**，再启动登录 shell，断言最终 PTY env 中这些 key 为 `""` 且 `GROK_HOME` 为 pending home。

## 建议项：pending 目录清理

- `SupervisorRuntime.cancelGrokProfileLogin`：现在删除 pending 目录（仅当路径解析后仍落在 `accountStore.managedRoot` 内，`removeGrokPendingHome` 用 `relative` 校验防越界）。
- `completeGrokProfileLogin` 无 identity 失败分支：同样清理 pending 目录。
- 测试：cancel 后 `existsSync(pendingHome) === false`；complete 无 identity 后 pending 目录不存在。

## 回归

- F08：Grok 卡片不打开 grok.com，登录走官方 device-auth（managed GROK_HOME 内）；`accounts.x.ai/oauth2/device` 测试保持。
- F12：pending GROK_HOME → 官方 device-auth → identity 门控 import；IPC/UI 已接。
- F14：agentLoginActions.test.ts 22/22、SidebarProviderAccounts.test.tsx 8/8。
- 全量定向回归：**24 files / 188 passed**。
- `pnpm typecheck`、`pnpm lint` 通过；`git diff --check` 无 whitespace error（仅既有 CRLF 提示）。

## 边界

- F04 五 Harness 仍 BLOCKED（Grok 官方余额、Kimi AUTH_REQUIRED、Antigravity unprobed、DSH unavailable）。
- F09 保持关闭：未导入 Router `xai-*.oauth.json`/cookie/refresh token；未接 CLIProxyAPI；未覆盖 `~/.grok/auth.json` 作默认切号；受管 Session 一律 `GROK_HOME=<managed home>`。
- 不 commit / tag / push；不宣称 Feature PASS；不进入 v0.5。
