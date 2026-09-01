# 04 — Native Event 与 Lifecycle Canonicalization

**What to build:** Antigravity 与 DeepSeek 的原生事件都能在 CraftStation UI/Session 中以统一但不失真的 canonical event、turn、session、diagnostic 语义呈现。

**Blocked by:** 02 — Antigravity 官方 stream-json Transport; 03 — DeepSeek / DSH 官方 Native Transport

**Status:** ready-for-agent

- [ ] 映射 text delta、thought、tool、permission、question、usage、turn/session lifecycle
- [ ] 保留安全 native envelope、sequence 和 correlation id
- [ ] 未知事件 forward-compatible，不造成静默丢失
- [ ] 取消、错误、退出和资源清理可测试
