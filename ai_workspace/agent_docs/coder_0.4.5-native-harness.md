# Coder — v0.4.5 Native Multi-Harness Fix Cycle

> 对应 Feature：`v0.4.0 — Native Multi-Harness Compatibility`
>
> Fix Cycle：`v0.4.5`
>
> 状态：已执行 Debugger v0.4.4 Fix Plan 的凭据/环境门控与回归自检；Grok/Kimi/Antigravity/DSH 仍受外部条件阻塞，等待 Debugger 独立复检。Feature 仍不可宣称 PASS。

## Fix Plan 执行结果

### 1. Capability 与架构边界

- 没有修改 production capability descriptor。
- 没有把单次 Codex `NATIVE_PROBE_OK`、`turn/completed`、session/new、usage exhausted 或 `AUTH_REQUIRED` 升格为 `supported+integrated`。
- 没有引入 CLIProxyAPI、Model API、Gemini CLI、旧 DSH 或 synthetic Entity/Session。

### 2. 外部凭据/环境门控

- Grok：保持官方 usage balance exhausted；不重复相同 ACP prompt，等待有余额的官方环境。
- Kimi：保持官方 `AUTH_REQUIRED`；不塞 key、不重复相同 prompt，等待用户完成官方 `kimi` 登录。
- Antigravity：保持 `unprobed`，没有安全非交互 PTY 时不假造 ACP。
- DeepSeek/DSH：保持 `RUNTIME_UNAVAILABLE`/`unavailable`，不启动旧 DSH，不生成 Entity/Session。
- Codex：复用 v0.4.4 已验证的真实 app-server marker 证据，不重复打扰当前 runtime。
- 详细门控记录见 [v0.4.5-native-session-probe.md](../validation/v0.4.5-native-session-probe.md)。

### 3. 可选 Codex `craftAgent` 证据边界

本轮未将可选 `CRAFTSTATION_REAL_RUNTIME=1` 测试冒充生产证据：现有测试通过 `setCustomCraftingAdapter()` 注入真实 adapter，并会写入旧 v0.3.2 artifact，不能独立证明未注入 custom adapter 的 production factory routing。Codex 真实 native marker 继续以 v0.4.4 脱敏 probe 证据为准。

## 当前验收矩阵

| Harness | 真实 evidence | capability / quality gate |
|---|---|---|
| Codex | v0.4.4 server turn identity、matching completion、assistant marker、length/hash、cleanup | `implementation missing`；单次 probe 不关闭五 Harness F04 |
| Grok Build | official ACP session；usage balance exhausted | `implementation missing` / `error` / BLOCKED |
| Kimi Code | official ACP session；`AUTH_REQUIRED`；cancel error | `implementation missing` / `partial` / BLOCKED |
| Antigravity | 无安全 PTY evidence | `unprobed` |
| DeepSeek / DSH | 无官方 executable | `unavailable` / `RUNTIME_UNAVAILABLE` |

F04 仍 BLOCKED：缺少五个平级 Harness 的完整产品级 `Crafting -> Runtime -> Entity -> Session -> real response`。本轮不写 Feature PASS。

## 回归自检

在 `D:\Work\CraftStation\craftstation` 执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness src/supervisor/runtime/nativeCodex src/shared/crafting src/renderer/components/crafting/CraftingGrid.test.tsx src/renderer/views/MainView/parts/RightPanel/parts/HarnessPanel src/supervisor/runtime.test.ts
pnpm typecheck
pnpm lint
node --check ..\ai_workspace\validation\v0.4.1-native-session-probe.mjs
git diff --check
codegraph status
```

本轮结果：

- 定向 Vitest：19 个测试文件，131 tests passed。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- Probe `node --check`：通过。
- `git diff --check`：无 whitespace error；仅有既存换行格式提示。
- CodeGraph：Index is up to date；2,890 files / 40,323 nodes / 151,327 edges。

## 工作树与交接

- 保留根仓库及 `craftstation/` 中既有用户/并行角色修改，未修改并行前端专项文件。
- 未执行 reset、checkout、递归清理、commit、tag 或 push。
- 请 Debugger 读取 `PROJECT_STATUS.md`、本交付文档和 [v0.4.5-native-session-probe.md](../validation/v0.4.5-native-session-probe.md)，独立复核 F01–F07；Grok/Kimi/Antigravity/DSH 的外部门控未解除时应继续保持 BLOCKED，Feature 不得 PASS。
