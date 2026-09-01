# 07 — Antigravity 与 DeepSeek Native Recipes

**What to build:** 用户选择对应 Model Item 与 Harness Item 时，Crafter 能解析、校验并编译 Antigravity 与 DeepSeek 的 Native Recipe，形成可执行 CraftPlan/Entity/Session。

**Blocked by:** 05 — CraftPlan Runtime Configuration Propagation; 06 — Native Capability Matrix 与 Readiness

**Status:** ready-for-agent

- [ ] Model Vendor 与 Harness Vendor 独立
- [ ] 未验证组合不能进入 executable path
- [ ] Recipe provenance、diagnostic 和 unsupported reason 可追溯
- [ ] 两条 composition 链路均有 contract tests
