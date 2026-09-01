# 03 — DeepSeek / DSH 官方 Native Transport

**What to build:** CraftStation 能通过 T01 确认的官方 DeepSeek SDK、JSON-RPC 或 stdio 边界创建原生 Session；环境不可用时返回准确的 unavailable/认证/协议诊断。

**Blocked by:** 01 — 官方 Harness Runtime Audit

**Status:** ready-for-agent

- [ ] 使用官方可编程边界，不使用 API proxy
- [ ] 取得真实 init/turn/stream/cleanup 证据，或记录可复现阻塞
- [ ] provider-specific event 不丢失，且不泄漏 secret
- [ ] descriptor capability 与真实证据一致
