# 01 — Native Harness Audit & Compatibility Matrix

**What to build:** 对 Codex、Grok Build、Kimi Code、Antigravity、DeepSeek/DSH 完成 upstream/native runtime 审计，并产出可复现的 discovery、版本、认证、machine-facing boundary、session、事件、能力、错误与 cleanup 矩阵。

**Blocked by:** None — can start immediately

**Status:** completed

- [x] 记录五个 target 的官方来源、安装/版本/ready 探针与真实命令证据。
- [x] 记录 native session、stream、tool、permission、MCP/Skills/Subagent、context/compaction、interrupt/resume、crash/cleanup 能力。
- [x] Antigravity 明确作为 Google/Gemini 侧目标，Gemini CLI 不进入核心范围。
- [x] 旧 DSH 标记 superseded；不得以 Model API 或 CLIProxyAPI 代替 Harness。
- [x] 建立 CodeGraph，或记录结构化搜索降级和限制；产出 capability matrix、native pairing 清单与风险。

交付证据：`ai_workspace/validation/v0.4.0-native-harness-audit.md`。
