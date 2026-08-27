# Coder — v0.4.10 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.10`
>
> 状态：已按 `debugger_0.4.10-native-harness.md` 连续完成 F18 / F19 / F20，等待 Debugger 独立复检。F04 五 Harness Feature 仍不得宣称 PASS。

## 输入与真实证据

- Fix Plan：`ai_workspace/agent_docs/debugger_0.4.10-native-harness.md`
- 真实 Grok 流量（脱敏）：`ai_workspace/validation/v0.4.10-grok-pool-probe.json`
- 真实错误形状：JSON-RPC `-32603` / `Internal error`，详情位于 `data.message` 与 `data.http_status=402`。
- 3 个 managed Grok profile 返回 `NATIVE_PROBE_OK`，3 个返回官方 `Grok Build usage balance exhausted`；本轮没有重复已知官方探针。

## F18 — 402 额度错误投影

修改 `src/supervisor/agents/acp/sessionErrors.ts`：

- `resolveAcpPromptRpcErrorMessage` 读取 `data.message`、`data.http_status`，不再只读取 Factory Droid 风格的 `details/detail`。
- 官方 Grok `402` + `usage balance exhausted` 映射为用户可见的 `Grok 额度已耗尽`，不再显示泛化的 `Internal error`。
- 一般 provider message 仍可作为非泛化 JSON-RPC 错误的 fallback；没有改变其他错误的认证、协议和运行时状态语义。
- 新增 `isAcpPromptQuotaExhaustedError`，严格识别官方 Grok 402 usage-balance 形状。

## F19 — 绑定账号状态回写

修改 `src/supervisor/agents/base/types.ts`、`src/supervisor/agents/acp/session.ts`、`src/supervisor/agents/acp/sessionFactory.ts`、`src/supervisor/runtime/nativeHarness/structuredAdapter.ts`、`src/supervisor/runtime/nativeHarness/index.ts` 与 `src/supervisor/supervisorRuntime.ts`：

- 新增 raw prompt error observer seam：`CreateStructuredSessionInput.onPromptError` → ACP session → native structured adapter。
- Grok `craftAgent` 创建 adapter 时把 observer 绑定到 immutable `accountBinding.accountId`。
- 识别到真实 402 后只执行 `accountStore.updateStatus(boundAccountId, "quota-exhausted", ...)`，记录脱敏用户文案与 `lastQuotaAt`，并发送 Grok 账号列表刷新事件。
- observer 失败不会覆盖原始 prompt error；当前 Session 仍由 ACP canonical error event 呈现失败。
- 不会根据当前 selected account 更新状态，不会把整池账号标记为耗尽，也不改变已经绑定的 Session。

## F20 — 新 Auto Session 填补与 sticky 边界

保留并验证 `AccountResolver` / `SupervisorRuntime.createCraftingAdapter` 的边界：

- `auto` 新建 Session 跳过 `quota-exhausted`，按持久化 `order` 选择下一个 enabled 的 `available` 或 `quota-low` 账号。
- `explicit` 命中耗尽账号直接返回 `ACCOUNT_UNAVAILABLE`，不偷偷切换到其他账号。
- 已创建 Session 的 `accountBinding` 不会因 selected account 变化而重解析；切换 selected 只影响后续新建 Session。
- DeepSeek/DSH 仍走 `RUNTIME_UNAVAILABLE` adapter，绝不创建 synthetic Entity/Session。

## 测试与验证

新增/更新回归包括：

- `src/supervisor/agents/acp/session.test.ts`：真实 `data.message + http_status` 402 映射、`Grok 额度已耗尽` 文案、raw prompt observer。
- `src/supervisor/runtime/nativeHarness/nativeHarness.test.ts`：native structured session 接收 prompt error observer。
- `src/supervisor/runtime.test.ts`：只更新绑定 Grok 账号为 `quota-exhausted`；现有 auto fallback、explicit no-fallback、new-session selection 与 sticky binding 回归。
- 既有 F08/F12/F14、Grok profile、账号池 UI、native harness、crafting 与 ACP 回归均纳入集合。

已执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/agents/acp/session.test.ts src/supervisor/runtime/nativeHarness/nativeHarness.test.ts src/supervisor/runtime/accountResolver.test.ts src/supervisor/runtime.test.ts
→ 4 files / 186 tests passed

pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx src/renderer/actions/agentLoginActions.test.ts src/supervisor/runtime/grokProfiles.test.ts src/supervisor/runtime/accountStore.test.ts src/supervisor/runtime/accountResolver.test.ts src/renderer/views/LoginTerminalOverlay/LoginTerminalOverlay.test.tsx src/supervisor/agents/acp/session.test.ts
→ 26 files / 310 tests passed

pnpm typecheck
→ passed

pnpm lint
→ passed

git diff --check
→ passed; only existing CRLF normalization warnings
```

## 边界与复检请求

- F04 仍 BLOCKED：Grok/Kimi/Antigravity/DeepSeek 的五 Harness 整体产品级真实 response 尚未满足；本轮不写 Feature PASS。
- 不导入 Codex Router `xai-*.oauth.json`，不覆盖 `~/.grok/auth.json`，不接 CLIProxyAPI，不重复耗尽账号探针。
- 不 commit / tag / push。
- 请 Debugger 读取本报告与 `PROJECT_STATUS.md`，对 F18/F19/F20 进行独立复检；F04 的整体 BLOCKED 条件保持不变。
