# Debugger — v0.8.4

> 对应 Feature：`v0.8.0 — OpenCode Native Harness and Multi-Model Compatibility`
>
> 角色：Debugger
>
> 日期：2026-08-30
>
> 工作树：`D:\Work\CraftStation\craftstation\.worktrees\v0.8`
>
> 分支：`feature/v0.8-opencode-native`
>
> 基线 / HEAD：`7ae6506ea01fc04029a10a711ebb0a65d7248e06` + 未提交 v0.8 改动
>
> 上一轮：[debugger_0.8.3.md](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/agent_docs/debugger_0.8.3.md)
>
> Verdict：**FAIL / ENGINEERING FIX REQUIRED + ENVIRONMENT BLOCKED**
>
> Requires Manager Re-plan：**No**
>
> Requires Ideate Revision：**No**

## Review Scope

本轮继续独立 Feature-level 复检，并纠正 `debugger_0.8.3.md` 中“打开项只有 F37、工程契约可保持关闭”的过早结论。审查依据为 Manager Plan、T01–T08 Tickets、OpenCode SDK `1.18.10` 类型、working tree 源码、既有成熟 OpenCode mapper/server lifecycle 实现，以及 Debugger 新增的一次性回归探针。

未执行 commit、push、tag、Feature→Dev merge 或 main promotion。`package.json`、`pnpm-lock.yaml` 仍与 HEAD 一致。检查残留 `PROJECT_STATUS.md.bakcheck` 已删除。

## Independent Evidence

证据：[v0.8.0-debugger-0.8.4-engineering-recheck.txt](file:///D:/Work/CraftStation/craftstation/.worktrees/v0.8/ai_workspace/validation/v0.8.0-debugger-0.8.4-engineering-recheck.txt)

- 原 8 个定向文件：41 tests PASS。
- Debugger 一次性缺陷探针：4 tests PASS；这些断言刻意证明当前错误行为存在：
  1. compatibility artifact 为 `unavailable` 时仍可成功编译 OpenCode CraftPlan；
  2. renderer-visible native envelope 保留完整嵌套 provider payload；
  3. 重复 `message.part.updated` 完整快照产生 `hellohello`；
  4. `session.error` 后若无后续 `session.idle`，`startTurn()` 100ms 内不 settle。
- 合计：9 files / 45 tests PASS；绿灯包含“缺陷复现成功”，不能解释为 Feature PASS。
- `tsc --noEmit`：exit 0。
- focused `oxlint`：exit 0。
- focused `oxfmt --check`：exit 0。
- SDK 类型确认：`@opencode-ai/sdk` 版本 `1.18.10`；`message.part.updated` 携带完整 `Part`；`session.error` 与 `session.next.step.failed` 携带错误对象；`promptAsync` 支持 per-call model/tools/system/variant，但这不表示 Manager 允许逐 turn 改模型。

## Two-axis Review

### Standards

1. **硬违反 / High**：OpenCode Harness Item 标为 `NATIVE`，六条 `EXPERIMENTAL` Recipe 无 compatibility gate 即注册和编译；违反未验证组合不得进入可执行路径。
2. **硬违反 / High**：新的 event mapper 把完整 provider payload 放入 native envelope，仅按字段名脱敏；没有用户角色过滤，也没有 delta/full snapshot reconciliation。违反 Renderer/IPC 不接收 raw provider payload 和完整敏感 Prompt 的边界。
3. **硬违反 / Medium**：diagnostic phase 将多个非 turn 操作误归类，connection correlation ID 未稳定带入所有诊断。
4. **判断性 smell / Medium**：脱敏逻辑重复且语义漂移；`safeMessage()` 的 regex 没有捕获组，却替换为 `$1=[REDACTED]`，并不能可靠处理 `Authorization: Basic <credential>`。

### Spec

1. 未验证 / unavailable 组合仍可编译 CraftPlan，违反 T06 “未验证组合不能 executable”。
2. `authRef/profileRef/accountBinding` 和既有 server 参数没有进入生产 transport/provider 绑定；每个 Session 默认新建 server transport，无法兑现 server reuse、restart recovery 和不同订阅隔离。
3. native failure event 只投影 `error`，不结算 pending turn。
4. permission/question 只产生 `request.opened` 摘要；缺少选项和 reply API，真实工具/问答流程无法闭环。
5. `StartTurnCommand.overrides.model` 可逐 turn 改模型，违反 Session provider/model identity 生命周期粘性。

## Findings

### F37 — 官方 OpenCode CLI / Provider E2E 仍不可用（环境阻塞）

- 状态：**OPEN / BLOCKED**。
- 证据沿用 `debugger_0.8.3`：PATH 无官方 headless `opencode`；桌面 `OpenCode.exe` 是 Electron GUI，不能冒充 `opencode serve`；六条兼容记录均 `unavailable`。
- 要求：Coder 不再重复空转 GUI/CLI 探测，不伪造 provider E2E PASS。工程修复可在 fixture/contract 层继续；真实 smoke 等 CLI 与凭据可用后执行。

### F38 — unavailable 组合仍进入 executable CraftPlan 路径

**Priority：P0**

- Spec：`manager_0.8.0.md:57,77-79,104-106`；`06-opencode-recipes.md:9-11`。
- Evidence：
  - `registry.ts:248-275` 把 OpenCode Harness Item 标为 `NATIVE`；
  - `registry.ts:350-416,466-474` 无条件注册六条 OpenCode Recipe；
  - `nativeHarnessRecipe.ts:111-204` 只检查 vendor/harness，不读取 compatibility matrix / runtime availability；
  - Debugger 探针实际得到 `success=true` 与 OpenCode CraftPlan，尽管 compatibility JSON 为 `unavailable`。
- Impact：UI/调用者能把未验证组合编译成可执行结果，错误地跨过 Model Matrix Gate。
- Fix：把“catalog 可组合”与“runtime executable”分离；编译或 spawn 前必须读取稳定 compatibility/readiness gate。`unavailable/unverified` 组合只能展示或形成不可执行候选，不能进入生产 `Entity -> Session`。
- Acceptance：新增反向测试，六条 `unavailable` 记录均不能生成 executable CraftPlan/Entity；只有具有允许状态与真实证据的组合才放行。

### F39 — native envelope 泄露 raw provider payload，且 snapshot/delta 会重复输出

**Priority：P0**

- Spec：`manager_0.8.0.md:56,83`；`03-opencode-session-events.md:9-12`；`07-ui-ipc-capability.md:9-12`。
- Evidence：
  - `events.ts:26-58` 将整个 event properties 复制进 `NativeEventEnvelope.payload`；仅按 key 名脱敏，普通 key 下的 secret / Prompt 不会被移除；
  - `runtimeInterface.ts:30-42` 的 SessionSnapshot 对外包含 `nativeEvents`；
  - `events.ts:247-265` 把 `message.part.updated` 完整 `part.text` 当 delta；没有 message role state，也没有与 `message.part.delta` 去重；
  - 既有 `sdkCanonicalMapping.ts:8-11` 已明确官方流会交错 incremental delta 与 full snapshot；
  - Debugger 探针证明 envelope 保留 `sensitive full prompt` / `opaque-secret`，重复 full snapshot 返回 `hellohello`。
- Impact：Renderer/IPC 可能收到用户 Prompt、完整 provider payload 或未知嵌套敏感值；assistant 文本可能重复，用户消息还可能被误标成 assistant output。
- Fix：native envelope 只保留 allowlist 字段和稳定标识，不传 raw payload；引入 message role / part state 与 snapshot reconciliation；复用通用、安全的 mapper seam，禁止直接 deep import legacy harness 实现。
- Acceptance：新增 user-role suppression、delta+snapshot dedupe、nested secret、full Prompt、unknown payload 边界测试；renderer projection 中不得出现 raw provider payload。

### F40 — Provider/Auth/Profile 与 OpenCode server lifecycle 没有生产绑定

**Priority：P1**

- Spec：`manager_0.8.0.md:54-55,63-65,70-72,78`；T02/T04/T06。
- Evidence：
  - `binding.ts:99-137` 生成 `ModelProviderBinding`，但生产 `openCodeNative` runtime 无调用；
  - `adapter.ts:14-20,73-86` 接收 `accountBinding/profileRef`，实际只把 account/profile 放 Entity metadata；
  - `session.ts:154-160` 创建 transport 时只传 `projectLocation/onDiagnostic`，没有 baseUrl、authorization、executable、auth/profile/provider config；
  - `authRef/profileRef/mcpServerIds/skillIds/context` 多数只写 session metadata，不作用于 OpenCode；
  - 每个 `OpenCodeNativeSession` 默认创建独立 transport/server；child ready 后退出不会 respawn，SSE loop 只会重复连旧 client。
- Impact：无法复用已运行 server，无法证明 server restart recovery；不同 provider 订阅仍依赖 OpenCode 全局状态，可能串用认证；CraftPlan 声称“完整传递”但 runtime 静默忽略。
- Fix：建立 CraftStation-owned server pool/config seam；从 supervisor-owned opaque ref 解析为 OpenCode 官方 profile/config/credential 操作，secret 不进入 CraftPlan/Renderer；明确每个 option 是“已应用、runtime-native inherited、或 unsupported 并拒绝”，不得只写 metadata。
- Acceptance：生产 factory 能连接/复用已有 server；并发 Session 不重复 spawn；server exit 可稳定恢复或明确 fail；两个不同 auth/profile fixture 不能互相冒充；MCP/Skills/context/compaction 具有实际调用或明确拒绝测试。

### F41 — native failure event 可让 turn 永久悬挂

**Priority：P1**

- Spec：`manager_0.8.0.md:64-65`；`03-opencode-session-events.md:9-10`。
- Evidence：`events.ts:151-172` 将 `session.error` / `session.next.step.failed` 只映射为 `error`；`session.ts:441-448` 仅在 `turn.completed` resolve；Debugger race 探针 100ms 返回 `timeout`。
- Impact：Provider auth、context overflow、content filter、API failure 等真实错误若不再发 idle，调用者永远等待。
- Fix：保留安全错误分类，并在属于当前 Session/turn 的 terminal failure 上 reject/resolve pending turn，清理 pending state、设置 `failed/error`，发出稳定终态。
- Acceptance：`session.error`、`step.failed`、server exit、abort 与 idle 的单独/乱序组合都恰好 settle 一次，不悬挂、不 double-settle。

### F42 — permission/question 流程不可回复

**Priority：P1**

- Spec：`manager_0.8.0.md:56,66,100,110`；`07-ui-ipc-capability.md:11`。
- Evidence：`events.ts:277-293` 只发送固定 summary，丢失 questions/options/tool context；`CraftSession` 没有 request reply seam；OpenCode SDK 已提供 permission/question reply API，但本 adapter 未暴露。
- Impact：需要工具审批或用户输入的真实 turn 会停住，UI 无法完成闭环。
- Fix：在通用 CraftSession/控制面建立类型化 request response seam；安全投影问题/选项并调用官方 OpenCode reply/reject API；终态发 `request.resolved`。
- Acceptance：permission allow/deny、question answer/reject 的 adapter + IPC 合同测试全部闭环，且不泄露 raw payload。

### F43 — Session identity 不粘、CraftPlan options 被静默忽略

**Priority：P1**

- Spec：`manager_0.8.0.md:55,78-79`；T04/T06。
- Evidence：`session.ts:270-287` 每次 `promptAsync` 都重传 model，并允许 `command.overrides.model` 改模型；permission 只在 create 应用，MCP/Skills/context/compaction/profile/account/auth ref 未实际应用。
- Impact：同一 CraftStation Session 可在每个 prompt 改模型，provider/model identity 与 provenance 不再可信；调用者以为 options 已生效，runtime 实际忽略。
- Fix：Session 建立时冻结 effective provider/model；若产品确需 switch，应使用显式新 Session/官方 switch 操作并更新 provenance，不接受普通 turn override 静默切换。逐项实现或拒绝未支持 options。
- Acceptance：跨多轮 provider/model 不变；不允许的 model override 返回稳定错误；每项声明的 option 有可观察调用/状态测试。

### F44 — diagnostics phase/correlation/redaction 不稳定

**Priority：P2**

- Evidence：
  - `transport.ts:59-78` 仅 discover/start 特判，其余操作全部标为 `dispose`，SSE 失败也被记成 dispose；
  - `session.ts:107-121` 除 get/create 外均标为 turn，connect/delete 等 phase 不准确；
  - mapper diagnostic 回调未始终附 connection correlation ID；
  - `transport.ts:49-56` regex 无捕获组却使用 `$1`，重复脱敏实现发生漂移。
- Impact：现场排障无法区分 discovery/start/connect/turn/reconnect/cleanup，敏感错误文本处理不可靠。
- Fix：集中一个 allowlist-first safe diagnostic builder；显式 phase enum/operation mapping；所有 connection 后诊断携带 correlation/session/model/harness identity，renderer 继续只接收稳定 public projection。
- Acceptance：SSE、connect、create/get、prompt、abort、delete、child exit 的 phase/code/correlation 精确测试；Basic/Bearer/query/nested secret 不泄露。

## Fix Plan for Coder

按以下顺序连续修复并自检，不因单项完成停顿：

1. **F39 安全边界先行**：删除 renderer-visible raw payload；完成 role state 与 delta/snapshot reconciliation。
2. **F41/F42 Session 终态和请求闭环**：error settle、permission/question reply/reject。
3. **F40/F43 binding 与 lifecycle**：生产 server pool/connect/restart seam；真正应用或拒绝 auth/profile/MCP/Skills/context/compaction；冻结 Session provider/model。
4. **F38 executable gate**：兼容矩阵/readiness 与 Recipe/Entity 执行放行一致。
5. **F44 observability**：统一 phase/correlation/redaction。
6. 将 Debugger 的四个一次性缺陷探针改写为正式、面向正确行为的回归测试；保持 package/lockfile 不污染。
7. 运行 focused tests、broader crafting/native harness tests、tsc、focused oxlint/oxfmt；真实 CLI 仍缺失时 F37 继续 BLOCKED，禁止 GUI/synthetic PASS。
8. 更新 `coder_0.8.x.md` 与 validation artifacts，然后通知原配对 Debugger 复检。

## Fix Acceptance Criteria

- [ ] `unavailable/unverified` OpenCode 组合不能进入 executable CraftPlan/Entity/Session
- [ ] RuntimeEvent/native envelope/IPC 不包含 raw provider payload、用户完整 Prompt 或嵌套 secret
- [ ] delta/full snapshot 不重复，用户 role 不映射成 assistant stream
- [ ] error/abort/exit/idle 组合恰好 settle turn 一次
- [ ] permission/question 能安全展示并回复/拒绝
- [ ] 生产 server 可复用；退出后恢复或稳定 fail；不会每 Session 重复 spawn
- [ ] authRef/profileRef/account binding 真正隔离不同订阅，不依赖不透明全局串用
- [ ] Session provider/model 多轮粘性成立；普通 turn 不能静默换模型
- [ ] MCP/Skills/context/compaction/options 已实际应用或明确拒绝
- [ ] diagnostics phase/code/correlation/redaction 精确
- [ ] package.json / pnpm-lock.yaml 与预期一致
- [ ] F37 继续诚实 BLOCKED，直到官方 CLI + 凭据提供真实 E2E

## Verdict

`FAIL / ENGINEERING FIX REQUIRED + ENVIRONMENT BLOCKED`

当前不再是“仅 F37 evidence-only”。F38–F44 是无需官方 CLI 即可修复和验证的工程问题；Coder 应立即进入 v0.8.4 Fix Cycle。修复后仍需等待 F37 的真实 provider E2E 才可能 Feature PASS。

## Feature → Dev Closeout

- Report generated：No（FAIL 不生成 PASS report）
- PROJECT_STATUS updated：Yes
- Lifecycle State：`DEBUGGER FAIL / FIX REQUIRED + BLOCKED`
- Feature → Dev merge：未完成
- Main Promotion：NOT AUTHORIZED
- Official release tag：No
