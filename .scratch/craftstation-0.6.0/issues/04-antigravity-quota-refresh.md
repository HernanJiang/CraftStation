# 04 — Antigravity Quota Refresh Integration

**What to build:** 将 OAuth 后的 Antigravity 账号投影接入原生 quota refresh，保留并正确呈现 Antigravity 内部 Gemini 与 Claude & GPT 两个 quota 分组，以及 reset、unavailable 和错误状态。

**Blocked by:** 03 — Antigravity System-Browser Loopback OAuth

**Status:** ready-for-agent

- [ ] OAuth credential 只通过主进程/provider seam 进入 quota collector。
- [ ] Gemini、Claude & GPT 分组继续解析，window id/provenance 不混淆。
- [ ] refresh、失效 credential、网络错误和 reset 时间有稳定投影。
- [ ] 测试和可用时的真实 quota refresh 证据均不包含 secret。
