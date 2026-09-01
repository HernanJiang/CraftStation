# 05 — 完整 Native Session 生命周期与长任务控制

**What to build:** 让用户把官方 Codex Thread 当作连续 CraftStation Session 使用，覆盖 second turn、resume、fork/read、steer、interrupt、crash recovery 和 cleanup。

**Blocked by:** 04 — 配置忠实传递与 Context/Usage/Compaction

**Status:** done

- [x] 同一官方 Thread 完成真实第二轮 Prompt 并保留上下文。
- [x] resume、fork/read、steer 和 interrupt 在官方支持范围内通过测试。
- [x] 超过 60 秒的 fake/controlled long Turn 不被 CraftStation 自动失败。
- [x] process exit 会使相关 Session 进入明确状态并提供可诊断 recovery path。
- [x] terminate/shutdown 清理 connection、process、subscription 与 pending request。
- [x] 重复、迟到和 terminal 后事件不会破坏 Session state。
