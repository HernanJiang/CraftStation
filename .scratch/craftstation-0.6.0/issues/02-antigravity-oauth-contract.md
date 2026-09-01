# 02 — Antigravity OAuth Contract & Secure State

**What to build:** 定义 Antigravity 原生 Google OAuth 的主进程契约，使登录、取消、超时、回调错误、刷新和安全凭据投影具有稳定状态与错误语义，Renderer 只能看到脱敏状态。

**Blocked by:** 01 — Baseline Audit & Execution Gate

**Status:** ready-for-agent

- [ ] 定义 auth state、account identity、refresh 状态和稳定错误 code。
- [ ] 设计 state/PKCE/nonce、超时/取消及并发刷新锁。
- [ ] 复用安全存储并定义绝不进入 Renderer、IPC 日志或报告的字段。
- [ ] 契约测试覆盖成功、拒绝、state mismatch、timeout、cancel 和 refresh rotation。
