# 03 — Priority tracer 与 Session sticky

**What to build:** 新建 Session 按账号顺序选择并注入官方 profile，Session 全生命周期保持同一账号，Auto fallback 与显式账号错误语义可验证。

**Blocked by:** 02 — Account Pool scheduling contract

**Status:** ready-for-agent

- [ ] Priority 顺序真实影响新 Session
- [ ] explicit account 不可用时不 silent fallback
- [ ] resume/restart 保持 account binding
