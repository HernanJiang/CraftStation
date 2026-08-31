# v0.9/T07 — In-place Switch UI and Provenance Timeline

## Goal

让用户在一个 Thread 内选择目标组合和切换模式，并理解 queue、progress、failure、rollback 与消息来源。

## Scope

- 复用 Continue-in-Provider selector；保留 Fork/Move；新增 Switch in this conversation。
- After-turn/abort mode、status/progress/error/retry/cancel。
- Segment provenance、`Recipe 配置名称 · 模型名称`、restart presentation、accessibility 与 i18n。

## Depends On

T04、T05、T06。

## Acceptance

- [ ] Renderer 只调用 Supervisor handoff Interface。
- [ ] Timeline 与 Thread identity 保持连续。
- [ ] Current/target combination 与所有阶段清晰可见。
- [ ] Fork/Move 不退化。
- [ ] Keyboard/screen-reader 与 restart state tests 通过。

## Evidence

Component/integration tests、原生 Electron smoke 与最短人工验收步骤。
