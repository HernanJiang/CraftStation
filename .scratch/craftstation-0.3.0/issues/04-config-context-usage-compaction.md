# 04 — 配置忠实传递与 Context/Usage/Compaction

**What to build:** 让 CraftStation UI 的显式控制准确进入 CraftPlan 和官方 Codex request，同时让未选配置、context usage 与 compaction 继续由 Codex 原生机制决定。

**Blocked by:** 03 — 打通首条真实 Native Thread/Turn 流式链

**Status:** done

- [x] 显式 UI 选择与实际 thread/turn request 逐字段一致。
- [x] 未选择字段不被 CraftStation 固定默认覆盖。
- [x] UI context/token usage 只使用官方 Runtime 事件或 snapshot。
- [x] 自动 compaction 可见，manual compact 可触发并观察完成。
- [x] invalid/managed/unsupported configuration 有稳定错误或明确 disabled state。
- [x] Session 中的受支持 settings change 有 provenance，不静默修改原 CraftPlan。
