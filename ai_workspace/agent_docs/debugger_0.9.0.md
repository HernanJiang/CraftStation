# Debugger Feature Review — v0.9.0 Cross-Harness Session Handoff

> 角色：Debugger  
> 日期：2026-08-31  
> 唯一验收 worktree：`D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`  
> Feature branch：`dev/v0.9-cross-harness-handoff`  
> Coder commit：`4ef61356bf9d9f4490517210cfa21fbe0454632d`  
> Manager Plan：`ai_workspace/agent_docs/manager_0.9.0.md`  
> Coder 交付：`ai_workspace/agent_docs/coder_0.9.0.md`  
> Verdict：**FAIL / BLOCKED BY ENVIRONMENT**  
> Requires Manager Re-plan：**No**  
> Requires Ideate Revision：**No**

## Review Scope

本轮独立验收 T01–T08，覆盖：

- source / target / restart 的 Segment ledger 与唯一 active binding；
- same-Thread switch、after-current-turn queue、abort handshake、rollback、late events；
- `threadId + segmentId + runtimeSessionId + bindingEpoch` event/input fencing；
- ConversationCheckpoint、portable context、provenance 与 credential safety；
- Renderer / IPC / remote route、in-place Switch UI、Fork/Move 回归；
- 迁移、类型检查、构建、格式、lint、focused 与 broader tests；
- 真实官方 `Codex A -> Grok B -> Codex C` non-synthetic Runtime gate。

没有创建第二个 worktree，没有修改 `main` 或其他版本 worktree，没有 merge、tag 或 push。CodeGraph 当前索引属于 Product Root 而非本 Feature worktree，本轮降级为当前 worktree 内的 `rg`、逐文件审查和真实测试。

## Evidence

### 独立通过项

1. 固定 Node ABI 的 v0.9 touched/focused suite：**10 files PASS、1 file SKIPPED；145 tests PASS、1 test SKIPPED**。SKIP 是未 opt-in 的真实 cross-harness integration，不是 Feature PASS。
2. Remote procedure regression：**1 file / 215 tests PASS**。
3. `pnpm typecheck`：PASS。
4. `pnpm run build:renderer`：PASS；存在既有 CSS `::highlight`、sourcemap、chunk-size warning，没有构建错误。
5. `pnpm run build:electron`：PASS。
6. Feature commit 触及的 34 个 TS/TSX：`oxlint --deny-warnings` PASS，`oxfmt --check` PASS。
7. `git diff --check`：PASS；`package.json` / `pnpm-lock.yaml` 无 Feature diff。
8. 新增 14 个 v0.9 msgid 在 12 个非英文 catalog 中均有非空翻译。
9. 全仓 `pnpm lint` 唯一错误是未被本 Feature 修改的 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52:7`：`vitest(no-conditional-expect)`；父提交同一代码位置已存在条件 expect。该项分类为既有全仓 lint blocker，不归因于 v0.9。

### Broader test 状态

`pnpm test`：

- **883 files / 9837 tests PASS**；
- **8 files / 19 tests FAIL**；
- **14 files / 78 tests SKIPPED**；
- **1 unhandled error**。

其中 `src/main/db/projectsThreads.test.ts` 的 1 个失败已定向复现为 **1 failed / 18 passed**，且由 v0.9 schema 版本 `36 -> 39` 直接触发。其他失败位于本 Feature 未修改的 `craftstationData.migrate`、`ThreadView` todo dock、`CraftingGrid` DeepSeek default、channel parity、probe cwd、Antigravity OAuth timeout、Crossagent MCP network paths；当前证据不足以把这些未触及失败改写成 v0.9 regression 或既有 PASS，故作为 broader-suite 非绿状态如实保留。

### 真实 Runtime gate

显式设置 `CRAFTSTATION_REAL_CROSS_HARNESS_E2E=1` 后，integration 测试进程显示 **1 file / 1 test PASS**，但该 PASS 只说明测试函数完成。最新 artifact：

- `synthetic: false`；
- `verdict: BLOCKED BY ENVIRONMENT`；
- `blockedReason.code: QUOTA_OR_LIMIT`；
- `scenarios: []`；
- `runtimeEventCount: 18`。

因此没有取得 Codex A、Grok B、Codex C 三段真实 non-synthetic response，也没有真实证明 Grok 理解 checkpoint/workspace、回 Codex 创建有效 continuation、abort/rollback/late-event/restart。T08 保持 **UNVERIFIED / BLOCKED BY ENVIRONMENT**，不能把 test process 的绿色结果写成 Feature PASS。

### Artifact / credential safety

- 对 `ai_workspace/validation`、handoff module 和真实 integration test 扫描 private key、Bearer、API key、cookie、access/refresh token、hidden/internal reasoning 字段。
- 高风险模式只命中 negative tests 中的假 token，例如 `sk-abcdefghijklmnop` 与 `Bearer abcdefghijklmnop`；对应断言明确验证它们不会进入序列化 checkpoint/ledger。
- 当前 validation artifact 不含明文凭据、完整 response、Prompt、hidden reasoning 或 provider internal state。

## Acceptance Assessment

| Area                                   | Result                            | Independent assessment                                                                                                                 |
| -------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| T01 durable Segment ledger / migration | PARTIAL                           | Ledger、CAS、restart recovery、unique active index 的 focused tests 通过；broader schema-version assertion 未同步。                    |
| T02 ConversationCheckpoint             | PASS at protocol level            | Allowlist、budget、truncation、redaction negative tests 通过；没有真实 provider continuation 证据。                                    |
| T03 same-Thread switch                 | IMPLEMENTED / UNVERIFIED          | Coordinator mock/protocol tests通过；真实 idle Codex -> Grok response 未取得。                                                         |
| T04 queued safe boundary               | IMPLEMENTED at focused-test level | replace-latest/cancel/boundary tests通过；真实 Runtime queue 未取证。                                                                  |
| T05 abort / rollback                   | PARTIAL                           | mock/CAS fail-closed tests通过；真实 official interrupt 与失败资源清理未取证。                                                         |
| T06 event/input fencing                | FAIL                              | event subscription 会补 envelope，但 Renderer active commands 没有发送 active execution envelope，迟到命令无法按旧 epoch 拒绝。        |
| T07 UI / IPC / provenance              | PARTIAL                           | Supervisor-only IPC、dialog/marker/action tests与构建通过；未完成真实 UI handoff主路径，且 command fencing 缺口影响 UI writer safety。 |
| T08 real continuation acceptance       | BLOCKED / INCOMPLETE HARNESS      | 当前环境额度阻塞；测试本身也没有验证 B/C response及声明的失败场景。                                                                    |

## Findings

### F1 [P1] Active command 调用方未携带 execution envelope，旧 UI binding 的迟到输入无法被 epoch fence 拒绝

**Evidence**

- `src/shared/contracts/thread.ts` 已为 Prompt、interrupt、steer、request resolution、close 定义可选 `execution`。
- `src/supervisor/sessionHandoff/coordinator.ts:134-155` 只有在 `expected` 存在时才比较 `segmentId/runtimeSessionId/bindingEpoch`。
- `src/renderer/actions/threadRuntimeActions.ts:122-128,228-233,270-289`、`src/renderer/components/thread/ThreadComposerSection.tsx:504-510`、`src/renderer/commands/registry.ts:473-479` 均只发送 `threadId` 等旧字段，没有 execution envelope。

**Impact**

切换完成后，来自旧 Renderer state、旧 permission/question UI、旧 interrupt/steer 或命令面板的迟到命令仍会命中当前 `threadId`。Supervisor 只确认“当前有 active Segment”，随后把命令发给新 Session；这不满足 Manager Plan 的 active input epoch fence，也可能让旧 UI action 写入错误的 Runtime Segment。

**Root Cause**

协议把 execution 设为 optional 以兼容 legacy route，但 crafted in-place handoff 调用方没有保存和附加当前 active execution binding；Supervisor 也没有对 crafted path 的缺失 envelope fail closed。

**Fix**

1. 为 Renderer 当前 Thread 暴露/保存 active `RuntimeExecutionEnvelope`，来源必须是 Supervisor handoff state/active Segment，而不是由 UI 猜测。
2. 所有 crafted active command（Prompt、slash command、interrupt、steer/clear、permission/question response、close，以及同类 remote command）携带该 envelope。
3. Supervisor 对已进入 Segment ledger 的 crafted Thread 在 envelope 缺失时返回稳定错误（建议 `HANDOFF_ACTIVE_EXECUTION_REQUIRED`）；legacy 非-crafted Thread 保持兼容。
4. pending request 必须绑定创建它的 execution，resolution 同时校验 request 与 active epoch；不能只按 `threadId + requestId`。

**Acceptance**

- 每条 active command 有 current、stale、missing-envelope tests。
- 切换后模拟 source UI 的迟到 Prompt、interrupt、steer、permission answer、close 均被拒绝，新 target 没有收到调用。
- 当前 target envelope 的相同命令正常到达 target；legacy thread 行为不变；remote protocol 精确保留 envelope。

### F2 [P1] T08 测试会 false-green，无法证明它声称的真实链路与失败场景

**Evidence**

- `crossHarnessHandoff.integration.test.ts:124-160` 对 Grok B / Codex C 只检查 `disposition === activated`，没有验证 `HANDOFF_GROK_B_OK` / `HANDOFF_CODEX_C_OK` response，也没有记录 response summary。
- `:172-176` 在 Segment count assertion 之前写 `verdict = REAL_NATIVE_CHAIN_COMPLETED`。
- `:177-185` 捕获所有异常后，测试最终只断言 `evidence.synthetic === false`；额度、认证、产品 bug、断言失败都会让 test process 绿色。
- T08 ticket 要求 queued、abort、rollback、late-event、restart 独立证据；当前文件没有执行这些 scenario。

**Impact**

即使 B/C 没有真实 response、Segment count 错误或产品链路出现 regression，测试仍可能显示 `1/1 PASS`。这会把“artifact 被写出”与“真实 Runtime acceptance”混淆，无法关闭 Feature-level gate。

**Root Cause**

环境可用性诊断和 acceptance assertion 被塞进同一 catch-all test，且真实 response 没有从 canonical event/result 进入明确断言。

**Fix**

1. 将环境 preflight/blocked artifact 与 acceptance assertions 分层：外部 `AUTH_REQUIRED/QUOTA_OR_LIMIT/RUNTIME_UNAVAILABLE` 可产出 blocked artifact；一旦链路开始，产品 assertion 失败必须使测试失败并保留稳定 failure code。
2. 对三段分别验证真实 assistant completion/response token（只在 artifact 写 length/hash/nonEmpty，不写正文），并验证同一 thread/workspace、新 Segment/native Session identity、ordinal/epoch 单调性。
3. `REAL_NATIVE_CHAIN_COMPLETED` 只能在全部 assertions 成功后写入；artifact schema 增加 scenario status、response summary、Segment identity presence 与 sanitized failure classification。
4. 增加或拆出可重复的 queued、abort-confirmed/abort-failed、target rollback、stale event/input、restart recovery scenarios；真实官方 Runtime 要求的场景不能只用 mock 代替，环境不足时逐项标记 blocked/unverified。

**Acceptance**

- 人为让 B/C 缺少 marker response、Segment count 错误、产品异常时，测试必须红或给出明确 non-environment failure，不能 `1/1 PASS + REAL_NATIVE_CHAIN_COMPLETED`。
- 真实成功 artifact 有三段 non-empty hashed summaries、3 个 distinct Segment、同一 Thread/workspace、B/C native Session presence，以及失败场景结果。
- 真实环境不可用时仍 fail closed：`BLOCKED BY ENVIRONMENT`，不把 test process 绿色表述成 acceptance PASS。

### F3 [P2] v0.9 schema 升级后 broader migration test 仍硬编码旧版本 36

**Evidence**

- v0.9 新增 migrations 37–39，`LATEST_SCHEMA_VERSION === 39`。
- `src/main/db/projectsThreads.test.ts:309` 仍断言 `schema_version === "36"`。
- 独立定向复现：**1 failed / 18 passed**，received `39`、expected `36`。

**Impact**

全仓测试无法绿色，迁移基线测试与实际 schema registry 脱节；后续版本继续增加 migration 时还会重复失败。

**Fix / Acceptance**

- 改用 `String(LATEST_SCHEMA_VERSION)`，并明确验证 v32 fixture 经 33–39 全链迁移后，原项目字段与 v0.9 三组新表/index 均存在。
- `src/main/db/projectsThreads.test.ts` 与 `src/main/db/migrations.test.ts` 定向全绿。

## Environment Blocker

即使 F1–F3 修复，当前 artifact 的 `QUOTA_OR_LIMIT` 仍阻止 T08 PASS。Coder 不得伪造 response、降低 `synthetic=false` 约束或把 blocked test process 绿色改写成 Feature PASS。真实凭据/额度不可用时，v0.9 必须继续 `UNVERIFIED / BLOCKED BY ENVIRONMENT`。

## Fix Plan

Fix Cycle：**v0.9.1**。完整执行顺序与验收命令见 `ai_workspace/agent_docs/debugger_0.9.1.md`。

## Verdict

**FAIL / BLOCKED BY ENVIRONMENT**

- 工程 Finding：F1、F2、F3 打开，交由 Coder Fix #1。
- 真实 Runtime gate：`QUOTA_OR_LIMIT`，三段 response 与失败场景仍未验证。
- 不生成 `ai_workspace/reports/report_0.9.md`，不做候选收口，不 merge main，不 tag，不 push。
