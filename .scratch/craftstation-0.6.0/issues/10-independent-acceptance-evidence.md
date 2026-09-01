# 10 — Independent Acceptance Evidence

**What to build:** 在 dev worktree 对 v0.6 整体执行独立验收，提供系统浏览器 OAuth、Antigravity quota refresh、Gemini CLI runtime 保留、Gemini usage 移除和 Ark credential/parser/error 证据，并形成 Debugger closeout。

**Blocked by:** 09 — Cross-Provider Regression & Packaging

**Status:** ready-for-agent

- [ ] 系统默认浏览器 OAuth、loopback callback、main-process exchange/refresh 有可复核证据。
- [ ] Antigravity Gemini 与 Claude & GPT quota groups 正确显示/更新。
- [ ] 独立 Gemini usage provider/login/quota card 不存在，Gemini CLI runtime 仍可运行。
- [ ] Ark API Key 与 AK/SK fixture/真实 smoke（若具备官方访问）及四类窗口、错误映射通过。
- [ ] Debugger 给出 PASS 或 FAIL；PASS 仅代表 DEV PASS / USER ACCEPTANCE PENDING。
