# 09 — Security、删除与 refresh hardening

**What to build:** 账号凭据、profile 和 Session binding 的生命周期操作具备原子写入、per-account refresh lock、managed-only 删除与 active binding 防护。

**Blocked by:** 03 — Priority tracer 与 Session sticky；07 — Account-scoped quota/status/reset；08 — Tokscale adapter 与 packaging

**Status:** ready-for-agent

- [ ] active Session 使用中的账号不能产生 dangling binding
- [ ] reauth 针对原账号，删除不触碰用户原始 profile
- [ ] logs/IPC/renderer 无 secret，atomic write 与 lock 有测试
