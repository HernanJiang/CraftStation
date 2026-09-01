# 01 — Baseline Audit & Execution Gate

**What to build:** 对 Antigravity、Gemini usage/runtime 与 Volcengine Ark 的现状完成一手资料和代码审计，形成 Gap Matrix；核验 Ark 官方 endpoint、认证字段、AK/SK V4、Coding Plan/Agent Plan 与窗口响应事实，并把 v0.6 的实现门禁写成可复核记录。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 记录当前 dev 工作树已有改动并保证不覆盖、不 reset、不清理。
- [ ] 以官方 Google/Ark 文档或 SDK 为准记录 OAuth 与 Ark 事实；未知字段明确标记 unknown。
- [ ] 输出可供后续票据引用的能力、依赖、风险和真实验收前提矩阵。
- [ ] 明确 v0.6 仅在 v0.5.7 用户验收/Feature Closeout 后、经用户授权才可执行。
