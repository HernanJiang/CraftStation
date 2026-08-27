# Debugger — v0.4.10 Native Multi-Harness Real-Traffic FAIL

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.10`
> 日期：2026-08-27
> 角色：Debugger
> 用户现场：已添加全部 Grok 账号后，Session 显示 `Internal error`
> 真实流量证据：[v0.4.10-grok-pool-probe.json](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.10-grok-pool-probe.json)
> 上一轮：[debugger_0.4.9-rereview-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.9-rereview-native-harness.md)
> Verdict：**FAIL**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**

用户要求用真实流量检验号池自动填补。Debugger 对 6 个 managed `GROK_HOME` 逐个跑官方 `grok --no-auto-update agent --no-leader stdio` ACP prompt。**登录/号池 UI 已能用；自动填补和生产错误映射没有修好。**

## 真实流量（脱敏）

每个账号：`initialize` success、`session/new` success、`session/close` success。`GROK_HOME` 钉在 managed profile。未读 token。

| order | selected | storeStatus | prompt | 分类 |
|---|---|---|---|---|
| 0 | yes | available | `NATIVE_PROBE_OK` | **有额度** |
| 1 | no | available | `-32603 Internal error` + `data.message` 402 usage balance exhausted | **耗尽** |
| 2 | no | available | `NATIVE_PROBE_OK` | **有额度** |
| 3 | no | available | 同上 402 | **耗尽** |
| 4 | no | available | `NATIVE_PROBE_OK` | **有额度** |
| 5 | no | available | 同上 402 | **耗尽** |

Grok 的真实错误形状：

```json
{"code":-32603,"message":"Internal error","data":{"message":"API error (status 402 Payment Required): Grok Build usage balance exhausted","http_status":402}}
```

UI 只展示 `Internal error`，因为 `resolveAcpPromptRpcErrorMessage` 只读 `data.details` / `data.detail`，**不读** Grok 的 `data.message`。`error.message` 又是泛化的 Internal error。

探针后 `accounts.json` 6 行仍全部 `status: "available"`。Resolver 的 auto fallback 只看事前 status，生产 402 **不会**把账号标成 `quota-exhausted`，新 Auto Session 也不会换号。

## Findings

### F18 — Grok 402 被显示成 Internal error

**P0**

`sessionErrors.ts` 把 `-32603` + `"Internal error"` 当泛化 transport。Grok 把额度耗尽放在 `data.message` + `http_status: 402`。用户看到 Internal error，看不到额度耗尽。

### F19 — 真实 402 不更新 AccountStore

**P0**

6 个账号探针后仍全是 `available`。没有 `updateStatus(..., "quota-exhausted")` 的生产路径。号池无法区分有额度/没额度。

### F20 — 新 Auto Session 不因 402 填补下一号

**P0**

规格：`quota-exhausted` → 新 Auto Session fallback；explicit / 已 bind Session sticky，耗尽报错不偷偷换号。

现状：status 不更新 → auto 永远绑 selected（order 0）。若用户点到耗尽号或 selected 耗尽，UI 只报 Internal error，不会换到 order 2/4 那些已验证有额度的号。

本轮 **不要** 对已启动 Session 做中途换号。

## Verdict

**FAIL**

F08/F12/F13/F14/F15/F16/F17 保持关闭。F04 部分推进：Grok **3/6** 账号已有真实 `NATIVE_PROBE_OK`；另外 3 个是官方 402。五 Harness Feature 仍不得 PASS。

## Fix Plan

### Fix 1 — F18：解开 Grok Internal error

1. ACP prompt 失败解析必须读 `data.message` 和 `http_status`。
2. `402` / `usage balance exhausted` → 用户可见「Grok 额度已耗尽」，不要 `Internal error`。
3. 测试用本轮真实 JSON-RPC 形状（不要 Factory Droid 的 details 形状冒充）。

### Fix 2 — F19：402 标记 quota-exhausted

1. Grok native prompt/runtime 识别 402/usage exhausted 后 `accountStore.updateStatus(boundAccountId, "quota-exhausted")`。
2. 仅该账号；不要把整池标死。
3. 测试：bound account 收到该错误后 list 中该行 status 为 quota-exhausted，其它行不变。

### Fix 3 — F20：新 Auto Session 填补

1. `accountMode: auto`（无 explicitAccountId）创建 **新** Session 时，跳过 `quota-exhausted`，按 order 选下一个 `available`/`quota-low`。
2. explicit 耗尽 → error，不 fallback。
3. 已 bind Session 的后续 send **不**换号。
4. 测试锁住：order=[exhausted, available] + auto → 新 Session 绑后者；explicit 前者 → error；已启动 Session 改 selected 仍 sticky。

### 真实流量回归（Coder 可跑同一探针）

`node ai_workspace/temp/grok-pool-probe.mjs`（只记录分类/marker，不写 secret）。有额度号应 success；耗尽号应 quota-exhausted 文案 + status 更新，不是 Internal error。

不要导入 Router oauth。不要覆盖 `~/.grok`。不 commit/tag/push。不宣称 Feature PASS。

## 用户最短验收（修完后）

1. 完全退出再开 CraftStation。
2. 打开「模型与用量」：6 个 Grok 应在；耗尽过的应变为额度耗尽，不是全 available。
3. 选 auto / 默认号池，新建 Grok 对话发一句：应落到有额度的号，得到回复，不要 Internal error。
4. 显式点一个已耗尽号发消息：应报额度耗尽，**不要**偷偷换号。
