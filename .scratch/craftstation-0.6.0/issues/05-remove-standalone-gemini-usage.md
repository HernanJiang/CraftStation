# 05 — Remove Standalone Gemini Usage Surface

**What to build:** 从 usage catalog/UI/login/quota surface 移除独立 Gemini provider，同时保持 Gemini CLI agent/runtime、模型能力、MCP/Skills、session 与 analytics identity 可运行，并保留 Antigravity 内部 Gemini quota group。

**Blocked by:** 01 — Baseline Audit & Execution Gate

**Status:** ready-for-agent

- [ ] 独立 Gemini usage descriptor、collector registration、login entry 和 quota card/provider projection 不再出现。
- [ ] Gemini CLI agent/runtime registry、models、MCP/Skills、session smoke 继续通过。
- [ ] Antigravity Gemini nested quota group 与 parser/tests 不受影响。
- [ ] 编译期/运行期断言防止把 usage catalog 删除误扩展为 runtime 删除。
