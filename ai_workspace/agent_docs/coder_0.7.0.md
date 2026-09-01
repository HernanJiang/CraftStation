# CraftStation Coder 交付 — v0.7.0

日期：2026-08-29
工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.7`
分支：`feature/v0.7-native-harnesses`
基线：`dev / 7ae6506`

## Existing

- 复用既有 `crafting`、`registry`、`HarnessRuntimeAdapter`、canonical `RuntimeEvent`、Supervisor `craftAgent` 和现有 UI/IPC seam。
- 既有 Codex、Grok、Kimi native runtime 保持原有 provider boundary；本 Feature 没有把它们改成 Antigravity 或 DSH 的实现。
- 既有 Antigravity PTY/terminal adapter 作为隔离 legacy/reference 路径保留；新的生产 native composition 路径使用独立 machine transport。
- DSH 在基线中只有 unavailable adapter；本轮根据官方参考快照核验出可编程边界，但本机仍没有可执行 carrier。

## Fixed

- 修正 Antigravity `agy 1.1.22` 的真实 stream-json 形状：`step_update` 和 `result` 的有效字段位于同名嵌套对象中。
- 修正 Antigravity 生命周期：`user_input` 的 `DONE` 不再提前结束 turn，最终 `result` 才是权威 turn boundary。
- 修正 streamed text 与完整 `result.response` 的重复累加，避免 `CraftAgentResult.response` 和 UI transcript 双写。
- 修正 crafted native Session 的 IPC 转发：canonical events 现在通过既有 `thread-runtime-event` Supervisor seam 进入 Renderer，而不是只存在于 Session 内部订阅。
- 修正 DSH shutdown 顺序和 pending JSON-RPC request 的进程退出清理，避免 transport 已 disposed 或 provider clean exit 造成永久等待。
- 保持所有 provider payload、native envelope、runtime config 和 control-plane projection 的 secret redaction。

## Added

- `nativeTransport.ts`：child-process stdio、NDJSON、JSON-RPC correlation、stderr/畸形输出/退出诊断；Antigravity 固定使用官方 `--input-format stream-json` 与 `--output-format stream-json`，不使用 PTY/TUI/键盘注入，不宣称 ACP/JSON-RPC。
- `nativeEventCanonicalizer.ts`：Antigravity `init` / `step_update` / `result` 与 DSH `session.event` / `session.status` / turn/tool/usage/request 事件映射为 canonical events，携带 sequence、correlation id 和安全 native envelope。
- `nativeAdapter.ts`：原生 Entity/Session、持续 turn、Antigravity model/effort/approval/conversation 参数、DSH `initialize` / `session/prompt` / `shutdown`、resume/interrupt/terminate。
- `nativeRuntimeExecutionConfigForPlan()` 与 `SessionSnapshot.runtimeConfig`：传递 model、workspace、reasoning、service tier、approval、profile/account binding、MCP、Skills、context、compaction 和 custom settings 的脱敏投影；内部路径和 credential-like key 被过滤。
- Antigravity 与 DeepSeek Model/Harness Items、Native Recipes、descriptor capability/readiness 状态和 vendor 独立匹配；DeepSeek Recipe 保持 `EXPERIMENTAL`，不可用 carrier 不进入 synthetic executable success path。
- 复用 Native Harness control-plane IPC 与 HarnessPanel，展示五个 Harness 的安全 descriptor/status/diagnostic；本轮新增 UI 文案已填充全部 12 个非英文 catalog。
- `nativeProductPath.integration.test.ts`：环境变量门控的真实 Antigravity product-path smoke；默认跳过，显式启用才会启动本机官方 runtime，并写入非 synthetic evidence。

## Evidence

### 真实 Native 运行时

- Antigravity 官方 executable：`C:\Users\Haona\AppData\Local\agy\bin\agy.exe`。
- 官方版本：`agy 1.1.22`。
- 已执行的真实 product-path 命令：

  `CRAFTSTATION_REAL_NATIVE_HARNESSES=1`、`CRAFTSTATION_AGY_EXECUTABLE=C:\Users\Haona\AppData\Local\agy\bin\agy.exe` 下运行
  `pnpm exec vitest run --configLoader runner src/supervisor/runtime/nativeHarness/nativeProductPath.integration.test.ts`。

- 结果：`1 test passed`；`response=CRAFTSTATION_AGY_PRODUCT_PATH_OK`；`synthetic=false`；取得 Entity/Session identity，canonical event types 为 `turn.started`、`session.started`、`content.delta`、`turn.completed`；native types 为 `init`、`step_update`、`result`。
- 证据文件：[v0.7.0-antigravity-product-path.json](../validation/v0.7.0-antigravity-product-path.json)。该 JSON 只含 marker、identity、版本和事件类型，没有 token/cookie/authorization/API key；原始 prompt 不进入 native envelope，但 artifact 保留短的测试 marker 以便复现。
- DeepSeek：官方参考 `reference/deepseek-harness` commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；核验的边界为 JSON-RPC 2.0 over stdio，关键方法为 `initialize` / `session/prompt` / `shutdown`，事件为 `session.event` / `session.status`。本机 PATH 未发现 `dsh-jsonrpc-agent`、`dsh`、`deepseek-harness` 或 `deepseek-cli`，官方 bundled carrier 没有 Windows 分发；结论为 `RUNTIME_UNAVAILABLE`，没有伪造 response、Entity 或 Session。

### 自动化验证

- Native 定向测试：`6 个测试文件通过，20 个测试通过`；在最后一次事件映射修复后，新增 adapter/product-path/lifecycle 定向测试为 `2 个文件通过，8 个测试通过，1 个环境门控测试跳过`。
- `pnpm run typecheck`：通过。
- 修改文件目标 lint：通过；`git diff --check`：通过。
- `pnpm run build`：此前已通过，产出 renderer 与 Electron bundle；仅有既有 Vite `__dirname`、CSS `::highlight`、sourcemap 和 chunk size 警告。
- 全量 `pnpm run test`：`854 passed, 10 skipped, 17 failed`，另有 1 个 unhandled error。失败集中在基线/环境问题：Poracode→CraftStation `.poracode/.craftstation` 重命名与迁移断言、MCP/外部网络相关测试、renderer remote procedure route 基线断言、测试清理/进程树权限问题；未命中本轮新增 Native 测试。Unhandled error 来自既有 `terminateProcessTree` 在测试清理期间读取 undefined process 结果，同样未命中本轮 Native 测试。
- 全量 `pnpm run lint`：唯一失败为未修改基线文件 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 的 `vitest(no-conditional-expect)`；本轮新增文件和改动路径 lint 已通过，因此没有修改无关基线测试。

## Remaining

- Debugger 尚未完成独立 Feature-level Review；本报告不是 PASS 声明。
- Antigravity 已证明一条真实 `craftAgent` 单轮响应和基础 canonical event 链路，但尚未证明官方 tool execution、权限交互、MCP、Skills、subagents、context/compaction、resume/multi-turn 等全部 acceptance dimensions；descriptor 继续按未完整实测状态表达。
- DeepSeek 官方 Windows carrier/可用安装、认证、真实 response、工具/权限、多轮和 cleanup 仍 unavailable；不得用 CLIProxyAPI、OpenAI-compatible API 或旧 fallback 替代。
- 全量测试和 lint 的基线失败需要 Debugger 独立复核其归属；Coder 没有修改 main、没有执行 dev→main promotion、没有创建正式 tag，也没有触碰或清理共享 `D:\Work\CraftStation\craftstation-dev`。

## Handoff

状态：`CODER COMPLETE / DEBUGGER PENDING`。请 Debugger 在本 Feature worktree 读取本报告与 `PROJECT_STATUS.md`，独立检查源码、测试、真实 artifact、UI/IPC seam 和剩余失败归属，再决定 PASS/FAIL；不要把本报告或单次成功 smoke 当作独立验收。
