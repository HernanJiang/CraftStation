# Debugger — v0.4.5 Native Multi-Harness Re-review

> Feature：`v0.4.0 — Native Multi-Harness Compatibility`
> Fix Cycle：`v0.4.5`
> 日期：2026-08-27
> 角色：Debugger
> Source Fix Plan：[debugger_0.4.4-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/debugger_0.4.4-native-harness.md)
> Coder 交付：[coder_0.4.5-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.5-native-harness.md)
> 门控证据：[v0.4.5-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.5-native-session-probe.md)
> Codex 探针证据（复用）：[v0.4.4-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.4-native-session-probe.md)
> Verdict：**FAIL / BLOCKED**

本轮不复用旧 Codex 多账号文档。单次 Codex marker **不是** 五 Harness PASS。不要进入 v0.5。

## Review Scope

- 是否遵守 v0.4.4 停止条件（不重复已知失败探针、不升格 capability、不造假 Harness）
- F04 五平级 Harness 产品级 `Crafting -> Runtime -> Entity -> Session -> real response`
- F01–F03 / F05–F07 回归

## Evidence

### 独立文档

- [PROJECT_STATUS.md](file:///D:/Work/CraftStation/PROJECT_STATUS.md)
- [manager_0.4.0.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/manager_0.4.0.md)
- [coder_0.4.5-native-harness.md](file:///D:/Work/CraftStation/ai_workspace/agent_docs/coder_0.4.5-native-harness.md)
- [v0.4.5-native-session-probe.md](file:///D:/Work/CraftStation/ai_workspace/validation/v0.4.5-native-session-probe.md)

### 停止条件合规

Coder 本轮：

- 未重跑 Grok usage exhausted 的相同 ACP prompt
- 未重跑 Kimi `AUTH_REQUIRED` 的相同 ACP prompt，未塞 key
- Antigravity 保持 unprobed，未用 Gemini CLI
- DSH 保持 unavailable，未启动旧 DSH，无 Entity
- 未把可选 `CRAFTSTATION_REAL_RUNTIME=1` 测试冒充生产 `craftAgent` 证据（该测试会 `setCustomCraftingAdapter`）
- 生产 `descriptors.ts` 仍 **0** 处 `supported+integrated`

这是正确的门控执行，不是 Feature 完成。

### 独立测试 / 工具

| 检查 | 结果 |
|---|---|
| nativeHarness + crafting + Codex baseline + CraftingGrid + HarnessPanel | **16 files / 71 passed** |
| `runtime.test.ts -t routes` | **5 passed** |
| `pnpm typecheck` | **PASS** |
| `codegraph status` | Index is up to date；2,890 files / 40,323 nodes / 151,327 edges |

未整包复跑 Coder 自称的 19 files / 131 tests。定向复跑足以证明接线未回退。

### 五 Harness 质量门

| Harness | 证据 | 门控 |
|---|---|---|
| Codex | v0.4.4 官方 app-server：server turn id + `turn/completed` + `NATIVE_PROBE_OK`（len 15 / hash `4f624a202114`） | probe 可审计；产品 capability 仍 `implementation missing`；不是产品 `craftAgent` 路径 |
| Grok | 官方 ACP session 后 usage exhausted | BLOCKED，等有余额的官方环境 |
| Kimi | 官方 ACP session 后 `AUTH_REQUIRED` | BLOCKED，等用户官方 `kimi` 登录 |
| Antigravity | 无安全非交互 PTY | unprobed |
| DeepSeek / DSH | 无官方 executable | unavailable |

## Fix Cycle Disposition

| Finding | v0.4.5 | 说明 |
|---|---|---|
| F01 / F02 / F03 / F05 / F06 / F07 | **仍关闭** | 接线与诚实性未回退 |
| F04 | **仍 OPEN / BLOCKED** | 外部门控，不是新的代码缺陷 |

## Remaining Findings

### F04 — 五 Harness 产品级 real response 仍缺（P0 / BLOCKED）

- Evidence：v0.4.4 Codex probe；v0.4.5 门控记录。Grok/Kimi 被官方余额/登录挡住。Agy/DSH 无安全或未安装 runtime。
- Impact：Manager 的五平级 Harness Feature 不能 PASS，也不能进入 v0.5。
- Root Cause：外部官方环境，不是当前代码能修的回归。
- Fix：**用户先**完成 Grok 官方余额或换号、Kimi 官方登录。完成后通知 Debugger/Coder 再探针。Coder **不要**再开 v0.4.6 空转。

## Verdict

**FAIL / BLOCKED**

- Feature PASS：**No**
- Closeout：**No**
- 进入 v0.5：**No**
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 下一动作：**等用户**，不是再派 Coder 改代码

F01–F03 / F05–F07 工程项保持关闭。不要为了 PASS 升格 capability。

## 给 Coder 的停止指令

在用户确认以下任一外部条件前，**不要**开始 v0.4.6：

- Grok 官方账号有余额
- 用户已完成官方 `kimi` 登录
- Antigravity 有经 Debugger 认可的安全非交互 PTY 路径
- 本机出现官方 DSH executable

期间保持生产 descriptor 诚实；保持 DSH `RUNTIME_UNAVAILABLE`；不要重复失败探针。

## 给用户的最短人工验收（确认进度，不是放行）

Feature **仍未通过**。工程接线可以看，真实五套对话还不行。

1. 终端进 [craftstation](file:///D:/Work/CraftStation/craftstation)，跑 `pnpm dev`。
2. Craft Table →「配方」，点 Grok / Kimi / Antigravity / DeepSeek：Harness 槽应是对应 harness，不是 `auto（确定性 Codex）`。
3. 右侧五条 Native Harness 状态应在。DeepSeek 不可用。谁都不该显示已集成。
4. **Grok / Kimi 现在点 Craft 预期失败**（没余额 / 要登录）。不要把 API key 发给 Agent。
5. 若要继续验收真实对话：先自己完成官方 Grok 余额和 `kimi` 登录，再叫 Debugger 复检。
