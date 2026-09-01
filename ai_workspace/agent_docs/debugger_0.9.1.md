# Debugger Fix Plan — v0.9.1 Fix #1

> Parent review：`ai_workspace/agent_docs/debugger_0.9.0.md`  
> Fix owner：Coder  
> 唯一允许修改的 worktree：`D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`  
> Branch：`dev/v0.9-cross-harness-handoff`  
> Requires Manager Re-plan：**No**  
> Requires Ideate Revision：**No**  
> Verdict：**FAIL — Coder Fix #1 required**

## Fix Scope

只修以下三项，不扩大 Feature：

1. **F1 active input fencing**：crafted Thread 的全部 active command 必须携带并校验 Supervisor-issued `segmentId + runtimeSessionId + bindingEpoch`；missing/stale fail closed，legacy thread 保持兼容。
2. **F2 T08 evidence integrity**：三段真实 response、Segment/native Session identity 和失败 scenarios 必须被真实断言；blocked artifact 与 product assertion failure 分离，禁止 catch-all false-green。
3. **F3 migration regression**：移除 schema 36 硬编码，验证 v32 -> latest 的完整迁移与 v0.9 tables/indexes。

真实环境仍 `QUOTA_OR_LIMIT` 时不要试图“修”成成功；保留 `UNVERIFIED / BLOCKED BY ENVIRONMENT`。

## Fix Acceptance Criteria

### F1

- Renderer/remote current binding 来自 Supervisor state，不由 UI 推测。
- Prompt、slash command、interrupt、steer/clear、permission/question response、close 覆盖 current/stale/missing tests。
- stale/missing crafted command 不触发 target Session；current command只触发当前 active target。
- pending request resolution 同时绑定 request origin execution；旧 Segment request 不能在新 Segment 解析。
- legacy non-crafted routes 不要求 envelope，既有行为不退化。

### F2

- Codex A、Grok B、Codex C 均验证真实 assistant response/completion；artifact 只保存 nonEmpty/length/hash，不保存正文。
- 3 个 distinct Segment、同一 Thread、同一 workspace、ordinal/epoch 递增、B/C 新 native Session presence 有 assertions。
- `REAL_NATIVE_CHAIN_COMPLETED` 最后写入；任何产品 assertion 失败不得被降级为环境阻塞或绿色 test。
- queued、abort success/failure、target rollback、late event/input、restart recovery 各有独立 scenario 证据；真实环境不足时逐项明确 blocked/unverified。
- 对 false-green 加 regression tests：B/C 无 response、Segment count 错误、product exception 必须失败。

### F3

- `projectsThreads.test.ts` 不硬编码 36，v32 fixture 迁移至 `LATEST_SCHEMA_VERSION`。
- 验证 v0.9 schema tables/indexes 与 legacy project data 同时保留。

## Required Validation

按顺序运行并记录原始汇总：

1. v0.9 focused tests（含新增 active command fencing、request origin、false-green、migration tests）。
2. `src/renderer/remoteProcedureRouter.test.ts`。
3. `src/main/db/projectsThreads.test.ts` 与 `src/main/db/migrations.test.ts`。
4. `pnpm typecheck`。
5. `pnpm run build:renderer`，完成后再运行 `pnpm run build:electron`。
6. touched-file `oxlint --deny-warnings` 与 `oxfmt --check`。
7. `git diff --check`。
8. `pnpm test`；若仍有非 Feature 失败，逐项保留原始分类，不得省略。
9. 显式 opt-in 真实 T08；以 artifact verdict/scenarios 判断，不以 test process exit 0 判断。
10. artifact/credential scan，确保无 token/cookie/完整 response/hidden reasoning。

## Execution Order

`F1 execution state source -> Renderer/remote propagation -> Supervisor fail-closed/request binding -> tests -> F3 migration test -> F2 harness refactor/scenarios -> focused/broader/static/build -> real opt-in -> sanitized artifact -> coder_0.9.1.md -> notify paired Debugger`

## Delivery

- 更新 `ai_workspace/agent_docs/coder_0.9.1.md`，列出每个 Finding 的源码、测试与真实 evidence 状态。
- 更新 `PROJECT_STATUS.md`，但在真实 T08 未完成时不得写 PASS。
- 在同一 Feature branch 提交 Fix #1；不得 merge main、tag 或 push。
- 修复完成后通知原配对 `Debugger-0.9-Cross-Harness Handoff` 复检。
