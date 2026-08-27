# 07 — Account-scoped quota/status/reset

**What to build:** 每个账号独立展示 5h/weekly quota、reset、status，并通过 provider-aware collector 刷新而不串号。

**Blocked by:** 02 — Account Pool scheduling contract；03 — Priority tracer 与 Session sticky；06 — Identity、alias 与 Account Row 2×2

**Status:** ready-for-agent

- [ ] A/B quota 与 resetsAt 独立保存和显示
- [ ] quota-low 不触发 fallback，exhausted/unavailable 才触发
- [ ] reset 后 refresh 可恢复 available
