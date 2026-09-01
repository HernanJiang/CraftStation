# 01 — 官方 Harness Runtime Audit

**What to build:** 完成 Antigravity CLI 与 DeepSeek/DSH 官方 machine-facing runtime 的 repository-driven audit，冻结可执行命令、协议、事件、认证、会话恢复和能力矩阵，形成后续 Adapter 的事实基线。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 记录官方来源、版本、可执行文件发现和认证边界
- [ ] 记录 Antigravity `stream-json` 输入/输出事件与退出语义
- [ ] 记录 DeepSeek 官方 SDK/JSON-RPC/stdio 可用性；未知项标为 unavailable，不猜测
- [ ] 产出审计 artifact 和 implementation decision
