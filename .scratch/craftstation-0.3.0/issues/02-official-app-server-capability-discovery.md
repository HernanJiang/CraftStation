# 02 — 直接启动官方 app-server 并发现 Runtime 能力

**What to build:** 让 CraftStation 直接启动用户实际安装的官方 \codex app-server\，完成握手、环境诊断、schema/capability discovery 与 Model Item refresh。

**Blocked by:** 01 — 建立 Native Codex Runtime Interface 与 Parity Harness

**Status:** done

- [x] 在 fake server 和真实官方 binary 上完成 initialize/initialized。
- [x] UI/registry 可获得真实 model list、Runtime version、auth 和 capability snapshot。
- [x] 未启用 experimental API 时不会发送 gated method/field。
- [x] RPC request、response、notification 和 server request 可正确区分与关联。
- [x] app-server stderr/log 不污染 JSON-RPC transport，关闭后无遗留进程。
- [x] 本 Ticket 不经过 \ThreadSessionManager\ 或 PoraCode Codex session implementation。
