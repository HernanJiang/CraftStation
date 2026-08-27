# Debugger — v0.4.6 Native Multi-Harness Re-review + User Bug Gate

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.6`
> 日期：2026-08-27
> 角色：Debugger
> 来源：用户现场截图 + v0.4.5 FAIL/BLOCKED 复检
> 用户证据：[codex-clipboard-516d7189-15f4-4f4e-af56-9eb687bf9819.png](file:///C:/Users/Haona/AppData/Local/Temp/codex-clipboard-516d7189-15f4-4f4e-af56-9eb687bf9819.png)
> 前一轮：[debugger_0.4.5-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.5-native-harness.md)
> Manager：[manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

用户在「模型与用量」里点 Grok「登录/授权 / 添加账号」后，应用内浏览器打开的是 `https://grok.com/` 首页，不是官方授权页。同时用户指出 Codex Router 里有 6 个 xAI 号，要求用有余额的号继续验收。这两项都不能把 Feature 升格为 PASS；本轮进入 v0.4.6 Fix Cycle。

## Review Scope

- 用户现场 Grok 登录入口是否接到 Native Harness / 官方 CLI OAuth
- Codex Router 六账号池能否替代 Grok Native Harness 登录与探针
- v0.4.5 仍未关闭的 F04 五 Harness 真实 response 质量门
- 是否需要 Manager Re-plan：否。产品目标未变，这是登录入口接错 + 官方环境/账号边界

## Evidence

### 独立源码

- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - `CLI_LOGIN_COMMANDS` 只有 claude / gemini / cursor / kimi / antigravity / commandcode / opencode
  - **没有 `grok`**
  - 卡片点击顺序：Codex profile → CLI_LOGIN_COMMANDS → API key modal → `handleSignIn()`
- [useUsageProviderLogin.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/components/providers/useUsageProviderLogin.ts)
  - `handleSignIn()` 调用 `readBridge().startUsageLogin({ providerId })`
- [providerLoginConfigs.ts](file:///D:/Work/CraftStation/craftstation/src/main/usageLogin/providerLoginConfigs.ts)
  - Grok cookie 配置：`loginUrl: "https://grok.com/"`、`cookieUrl: "https://grok.com/"`
- [usageProviders.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/components/providers/usageProviders.ts)
  - `grok: { supportsBrowserLogin: true }`，所以卡片会落到 cookie 抓取
- [SingleAgentSettings.test.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/SettingsOverlay/parts/SingleAgentSettings/SingleAgentSettings.test.tsx)
  - Settings 已规定：Grok 同时有 ACP 与 `loginCommand` 时，必须走 `grok login --device-auth`，禁止 ACP authenticate
- [agentLoginActions.test.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/agentLoginActions.test.ts)
  - 官方登录 URL 是 `https://auth.x.ai/oauth2/authorize?...`，不是 `https://grok.com/`

### 用户现场

截图同时显示：

1. 左侧「模型与用量」Grok 卡片按钮为「登录中…」
2. 右侧应用内「浏览器」地址栏是 `https://grok.com/`
3. 页面是 Grok 官网首页（登录/注册/問 Grok），不是 `auth.x.ai` OAuth authorize

这与 cookie login 配置逐字一致，不是偶发 UI 闪一下。

### Codex Router 六账号边界（只计数量与厂商，不记录密钥）

本机 Codex Router 用户数据里存在 **6** 份 `xai-*.oauth.json`，位于 CLIProxy 管理目录，不是 `~/.grok` 官方 CLI home。  
`codex-router-config.json` 的 `oauthAccountIds` 是 Router/CLIProxy 号池 ID，不是 CraftStation Native Harness profile。

v0.4.5 探针失败原因仍是官方 Grok ACP `usage balance exhausted`，使用的是 `~/.grok` 当前 CLI 身份。Router 号池即使有余额，也不会自动成为 `grok agent stdio` 的登录身份。

## Spec Fidelity

- Manager Acceptance：Grok 必须走官方/native runtime boundary；Account/Usage 只提供 profile/environment，不代理 Harness execution。
- 当前卡片把 Grok Native 登录做成了 grok.com cookie 会话抓取，违反 Official/Native Runtime First。
- 把 Router 号池直接当 Native Harness 账号，会复活 CLIProxyAPI execution path，明确禁止。

## Findings

### F08 — Grok 用量卡片登录打开 grok.com，不是官方授权页

**严重性：P0 / 用户可复现**

侧栏 Grok「登录/授权 / 添加账号」没有 CLI 登录命令，落入 `startUsageLogin`。`UsageLoginManager` 把内置浏览器导航到 `https://grok.com/` 抓 cookie。  
Settings 已有正确路径：`grok login --device-auth`，并由 login terminal 拦截 `https://auth.x.ai/oauth2/authorize...`。

用户要的授权页是官方 OAuth，不是 grok.com 首页。

### F09 — Codex Router 六账号不能直接充当 Native Grok 登录/探针身份

**严重性：P0 / 验收边界**

六个 xAI OAuth 文件属于 Codex Router / CLIProxy 号池。Native Grok Harness 认官方 CLI（`grok login` / `~/.grok`）。  
禁止：把 Router json、cookie、API key 复制进 CraftStation 或塞给 `grok acp`。  
允许：用户用官方 `grok login --device-auth` 登录其中一个有余额的号；登录成功后只证明 `~/.grok` 当前 CLI 身份，再复跑 Grok native probe。

### F04 — 五 Harness 产品级 real response 仍未关闭

保持 v0.4.5：

| Harness | 状态 |
|---|---|
| Codex | 已有 v0.4.4 marker，不升格为五 Harness PASS |
| Grok | official ACP handshake + usage exhausted；等有余额的官方 CLI 身份 |
| Kimi | `AUTH_REQUIRED` |
| Antigravity | unprobed |
| DeepSeek/DSH | unavailable |

F01–F03 / F05–F07 保持关闭。生产 capability 不得升格。

## Verdict

**FAIL**

不进入 v0.5。不 Closeout。不 commit/tag/push。

## Fix Plan

交给 Coder 一次性连续修复。不要开新 Feature，不要改并行前端无关文件，除非修 F08 必须碰到同一卡片。

### Fix 1 — F08：Grok 卡片走官方 CLI 授权，禁止 grok.com cookie 登录

1. 在 `CLI_LOGIN_COMMANDS` 增加 Grok，命令与 Settings 一致：`grok login --device-auth`（若探测到的 `loginCommand` 不同，优先官方探测值，但不得回退到 grok.com）。
2. 侧栏 Grok「登录/授权 / 添加账号」必须调用 `runAgentLoginCommand`，不得 `startUsageLogin({ providerId: "grok" })`。
3. 打开的必须是官方 OAuth：`https://auth.x.ai/oauth2/authorize?...`。
   - 优先应用内授权视图 / login-terminal URL 拦截后的授权页。
   - 禁止再打开 grok.com 首页、注册页或「問 Grok」消费页。
4. 未拿到邮箱/身份凭证前不得新增账号条目（延续既有「失败登录不插账号」约束）。
5. 登录成功后刷新 Grok usage/status；失败保持 error，不写假 session。
6. 测试至少覆盖：
   - 点击 Grok 卡片登录调用 `grok login --device-auth` / 探测到的 loginCommand
   - 不调用 `startUsageLogin` 且不导航 `https://grok.com/`
   - 授权 URL 为 `auth.x.ai`
   - Settings 既有 “prefers terminal login for Grok” 回归

### Fix 2 — F09：官方 Grok 身份与 Router 号池隔离

1. 不得读取、复制或导入 Codex Router 的 `xai-*.oauth.json`、cookie、refresh token。
2. 不得把 CLIProxyAPI / Router 号池接到 Native Grok Adapter。
3. Native 探针继续使用官方 `grok` executable + 当前 `~/.grok` CLI 身份。
4. 文档写清：Router 六号只证明本机存在其他有余额的 xAI 订阅；CraftStation 要用它们，必须用户走官方 `grok login` 换到该号。
5. 用户完成官方登录后，用非交互探针复跑 Grok：
   - 若仍 usage exhausted：保持 `implementation missing/error/BLOCKED`，不要重复同一耗尽号
   - 若拿到真实 native response：记录 envelope，**仍不得**把 capability 升格为五 Harness PASS
6. 不要为了过门禁去登录 Kimi/Antigravity/DSH；那些仍按原停止条件。

### Fix 3 — 回归

- 定向测试：Sidebar Grok 登录、`agentLoginActions` URL 拦截、SingleAgentSettings Grok terminal login、usage cookie 配置不再被 Grok 卡片触发
- `pnpm` 受影响 test + typecheck/lint（若全量 typecheck 仍被既有 `supervisorRuntime.ts` exactOptionalPropertyTypes 挡住，记录为既有问题，不要假装本轮引入）
- 不升格 descriptors
- 不 commit / tag / push

## Fix Acceptance Criteria

- [ ] 点击 Grok「登录/授权 / 添加账号」不再出现 grok.com 首页
- [ ] 出现官方 `auth.x.ai` 授权流程（login terminal + 授权 URL）
- [ ] 自动化测试锁住上述路径
- [ ] Codex Router 六号未被导入 Native path
- [ ] Grok native probe 使用官方 CLI 身份；有余额则补真实 response 证据，无余额则诚实 BLOCKED
- [ ] Feature 仍不得宣称 PASS，除非五 Harness 都有产品级 real response（本轮预期仍 FAIL/部分推进）

## Fix Execution Order

1. F08 登录入口
2. 测试锁路径
3. F09 边界说明 + 仅在官方 CLI 已换号时复跑 Grok probe
4. 回归
5. 写 `coder_0.4.6-native-harness.md`，通知 Debugger 复检

## Stop Conditions

- 不把 Router/CLIProxy 凭证当 Native Harness
- 不重复已知耗尽 Grok 号的同一 ACP prompt
- 不塞 Kimi key
- 不伪造 Antigravity/DSH
- 不进入 v0.5
