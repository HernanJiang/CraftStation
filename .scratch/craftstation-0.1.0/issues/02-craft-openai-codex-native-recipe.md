# 02 — Craft OpenAI + Codex Native Recipe

**What to build:** 让用户选择 OpenAI Model Item，并由 `auto` Harness Slot 确定性解析 Codex Harness Item，经 Registry 和 Crafter 生成可追溯的 Result Item 与 CraftPlan，再通过测试 runtime Adapter 创建最小 Entity。

**Blocked by:** 01 — 建立 CraftStation Working Baseline 与 Regression Harness.

**Status:** ready-for-agent

- [ ] Registry 注册至少一个受支持 OpenAI Model Item、Codex Harness Item 和对应 Native Recipe，Model 与 Harness 保持独立 Items。
- [ ] Harness `auto` 正确解析 Codex，显式选择 Codex 产生相同 Recipe identity；`auto` 不进入 Item registry。
- [ ] Crafter 只通过 `resolve / validate / compile` 工作，成功和 missing Item、unresolved Slot、invalid Recipe、runtime unavailable 分支具有稳定错误语义与 contract tests。
- [ ] Result Item 与 CraftPlan 保存稳定 identity、source Recipe、Ingredient provenance、runtime binding、Workspace 和可选 Session reference。
- [ ] 测试 runtime Adapter 证明 CraftPlan 可跨 `harness-runtime` seam 创建 Entity；Crafting module 不导入 Codex protocol、transport、RPC 或 process implementation。
- [ ] 相同输入和 Registry 状态产生确定性结果，关键日志包含 composition/result/correlation identity。
