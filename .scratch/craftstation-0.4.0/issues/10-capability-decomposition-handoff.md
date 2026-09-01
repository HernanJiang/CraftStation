# 10 — Capability Decomposition Design Handoff

**What to build:** 基于五个完整 Native Harness 的真实差异，产出后续 Component decomposition、Item promotion 与 v0.5 候选设计入口；本 Ticket 只交付证据和设计，不实现 Universal* 或自动抽象。

**Blocked by:** 09 — Cross-Harness Control Plane & Native Capability Projection

**Status:** completed

- [x] 汇总五 Harness capability matrix、native semantics、稳定交集与不可合并差异。
- [x] 标出哪些能力可成为 Component、哪些仍应留在 Harness Adapter，给出理由和迁移风险。
- [x] 形成 v0.5 Ideate 输入，不改变 v0.4 的 Item/Recipe/Crafter 核心 ontology。
- [x] 明确禁止在本 Ticket 偷渡 Auto-Crafting、Recipe Search、Learned Router 或 universal capability engine。

交付证据：`ai_workspace/validation/v0.4.0-capability-decomposition-handoff.md`。
