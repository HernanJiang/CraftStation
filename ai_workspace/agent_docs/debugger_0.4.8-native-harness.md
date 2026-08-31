# Debugger — v0.4.8 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.8`（复检 `coder_0.4.7`）
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.7-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.7-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.7-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.7-native-harness.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout。

## Review Scope

- F14：Codex profile 三个 login 用例 + Work profile 按钮
- F12：Grok managed 登录是否接到 IPC/UI
- F13：Grok spawn 是否真正隔离宿主 API key / Router 变量
- F08：是否还打开 grok.com
- F09：Router/CLIProxy 边界
- F04：五 Harness 真实 response

## Evidence

### 独立源码

- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - Grok 卡片调用 `createAndRunGrokProfileLogin({ label: "New Grok" })`
  - `CLI_LOGIN_COMMANDS` **已移除 grok**，不再 `startUsageLogin`
- [agentLoginActions.ts](file:///D:/Work/CraftStation/craftstation/src/renderer/actions/agentLoginActions.ts)
  - `createAndRunGrokProfileLogin` → `createGrokProfileLogin` → `startGrokProfileLogin` → 成功才 `completeGrokProfileLogin`
  - exitCode 非 0 / 取消走 `cancelGrokProfileLogin`
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts)
  - `createGrokProfileLogin` 只建 pending home，不落 AccountStore
  - `startGrokProfileLogin` 用 `managedGrokProcessEnvironment(pending.home)` + `buildGrokLoginScript`
  - `completeGrokProfileLogin` 调 `importAuthJson`；无 identity 删 pending、抛错、不落行
  - `createCraftingAdapter` grok 分支：`baseSpawnEnv: managedGrokProcessEnvironment(accountRoot)`
- 本机官方 `~/.grok/auth.json` 键名（只核对结构，不记录 secret）：含 `email` / `user_id` / `principal_id`，与 identity 门控一致
- [session.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/session.ts) ACP spawn：
  ```ts
  env: { ...process.env, TERM: "xterm-256color", ...(command.env ?? {}) }
  ```
- [threadSessionManager.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/threadSessionManager.ts) 登录 shell：
  ```ts
  { ...sanitizedProcessEnv, ...terminalEnv, ...extraEnvironment }
  ```
- [grokProfiles.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/grokProfiles.ts) `managedGrokProcessEnvironment` **省略** `GROK_API_KEY` / `XAI_API_KEY` / CLIPROXY / CODEX_ROUTER，**没有**写成空字符串覆盖

省略 + `{...process.env, ...command.env}` = 宿主 key 会回来。Windows 登录脚本有 `Remove-Item Env:GROK_API_KEY`，POSIX 登录脚本没有。ACP runtime spawn 两边都会漏。

### 独立测试（Debugger 复跑）

```text
pnpm exec vitest run grokProfiles / accountStore / accountResolver / runtime.test
  / SidebarProviderAccounts / agentLoginActions / nativeHarness
```

**11 files / 126 passed / 0 failed**

含：Grok card → `createAndRunGrokProfileLogin`；device URL 不含 grok.com；pending 不落行；完成有 identity 落行；无 identity 不落行；cancel 不落行；A/B sticky / auto fallback / explicit error。

F13 测试只断言 `spawnOptions.env.GROK_API_KEY` 为 undefined，**没有先往 `process.env` 注入宿主 key**，所以打不穿 merge 漏洞。

### CodeGraph

已 `codegraph sync`。

### F09

未发现导入 `xai-*.oauth.json`、CLIProxyAPI execution path、默认覆盖 `~/.grok/auth.json` 切号。F09 保持关闭。

## Spec Fidelity

| 要求                                 | 结果                                              |
| ------------------------------------ | ------------------------------------------------- |
| 点 Grok 不再打开 grok.com            | **关闭**                                          |
| pending GROK_HOME 跑官方 device-auth | **关闭**（IPC/UI 已接）                           |
| 无 identity 不插账号                 | **关闭**（单测 + 真机 auth.json 键名对齐）        |
| Session sticky / auto / explicit     | **单测关闭**                                      |
| spawn 剥离 API key / Router 变量     | **未关闭**：ACP/登录 shell 再 merge `process.env` |
| Codex profile 回归                   | **关闭**（本轮独立 126 全绿，含原先 4 个红测）    |
| 五 Harness 真实 response             | **仍 BLOCKED**                                    |

## Findings

### F08 — 关闭

侧栏走 managed device-auth，测试锁住不 `startUsageLogin`、不含 grok.com。

### F12 — 关闭

生产路径：pending home → `GROK_HOME=<pending>` 官方 `grok login --device-auth` → identity 门控 import。失败/取消/无 identity 不落 AccountStore。

残余（不单独开 Finding）：`cancelGrokProfileLogin` 只删 map，pending 目录可能留在磁盘。

### F14 — 关闭

独立复跑原失败用例已绿。死锁修复（先启动再 emit）成立。

### F13 — 未关闭：process.env merge 把已剥离的 key 加回去

**严重性：P1（有宿主 `GROK_API_KEY` / Router 环境时，受管 Session 会被第三方凭据抢占）**

`managedGrokProcessEnvironment` 省略 key 后，ACP spawn 与 login shell 都先 spread `process.env`。省略的 key 不会覆盖宿主值。

测试没 seed 宿主 key，所以是绿的假阴性。

### F04 — 仍 BLOCKED

无新的五 Harness 真实 native response。

## Verdict

**FAIL**

Fix Cycle v0.4.7 关闭了 F08 / F12 / F14。F13 生产隔离未完成。Feature 因 F04 + F13 仍不得 PASS。

## Fix Plan（v0.4.8，只修 F13）

不要扩大范围。不要开 v0.5。不要宣称 PASS。

1. `managedGrokProcessEnvironment` 对剥离的变量必须 **显式覆盖为空**（或 spawn 在提供 isolation env 时不要 spread `process.env` 里的这些 key）。省略不够。
2. ACP Grok runtime spawn 与 `startShellWithEnvironment` 登录 shell 都必须在 **最终 child env** 上断言：宿主若已有 `GROK_API_KEY` / `XAI_API_KEY` / `CLIPROXY*` / `CODEX_ROUTER*` / `MODEL_CATALOG*`，child 里这些值必须为空或不存在。
3. 测试必须先 `process.env.GROK_API_KEY = "host-leak"` 等再 spawn，断言 child env 不含该值。
4. 建议顺手：`cancelGrokProfileLogin` / complete 失败时删除 pending 目录。
5. 回归 F08/F12/F14 定向测试。不 commit / tag / push。

## Fix Acceptance Criteria

- [ ] 宿主设置 `GROK_API_KEY` / `XAI_API_KEY` 后，Grok login PTY 与 Grok ACP child 的最终 env 都不带这些值
- [ ] 同样覆盖 CLIPROXY / CODEX_ROUTER / MODEL_CATALOG
- [ ] `GROK_HOME` 仍是 managed/pending 目录
- [ ] F08/F12/F14 定向测试保持绿
- [ ] F04 仍诚实 BLOCKED

## Fix Execution Order

1. 修 `managedGrokProcessEnvironment` 或 spawn merge
2. 加 seed-host-env 测试
3. pending 目录清理（可选但建议）
4. 定向回归 + `coder_0.4.8-native-harness.md`
5. 通知 Debugger 复检

## 用户最短手工验收（本轮未 PASS）

1. 完全退出 CraftStation 再开
2. 打开「模型与用量」
3. 点 Grok「登录/授权」
4. **现在应看到：** 登录终端，命令为 `grok login --device-auth`；若弹浏览器应是 `accounts.x.ai` 设备授权，**不是** grok.com 首页
5. 取消或关终端：**不应**新增 Grok 账号卡片
6. 用有余额的号完成授权后：应出现带邮箱/身份的受管卡片，而不是空条目
7. Feature 仍未完成：五 Harness 真实回复和 API-key 隔离还没过门禁
