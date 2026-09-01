# 01 — 建立 CraftStation Working Baseline 与 Regression Harness

**What to build:** 让新产品以 CraftStation identity 从 PoraCode 基线完成安装、检查和启动，并用可执行 smoke surface 锁定现有桌面与 Codex 基础能力，为后续 Composition 改造建立可信回归基线。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Working Copy、分支、包管理器、CraftStation identity、安装和启动命令形成单一且可复现的基线。
- [ ] 实际执行并记录 `typecheck`、`lint`、`test`、`build`；无法执行的项目必须有具体阻塞证据和最小替代验证。
- [ ] application startup、workspace opening、Codex startup、session operation、terminal、IPC、persistence 与 shutdown/cleanup 具有可执行 regression checklist 或 smoke surface。
- [ ] 基线验证覆盖关键启动失败并提供可操作诊断，不泄露凭据。
- [ ] 本 Ticket 不引入 Crafting domain 功能，也不对 PoraCode 做无关的全仓重命名。
