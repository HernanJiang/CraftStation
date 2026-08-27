# 05 — Provider presentation order 与 4/1 UI

**What to build:** 现有“模型与用量”入口按认证状态形成左 4 列/右 1 列布局；Provider Card 拖拽只持久化展示顺序。

**Blocked by:** 01 — Audit baseline 与迁移契约

**Status:** ready-for-agent

- [ ] 已认证 Pool 在左侧、未认证 Provider 在右侧滚动区
- [ ] Provider Card DnD 不改变 runtime selection
- [ ] 重启恢复展示顺序并覆盖 0/1/2+ provider
