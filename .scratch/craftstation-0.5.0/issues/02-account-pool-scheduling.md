# 02 — Account Pool scheduling contract

**What to build:** 用户可为每个 Provider Pool 选择 Priority、Round-Robin 或 Random，账号状态按统一 usable 规则解析，默认 Priority。

**Blocked by:** 01 — Audit baseline 与迁移契约

**Status:** ready-for-agent

- [ ] provider-scoped scheduling mode 持久化并可恢复
- [ ] disabled/auth-expired/exhausted/unavailable/hard-error 被过滤，quota-low 保留
- [ ] explicit unavailable 与 pool exhausted 返回稳定错误
