# 10 — Grok 双账号真实 E2E 与回归

**What to build:** 使用至少两个真实 Grok 账号和 Official Grok Harness Runtime，完成独立 profile、quota、Priority/RR/explicit/sticky 全链路证据。

**Blocked by:** 03 — Priority tracer 与 Session sticky；04 — Round-Robin / Random；07 — Account-scoped quota/status/reset；08 — Tokscale adapter 与 packaging；09 — Security、删除与 refresh hardening

**Status:** ready-for-agent

- [ ] A/B 独立登录、profile、quota/reset 和 native response 可复现
- [ ] Priority、Round-Robin、显式不可用报错、Auto fallback 与 sticky 全部通过
- [ ] 缺少真实官方运行证据时保持 NOT PASS，不以 mock/绿测替代
