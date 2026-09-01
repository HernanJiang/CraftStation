# 03 — Antigravity System-Browser Loopback OAuth

**What to build:** 用户点击 Antigravity 登录时，系统默认浏览器完成 Google OAuth，主进程 loopback callback 接收正确授权码并完成 exchange/refresh；该流程不打开 CraftStation 内置终端或内置网页登录。

**Blocked by:** 02 — Antigravity OAuth Contract & Secure State

**Status:** ready-for-agent

- [ ] 只调用系统默认浏览器并绑定当前 flow 的 localhost/loopback callback。
- [ ] 正确校验 state（及官方要求的 PKCE/nonce），错误回调 fail closed。
- [ ] 主进程完成 code exchange、refresh token rotation 与安全存储。
- [ ] 真实或受官方契约约束的 browser/callback smoke 可复核，且凭据不泄露。
