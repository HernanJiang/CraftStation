# Debugger — v0.4.0

## Review Scope

Feature-level Review：`v0.4.0 — Multi-Account Pool, Provider Quota & Token Usage Control Plane`。

对照 `manager_0.4.0.md`、`coder_0.4.0.md`。Coder 明确未宣称最终 PASS；真实双 profile 仍是质量门。

本轮不修改产品代码。

## Evidence

- 生产接线：`SupervisorRuntime.craftAgent` 经 `AccountResolver` 得到 `accountBinding`，`NativeCodexRuntimeAdapter` 用 scoped `CODEX_HOME` 启动 `AppServerProcessHost`。
- 独立测试：accountStore / accountResolver / tokenUsageAdapter / codexProfiles / peripheralSidecar / boundaryGuard → **6 files / 25 passed**。
- 无 `ai_workspace/validation/` 下 v0.4 双账号真实 round-trip 证据。仅有 T01 audit 文档。
- CodeGraph：Already up to date。
- Coder 自述：并行 frontend task 拥有部分 UI 文件；本 Coder 未改若干 panel/composer 文件。

## Review

### Spec Fidelity

后端 control plane 骨架对齐 Spec：账号 0/1/N、explicit 不 fallback、auto 可按状态 fallback、account sticky via binding、usage source/quality、sidecar JSONL、native Codex 用 scoped home。

未关闭：真实两个 Codex profile 的 login/import、per-account quota、同一 Session sticky、跨 Session 切换、以及 UI 完整入口的人工/真实证据。Manager 写明 Debugger 未 PASS 前不得 Feature PASS。

### Integration

账号解析已进 `craftAgent`。boundaryGuard 仍只防 crafting/nativeCodex→TSM，没有断言 Account 不进入 Item/Recipe/Crafter ontology（Spec 要求）。CLIProxyAPI 未进产品路径，符合。

### Runtime / Edge Cases

单测覆盖 store lock、selected 删除、resolver fallback。缺真实 auth-expired / quota-exhausted 双账号证据。

## Findings

### F01 — 无真实双 Codex profile 验收证据

- Evidence：validation 无 v0.4 JSON；Coder 把双 profile 留给 Debugger。
- Impact：不能证明 scoped `CODEX_HOME`、sticky binding、quota 行为在真 app-server 上成立。
- Fix：两套官方 login/import 后，分别 Craft/Session，保存非 synthetic 证据（accountId、credentialScopeRef、CODEX_HOME、threadId、response 或稳定错误码）。
- Acceptance：至少两个 profile 的独立 Session 证据；explicit 失败不 fallback。

### F02 — Account ontology 边界测试不足

- Evidence：`boundaryGuard.test.ts` 未检查 crafting types/Crafter 不含 Account。
- Fix：加守卫：Account 只出现在 contracts/supervisor/UI，不进入 Recipe/Crafter/CraftPlan 作为 Item。
- Acceptance：对应测试失败当 Account 漏进 crafting domain。

### F03 — Feature UI 入口与 ownership 分裂，未独立验收

- Evidence：Coder 声明未修改多个 panel/composer 文件（并行 frontend）。Debugger 未做 Playwright/UI 验收。
- Impact：用户可能找不到账号池/Usage 入口，或入口与 backend 未接好。
- Fix：列出用户可见入口（Settings / Usage / Craft Table account slot），补最小 UI 测试或人工截图证据。
- Acceptance：最短人工路径可从 UI 选择账号并看到 usage/quota 状态。

## Fix Plan

1. 补 Account-not-in-crafting 边界测试。
2. 产出双 profile 真实证据 JSON。
3. 核对并记录 UI 入口；缺则由 Coder 接线。
4. 诚实文档：未完成项不要写成 Feature PASS。

## Fix Acceptance Criteria

- [ ] 两个真实 Codex profile 的 Session 证据（或稳定 AUTH/quota 诊断）
- [ ] explicit 失败不 fallback 有真实或合同 证明
- [ ] Account 不进入 crafting ontology 有自动守卫
- [ ] 用户可走的 UI 最短路径写进 Debugger User Smoke

## Requires Manager Re-plan

`No`

## Verdict

`FAIL`

Feature 后端切片可继续，但质量门未过。不要 Closeout，不要让用户当完成品验收多账号。

## User Smoke（仅用于复现缺口，不是 PASS 教学）

当前不要当完成功能用。若要帮 Debugger 收集 F01 证据：准备两个 `codex login` profile，分别 Craft 一次并保存 accountBinding。
