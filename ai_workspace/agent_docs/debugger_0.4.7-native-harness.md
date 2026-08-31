# Debugger — v0.4.7 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.7`（复检 `coder_0.4.6`）
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.6-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.6-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.6-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.6-native-harness.md)
> Grok 控制面规格：[debugger_0.5.0-grok-account-control-brief.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.5.0-grok-account-control-brief.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout，不得进入完整 v0.5。

## Review Scope

- F08：侧栏 Grok「登录/授权」是否还打开 `https://grok.com/`
- F09：是否导入 Codex Router / CLIProxy 凭据
- Grok Account Control Plane tracer：managed `GROK_HOME`、identity 门控、Session sticky 是否接到 **生产路径**
- Coder 本轮改动文件上的回归（Codex profile login / Work profile 按钮）
- F04 五 Harness 真实 response（保持 BLOCKED）

## Evidence

### 独立源码

- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - `CLI_LOGIN_COMMANDS.grok = "grok login --device-auth"` **已加上**
  - 点击走 `runAgentLoginCommand`，不再 `handleSignIn()` / `startUsageLogin`
  - **未**传 `GROK_HOME`，**未**调用 `createPendingGrokHome` / `buildGrokLoginScript` / `importAuthJson`
- [agentLoginActions.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/agentLoginActions.ts)
  - 拦截 `accounts.x.ai/oauth2/device`，测试断言不含 grok.com
  - Grok 登录仍是普通 CLI shell（默认 `~/.grok`），不像 Codex 有 isolated profile login
- [grokProfiles.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/grokProfiles.ts)
  - `importAuthJson` identity 门控、`managedGrokProcessEnvironment`、`buildGrokLoginScript` 存在
  - `GrokProfileService` 只在 supervisor 构造；**没有** `startGrokProfileLogin` / `importGrokProfile` IPC
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts)
  - Grok `craftAgent` 会 resolve account，并把 `{ GROK_HOME: accountRoot }` 注入 factory
  - **没有**使用 `managedGrokProcessEnvironment`（不剥离 `GROK_API_KEY` / `XAI_API_KEY` / CLIPROXY / CODEX_ROUTER）
- [nativeHarness/index.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/nativeHarness/index.ts)
  - `withGrokBaseSpawnEnv` merge 到 Grok adapter，ACP sessionFactory 会带进 spawn
- [runtime.test.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime.test.ts)
  - sticky / selected / auto fallback / explicit exhausted 黄金用例存在且独立跑过

### 独立测试（Debugger 复跑）

| 套件                                                                                        | 结果                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `grokProfiles.test.ts` + `accountStore` + `accountResolver` + `runtime.test.ts` Grok 控制面 | **通过**（黄金路径单测成立）                                          |
| Sidebar「routes the Grok card through the official CLI device login」                       | **通过**（未出现在 FAIL 列表）                                        |
| agentLoginActions「never grok.com」                                                         | **通过**                                                              |
| `agentLoginActions.test.ts` 3 个 Codex profile 用例                                         | **FAIL**：timeout / `onForceClose` undefined / `closeThread` 未被调用 |
| Sidebar「Work profile 登录授权」                                                            | **FAIL**：找不到按钮名 `Work profile 登录授权`                        |

这 4 个失败都在 **本轮改过的文件**（`agentLoginActions.ts` +213 / `SidebarProviderAccounts.tsx` +473），**不能**记成并行 Agent 遗留。

### CodeGraph

`codegraph sync` 已执行。先前 `Index is up to date` 滞后（Added 3 / Modified 25），现已同步。

### F09

未发现读取 `xai-*.oauth.json`、CLIProxyAPI execution path、默认覆盖 `~/.grok/auth.json` 作为切号。F09 **保持关闭**。

## Spec Fidelity

| 要求                                       | 结果                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| 点 Grok 卡片不再打开 grok.com              | **部分满足**（改走 CLI device-auth）                                                                  |
| 官方授权 URL                               | **部分满足**（`accounts.x.ai/oauth2/device`；不是 grok.com，也不是旧的 `auth.x.ai/oauth2/authorize`） |
| 登录写入 managed GROK_HOME，成功后才插账号 | **不满足**（生产登录仍写默认 home，且无 import IPC）                                                  |
| A/B 独立 GROK_HOME + Session sticky        | **单测满足，生产登录未闭环**                                                                          |
| Renderer 零 secret                         | **满足**（AccountView）                                                                               |
| 禁止 Router/CLIProxy                       | **满足**                                                                                              |
| Codex isolated profile 回归                | **FAIL**                                                                                              |

## Findings

### F08 — 部分关闭：不再打开 grok.com，但不是 managed 官方登录

卡片不再走 cookie login。这修了用户截图里的 grok.com 首页。

剩余缺口：

1. `runAgentLoginCommand({ command: "grok login --device-auth" })` **不设置** `GROK_HOME`
2. `buildGrokLoginScript` / `createPendingGrokHome` **未被 UI 调用**
3. 登录成功只 `refreshAndMergeProviderUsage`，**不会** `importAuthJson`
4. 因此官方 CLI 仍写入 **`~/.grok`**，账号池不会因为这次授权新增受管条目

用户点「添加账号」看起来像授权，实际还是全局默认 home。

### F12 — GrokProfileService 未接到生产 IPC/UI

`grokProfileService` 只被构造。没有对称于 `startCodexProfileLogin` / `importCodexProfile` 的 Grok API。  
`craftAgent` 只能绑定 **已经存在** 的 AccountStore 行。新用户走侧栏登录进不了 A/B managed runtime。

### F13 — spawn 未使用 `managedGrokProcessEnvironment`

`createCraftingAdapter` 只注入 `{ GROK_HOME: accountRoot }`。  
`withCommandBaseSpawnEnv` 是 merge。宿主 `GROK_API_KEY` / `XAI_API_KEY` / Router 变量仍可能抢凭据。规格要求剥离这些变量。

### F14 — 本轮回归：Codex isolated profile login 与 Work profile 按钮

独立复跑失败，且文件就是本轮 Grok/登录改动集。Coder 不得再把它们标成并行遗留。

- `runCodexProfileLogin`：非零 completion timeout、cancel 时 `open` 未建立、backend failure 不 `closeThread`
- Sidebar 已登录/未授权 Codex 账号按钮文案或结构变了，测试名 `Work profile 登录授权` 找不到

### F04 — 仍 BLOCKED

无新的五 Harness 真实 response。Grok 余额、Kimi AUTH_REQUIRED、Antigravity unprobed、DSH unavailable 不变。

## Verdict

**FAIL**

- F08 用户可见的 grok.com bug：**行为上已改道**，但 managed 登录闭环未完成
- Grok 控制面：**单测 tracer 成立，生产路径未接上**
- 本轮引入/暴露的 Codex profile 回归：**必须修**
- Feature 仍不得 PASS

## Fix Plan（v0.4.7）

一次性连续修复，不要开新 Feature。

### Fix 1 — 接上 Grok managed 登录闭环

1. 侧栏 Grok「登录/授权 / 添加账号」对齐 Codex：pending managed `GROK_HOME` → `GROK_HOME=<pending>` 跑 `grok login --device-auth`（用 `buildGrokLoginScript`）→ 成功且解析到 email/principal/user_id 才 `importAuthJson`
2. 失败、取消、无 identity：**不**往 AccountStore 插行；清理 pending home
3. 增加 `startGrokProfileLogin` / import IPC，Renderer 不读 secret
4. 测试：登录 command env 含 `GROK_HOME`、成功才 listAccounts 增加、失败 list 仍为空、不打开 grok.com

### Fix 2 — spawn 使用隔离环境

`createCraftingAdapter` 的 Grok `baseSpawnEnv` 必须来自 `managedGrokProcessEnvironment(accountRoot)`，不能只 `{ GROK_HOME }`。  
测试：注入环境不含 `GROK_API_KEY` / `XAI_API_KEY` / CLIPROXY / CODEX_ROUTER。

### Fix 3 — 修掉本轮登录回归

1. `runCodexProfileLogin` 三个失败用例必须重新变绿
2. Sidebar「已有未授权 Codex 账号」必须能点到 managed profile login；更新按钮 accessible name 或恢复文案，测试跟着绿
3. 不得再声称这些是无关并行失败

### Fix 4 — 回归与边界

- F08/F12/F13 定向测试 + 上一轮 Grok 黄金测试
- F01–F07 native harness 定向回归
- 不导入 Router oauth；不覆盖默认 `~/.grok` 作为切号；不 quota-low 自动切
- 不 commit / tag / push
- 不宣称 v0.4 Feature PASS

## Fix Acceptance Criteria

- [ ] 点 Grok 登录仍不出现 grok.com
- [ ] 登录进程的 `GROK_HOME` 是 pending/managed 目录，不是用户 `~/.grok`
- [ ] 无官方 identity 不出现新账号卡片
- [ ] 成功登录后新 Session 绑到该账号的 managed home
- [ ] spawn env 剥离 API key / Router 变量
- [ ] Codex profile 三个 login 用例 + Work profile 按钮用例通过
- [ ] F04 仍诚实 BLOCKED，除非有新的真实 native response

## Fix Execution Order

1. Fix 3（回归，避免继续扩大登录面）
2. Fix 1（managed 登录闭环）
3. Fix 2（隔离 spawn env）
4. 定向测试 + 写 `coder_0.4.7-native-harness.md`
5. 通知 Debugger 复检

## 用户最短手工验收（本轮未 PASS，只验证 F08 改道）

1. 完全退出 CraftStation 再开
2. 打开「模型与用量」
3. 点 Grok「登录/授权」
4. **预期现在：** 登录终端 + `grok login --device-auth`，浏览器若弹出应是 `accounts.x.ai` 设备授权，**不是** grok.com 首页
5. **预期仍缺：** 授权成功也不保证出现独立受管 Grok 账号卡片；那是 v0.4.7 要补的闭环
