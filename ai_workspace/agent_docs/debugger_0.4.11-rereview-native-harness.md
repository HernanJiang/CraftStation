# Debugger — v0.4.11 Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.11` 复检
> 日期：2026-08-27
> 角色：Debugger
> Coder 交付：[coder_0.4.11-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.11-native-harness.md)
> 上一轮 Fix Plan：[debugger_0.4.11-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.11-native-harness.md)
> Verdict：**FAIL（F21/F23 关闭；F22 生产点选路径未完成；现场 5/6 账号仍 disabled）**
> Requires Manager Re-plan: **No**
> Requires Ideate Revision: **No**
> Next Coder cycle: **v0.4.12**，见 [debugger_0.4.12-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.12-native-harness.md)

独立复检，不以 Coder self-check 代替质量门。v0.4 Feature **不得 PASS**。

## Review Scope

- F21：402 duck-type、首条 sendPrompt throw 落盘、Auto 跳过 disabled/exhausted
- F22：点账号行 = enable + select；登录授权与选号分离
- F23：邮箱前3后3、默认名前3、右键改名
- 真实 accounts.json 是否已能支持用户手工验收

## Evidence

### 独立源码

- [sessionErrors.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/agents/acp/sessionErrors.ts)：不再 `instanceof RequestError`，按 `data.http_status` + `data.message` duck-type。
- [supervisorRuntime.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/supervisorRuntime.ts)：`craftAgent` 把 `accountBinding` 提到 try 外；首条 `sendPrompt` throw 仍 `handleGrokNativePromptError`。
- [accountResolver.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/accountResolver.ts)：AUTO_FALLBACK 含 `disabled`。
- [accountStore.ts](file:///D:/Work/CraftStation/craftstation/src/supervisor/runtime/accountStore.ts)：`maskIdentity` local 前3+***+后3；`New Grok` 迁移为邮箱前3；`rename` IPC 已接。
- [SidebarProviderAccounts.tsx](file:///D:/Work/CraftStation/craftstation/src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx)
  - **模型与用量 dialog 的 AccountRow**：`onClick` → enable+select；`onContextMenu` → rename。这条路径符合 F22/F23。
  - **侧栏紧凑 Grok 卡**：每行仍只是 `<span>{label}</span>`，没有 onClick/select。用户上次点的就是这里，不是 dialog。

### 独立测试

- `session.test.ts` + `accountResolver.test.ts` + `accountStore.test.ts` + `grokProfiles.test.ts` 独立复跑通过。
- `runtime.test.ts` Grok account control plane 独立复跑通过（含 duck-typed 首条 prompt 落盘）。
- Sidebar 测试覆盖 **dialog 行** 的 enable+select / rename，**没有**覆盖紧凑卡点击选号。

### 真实账号库（修完代码后再次读取，脱敏）

| label | masked | enabled | selected | status | lastQuotaAt |
|---|---|---|---|---|---|
| `her` | `her***g01@gmail.com` | false | false | disabled | 空 |
| `poi` | `poi***son@gmail.com` | false | false | disabled | 空 |
| `poi` | `poi***nan@gmail.com` | false | false | disabled | 空 |
| `hao` | `hao***ise@gmail.com` | false | false | disabled | 空 |
| `poi` | `poi***nan@gmail.com` | false | false | disabled | 空 |
| `her` | `her***g01@gmail.com` | true | true | available | 空 |

F23 迁移已生效（不再是 New Grok，掩码已是前3后3）。F21 落盘未发生，因为用户还没在新代码上发过 402。**F21 Auto 在现场仍不可用**：5 个 identity 账号保持 disabled，号池实际仍只有 selected 那一个（探针里的耗尽号）。

## Findings

| ID | 结论 |
|---|---|
| F21 | **关闭（工程）**。duck-type + craftAgent catch 落盘 + resolver 跳过 disabled/exhausted。生产要等用户重开后发一轮 402 才能看到 `quota-exhausted`。 |
| F22 | **未关闭**。Dialog 行已接线；侧栏紧凑卡仍不能选号。用户现场「指定有额度的号」走的就是紧凑卡。 |
| F23 | **关闭**。掩码/默认名已写入真实 accounts.json；dialog 右键改名已接。 |
| F24 | **新 P0**。已有官方 identity 的 Grok 账号被旧「首选=独占启用」留在 disabled。启动时必须把这类账号重新 `enabled=true`（status 从 disabled → available），不要改 selected，不要批量 disable。否则 Auto 永远没有下一个号。 |

## Verdict

**FAIL**。不要 Feature PASS。不要 commit/tag/push。F04 仍 BLOCKED。

下一轮只修 F22 剩余（紧凑卡点选）和 F24（legacy disabled 回启用）。
