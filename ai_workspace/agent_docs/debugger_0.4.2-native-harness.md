# Debugger — v0.4.2 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.2`
> 日期：2026-08-27
> 角色：Debugger
> Source Fix Plan：[debugger_0.4.1-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.1-native-harness.md)
> Coder 交付：[coder_0.4.2-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.2-native-harness.md)
> 探针证据：[v0.4.2-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.2-native-session-probe.md)
> Verdict：**FAIL**

本轮不复用旧 Codex 多账号文档。partial handshake、session identity、auth 文件、`--version` 和 fixture **一律不升格为 PASS**。

## Review Scope

- F04 真实 Native Session / 五 Harness `Entity -> Session -> real response`
- F01/F02/F03/F05 回归
- capability 是否被错误升格为 `supported+integrated`
- Official/Native First、DSH 不造假、Codex app-server 不回退
- 独立测试 / typecheck / lint / CodeGraph

## Evidence

### 独立文档

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.2-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.2-native-harness.md)
- [v0.4.2-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.2-native-session-probe.md)
- [v0.4.1-native-session-probe.mjs](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.mjs)（probe version `0.4.2`）

### 独立源码复核

- `descriptors.ts`：生产矩阵 **0 处** `supported+integrated`。已接线能力仍是 `implementation missing`；DSH 全 `unavailable`。
- `CraftingGrid.tsx`：Recipe 仍按 `harnessItemId` + `modelVendors` 填充。
- `HarnessPanel.tsx`：仍调用 `getNativeHarnessControlPlane({})`。
- `runtime.test.ts`：生产 factory 路由与 DeepSeek `no synthetic Entity` 仍在。
- `supervisorRuntime.ts`：Codex 仍 `NativeCodexRuntimeAdapter`；其余仍 `createNativeHarnessRuntimeAdapter`。
- 探针脚本：Codex 走 `codex app-server --stdio`；Grok 走 `grok --no-auto-update agent --no-leader stdio`；Kimi Windows 走官方 Node entry + `acp`。Antigravity/DSH 只记录 unprobed/unavailable，不启动假进程。

### 独立测试 / 工具

| 检查                                      | 结果                                                            |
| ----------------------------------------- | --------------------------------------------------------------- |
| nativeHarness + crafting + Codex baseline | **16 files / 71 passed**                                        |
| `CraftingGrid` + `HarnessPanel`           | **2 files / 10 passed**                                         |
| `runtime.test.ts -t routes`               | **5 passed / 43 skipped**                                       |
| `pnpm typecheck`                          | **PASS**                                                        |
| `pnpm lint`                               | **PASS**                                                        |
| `codegraph status`                        | Index is up to date；2,890 files / 40,323 nodes / 151,327 edges |

Coder 自称 19 files / 131 tests 本轮未整包复跑；以上定向复跑足以证明 F01/F02/F03/F05 未回退。全量数字不作为本轮门禁。

### 真实探针（Coder 记录，Debugger 按诚实边界采信）

| Harness        | 本轮证据                                                                                                          | 质量门结论                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Codex          | initialize + `thread/start` 成功；等待 `turn/completed` 超时 `PROBE_TIMEOUT`；interrupt `NATIVE_EXECUTION_FAILED` | **partial / error**，保持 `implementation missing` |
| Grok           | initialize + `session/new` 成功；prompt 官方 usage balance exhausted；`session/close` 成功                        | **error**，保持 `implementation missing`           |
| Kimi           | initialize + `session/new` + `session/close` 成功；prompt `AUTH_REQUIRED`；cancel `NATIVE_EXECUTION_FAILED`       | **partial / error**，保持 `implementation missing` |
| Antigravity    | 未跑 PTY                                                                                                          | **unprobed**                                       |
| DeepSeek / DSH | 无官方 executable                                                                                                 | **unavailable**，无 Entity                         |

Coder **没有**把这些写成 Feature PASS，也没有升格 capability。Debugger 同意。

## Fix Cycle Disposition

| Finding | v0.4.2 复检           | 说明                                                 |
| ------- | --------------------- | ---------------------------------------------------- |
| F01     | **仍关闭**            | 生产 descriptor 未升格                               |
| F02     | **仍关闭**            | 四条非 Codex Recipe 测试仍绿                         |
| F03     | **仍关闭**            | Renderer 仍消费 Control Plane IPC                    |
| F05     | **仍关闭**            | 生产路由 + DSH 无 Entity                             |
| F04     | **仍 OPEN / BLOCKED** | 没有完整 `start → turn/response → interrupt/cleanup` |

## Remaining Findings

### F04 — 五 Harness 仍无完整真实 response（P0 / BLOCKED）

- Evidence：v0.4.2 探针表。Grok/Kimi 已建立真实 session，但 prompt 分别因余额耗尽 / `AUTH_REQUIRED` 失败。Codex turn 未完成。Antigravity unprobed。DSH unavailable。
- Impact：Manager 要求的 `Crafting -> Runtime -> Entity -> Session -> native events / real response` 仍未关闭。T08 不能关，Feature 不能 PASS。
- Fix：见 v0.4.3 Plan。禁止升格 capability。禁止 synthetic Entity。

### F06 — Codex 探针可能用错 turn identity（P1，探针缺陷）

- Evidence：
  - 探针 `turn/start` 发送 client `turnId: "native-probe-turn"`，并只等待 `params.turnId` 或 `params.turn.id === "native-probe-turn"` 的 `turn/completed`。
  - 生产 `CodexTurnStartParams.turnId` 是可选；`CodexTurnStartResult` 是 `{ turn: { id, status } }`。生产 adapter 用 **server 返回的 turn.id** 做 interrupt / 完成匹配。
  - fixture 也是先回 `turn/start` result，再发 `turn/started` / `turn/completed`，完成事件带 **server turn id**。
- Impact：即使官方 app-server 已经完成 turn，探针也可能因 id 对不上而记 `PROBE_TIMEOUT`，然后对错误 turnId 做 interrupt。这会把协议/探针 bug 伪装成 runtime 失败。
- Root Cause：探针没有按生产 `AppServerClient.startTurn` 契约读取 server turn id。
- Fix：探针必须：
  1. 等待 `turn/start` JSON-RPC **result**；
  2. 用 `result.turn.id` 等待 `turn/completed` / 做 `turn/interrupt`；
  3. 不要把 client 自造 turnId 当唯一匹配键；
  4. 超时前记录已收到的 notification method 列表（脱敏），便于区分“真超时”和“等错事件”。
- Acceptance：协议对齐后的 Codex 探针要么拿到非 synthetic `NATIVE_PROBE_OK` / 等价完成，要么记录稳定错误码且能证明等的是 server turn。不得再用错误 turnId 解释超时。

Grok 余额耗尽、Kimi `AUTH_REQUIRED` 是官方 runtime 的诚实失败，不是 synthetic PASS，也不是探针假阳性（除非后续证明 ACP 请求体写错）。它们保持 `implementation missing` / error，直到有真实成功 turn。

## Verdict

**FAIL**

- Feature PASS：**No**
- Closeout：**No**（无 report、无 commit/tag/push）
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 下一 Fix Cycle：`v0.4.3`

v0.4.2 的诚实性是对的：session 建立 ≠ 已集成。不要为了 PASS 去改 descriptor。

## Fix Plan — v0.4.3

Fix Owner：Coder  
文档：`ai_workspace/agent_docs/coder_0.4.3-native-harness.md`  
不要覆盖历史 Codex-only `coder_0.4.1.md`。

### Fix Execution Order

1. **先修 F06**：按生产 `AppServerClient` / `nativeCodexRuntimeAdapter` 修正 Codex 探针 turn identity。追加 `ai_workspace/validation/v0.4.3-native-session-probe.md`。
2. **再跑 F04 最小真实探针**（每个独立进程，脱敏，不读 token）：
   - Codex：协议对齐后完成一轮受控 prompt，或稳定 `AUTH_REQUIRED` / `NATIVE_EXECUTION_FAILED` / 真超时。interrupt/cleanup 必须针对 server turn id。
   - Grok：若仍 usage exhausted，保持 error，记录官方错误语义；有余额时才补成功 turn。不要用 Model API 替代。
   - Kimi：`AUTH_REQUIRED` 必须走官方 `kimi` login/auth，不得塞 key。成功或稳定失败都写入证据。
   - Antigravity：没有安全非交互 PTY 就保持 `unprobed` + 诊断，不要假 ACP / Gemini CLI。
   - DSH：继续 `RUNTIME_UNAVAILABLE`，无 Entity。
3. 生产 capability **禁止**因 handshake / session/new / 余额错误 / AUTH_REQUIRED 升格为 `supported+integrated`。只有完整 start→response→interrupt/cleanup 且非 synthetic 才允许**单项**升格，并同步 Control Plane。
4. 回归：F01/F02/F03/F05 测试 + `pnpm typecheck`。不要改并行无关前端专项。
5. 自检后通知 Debugger。Coder 仍不得写 Feature PASS。

### Fix Acceptance Criteria

- [ ] Codex 探针使用 server turn id；证据能区分真超时 vs 等错事件
- [ ] 每个已安装 Harness 有 v0.4.3 非 fixture 证据，或与 UI 一致的 error/unprobed/unavailable
- [ ] 无完整真实 response 则 capability 保持 `implementation missing` / `error` / `unavailable`
- [ ] DSH spawn 仍无 Entity
- [ ] 无 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness
- [ ] F01/F02/F03/F05 回归绿
- [ ] Debugger 复检前不得 Closeout

## 给用户的最短人工验收（确认进度，不是放行）

Feature **仍未通过**。可以核对已修好的 UI，不要当成五套 Harness 都能真实对话。

1. 终端进 [craftstation](file:///D:/Work/CraftStation/craftstation)，跑 `pnpm dev`，等 Electron 起来。
2. Craft Table →「配方」，点 Grok / Kimi / Antigravity / DeepSeek：Harness 槽应是对应 harness，不是 `auto（确定性 Codex）`。
3. 右侧五条 Native Harness 状态应在。DeepSeek 应为不可用。Codex/Grok/Kimi **不应**显示已集成。
4. **先不要指望点 Craft 得到真实回复。** 当前证据是：Codex turn 未完成、Grok 余额耗尽、Kimi 需要官方登录、Antigravity 未探针、DSH 不可用。

等 v0.4.3 补上协议正确的真实 turn 证据、Debugger PASS 后，再给完整烟雾路径。
