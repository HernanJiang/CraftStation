# Debugger — v0.8.5 独立复检

> 对应 Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 角色：Debugger
>
> 日期：2026-08-30
>
> 实际工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 用户给出的 `D:\Work\CraftStation\craftstation.worktrees\v0.8` 不存在；本复检严格使用 Git 登记的 Feature worktree。
>
> 分支：`feature/v0.8-opencode-native`
>
> 基线：`dev / 7ae6506ea01fc04029a10a711ebb0a65d7248e06`
>
> Verdict：**FAIL / ENGINEERING FIX REQUIRED**

## 1. 复检范围与边界

本轮没有复用 Coder 的结论作为验收结论，而是独立读取 `AGENTS.md`、`PROJECT_STATUS.md`、Manager Plan、Coder v0.8.5 交接、上一轮 Debugger 文档、兼容性 artifact、F38/F40/F42/F44 源码与测试，并执行真实 carrier、反向 probe、回归测试和静态检查。

本轮未执行 commit、push、tag、Feature→Dev merge 或 main promotion。临时反向 probe 执行后已删除；没有把 probe 留在产品测试路径中。

## 2. Worktree / Git 事实

- 实际 HEAD 仍为 `7ae6506ea01fc04029a10a711ebb0a65d7248e06`；分支为 `feature/v0.8-opencode-native`。
- 当前 Feature 改动为未提交工作树内容；没有切换到 main 或 nested Dev。
- `git diff --check`：通过。
- `git diff HEAD -- package.json pnpm-lock.yaml`：无差异。
- CodeGraph：当前可用索引属于 Product Git Root，而非本 Feature worktree；本报告没有把它当作 Feature 代码事实，改用 worktree 内源码和测试完成审查。

## 3. 独立运行证据

### 3.1 官方 headless CLI

执行：

```text
where.exe opencode
opencode.exe --version
```

结果：

```text
C:\Users\Haona\AppData\Roaming\npm\opencode.exe
1.18.25
```

随后直接执行：

```text
opencode.exe serve --port 0 --hostname 127.0.0.1 --print-logs
```

真实日志宣布：

```text
opencode server listening on http://127.0.0.1:4096
```

收到监听地址后终止该探针进程，并独立确认 `127.0.0.1:4096` 没有残留监听。结论：**官方 headless Server carrier 通过**；这不证明任何 Provider assistant response。

### 3.2 真实 OpenCode carrier / 六路 matrix

执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/openCodeNative/liveSmoke.test.ts src/supervisor/runtime/openCodeNative/liveSmokeMatrix.test.ts
```

结果：`2 files passed, 8 tests passed`。

这组测试确实拉起真实 `opencode.exe`，并覆盖 Server HTTP/OpenAPI、SSE、Session 创建/读取/消息查询/删除及六条 route 的错误收口和清理。当前没有匹配的 Provider 凭据；因此六条 route 仅证明真实 Server Session/error lifecycle：

1. OpenAI / `openai:gpt-4o`
2. xAI/Grok / `xai:grok-4`
3. Google/Gemini / `google:gemini-2.5-pro`
4. DeepSeek Model / `deepseek:deepseek-chat`
5. Moonshot-native Kimi / `moonshotai:kimi-k2.5`
6. OpenAI-compatible Kimi / `moonshot-openai-compatible:kimi-k2.5`

不能证明 assistant stream、成功后续 turn、tool calling、usage 或 compaction。独立解析 `ai_workspace/validation/v0.8.0-opencode-compatibility.json` 得到：`probe=verified`、`records=6`、`available=0`、`unverified=6`、`providerAssistantResponse=unverified` 六条。该证据边界是正确的，不能升格为 Provider E2E PASS。

### 3.3 F38/F40/F42/F44 回归与定向测试

独立执行：

```text
pnpm exec vitest run --configLoader runner src/supervisor/runtime/openCodeNative/engineeringRegression.test.ts src/supervisor/runtime/openCodeNative/adapter.test.ts src/supervisor/runtime/openCodeNative/runtimeBinding.test.ts src/supervisor/runtime/openCodeNative/serverPool.test.ts src/supervisor/runtime/openCodeNative/diagnostics.test.ts src/supervisor/runtime/openCodeNative/events.test.ts src/supervisor/runtime/openCodeNative/session.test.ts src/supervisor/runtime/openCodeNative/transport.test.ts
```

结果：`8 files passed, 52 tests passed`。

用户指定的精确命令实际结果为：

```text
pnpm test src/shared/opencodeNative src/supervisor/runtime/openCodeNative src/shared/crafting/openCodeNativeComposition.test.ts src/shared/crafting/crafting.test.ts src/shared/crafting/nativeHarnessRegistry.test.ts src/supervisor/runtime/nativeHarness/controlPlane.test.ts
```

结果：`15 files passed, 100 tests passed`。目录参数包含的测试数量已不同于 Coder 交接中记录的 11/60；本报告以本轮实际输出为准。

额外 broader suite（加入 `src/supervisor/runtime/accountStore.test.ts`）结果：`17 files passed, 118 tests passed`。

TypeScript：

```text
pnpm exec tsc --noEmit -p tsconfig.json
```

通过，exit 0。

## 4. 反向安全与协议 probe

本轮临时 probe 独立验证了以下三个失败行为，随后删除临时测试文件：

1. 在宿主 `process.env` 放入无关 Provider marker 后，OpenCode child 的 spawn environment 仍包含该 marker。`serverEnvironment` 的 scope marker 正确注入，但没有清除宿主环境。
2. `safeMessage("Authorization: Bearer abc123")` 仍保留 `abc123`；`safeMessage('{"apiKey":"sk-json-secret"}')` 仍保留 JSON secret；nested `details.auth` / `details.oauth` 也可进入 diagnostic JSON。
3. 官方 SDK v2 事件 `permission.v2.asked` 与 `question.v2.asked` 当前映射为 `warning` + `PROTOCOL_MISMATCH / sse.unknown-event`，没有形成可操作的 `request.opened`。

这三个 probe 均按“观察缺陷应通过”的方式执行并通过，不能当作产品正确性测试的 PASS。

## 5. 双轴复检结论

### 5.1 Standards 轴

#### [P1 / 硬安全边界] F40：credential scope 没有形成进程环境隔离

- 证据：`src/supervisor/runtime/openCodeNative/transport.ts:151-153` 使用 `{ ...process.env, ...command.env }` 启动 child。
- 证据：`src/supervisor/runtime/openCodeNative/runtimeBinding.ts:64-80` 虽能读取 Supervisor account environment 并形成 isolation key，但 isolation key 不能隔离 child 继承的宿主 Provider secrets。
- 影响：绑定 A 的 OpenCode Server 仍可能看到其他 Provider/account 的 key/token。Pool 分区不等于凭据边界，违反 Manager Plan 对 Supervisor-owned auth/profile 与 secret boundary 的要求。
- 要求：为 OpenCode child 构造 allowlist-first 的最小环境，只保留运行所需安全系统变量、Supervisor 为该 binding 投影的变量和 server 自身变量；增加无关宿主凭据不可见的回归断言。

#### [P1 / 硬集成边界] F42：新 `respondToRequest` 没有接到生产 IPC 路径

- 证据：`src/supervisor/ipcHandlers.ts:92` 固定调用 `threads.resolveThreadServerRequest(payload)`。
- 证据：`src/supervisor/runtime/threadSessionManager.ts:1101-1112` 只查询传统 `ThreadSessionManager` session 的 `structuredSession`。
- 证据：OpenCode crafted session 存在 `src/supervisor/supervisorRuntime.ts:251,1340-1355` 的 `craftedSessionsByThread`，但生产 IPC 没有把它路由到 `CraftSession.respondToRequest`；仓内 `respondToRequest` 调用只有 OpenCode Session 单测和 regression 测试。
- 影响：UI 发送 permission/question 回复时可能进入错误的 legacy session 路径，官方 `permission.reply` / `question.reply` / `question.reject` 代码成为生产不可达 seam；真实 Agent loop 仍可能悬停。
- 要求：在 Supervisor 的 crafted-session 路由建立类型化 IPC contract，按 thread/session identity 分流到 `CraftSession.respondToRequest`，并保留 legacy thread 路径；补 handler-level contract test。

#### [P1 / 硬协议边界] F42：未处理锁定 SDK v2 的 permission/question 事件名

- 证据：`src/supervisor/runtime/openCodeNative/events.ts:460-552` 只处理旧的 `permission.requested/opened/asked`、`question.asked` 和旧 replied/rejected 事件。
- 证据：锁定 `@opencode-ai/sdk` `1.18.10` v2 类型声明包含 `permission.v2.asked/replied`、`question.v2.asked/replied/rejected`；当前临时 probe 证明 v2 asked 落入 unknown-event。
- 影响：官方 v2 事件无法进入 actionable request projection，UI 即使有回复入口也拿不到可回复的请求。
- 要求：canonicalizer 映射官方 v2 事件，安全投影 permission action/resources 与 question questions/tool；同时为 v2 asked/replied/rejected 增加事件 contract tests。

#### [P2 / 硬安全结果] F44：常见 Authorization/JSON/nested secret 仍可泄漏

- 证据：`src/supervisor/runtime/openCodeNative/diagnostics.ts:9-14` 的 keyed regex 先把 `Authorization: Bearer` 替换掉，随后留下 token；JSON key/value 不是该 regex 的匹配形状。
- 证据：`src/supervisor/runtime/openCodeNative/diagnostics.ts:18-30` 的 `SECRET_KEY` 没有覆盖 `auth`、`oauth`、`apiKey` 等常见 JSON 变体，safe details 只对命中的键做 redaction。
- 影响：diagnostic message/details 可能携带 API key、Bearer token 或 nested credentials，违反 `AGENTS.md` 的日志安全约束和 Manager Plan `Security and observability`。
- 要求：统一先处理完整 Authorization header，再处理 Bearer/Basic/query/JSON key-value/nested common aliases；采用无捕获组或函数替换避免替换顺序泄漏；补上本 probe 输入对应的正确行为断言。

#### [P2 / 架构判断性 smell] F38：OpenCode 专属判断进入 shared crafting

`src/shared/crafting/crafter.ts:14-23,221-243` 直接导入并判断 OpenCode readiness 类型。当前 gate 行为本身已在 focused tests 中工作，但 provider/harness-specific 分支进入 shared core，违反工作树标准中 provider-specific if/else 应留在边界的方向，属于 Repeated Switches / Shotgun Surgery / Divergent Change 风险。该项不是本次阻断 Verdict 的首要原因，但应在后续修复中保持 seam 清晰。

### 5.2 Spec 轴

#### F38：本轮基本关闭

`Crafter` compile 与 OpenCode adapter 的 spawn/create/resume 现在都要求 route-specific readiness；当前测试覆盖 unverified/unavailable 反向 fixture 和 ready fixture。该项本轮**通过当前 Acceptance**。同时，F38 的 executable readiness 不能由仅有 Server carrier 的事实替代 Provider response；compatibility artifact 保持六路 unverified 是必要条件。

#### F40：pool/reuse/restart 和 opaque-ref fail-closed 基本关闭，但 secret process boundary 仍失败

`runtimeBinding.test.ts` 与 `serverPool.test.ts` 覆盖 opaque ref/provider mismatch、同 binding reuse、不同 binding 隔离及 child-exit eviction/restart；这些局部行为通过。但由于 child 仍继承完整 `process.env`，F40 的 credential-scope isolation Acceptance **未关闭**。

#### F42：permission/question adapter API 局部正确，Feature 闭环仍失败

`session.ts:347-377` 已按 resolution kind 调用官方 permission/question API，question answers 也使用二维数组；但生产 IPC 路由与官方 v2 event canonicalization 缺失。因此不能把单元测试通过写成 UI/IPC 或真实 permission/question 闭环通过。

#### F44：diagnostic phase/correlation 结构局部正确，安全 Acceptance 仍失败

`diagnosticPhase` 与统一 builder 已覆盖多项 operation，并在现有测试中通过；但本轮反向 probe 证明常见 Authorization、JSON 和 nested secret redaction 不足，所以 F44 仍未满足安全 Acceptance。

#### F37：仍为环境阻塞，不得作为 Provider PASS

官方 carrier 已通过，但六路均没有真实 assistant response/后续 turn 证据。状态必须保持六路 `unverified`，不得生成 `available` 或 Feature PASS。

## 6. Fix Plan（交回 Coder）

1. **F40 先修 secret boundary**：将 OpenCode child spawn environment 改成 allowlist-first；保留 Supervisor account projection 和 server auth，但不得继承无关 Provider/account 环境；补 cross-scope negative test。
2. **F42 接通生产 IPC**：在 Supervisor 依据 crafted session/thread identity 分流 request resolution，确保 Renderer/UI 的 permission/question 操作真正到达 `CraftSession.respondToRequest`；补 IPC handler contract test。
3. **F42 接入 SDK v2 events**：映射 `permission.v2.*`、`question.v2.*`，安全保留 questions/options/multiple/custom/tool context，并为 replied/rejected 发出 `request.resolved`。
4. **F44 完成全形态 redaction**：修复 Authorization 替换顺序，覆盖 JSON key/value 与 `auth`/`oauth`/`apiKey` 等常见嵌套别名；补无泄漏断言和 `$1` 回归。
5. 保持 F38 readiness gate、F40 pool/restart、F44 phase/correlation 回归；重新运行 focused、broader、live carrier smoke、tsc、Feature lint/format 和用户指定测试。
6. 凭据安全可用后，才重新做六路 assistant stream、多轮及适用能力 smoke；在此之前 compatibility artifact 继续 `available=0/unverified=6`。

## 7. 静态检查与最终 Verdict

Feature 代码路径的 focused tests、TypeScript 和现有 targeted tests 通过，但用户要求的全仓静态门未全绿：

- `pnpm exec oxlint --deny-warnings`：失败。Feature 临时 probe 已删除后，剩余既有阻断为 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52` 的 `vitest(no-conditional-expect)`。
- `pnpm exec oxfmt --check`：失败，报告 64 个既有/非 Feature 文件格式问题；本 Feature 相关源码与测试不在该失败列表中。
- `package.json` / `pnpm-lock.yaml`：相对 HEAD 干净。

综合结论：

```text
FAIL / ENGINEERING FIX REQUIRED
```

原因不是测试数量不足，而是存在可独立复现的 F40 secret process-boundary 缺陷、F42 生产 IPC/v2 event 闭环缺陷和 F44 diagnostic secret redaction 缺陷。真实 OpenCode carrier 通过不改变结论；六路 Provider assistant response 仍未验证。

## 8. 生命周期与 Git 边界

- Lifecycle：`DEBUGGER FAIL / FIX REQUIRED`
- Feature→Dev merge：未执行。
- Dev→Main：未执行；`Main promotion: NOT AUTHORIZED`。
- 正式 release tag：未创建。
- 下一步：Coder 在同一 Feature worktree 执行本报告 Fix Plan，完成后交回绑定 Debugger 独立复检。
