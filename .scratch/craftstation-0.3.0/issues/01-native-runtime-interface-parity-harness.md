# 01 — 建立 Native Codex Runtime Interface 与 Parity Harness

**What to build:** 建立事件驱动的 CraftStation \harness-runtime\ Interface，并用 fake app-server 跑通一个可观察的 Entity/Session/Turn，使后续官方 Codex implementation、UI 与测试都跨同一个 seam 工作。

**Blocked by:** v0.2 Feature Close；关闭后可立即开始。

**Status:** done

- [x] fake Runtime 可从 CraftPlan 创建 Entity/Session、提交 Turn、流式发送事件并形成 terminal snapshot。
- [x] Session Interface 支持 subscribe/snapshot 和至少 start turn、interrupt、terminate 的命令语义。
- [x] Turn completion 不依赖固定 60 秒 timeout。
- [x] CraftPlan 能表达 typed explicit overrides，未选择字段可以保持缺失。
- [x] Interface、错误、事件与日志 contract 有自动测试。
- [x] Crafting、Crafter 和 UI contract 不包含 Codex JSON-RPC DTO。
