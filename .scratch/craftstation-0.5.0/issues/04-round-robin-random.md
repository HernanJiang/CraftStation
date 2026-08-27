# 04 — Round-Robin / Random

**What to build:** 在新 Session 边界提供持久化 Round-Robin ring 与 usable-only Random 选择，且不破坏 sticky binding。

**Blocked by:** 02 — Account Pool scheduling contract；03 — Priority tracer 与 Session sticky

**Status:** ready-for-agent

- [ ] A/B/C 新 Session 轮询为 A→B→C→A
- [ ] Random 只从 usable pool 选择且不依赖具体随机序列
- [ ] 重启后的 cursor 行为有明确契约与测试
