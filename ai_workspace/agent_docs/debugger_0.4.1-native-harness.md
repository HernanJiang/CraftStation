# Debugger — v0.4.1 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.1`
> 日期：2026-08-27
> 角色：Debugger
> Source Fix Plan：[debugger_0.4.0-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.0-native-harness.md)
> Coder 交付：[coder_0.4.1-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.1-native-harness.md)
> 探针证据：[v0.4.1-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.md)
> Verdict：**FAIL**（Fix Cycle 工程项大部分关闭；Feature 因真实 Native Session 不完整仍不 PASS）

本轮不复用旧 Codex 多账号 `debugger_0.4.1.md`。验收对象仍是五个平级 Native Harness。

## Review Scope

复检上一轮 Fix Plan 的 F01–F05：

- F01 capability 诚实性
- F02 Craft Table 非 Codex Recipe 填充
- F03 Control Plane Supervisor → Renderer 接线与脱敏
- F04 真实 native probe / unavailable 证据
- F05 生产 `createCraftingAdapter` / `craftAgent` 路由

并核对：Official/Native First、DSH 不造假、Codex app-server 不回退、typecheck / 定向测试。

## Evidence

### 独立文档

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.1-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.1-native-harness.md)
- [v0.4.1-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.md)
- [v0.4.1-native-session-probe.mjs](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.mjs)

### 独立源码复核

- `descriptors.ts`：`capabilityMap` 把未取得完整 native session 的已接线能力标为 `implementation missing`；unsupported 保持 `native unsupported`；DSH 全 `unavailable`。生产矩阵中**没有** `supported+integrated`。
- `CraftingGrid.tsx`：Recipe 点击按 `recipe.harnessItemId` + 匹配 `modelVendors` 填充，不再强制 `auto`。
- `HarnessPanel.tsx`：调用 `getNativeHarnessControlPlane({})`，渲染五条 `native-harness-*` 状态行。
- `supervisorRuntime.ts`：`createCraftingAdapter` 仍是 Codex → `NativeCodexRuntimeAdapter`，其余 → `createNativeHarnessRuntimeAdapter`；聚合 adapter/session diagnostics；`profileConfigured` 排除空 pending account，并合并 AgentStatus `authenticated`。
- `runtime.test.ts`：Grok/Kimi/Antigravity 通过 factory override 走 `craftAgent`；DeepSeek 不 override，生产 unavailable adapter 抛 `RUNTIME_UNAVAILABLE` / `no synthetic Entity`。
- Codex baseline guard：官方 `codex app-server --stdio`，capability 不得含 `supported+integrated`。

### 独立测试 / 工具

| 检查                                                               | 结果                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| nativeHarness + crafting + nativeCodexBaselineGuard                | 先前定向 **16 files / 71 passed**                                      |
| `CraftingGrid.test.tsx` + `HarnessPanel.test.tsx` + Codex baseline | **3 files / 12 passed**                                                |
| `runtime.test.ts -t routes`                                        | **5 passed / 43 skipped**（Grok/Kimi/Agy 路由 + DeepSeek unavailable） |
| `pnpm typecheck`                                                   | **PASS**                                                               |
| `codegraph status`                                                 | Index is up to date；2,890 files / 40,323 nodes / 151,327 edges        |
| 本轮 Debugger 未重跑交互式 login / 模型响应                        | 以 Coder 探针文件为诚实记录，不升格                                    |

### 真实探针（Coder 记录，Debugger 按诚实边界采信）

| Harness        | 结论                                                                                 | capability 应保持                  |
| -------------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| Codex          | initialize + `thread/start` 成功；prompt 未完成；interrupt `NATIVE_EXECUTION_FAILED` | `implementation missing` / partial |
| Grok           | initialize 成功；`session/new` `PROBE_TIMEOUT`                                       | `implementation missing` / error   |
| Kimi           | initialize + `session/new` + `session/close` 成功；prompt 未完成；cancel 失败        | `implementation missing` / partial |
| Antigravity    | 未跑 PTY                                                                             | `unprobed`                         |
| DeepSeek / DSH | 无官方 executable                                                                    | `unavailable`                      |

Coder 未把上述结果写成 Feature PASS。Debugger 同意。

## Fix Cycle Disposition

| Finding | 复检               | 说明                                                                                           |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| F01     | **CLOSED**         | 生产 descriptor 与 Codex baseline 测试锁定诚实状态                                             |
| F02     | **CLOSED**         | 四个非 Codex Recipe 测试断言 harnessKind / model 绑定                                          |
| F03     | **CLOSED**         | Renderer 消费 typed IPC；敏感字段脱敏测试仍在                                                  |
| F05     | **CLOSED**         | 生产 factory 路由 + DSH 无 Entity                                                              |
| F04     | **OPEN / BLOCKED** | 证据文件存在且诚实，但五个平级 Harness 仍没有完整 Entity→Session→real response。T08 不能关闭。 |

## Remaining Findings

### F04 — 真实 Native Session 仍不完整（P0 / BLOCKED）

- Evidence：探针表；Codex/Kimi 仅 handshake/partial lifecycle；Grok `PROBE_TIMEOUT`；Antigravity unprobed；DSH unavailable。生产 capability 正确保持 `implementation missing`，因此 UI 也不得显示“已集成”。
- Impact：Manager 要求的五 Harness `Crafting -> Runtime -> Entity -> Session -> native events / real response` 未完成。这是 Feature 质量门，不是文档缺口。
- Root Cause：官方 runtime 的受控 turn/interrupt 尚未打通（Grok session/new 超时；Codex/Kimi prompt/cancel 失败；Agy 无非交互 PTY 探针）。
- Fix：下一 Fix Cycle `v0.4.2` 继续最小真实探针，直到每个已安装 Harness 要么有非 synthetic 一轮响应 + interrupt/cleanup 证据，要么公开 error/unavailable 且与 UI 一致。禁止升格 capability。DSH 继续 unavailable。
- Acceptance：见下方 Fix Plan。不得用 fixture、`--version` 或 auth 文件存在性宣称 PASS。

## Verdict

**FAIL**

- Feature PASS：**No**
- Fix Cycle v0.4.1 工程修复：**部分通过**（F01/F02/F03/F05 关闭）
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 下一 Fix Cycle：`v0.4.2`
- 未做 Feature Closeout、未 commit / tag / push

保留且不要拆掉：Official/Native First、Codex app-server 路径、DSH unavailable、诚实 capability、Recipe 填充、Control Plane IPC。

## Fix Plan — v0.4.2

Fix Owner：Coder  
文档：更新或新建 `ai_workspace/agent_docs/coder_0.4.2-native-harness.md`  
不要覆盖历史 Codex-only `coder_0.4.1.md`。

### Fix Execution Order

1. 以 [v0.4.1-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.1-native-session-probe.md) 为基线，只补真实 lifecycle 缺口：
   - Codex：受控 prompt 完成或稳定 `NATIVE_EXECUTION_FAILED` / `AUTH_REQUIRED`；interrupt/cleanup 成功或稳定错误。
   - Kimi：受控 prompt 完成或稳定错误；cancel 不得 silently 当成功。
   - Grok：定位 `session/new` `PROBE_TIMEOUT`（协议/认证/超时预算）；成功则记录 session id；失败保持 error。
   - Antigravity：若无法安全非交互 PTY，保持 `unprobed` + 明确诊断，不要假 ACP。
   - DSH：继续 `RUNTIME_UNAVAILABLE`，无 Entity。
2. 探针证据写入 `ai_workspace/validation/`（可追加 v0.4.2 文件）。禁止记录 token/cookie/路径。
3. 生产 capability **不得**因 partial handshake 升格为 `supported+integrated`。只有完整 start→turn→interrupt/cleanup 且非 synthetic 才允许单项升格，并同步 Control Plane。
4. 回归：上一轮已关闭的 Grid / Panel / factory routing / descriptors / typecheck。
5. 自检后通知 Debugger。Coder 仍不得写 Feature PASS。

### Fix Acceptance Criteria

- [ ] 每个已安装 Harness 有新的非 fixture 证据文件，或与 UI 一致的 error/unprobed/unavailable
- [ ] Codex/Grok/Kimi 若仍无真实 response，capability 保持 `implementation missing` 或 `error`
- [ ] Antigravity 无 PTY 证据则保持 unprobed，不标 integrated
- [ ] DSH spawn 仍 `RUNTIME_UNAVAILABLE`，无 Entity
- [ ] F01/F02/F03/F05 回归保持绿
- [ ] 无 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness
- [ ] Debugger 复检前不得 Closeout

## 给用户的最短人工验收（确认当前进度，不是放行）

本轮 **Feature 仍未通过**。可以核对已修好的 UI，但不要当成五 Harness 已能真实对话。

1. 终端进 [craftstation](file:///D:/Work/CraftStation/craftstation)，跑 `pnpm dev`，等 Electron 起来。
2. 打开 Craft Table →「配方」，分别点：
   - xAI Grok Build Native Recipe
   - Moonshot Kimi Code Native Recipe
   - Google Antigravity Native Recipe
   - DeepSeek / DSH Native Recipe
3. Harness 槽应变为对应 `harness:grok` / `kimi` / `antigravity` / `deepseek`，**不应**再停在 `auto（确定性 Codex）`。这是 F02。
4. 右侧 Harness 面板应有五条 Native Harness 状态（就绪 / 未配置 / 不可用 / 错误）。DeepSeek 应为不可用 + `RUNTIME_UNAVAILABLE`。这是 F03。
5. **先不要对 Grok/Kimi/Codex 点 Craft 指望真实回复。** 探针显示 session 不完整；DeepSeek 点了也应失败且不造假会话。

等 v0.4.2 打通真实 session 并由 Debugger PASS 后，再给完整烟雾路径。
