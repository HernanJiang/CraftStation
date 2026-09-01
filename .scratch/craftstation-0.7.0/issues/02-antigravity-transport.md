# 02 — Antigravity 官方 stream-json Transport

**What to build:** CraftStation 能启动官方 `agy` machine mode、发送结构化输入并接收增量 NDJSON 输出，具备会话启动、持续 turn、取消、退出和认证失败诊断。

**Blocked by:** 01 — 官方 Harness Runtime Audit

**Status:** ready-for-agent

- [ ] 不使用 TUI 抓屏或键盘注入
- [ ] 输入/输出 framing、stderr、退出码和超时可诊断
- [ ] OAuth/Keyring/订阅身份由官方 CLI 处理，Adapter 不接触秘密
- [ ] 单元和协议 fixture 覆盖正常、未知事件、畸形行和进程失败
