# Manager Re-plan — v1.1.0 Compatibility Bridge（2026-09-04）

> 依据：`debugger_1.1.2.md` **FAIL / BLOCKED** 裁决（"no further Coder fix round is authorized by this review"→ 需 Manager re-plan）与用户目标授权（做出 re-plan 决策）。
> 候选现状：`fde6c87`（T01–T13 + Fix v1.1.1/v1.1.2 + takeover 加固，全部已固化提交）。

## 决策

采用 Debugger 裁决中给出的唯一重新受理路径，作为 **v1.1.3 Coder 轮（Re-plan 后授权执行）** 的验收基线：

1. **真实 CPA 二进制契约**
   - 从官方 `router-for-me/CLIProxyAPI` GitHub releases 获取本机（windows x64）release 二进制，放置于 worktree 工具目录（**不提交**、不进产品源码树），并实现产品侧 CPA binary 发现/配置 seam（Settings 或受管工具路径）。
   - 证明：真实进程启动 → loopback 健康检查 → `config.yaml`（host/port/api-keys/auth-dir）加载 → 优雅关闭。
2. **独立 Compatibility Runtime Adapter**
   - 新建 `CompatibilityRuntimeAdapter`（不再向 native adapter 注入 DTO）：经 Bridge 发起 bridge-shaped HTTP 会话请求并返回 Target Harness 响应；Native 配对继续绕过 CPA（保持 fail-closed 拒绝注入路径）。
3. **一条 fixture-scoped 跨组合真实 Agent Loop（tracer bullet）**
   - 目标配对：OpenAI-compatible Model × OpenCode Harness（沿用 v1.1 既定 tracer）；经 `CompatibilityBridgeRecipe → CraftPlan(endpoint 由 runtime 产出) → Bridge → exporter → 官方 Target Harness → Session 回包`。
   - 断言 route/protocol/account 诊断存在、响应真实返回；允许 fixture-scoped 凭据（CPA auth-dir 内 fixture 账号）。
4. **账号 namespace 绑定与持久化**
   - `pinAccount()` 从内存字段升级为 CPA credential namespace 映射 + session-scoped 绑定持久化（secret-free 快照）；resume / cleanup 隔离补测试。
5. **清理与回归**
   - Bridge 子进程生命周期、中断/关闭清理、全量 vitest / typecheck / lint / build；完成后交 `Debugger-1.1-Compatibility Bridge` Re-review。

## 维持不变的边界

- CLIProxyAPI 不是 Usage Authority；不重做 Account Pool / Quota / Tokscale / Token Monitor。
- Antigravity 直连 Gemini-compatible `/v1beta`，不加 OpenAI→Gemini proxy。
- 其余四 Harness 的 Compatibility 消费证据在本轮只要求 OpenCode tracer 成立，其余按 `implementation available` 记录，不冒充 PASS。

## 外部依赖登记（允许的 BLOCKED 项）

- 若 OpenCode/目标 Harness 的真实凭据不可用，则 (3) 允许降级为 fixture 凭据 + 明确标注；但 (1)(2)(4) 的工程证据不可豁免。

## 状态

- v1.1.0 Status：`RE-PLANNED / CODER v1.1.3 AUTHORIZED`。
- 本 re-plan 由用户目标授权直接发布；发布后 Manager 不轮询，Coder 完成自检后自行交接 Debugger。
