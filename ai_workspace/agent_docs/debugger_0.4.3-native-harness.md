# Debugger — v0.4.3 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.3`
> 日期：2026-08-27
> 角色：Debugger
> Source Fix Plan：[debugger_0.4.2-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.2-native-harness.md)
> Coder 交付：[coder_0.4.3-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.3-native-harness.md)
> 探针证据：[v0.4.3-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.3-native-session-probe.md)
> Verdict：**FAIL**

本轮不复用旧 Codex 多账号文档。`turn/completed`、delta 事件、session/new、usage exhausted、`AUTH_REQUIRED` **一律不升格为 Feature PASS**。

## Review Scope

- F06 Codex 探针是否使用 server `turn.id`
- F04 五 Harness 是否存在非 synthetic `start → real response → interrupt/cleanup`
- F01/F02/F03/F05 回归
- 生产 capability 是否被错误升格

## Evidence

### 独立文档

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.3-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.3-native-harness.md)
- [v0.4.3-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.3-native-session-probe.md)
- [v0.4.1-native-session-probe.mjs](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.mjs)（`probeVersion = 0.4.3`）

### F06 源码复核

`probeCodex()` 现在：

1. `turn/start` **不**发送 `native-probe-turn`
2. 等待 JSON-RPC result，读取 `turnStart.turn.id`，缺失则失败
3. 记录 `turnIdSource = server-turn-start-result`
4. `turn/completed` 按 `threadId` + server `turn.id` 匹配
5. 未完成时 `turn/interrupt` 使用同一 server id；完成后标记 `not-needed-after-completion`

这关闭了 v0.4.2 的 F06。

### 独立测试 / 工具

| 检查                                                                    | 结果                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| nativeHarness + crafting + Codex baseline + CraftingGrid + HarnessPanel | **16 files / 71 passed**                                        |
| `runtime.test.ts -t routes`                                             | **5 passed**（Grok/Kimi/Agy 路由 + DSH 无 Entity）              |
| `pnpm typecheck`                                                        | **PASS**                                                        |
| `codegraph status`                                                      | Index is up to date；2,890 files / 40,323 nodes / 151,327 edges |
| 生产 `descriptors.ts`                                                   | **0** 处 `supported+integrated`                                 |

本轮未整包复跑 Coder 自称的 19 files / 131 tests；定向复跑足以证明接线未回退。全量数字不作为门禁。本 Debugger 未重跑交互式 login。

### 真实探针（Coder 记录，Debugger 按诚实边界采信）

| Harness        | 本轮证据                                                                                                                                           | 质量门                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Codex          | initialize + thread/start + server turn id + matching `turn/completed(completed)` + `item/agentMessage/delta`；固定 `NATIVE_PROBE_OK` **未观察到** | **partial**，保持 `implementation missing` |
| Grok           | session/new 成功；prompt usage exhausted；close 成功                                                                                               | **error**                                  |
| Kimi           | session/new 成功；prompt `AUTH_REQUIRED`；cancel 失败；close 成功                                                                                  | **partial/error**                          |
| Antigravity    | 未跑 PTY                                                                                                                                           | **unprobed**                               |
| DeepSeek / DSH | 无官方 executable                                                                                                                                  | **unavailable**，无 Entity                 |

Coder 没有升格 capability，也没有写 Feature PASS。Debugger 同意。

## Fix Cycle Disposition

| Finding | v0.4.3                | 说明                                    |
| ------- | --------------------- | --------------------------------------- |
| F01     | **仍关闭**            | 生产矩阵未升格                          |
| F02     | **仍关闭**            | Recipe 填充回归绿                       |
| F03     | **仍关闭**            | Control Plane IPC 仍在                  |
| F05     | **仍关闭**            | 生产路由 + DSH 无 Entity                |
| F06     | **关闭**              | 探针使用 server turn id                 |
| F04     | **仍 OPEN / BLOCKED** | 五 Harness 仍无完整可审计 real response |

## Remaining Findings

### F04 — 五 Harness 仍无完整真实 response（P0 / BLOCKED）

- Evidence：v0.4.3 探针表。Codex 只有 completed 事件 + delta 存在性，没有锁定 `NATIVE_PROBE_OK`。Grok 官方余额耗尽。Kimi `AUTH_REQUIRED`。Agy unprobed。DSH unavailable。
- Impact：T08 / Feature 质量门未关闭。`Crafting -> Runtime -> Entity -> Session -> native events / real response` 仍不成立。
- Fix：见 v0.4.4。禁止升格 capability。禁止 synthetic Entity。

### F07 — Codex 响应验收只扫一种 delta 字段（P1，探针）

- Evidence：`responseMarkerObserved()` 只认 `method === "item/agentMessage/delta"` 且 `params.delta` 为字符串。生产 `eventMapping.ts` 同时处理 `agentMessage/delta`、`content/delta`，并把 assistant 文本累计到 `content.delta`；`item/completed` 也可能带 payload 文本。
- Impact：模型可能已经按要求回复，但 marker 被切块、放在别的 method、或只出现在 completed payload 时，探针会记 `completed-without-response-marker`。这会把“真实回复已到”和“只看到事件空壳”混在一起。
- Fix：按生产 adapter 累计 assistant_text：拼接 `item/agentMessage/delta`、`agentMessage/delta`、`content/delta` 的文本，并检查 `item/completed` payload 文本。只记录 boolean `responseMarkerObserved` 与脱敏后的短 hash/长度，不落完整模型输出。
- Acceptance：Codex 要么观察到 `NATIVE_PROBE_OK`（或稳定说明模型未按指令回复），要么证明所有相关 notification 已扫描且文本长度为 0。不得只用单一 delta method 下结论。

Grok usage exhausted 与 Kimi `AUTH_REQUIRED` 仍是官方诚实失败，不是 PASS。

## Verdict

**FAIL**

- Feature PASS：**No**
- Closeout：**No**
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 下一 Fix Cycle：`v0.4.4`

v0.4.3 的诚实性是对的：`turn/completed` ≠ 已验证业务响应。不要为了 PASS 去改 descriptor。

## Fix Plan — v0.4.4

Fix Owner：Coder  
文档：`ai_workspace/agent_docs/coder_0.4.4-native-harness.md`

### Fix Execution Order

1. **F07**：按生产 Codex event mapping 累计 assistant 文本后再判 `NATIVE_PROBE_OK`。证据写入 `ai_workspace/validation/v0.4.4-native-session-probe.md`。
2. **F04** 最小真实探针（独立进程，脱敏，不读 token）：
   - Codex：F07 修好后，要么锁定 marker，要么记录模型实际完成语义（仍不得升格 capability，除非文本可审计）。interrupt 仅在未完成时用 server turn id。
   - Grok：若仍 usage exhausted，保持 error；有余额才补成功 turn。禁止 Model API。
   - Kimi：`AUTH_REQUIRED` 必须走官方 login，不得塞 key。
   - Antigravity：无安全非交互 PTY 则保持 `unprobed`。禁止 Gemini CLI。
   - DSH：继续 `RUNTIME_UNAVAILABLE`，无 Entity。
3. 生产 capability **禁止**因 `turn/completed`、delta、session/new、余额错误、AUTH_REQUIRED 升格为 `supported+integrated`。
4. 回归 F01/F02/F03/F05 + `pnpm typecheck`。不要改并行无关前端。
5. 自检后通知 Debugger。Coder 不得写 Feature PASS。

### Fix Acceptance Criteria

- [ ] Codex 探针扫描全部 assistant 文本通道；marker 判定可审计
- [ ] 每个已安装 Harness 有 v0.4.4 非 fixture 证据，或与 UI 一致的 error/unprobed/unavailable
- [ ] 无完整可审计 real response 则 capability 保持 `implementation missing` / `error` / `unavailable`
- [ ] DSH spawn 仍无 Entity
- [ ] 无 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness
- [ ] F01/F02/F03/F05/F06 回归保持
- [ ] Debugger 复检前不得 Closeout

## 给用户的最短人工验收（确认进度，不是放行）

Feature **仍未通过**。可以核对 UI，不要当成五套 Harness 都能真实对话。

1. 终端进 [craftstation](file:///D:/Work/CraftStation/craftstation)，跑 `pnpm dev`。
2. Craft Table →「配方」，点 Grok / Kimi / Antigravity / DeepSeek：Harness 槽应是对应 harness，不是 `auto（确定性 Codex）`。
3. 右侧五条 Native Harness 状态应在。DeepSeek 不可用。Codex/Grok/Kimi **不应**显示已集成。
4. **先不要点 Craft 等真实回复。** 当前：Codex 只证明 turn 完成事件，未锁定 `NATIVE_PROBE_OK`；Grok 没余额；Kimi 要官方登录；Agy 未探针；DSH 不可用。
