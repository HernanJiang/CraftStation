# Feature Report — v0.3.0

## Goal

把 Codex 生产路径从 PoraCode TSM Adapter 切到 CraftStation-owned Native Runtime，直接驱动官方 `codex app-server`：

```text
CraftPlan -> NativeCodexRuntimeAdapter -> official app-server --stdio
-> Entity -> Session -> real response
```

## Delivered

- T01：command/event/snapshot `CraftSession` + Fake parity harness + typed overrides
- T02–T07：process host、JSONL JSON-RPC（omit jsonrpc）、V2 thread/turn、streaming mapping、steer/interrupt、approval/MCP 入口
- T08–T09：`craftAgent`/`resumeCraftAgent` 切到 Native adapter；boundary 禁止 nativeCodex 依赖 TSM
- 真实双轮 round-trip 证据（codex-cli 0.150.0-alpha.8）

## Important Design / Architecture Changes

- Codex agent loop 仍由官方 Runtime 拥有
- CraftStation 只拥有 composition seam + app-server host + event mapping
- 生产路径不再 fallback ThreadSessionManager / SpawnPipeline / CodexStructuredSession

## Validation

- Mock/contract：nativeCodex + fake harness + boundary
- 真实：`ai_workspace/validation/craftstation_execution_path_v0.3.2.json`
  - initialize 成功，13 models
  - turn1 `CRAFTSTATION_REAL_ROUNDTRIP_OK`
  - turn2 `CRAFTSTATION_SECONDTURN_OK`

## Important Issues and Fixes

- v0.3.1 FAIL：仅 mock、model/list 假列表、无真实握手
- v0.3.2：修正 JSONL framing、`--stdio`、真实双轮 PASS 证据

## Final Status

`PASS`

## Notes for Future Features

- 远程项目 Craft 仍 local-only
- 用户数据目录/部分 IPC 名仍可能带 poracode 痕迹
- 全仓 test 未作为本轮关闭证据
