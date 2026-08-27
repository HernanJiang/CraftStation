# Debugger — v0.4.10 Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.10` 复检
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.10-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.10-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.10-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.10-native-harness.md)
> 真实流量（脱敏）：[v0.4.10-grok-pool-probe.json](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.10-grok-pool-probe.json)
> Verdict：**FAIL / BLOCKED（F18/F19/F20 关闭；F04 仍缺五 Harness 产品级真实 response）**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**
> Next Coder cycle: **不要开 v0.4.11。** F18–F20 工程修复已独立复检关闭。下一动作是用户**完全退出并重开** CraftStation，手工点一遍 Grok 号池 / 402 文案 / Auto Session 填补。未出现新的生产缺陷前不派发 Coder。

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**，不得 Closeout，不得 commit / tag / push。

## Review Scope

- F18：官方 Grok JSON-RPC `-32603 Internal error` + `data.message` / `data.http_status=402` 是否投影为「Grok 额度已耗尽」，而不是泛化 Internal error
- F19：402 是否只把**当前 Session 已绑定**的账号标成 `quota-exhausted`，不按 UI selected 误伤整池
- F20：新 Auto Session 是否跳过 `quota-exhausted` 按 order 选 `available` / `quota-low`；explicit 不 fallback；已绑定 Session sticky
- F04：五个平级 Native Harness 的产品级真实 response
- F08–F17：保持已关闭，本轮不重开

## Evidence

### 真实官方 ACP 形状（本轮复用，未重复已知耗尽账号探针）

[v0.4.10-grok-pool-probe.json](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.10-grok-pool-probe.json)

- 6/6 `initialize` + `session/new` + `session/close` 成功；`GROK_HOME` 钉在 managed profile
- 3/6 `NATIVE_PROBE_OK`（有额度）
- 3/6 `QUOTA_EXHAUSTED`：JSON-RPC `-32603` / `Internal error`，详情在 `data.message` 与 `data.http_status=402`
- 探针当时 `accounts.json` 6 行仍是 `available`——那是 **F19 修复前** 的现场；不能当作修复后的生产证据

### 独立源码

- [sessionErrors.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/sessionErrors.ts)
  - `resolveAcpPromptRpcErrorMessage` 读取 `data.message` + `data.http_status`
  - `httpStatus === 402` 且 `usage balance exhausted` 映射为 `Grok 额度已耗尽`
  - `isAcpPromptQuotaExhaustedError` 只认官方 Grok 402 usage-balance 形状，不把泛化 Internal error 当额度耗尽
- [session.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/session.ts)
  - prompt catch：先 `await this.onPromptError?.(error)`，observer 失败只 warn，再 `emitPromptFailure(error)`
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts)
  - Grok `createCraftingAdapter` 把 `onPromptError` 闭包钉在 immutable `accountBinding.accountId`
  - `handleGrokNativePromptError`：仅 `updateStatus(boundAccountId, "quota-exhausted")` + 刷新 Grok 账号列表
- [accountResolver.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/accountResolver.ts)
  - explicit：不可用直接 `ACCOUNT_UNAVAILABLE`，禁止 fallback
  - auto：跳过 `quota-exhausted` / `auth-expired` / `unavailable`，按 order 选下一个 `available` / `quota-low`
- Native Grok factory / structured adapter 把 `onPromptError` 传到 ACP session，不是只改文案

### 独立测试

定向 4 files / 186 tests（独立复跑）：

```text
src/supervisor/agents/acp/session.test.ts
src/supervisor/runtime.test.ts
src/supervisor/runtime/accountResolver.test.ts
src/supervisor/runtime/nativeHarness/nativeHarness.test.ts
```

F18/F19/F20 过滤用例全部通过，包括：

- `projects the official Grok 402 data.message shape instead of Internal error`
- `observes the raw Grok quota error before projecting the renderer error`
- `marks only the bound Grok account quota-exhausted from the official ACP error shape`
- `auto-falls back to the next Grok account when the selected account is exhausted`
- `rejects an exhausted explicit Grok account instead of silently falling back`
- sticky：已启动 Session A 改 selected 为 B 后 Session A 仍是 A
- native adapter 转发 `onPromptError`

测试使用的错误对象就是真实探针形状：`RequestError(-32603, "Internal error", { message: "...usage balance exhausted", http_status: 402 })`。

### CodeGraph

`craftstation/`：`codegraph status` → Index is up to date（2,894 files / 40,411 nodes / 151,691 edges）。

## Spec Fidelity

对照 [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md) 与 Grok 控制面 brief：

- Official/Native Runtime First：仍走官方 `grok` ACP，未接 CLIProxyAPI，未导入 Codex Router `xai-*.oauth.json`
- 受管 `GROK_HOME` isolation + Session sticky 保持
- 额度耗尽语义：quota-exhausted 只影响**新 Auto Session** 填补；explicit / 已绑定 Session 不换号
- Renderer 仍只消费 AccountView，不跨 IPC 暴露 secret

## Integration / Regression / Edge Cases

| 项 | 结论 |
|---|---|
| F18 UI 文案 | Session 失败路径投影为「Grok 额度已耗尽」。账号行仍显示 raw `quota-exhausted`（既有 AccountRow），不是新的 P0 |
| F19 绑定回写 | observer 使用 bound accountId，不读当前 selected |
| F20 Auto 填补 | selected 耗尽时新 Session 解析到下一个 available；selected 本身不偷偷改成 B |
| F20 explicit | exhausted explicit → error，factory 不被调用 |
| F20 sticky | Session A 绑定后改 selected 不影响 A |
| F08–F17 | 保持关闭：Grok 不打开 grok.com、managed GROK_HOME、overlay 可关、identity 才落行、spawn env 空值覆盖宿主泄漏 |
| F04 | **仍 BLOCKED**：Kimi AUTH_REQUIRED、Antigravity unprobed、DSH unavailable；Grok 3/6 marker 只证明号池部分有额度，不是五 Harness PASS |

## Findings

无新的 P0/P1。F18 / F19 / F20 **关闭**。

残留边界（不派发 Coder）：

1. **F04** 五 Harness 产品级真实 response 仍不完整。
2. 账号池 UI 的 `AccountRow` 仍渲染英文 `account.status`（例如 `quota-exhausted`）。Session 错误文案已是中文「Grok 额度已耗尽」。这是既有展示，不是本轮 402 映射失败。
3. 本轮**没有**在修复后再对 6 个 managed profile 发真实 ACP。现场验收必须用户完全退出并重开后手工点一遍。旧探针 JSON 不能证明修复后的 UI。

## Verdict

**FAIL / BLOCKED**

- Fix Cycle v0.4.10 的 F18 / F19 / F20：**关闭**
- Feature v0.4.0：**不得 PASS**
- 不进入 Feature Closeout
- 不 commit / tag / push
- 不进入 v0.5
- **不要开 v0.4.11**，除非用户重开后报出新的生产缺陷

## 最短人工验收路径（必须完全退出后重开）

当前跑着的 Electron 进程还是修复前的代码。请先关掉所有 CraftStation 窗口，再重新打开。

1. 杀光 CraftStation / Electron 窗口，重新启动。
2. 打开「模型与用量」→ Grok 账号池：应能看到已导入的 6 个账号（只看 masked 邮箱，不要点开凭据文件）。
3. 用**默认 / Auto** 新建一个 Grok 对话，发一句短消息。
   - 期望：落到**有额度**的账号，能收到回复；不要再看到光秃秃的 `Internal error`。
4. 再对一个已知没额度的账号发一轮（或等某次 402）。
   - 期望：对话里出现 **「Grok 额度已耗尽」**。
   - 期望：该账号状态变为 `quota-exhausted` / 额度耗尽，其他有额度账号不要被一起标红。
5. 不指定账号、再 **新建** 一个 Auto Grok 对话。
   - 期望：新 Session 自动落到下一个 `available` / `quota-low` 账号，而不是卡在已耗尽账号上。
6. 在号池里**显式点选**一个已耗尽账号再发。
   - 期望：报额度耗尽 / 账号不可用，**不要偷偷换到另一个号**。
7. 保持一个已打开的有额度 Session，把首选账号改成别的。
   - 期望：这个旧 Session 仍走原来绑定的账号。

报告：

- 复检：[debugger_0.4.10-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.10-rereview-native-harness.md)
- Coder 交付：[coder_0.4.10-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.10-native-harness.md)
- Fix Plan：[debugger_0.4.10-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.10-native-harness.md)
- 真实探针：[v0.4.10-grok-pool-probe.json](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.10-grok-pool-probe.json)
