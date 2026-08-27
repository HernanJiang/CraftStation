# Debugger — v0.4.8 Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.8` 复检
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.8-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.8-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.8-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.8-native-harness.md)
> Verdict：**FAIL / BLOCKED（F13 关闭；F04 仍缺五 Harness 真实 response）**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**
> Next Coder cycle: **不要开 v0.4.9 代码修复。** F04 被官方余额/登录挡住，不是漏实现。

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout，不得进入 v0.5。

## Review Scope

- F13：宿主 `GROK_API_KEY` / Router 变量是否还会漏进 Grok login PTY 与 ACP child
- F12/F08/F14 回归是否仍绿
- pending 目录清理
- F04 五 Harness 真实 response（保持诚实 BLOCKED）

## Evidence

### 独立源码

- [grokProfiles.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/grokProfiles.ts)
  - `managedGrokProcessEnvironment` 对 `GROK_API_KEY` / `XAI_API_KEY` / `CLIPROXY*` / `CODEX_ROUTER*` / `MODEL_CATALOG*` **显式写入 `""`**
  - `GROK_HOME` 最后钉在 managed/pending 目录
  - 注释写明 ACP/login 都是 `{...process.env, ...command.env}`，omit 不够
- [session.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/session.ts)
  ```ts
  env: { ...process.env, TERM: "xterm-256color", ...(command.env ?? {}) }
  ```
  后 spread 的空字符串会覆盖宿主 key。
- [sessionFactory.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/sessionFactory.ts)
  - `withCommandBaseSpawnEnv(acpCommand, input.baseSpawnEnv)` 把隔离 env 放进 `command.env`
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts)
  - `startGrokProfileLogin` 仍用 `managedGrokProcessEnvironment(pending.home)`
  - `createCraftingAdapter` grok 分支同样
  - `cancelGrokProfileLogin` / complete 无 identity：`removeGrokPendingHome`（`relative` 限制在 managedRoot 内）

### 独立测试（Debugger 复跑）

```text
pnpm exec vitest run
  grokProfiles.test.ts
  runtime.test.ts
  SidebarProviderAccounts.test.tsx
  agentLoginActions.test.ts
  accountStore.test.ts
  accountResolver.test.ts
```

**6 files / 105 passed / 0 failed**

关键断言已不再是假阴性：

- `overwrites seeded host API-key / Router vars after the ACP process.env merge`：`{...hostEnv, ...isolated}` 后 `GROK_API_KEY` 等为 `""`，`GROK_HOME` 为 managed root
- `startGrokProfileLogin` **先** `process.env.GROK_API_KEY="host-leak"` 再 spawn，最终 PTY env 这些 key 为 `""`，`GROK_HOME` 为 pending home
- cancel / complete 无 identity 后 `existsSync(pendingHome) === false`

### CodeGraph

已 `codegraph sync`（4 个改动文件）。

### F09

未发现导入 Router `xai-*.oauth.json`、CLIProxyAPI execution path、默认覆盖 `~/.grok/auth.json`。保持关闭。

## Spec Fidelity

| 要求 | 结果 |
|---|---|
| 点 Grok 不再打开 grok.com | **关闭**（F08） |
| pending GROK_HOME + identity 门控 | **关闭**（F12） |
| Codex profile 回归 | **关闭**（F14） |
| 宿主 API key / Router 不进 child | **关闭**（F13，本轮） |
| pending 失败/取消删目录 | **关闭** |
| 五 Harness 产品级 real response | **仍 BLOCKED（F04）** |

## Findings

### F13 — 关闭

空字符串覆盖 + seed-host-key 测试成立。ACP merge 与 login PTY 都能把宿主泄漏值打成空。`GROK_HOME` 仍指向 managed/pending。

### F08 / F12 / F14 — 保持关闭

本轮定向 105 全绿，未回归。

### F04 — 仍 BLOCKED

没有新的五路官方 native response：

| Harness | 状态 |
|---|---|
| Codex | v0.4.4 marker 证据，不升格为五 Harness PASS |
| Grok | handshake + 曾 usage exhausted；等有余额的官方 CLI 身份走 managed 登录 |
| Kimi | AUTH_REQUIRED |
| Antigravity | unprobed |
| DeepSeek/DSH | unavailable |

不要重复已知耗尽号的同一 ACP prompt。不要塞 Kimi key。不要伪造 Antigravity/DSH。

## Verdict

**FAIL / BLOCKED**

v0.4.6–v0.4.8 的工程项（grok.com 改道、managed 登录闭环、Codex profile 回归、spawn 隔离）已独立关闭。  
Feature 仍不能 PASS，因为 F04 要五条官方 Harness 的产品级真实回复。

**不要派 Coder 开 v0.4.9。** 下一动作在用户官方登录/余额，然后 Debugger 复检探针。

## 用户最短手工验收

1. 完全退出 CraftStation 再开。
2. 打开「模型与用量」。
3. 点 Grok「登录/授权」。
4. **应看到：** 登录终端，命令为 `grok login --device-auth`；若弹浏览器应是 `accounts.x.ai` 设备授权，**不是** grok.com 首页。
5. 取消或关终端：**不应**新增空账号卡。
6. 用**有余额**的官方 Grok 号完成授权后：应出现带邮箱/身份的受管卡片。
7. 用该卡片开一个 Grok Session，确认能出真实回复。这才是 F04 的 Grok 格。
8. Feature 整体仍未完成：Kimi 官方登录、Antigravity、DSH 还各自阻塞。

不要把 Codex Router 那 6 个号直接导入。要用它们，必须走这次官方 `grok login` 写进 managed `GROK_HOME`。
