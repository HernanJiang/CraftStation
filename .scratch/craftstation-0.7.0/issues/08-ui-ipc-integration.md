# 08 — UI/IPC Native Harness Control Integration

**What to build:** CraftStation 现有 UI 能选择、启动、流式显示、暂停/取消和恢复 Antigravity/DeepSeek Session；不创建第二套 Harness 页面或把 provider secrets 暴露给 Renderer。

**Blocked by:** 07 — Antigravity 与 DeepSeek Native Recipes

**Status:** ready-for-agent

- [ ] 复用现有 Crafting/Session UI 与 IPC seam
- [ ] 实时显示 canonical events、status、usage 和诊断
- [ ] 权限、MCP、Skills、subagent 能力按 descriptor 显示
- [ ] UI/IPC payload 经过 secret redaction 测试
