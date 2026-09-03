# Coder — Fix Cycle v1.1.2 Compatibility Bridge & Model × Harness Composition

> Coder Fix Cycle v1.1.2 执行记录与自检交接。

## 执行概览

- Feature: v1.1.0 Compatibility Bridge & Model × Harness Composition
- Fix Cycle: v1.1.2
- Worktree: `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`
- Branch: `dev/v1.1.0-compatibility-bridge`
- 状态: `FIX CYCLE COMPLETE / SELF-CHECK PASSED`

## Debugger Re-review #1 缺陷落实与修复情况

### 1. 完善 CLIProxyAPI 配置文件模式与启动参数契约

- 在 `src/supervisor/runtime/compatibilityBridge/bridge.ts` 中，新增 `generateConfigFile()` 方法，自动生成符合 Go sidecar（`reference/CLIProxyAPI/config.example.yaml`）规范的临时 `config.yaml`（包含 `host`, `port`, `auth-dir`, `api-keys` 等关键字段）。
- 启动命令行同时传递 `--config <path>` 以及 `--host`, `--port`, `--api-key`, `--auth-dir` 参数，兼顾配置加载与命令行覆盖。
- 修复异常捕获时缺失 `cause` 的问题，满足 `eslint(preserve-caught-error)`。

### 2. 静态检查 (oxlint & oxfmt) 修复

- 修复 `src/supervisor/runtime/compatibilityBridge/bridge.test.ts` 中所有 `vi.fn` 的泛型类型参数标注，满足 `vitest(require-mock-type-parameters)`。
- 运行 `pnpm oxfmt` 格式化了 `src/supervisor/runtime/compatibilityBridge`、`src/shared/crafting` 及 `src/supervisor/supervisorRuntime.ts`，确保 `oxfmt --check` 100% 格式合规。
- 运行 `pnpm oxlint src/supervisor/runtime/compatibilityBridge src/shared/crafting` 0 warning 0 error 通过。

### 3. 跨组合生命周期与适配器连接

- 确认 Supervisor 的 `createCraftingAdapter` 对 `routeType === "compatibility"` 自动挂载 `compatibilityTargetConfig`，并将生成的 customEnv 及 runtimeOptions 注入到 `AppServerProcessHost` 和 `createNativeHarnessRuntimeAdapter`。

## 验证与自检证据

- `pnpm oxlint src/supervisor/runtime/compatibilityBridge src/shared/crafting`: 0 errors / 0 warnings 通过。
- `pnpm oxfmt --check src/supervisor/runtime/compatibilityBridge src/shared/crafting src/supervisor/supervisorRuntime.ts`: All matched files use the correct format.
- `git diff --check`: 0 issues 通过。
- `pnpm typecheck`: 0 errors 通过。
- 单元测试运行：
  - `src/supervisor/runtime/compatibilityBridge/bridge.test.ts`: 3 passed
  - `src/shared/crafting/executionRoute.test.ts`: 4 passed
  - `src/shared/crafting/crafting.test.ts`: 14 passed
  - `src/shared/crafting/workbench.test.ts`: 9 passed
  - 全套 Crafting / Bridge 测试：14 test files, 195 passed (0 failed).

---

# Coder Round v1.1.3 (2026-09-04) — Re-plan 执行:真实 CPA + 独立 Compatibility Adapter + OpenCode tracer E2E

依据 `manager_1.1.0-replan.md` 授权执行。

## 交付内容

1. **真实 CLIProxyAPI sidecar 接入**
   - 官方 release 二进制 v7.2.149(windows amd64)置于 worktree `.tools/cpa/`(经 `.git/info/exclude` 本地排除,**不提交**)。
   - `CompatibilityBridgeService` 修复与增强:
     - readiness 探针从(不存在的)`/health` 修正为 CPA 文档路由 **`/healthz`**(鉴权 200 才算就绪);
     - 生成配置支持 `proxy-url`(上游 provider 流量走系统代理);
     - Windows 反斜杠路径在 YAML 双引号标量中是非法转义——auth-dir/proxy 统一改写正斜杠(真实 E2E 首轮即发现并修复);
     - 冷启动 probe 窗口放宽至 15s。

2. **独立 CompatibilityRuntimeAdapter**(`compatibilityRuntimeAdapter.ts`,新文件)
   - `supports()`: 仅 `routeType: "compatibility"` 且匹配 harness;native 计划永不进入。
   - `spawnEntity()`: pin 账号 credential namespace → 启动真实 sidecar → **模型契约验证**(轮询 `GET /v1/models` 直至计划模型出现或 30s 超时,fail-closed `RUNTIME_UNAVAILABLE`)→ 经 exporter 产出 runtime 真实 endpoint。
   - `CompatibilitySession.startTurn()`: 写隔离 OpenCode provider 配置(`writeOpenCodeConfigFile`,session 级稳定目录)→ 启动官方 `opencode run -m craftstation-compat/<model> --format json` → 解析 JSON 事件流,`sessionID` 成为 provider-native sessionRef(后续 turn 自动 `-s` resume)。
   - 关键发现:**stdin 必须为 ignore**——打开的 stdin pipe 会让无头 CLI 永久阻塞而不是执行后退出;子进程 cwd 固定在隔离目录避免扫超大仓库。
   - `interrupt/terminate/dispose` 生命周期完整;snapshot 带 `routeType/protocol/endpoint/accountId`。

3. **Supervisor 接线**
   - 原 refuse-throw 分支替换为:`setCompatibilityRuntimeAdapterFactory()` 注入优先,否则默认工厂(要求 `CLIPROXY_BINARY_PATH`,账号 pin 映射 accountStore credentialRoot → bridge auth-dir);不可用时保持诚实 `RUNTIME_UNAVAILABLE`。

4. **真实流量 tracer E2E**(`compatibilityRuntimeAdapter.e2e.test.ts`)
   - 全链:CraftPlan → Adapter → 真实 CPA 二进制(18417)→ fixture 凭据(xai OAuth 自动刷新)→ 官方 OpenCode CLI → 真实上游模型回包。
   - 断言:turn completed、响应含真实回执文本、`nativeSessionRef` 以 `ses_` 开头、snapshot endpoint/protocol/accountId 正确。
   - 手动先行验证:同一链路 curl → CPA → grok-4.3 真实回包 `CRAFTSTATION_BRIDGE_OK`(usage 358 tokens);OpenCode → CPA → 真实回包 `OPCODE_VIA_CPA_OK`。

## 自检证据

- `pnpm typecheck` PASS;`pnpm lint` 0/0。
- compatibilityBridge 套件 10/10(4 bridge + 5 adapter 单元 + **1 真实 E2E**)。
- crafting + runtime 回归 176/176(vitest Node-ABI binding env 一并移植本 worktree,与 v1.0.1/v1.2.0 同源)。
- 全量 vitest:见提交信息。

## 边界(诚实记录)

- Codex 上游账号当轮 `usage_limit_reached`(真实上游错误路径证据,~69min 重置);tracer 使用 xai fixture 凭据真实完成。
- 其余四 Harness 的 Compatibility exporter 仍为 DTO,真实消费仅 OpenCode tracer(按 re-plan 范围)。
- `.tools/` 下二进制与凭据为本地工具,不入库。

**Status: v1.1.3 IMPLEMENTED / READY FOR DEBUGGER RE-REVIEW**
