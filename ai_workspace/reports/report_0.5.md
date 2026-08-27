# Feature Report — v0.5.0

## Goal

把 CraftStation 的多账号从「selected 首选 / 假绿测」收敛成可审计的 Account Control Plane：

```text
Account
  -> 独立 metadata / secret
  -> managed GROK_HOME / CODEX_HOME
  -> Official Harness Runtime
  -> Session sticky binding
  -> Auto 仅在 exhausted 时按 order 回退
```

Quota 与 Token Usage 分开；Renderer 只看 AccountView。Grok 是黄金真实 E2E。

## Delivered

- T01：AccountFile v1→v2，`pools` 持久化；selected 不再驱动 auto
- T02–T04：provider-scoped Priority / Round-Robin / Random；usable 过滤；sticky；explicit 不 silent fallback
- T05：模型与用量 4 列已认证 + 1 列未认证；DnD 只改展示顺序
- T06：账号行 identity + 2×2 用量格；缺可靠数据为 —
- T07：Grok collectQuota 走 managed GROK_HOME；quota-low 不 fallback
- T08：Tokscale adapter + quality/provenance
- T09：live Session ACCOUNT_LOCKED；per-account refresh lock；managed-only 删除
- T10：两个真实 managed Grok profile 走产品 `craftAgent` 得到非空 official ACP response，并覆盖 sticky / RR / Auto skip / explicit error

## Important Design / Architecture Changes

- 新 Session 的账号来自 launch `accountMode` + 可选 `accountId`，不是 UI selected 标记
- 账号行点击只设置 next-session override
- Session 一旦 bind 就 sticky，直到 close / terminate / 失败释放
- 禁止 CLIProxyAPI、第三方 Grok API、覆盖 `~/.grok` 作为默认切号

## Validation

独立复跑：`pnpm typecheck` 通过；定向 8 files / 144 passed / 1 skipped。

真实产品路径（脱敏）：`ai_workspace/validation/v0.5.2-grok-product-path.json`

- A her `grok:852862f8-…0b52ed32` 与 B hao `grok:071e94ac-…d4707c9b`
- priority-auto / explicit-b 均非空
- explicit 耗尽号 `ACCOUNT_UNAVAILABLE`，未进 ACP
- Auto 跳过耗尽号仍落到 A
- sticky resume 在 pool order 改成 B 后仍是 A
- Round-Robin 两次新 Session 分别是 A / B

## Important Issues and Fixes

- v0.5.0 FAIL：host `~/.grok` probe 不能替代产品路径；Renderer 未传 accountMode
- v0.5.1 FAIL：explicit B 选了已耗尽号，`responseLength=0`
- v0.5.2：改用 available hao 作为 B，补齐 sticky / RR / skip / no-fallback

## Final Status

`PASS` — DEV PASS / USER ACCEPTANCE PENDING

v0.4 Native Multi-Harness 仍 **NOT PASS**。不得把本报告当成五 Harness 完成。

## Notes for Future Features

- live quotaWindows 仍可能为空，UI 应继续显示 —
- Codex 真实双账号不在 v0.5 硬门
- 历史 grok-pending-* 目录可后续清理
- 用户验收后由 Manager 做 dev → main promotion 与正式 tag
