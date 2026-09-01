# 05 — 持久化 Composition Provenance 与 Session Recovery

**What to build:** 让用户重启应用或重新打开 Workspace 后仍能理解已有 Entity 的 Recipe 来源、Ingredients 和 runtime binding，并可靠恢复同一个连续 Session。

**Blocked by:** 04 — React Crafting Grid 到真实 Session.

**Status:** ready-for-agent

- [ ] 在现有 persistence 上保存恢复与追溯所需的最小 Result identity、source Recipe、Ingredient provenance、runtime binding、Entity 和 Session reference。
- [ ] Session recovery 可重建必要 CraftStation identity 与 runtime binding，并继续使用同一连续 Session。
- [ ] 缺失、损坏、过期或不兼容 provenance 产生明确错误或安全降级，不构造错误 Recipe、Entity 或 Session。
- [ ] persistence 和 recovery 测试覆盖正常重启、Workspace reopen、已有 Session、无效 provenance 与清理行为。
- [ ] 本 Ticket 不建立完整 Recipe Graph database、搜索引擎或通用迁移框架。
- [ ] provenance 日志可用 composition/result/entity/session/correlation identity 串联写入与恢复阶段，且不记录敏感 Prompt 或凭据。
