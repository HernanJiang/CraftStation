# Coder — v0.4.6 Native Multi-Harness Fix Cycle + Grok Account Control Plane

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.6`
>
> 状态：已按 `debugger_0.4.6-native-harness.md` Fix Plan 完成 F08，并按用户授权实现 Grok Account Control Plane tracer bullet（`debugger_0.5.0-grok-account-control-brief.md`）。等待 Debugger 独立复检。v0.4 Feature 仍不可宣称 PASS。

## F08 — Grok 卡片禁止打开 grok.com，必须走官方 CLI device-auth

### 根因

- `SidebarProviderAccounts.tsx` 的 `CLI_LOGIN_COMMANDS` 没有 `grok` 条目，Grok 卡片点击落入 `useUsageProviderLogin.handleSignIn()` → `startUsageLogin`，其 `providerLoginConfigs` 里 Grok 的 `loginUrl`/`cookieUrl` 是 `https://grok.com/`（首页），不是官方授权页。

### 修复

- `SidebarProviderAccounts.tsx`：`CLI_LOGIN_COMMANDS` 增加 `grok: "grok login --device-auth"`。点击 Grok 卡片会命中 `runAgentLoginCommand`，与 Settings 侧完全一致；不会再落入 `startUsageLogin`。
- `agentLoginActions` 的 WSL URL 拦截已支持官方授权页：`auth.x.ai/oauth2/authorize`（已有测试）与 `accounts.x.ai/oauth2/device`（`normalizeLoginUrl` 规范化 `user_code`，交给原生浏览器）。新增锁定测试验证 `grok login --device-auth` 输出 device URL 时打开的是 `accounts.x.ai/oauth2/device`，且绝不含 `grok.com`。

### 测试锁定（F08）

- `SidebarProviderAccounts.test.tsx`：新增 `routes the Grok card through the official CLI device login, never the browser usage login`。
  - 点击 Grok 卡片 → `runAgentLoginCommand` 被调用，参数 `{ label: "Grok", command: "grok login --device-auth" }`。
  - 不调用 `useUsageProviderLogin.handleSignIn`（即不触发 `startUsageLogin`）。
  - 不调用 Codex profile 登录。
- `agentLoginActions.test.ts`：新增 `opens the Grok device-authorization URL from the official CLI, never grok.com`。
  - `grok login --device-auth` 在 WSL 项目下打开 `https://accounts.x.ai/oauth2/device?user_code=...`。
  - 断言 `openExternalNative` 的调用不含 `grok.com`。

## Grok Account Control Plane（tracer bullet）

### 架构层

- `AccountStore`（复用，provider-agnostic）：`add/select/reorder/setEnabled/updateStatus/projectCredential/credentialRoot` 全部适用于 `provider: "grok"`。
- `AccountResolver`（复用）：`explicit > selected > auto priority-fallback`，auto 只在 `quota-exhausted / auth-expired / unavailable` 时回退；explicit 不可用直接抛 `ACCOUNT_UNAVAILABLE`。
- `AccountBinding`（复用）：`craftAgent` 创建 Session 时通过 `createCraftingAdapter` 解析一次并绑定 `accountId/provider/credentialScopeRef/reason/boundAt`；Session 启动后不再重新 resolve。
- 新增 `GrokProfileService`（`src/supervisor/runtime/grokProfiles.ts`）：
  - `importAuthJson({ label, profileRoot })`：读取官方 CLI 写出的 `auth.json`，通过 `grokAuthContainer` 取最鲜活 token 容器，用 `email / principal_id / user_id` 提取官方 identity；**未拿到官方 identity 不插入账号条目**。
  - `managedGrokHome(accountId)`：返回该账号的 managed credential root。
  - `managedGrokProcessEnvironment`：`GROK_HOME=<managed root>`，剥离 `GROK_API_KEY / XAI_API_KEY / CLIPROXY / CODEX_ROUTER / MODEL_CATALOG`，防止 Router 号池或第三方 API 污染。
  - `buildGrokLoginScript`：Windows/POSIX 下运行官方 `grok login --device-auth`，复用现有 login-terminal completion 协议。
  - `createPendingGrokHome`：登录前只建 managed home 目录，不写 AccountStore 条目。

### 启动语义（Session sticky）

```text
新 Session → AccountResolver 一次 → AccountBinding 固定
  → managed GROK_HOME/A 或 /B → spawn official grok（env.GROK_HOME）
  → 之后 send/interrupt/resume 不重新 resolve
```

- `createCraftingAdapter`：为 `harnessKind === "grok"` 做 account resolution（与 codex 对称），把 `accountRoot` 通过 `baseSpawnEnv: { GROK_HOME }` 注入 native harness adapter。
- `nativeHarness` grok factory：支持 `baseSpawnEnv`，合并到 Grok ACP adapter 的 spawn env。

### 黄金测试（runtime.test.ts Grok account control plane）

1. `binds the new Session to the selected Grok account and injects its managed GROK_HOME` — selected A → accountBinding=A 且 `baseSpawnEnv.GROK_HOME` = A 的 managed root（≠ B）。
2. `binds a new Session to the newly selected Grok account` — selected B → accountBinding=B。
3. `auto-falls back to the next Grok account when the selected account is exhausted` — A quota-exhausted + auto → 回退到 B。
4. `rejects an exhausted explicit Grok account instead of silently falling back` — explicit A exhausted → 抛错，adapter 不被调用。
5. `keeps an already-started Session bound to its original account after selection changes` — Session A 启动后 selected 改 B，Session A 仍是 A，新 Session 才是 B。

`grokProfiles.test.ts` 还锁定：无官方 identity 不插入、identity 导入后 managed root 投影 `GROK_HOME`/`auth.json`、A/B 独立 home、跨 home 投影拒绝、managed env 隔离、登录脚本命令。

## F09 边界遵守

- 未读取、复制或导入 Codex Router 的 `xai-*.oauth.json` / cookie / refresh token。
- 未把 CLIProxyAPI 接入 Native Grok Adapter。
- Native probe 仍只使用官方 `grok` executable + 当前 `~/.grok`；换号必须由用户走官方 `grok login`。
- 未把 `~/.grok/auth.json` 全局覆盖当作默认切号。

## 未完成 / 阻塞

- F04 五 Harness 完整产品级 real response 仍 BLOCKED：Grok 官方 usage balance exhausted（等待有余额账号）；Kimi `AUTH_REQUIRED`（等待用户官方登录）；Antigravity 无安全非交互 PTY 仍 `unprobed`；DeepSeek/DSH 无官方 executable 仍 `RUNTIME_UNAVAILABLE`。
- 不重复已知失败探针，不升格 capability，不宣称 Feature PASS，不进入 v0.5。

## 验证记录

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- Grok 控制面定向：`grokProfiles.test.ts + accountStore + accountResolver + runtime.test (Grok)` → 21 passed。
- F08 定向：`SidebarProviderAccounts.test.tsx -t "routes the Grok card"`、`agentLoginActions.test.ts -t "opens the Grok device-authorization URL"` → 均通过。
- 全量定向（nativeHarness/nativeCodex/crafting/CraftingGrid/HarnessPanel/runtime/两个 F08 文件/account*）：24 个文件，178 passed / 4 failed。4 个失败为并行 Agent 重构遗留（`runCodexProfileLogin` 超时/closeThread、Work profile 按钮渲染），非本轮引入，另行协调处理。
