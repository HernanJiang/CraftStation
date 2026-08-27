# Debugger — v0.4.4 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.4`
> 日期：2026-08-27
> 角色：Debugger
> Source Fix Plan：[debugger_0.4.3-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.3-native-harness.md)
> Coder 交付：[coder_0.4.4-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.4-native-harness.md)
> 探针证据：[v0.4.4-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.4-native-session-probe.md)
> Verdict：**FAIL**

本轮不复用旧 Codex 多账号文档。单次 Codex marker、`turn/completed`、session/new、usage exhausted、`AUTH_REQUIRED` **一律不升格为五 Harness Feature PASS**。

## Review Scope

- F07 Codex assistant 文本是否按生产通道累计后再判 `NATIVE_PROBE_OK`
- F06 server turn id 是否保持
- F04 五 Harness 是否存在完整可审计 `start → real response → interrupt/cleanup`
- F01/F02/F03/F05 回归与 capability 诚实性

## Evidence

### 独立文档

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.4-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.4-native-harness.md)
- [v0.4.4-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.4-native-session-probe.md)
- [v0.4.1-native-session-probe.mjs](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.mjs)（`probeVersion = 0.4.4`）

### F07 源码复核

`assistantTextFromMessages()` 现在累计：

- `item/agentMessage/delta`
- `agentMessage/delta`
- `content/delta`
- assistant `item/completed` payload（`text` / `delta` / `content` / `parts` / `output` / `message` / `payload`）

跨 chunk 拼接后再 `includes("NATIVE_PROBE_OK")`。报告只写 boolean、length、SHA-256 前 12 位。未见完整模型输出。

F06 保持：`turn/start` 不发送 `native-probe-turn`；completion / interrupt 使用 `result.turn.id`。

### 独立 hash 核验

Debugger 独立计算：

```text
len("NATIVE_PROBE_OK") = 15
sha256("NATIVE_PROBE_OK")[:12] = 4f624a202114
```

与探针报告的 `assistantTextLength=15`、`assistantTextSha256_12=4f624a202114` 一致。这支持 Codex 官方 app-server 本轮确实产出了该 marker，而不是空 completed 事件。

### 独立测试 / 工具

| 检查 | 结果 |
|---|---|
| nativeHarness + crafting + Codex baseline + CraftingGrid + HarnessPanel | **16 files / 71 passed** |
| `runtime.test.ts -t routes` | **5 passed** |
| `node --check` 探针脚本 | **PASS** |
| 生产 `descriptors.ts` | **0** 处 `supported+integrated` |
| `codegraph status` | Index is up to date；2,890 files / 40,323 nodes / 151,327 edges |

未整包复跑 Coder 自称的 19 files / 131 tests；定向复跑足以证明接线未回退。本 Debugger 未重跑交互式 login，也未启用 `CRAFTSTATION_REAL_RUNTIME=1` 的产品 `craftAgent` 集成测试。

### 真实探针（Coder 记录 + Debugger hash 核验）

| Harness | 本轮证据 | 质量门 |
|---|---|---|
| Codex | server turn id；`turn/completed`；marker true；len 15；hash `4f624a202114`；完成后无需 interrupt；进程清理 | **probe success**，生产 capability **仍** `implementation missing` |
| Grok | session/new 成功；prompt usage exhausted；close 成功 | **error** |
| Kimi | session/new 成功；prompt `AUTH_REQUIRED`；cancel 失败；close 成功 | **partial/error** |
| Antigravity | 未跑 PTY | **unprobed** |
| DeepSeek / DSH | 无官方 executable | **unavailable**，无 Entity |

Coder 没有升格 capability，也没有写 Feature PASS。Debugger 同意。

## Fix Cycle Disposition

| Finding | v0.4.4 | 说明 |
|---|---|---|
| F01 | **仍关闭** | 生产矩阵未升格 |
| F02 | **仍关闭** | Recipe 填充回归绿 |
| F03 | **仍关闭** | Control Plane IPC 仍在 |
| F05 | **仍关闭** | 生产路由 + DSH 无 Entity |
| F06 | **仍关闭** | server turn id 保持 |
| F07 | **关闭** | 全通道累计 + 独立 hash 核验 |
| F04 | **仍 OPEN / BLOCKED** | 五平级 Harness 仍无完整产品级 real response |

## Remaining Findings

### F04 — 五 Harness Feature 质量门仍未关闭（P0 / BLOCKED）

- Evidence：Codex 仅有 **独立探针脚本** 的成功 marker，不是本轮 Debugger 复跑的 `craftAgent` 产品路径。Grok 官方余额耗尽。Kimi `AUTH_REQUIRED`。Agy unprobed。DSH unavailable。
- Impact：Manager 要求五个平级 Harness 进入 `Crafting -> Runtime -> Entity -> Session -> real response`。一条 Codex probe 不能关闭 Feature。
- Root Cause：其余 Harness 被官方认证/配额/PTY 安全边界挡住；继续空转同样的 ACP prompt 不会变成 PASS。
- Fix：见 v0.4.5。禁止升格 capability。禁止 synthetic Entity。不要为了“再跑一轮相同探针”改代码。

Grok usage exhausted 与 Kimi `AUTH_REQUIRED` 是官方诚实失败，应保持，直到用户完成官方充值/登录。

## Verdict

**FAIL**

- Feature PASS：**No**
- Closeout：**No**
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 下一 Fix Cycle：`v0.4.5`（凭据/环境门控，不是再发明一个探针 bug）

v0.4.4 的诚实性是对的：Codex marker 可审计，但不是五 Harness PASS。

## Fix Plan — v0.4.5

Fix Owner：Coder  
文档：`ai_workspace/agent_docs/coder_0.4.5-native-harness.md`

### 停止条件

以下情况 **不要** 再改生产代码或重复相同失败探针：

- Grok 仍报 usage balance exhausted
- Kimi 仍报 `AUTH_REQUIRED`
- Antigravity 仍无安全非交互 PTY
- DSH 仍无官方 executable

把这些记为 BLOCKED，等用户给出官方登录/余额/PTY 许可后再探针。

### Fix Execution Order

1. **不要**升格任何 production capability。
2. **不要**为 Grok/Kimi/Agy/DSH 发明 CLIProxyAPI、Gemini CLI、Model API 或旧 DSH fallback。
3. 可选、仅在不打扰用户登录流的前提下：对 Codex 跑一次产品路径证据（`CRAFTSTATION_REAL_RUNTIME=1` 的 `craftAgent.integration.test.ts`，或等价 Supervisor `craftAgent`）。失败则记录稳定错误，成功也不把五 Harness 写成 PASS。
4. 当且仅当用户确认 Grok 有余额 / Kimi 已官方登录后，再跑对应官方 ACP 最小成功 turn。证据写入 `ai_workspace/validation/v0.4.5-native-session-probe.md`。
5. Antigravity / DSH 保持 unprobed / unavailable，直到有官方可执行且安全的非交互路径。
6. 回归 F01–F03/F05–F07。自检后通知 Debugger。Coder 不得写 Feature PASS。

### Fix Acceptance Criteria

- [ ] 生产 descriptor 仍无未证明的 `supported+integrated`
- [ ] Grok/Kimi 若仍失败，证据与 UI 一致为 error / not-configured / AUTH_REQUIRED，而不是 integrated
- [ ] DSH 仍无 Entity
- [ ] 无 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness
- [ ] 若 Codex 产品 `craftAgent` 有新证据，单独记录，不替代其余四个 Harness
- [ ] 五 Harness 仍缺完整产品级 real response 时，Debugger 继续 FAIL，不得 Closeout

## 给用户的最短人工验收（确认进度，不是放行）

Feature **仍未通过**。可以核对 UI 和 Codex 探针进度，不要当成五套都能对话。

1. 终端进 [craftstation](file:///D:/Work/CraftStation/craftstation)，跑 `pnpm dev`。
2. Craft Table →「配方」，点 Grok / Kimi / Antigravity / DeepSeek：Harness 槽应是对应 harness，不是 `auto（确定性 Codex）`。
3. 右侧五条 Native Harness 状态应在。DeepSeek 不可用。Codex/Grok/Kimi **不应**显示已集成。
4. **先不要指望 Grok/Kimi Craft 成功。** 当前官方结果是余额耗尽 / 需要登录。
5. 若你要继续打通：给 Grok 充值或换有余额的账号；在官方 `kimi` 完成登录。不要把 API key 发给 Agent。完成后让 Coder 再探针这两条。
