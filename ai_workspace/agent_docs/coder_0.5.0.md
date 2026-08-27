# Coder — v0.5.0 Account Pool + Quota + Token Usage Stabilization

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Coder
>
> 日期：2026-08-28
>
> 状态：按 `manager_0.5.0.md` Part II 与 `.scratch/craftstation-0.5.0/issues/01-…10` 一次性连续完成 T01→T10 工程与自检；T10 真实双账号独立 profile E2E 因本机缺少第二个官方 Grok 身份而 **BLOCKED**，Feature 保持 **NOT PASS**，等待 Debugger 独立复检。

## 输入与边界

- Manager 文档：`ai_workspace/agent_docs/manager_0.5.0.md`（Part I Ideate + Part II Plan）
- Tickets：`.scratch/craftstation-0.5.0/issues/01-audit-baseline.md` … `10-grok-e2e.md`
- 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `be8d8c2`）；未修改 main。
- 约束遵守：不复活 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness；不读取、复制或导入 Codex Router `xai-*.oauth.json`、cookie 或 token；不覆盖 host `~/.grok/auth.json`；Account/Quota/Token 保持外围能力，未进入 Item/Recipe/Crafter/Core ontology；Renderer/IPC/logs 不泄露 secret 或物理路径；F04/v0.4 保持 BLOCKED。
- 未执行 commit / tag / push；本交付供 Debugger 复检。

## T01 — Audit baseline 与迁移契约

- 建立 v0.5 Gap Matrix（`AccountStore` 持久化/atomic write/backup = DONE；selected 语义 = FIX；provider-scoped scheduling = MISSING；quota-low 过滤 = FIX；Provider 展示顺序 = FIX；Identity/alias = FIX；2×2 usage grid = MISSING；provider-aware quota = FIX；Tokscale seam = FIX；active-binding 删除防护 = MISSING）。
- AccountFile 升级 `version 1 → 2`：新增 `pools`（provider-scoped scheduling 状态），迁移时写回磁盘；`read()` 兼容 v1，`writeUnlocked` 恒写 v2。
- 保留 legacy `selected` 字段仅用于向后兼容读取，明确注释 deprecated；产品层不再提供「设为首选」语义。
- 负向测试：v1→v2 迁移落盘、`AccountView` 不投影 `credentialRoot`/secret、path escape 拒绝。
- 证据：`accountStore.test.ts`（13 passed）含「promotes a legacy v1 metadata file to v2」与「never projects secrets into AccountView across reopen」。

## T02 — Account Pool scheduling contract

- 新增 `accountSchedulingModeSchema`（`priority | round-robin | random`）、`ProviderPoolConfig`、`accountPoolConfigPayloadSchema`。
- `AccountStore` 新增 `poolConfig` / `setPoolSchedulingMode` / `advanceRoundRobinCursor` / `resetRoundRobinCursor`，持久化到 AccountFile v2 `pools`。
- `AccountResolver` 重写为 provider-scoped 调度：`explicit` 永不 silent fallback；`auto` 按持久化 scheduling 模式（priority 按 order、round-robin 持久 cursor、random usable-only）。
- usable 过滤：`enabled && (available | quota-low)`；`disabled / quota-exhausted / auth-expired / unavailable / error` 跳过并保留 candidates 诊断；`quota-low` 不 fallback。
- 稳定错误：explicit 不可用 → `ACCOUNT_UNAVAILABLE`；pool 无可用 → `ACCOUNT_POOL_EXHAUSTED`。
- IPC：`setAccountPoolScheduling` / `getAccountPoolScheduling`；runtime + ipcHandlers 接线。
- 证据：`accountResolver.test.ts`（10 passed）覆盖 priority / round-robin 环 / random usable-only / pool exhausted / persisted scheduling / explicit sticky。

## T03 — Priority tracer 与 Session sticky

- `createCraftingAdapter` 移除 `selectedAccountId` 依赖，auto 完全由 provider-pool scheduling 驱动；explicit 仅存在于 per-session override。
- `craftAgent` / `resumeCraftAgent` 在创建 binding 时向 `activeAccountBindings` 注册，保证已绑定 Session 不因后续 UI 变化换号。
- resume/restart 通过 `thread.accountBinding.accountId` → explicit 保持原 binding（v0.5 语义）。
- 证据：`runtime.test.ts`「Grok account control plane」（7 passed）覆盖 priority 绑定 / explicit 绑定 / auto-fallback / 402 duck-type 状态落盘 / explicit 不 fallback / sticky。

## T04 — Round-Robin / Random

- Round-robin：持久化 cursor，从 cursor 之后（不含）按 order 找下一个 usable，A→B→C→A；非 usable 跳过不破坏环。
- Random：只从 usable pool 用 `randomInt` 选择，不依赖具体随机序列。
- 重启后 cursor 从持久化 `pools.roundRobinCursor` 恢复；无 cursor 首轮选 order[0]。
- 不破坏 sticky：新 Session 才推进 cursor，已绑定 Session 不动。
- 证据：`accountResolver.test.ts` 中 round-robin 环 / 跳过非 usable / random usable-only / cursor 持久化。

## T05 — Provider presentation order 与 4/1 UI

- 修复 `ModelUsageDialog` 中 Codex/Grok 账号池 `onDrop` provider 参数接反（codex pool 传 "grok"、grok pool 传默认 "codex"）→ 各自正确。
- `ModelUsageDialog` 未认证 Provider 卡片改由 `resolveDisplayedProviders(providerOrder, disabledProviders)` 渲染，与 RightPanel 共用 `usage.providerOrder`（已持久化，重启恢复）；DnD 只改展示顺序，不影响 runtime selection。
- `ProviderCard` 增加可选 `index` / DnD props，dialog 内支持拖拽持久化展示顺序。
- 4/1 布局保持：已认证 pool（`col-span-2`）左侧、未认证 card（`col-span-1`）右侧。
- 证据：`SidebarProviderAccounts.test.tsx`（15 passed）覆盖 grid 4 列、已认证 2 列、紧凑卡选号/改名、Grok 设备登录不打开 grok.com。

## T06 — Identity、alias 与 Account Row 2×2

- `AccountRow` 改为真实 identity（maskedIdentity/providerAccountId）主文字 + alias（label）副文字。
- 移除「首选/设为首选」按钮（v0.5 废除 preferred 语义）。
- 默认 alias 契约：`AccountStore.add` 对占位 label（`New Grok` / `New Codex` / 空）改写为 `<Provider> Account N`；显式 label 保留。`GrokProfileService.importAuthJson` 同步。
- 新增 `AccountUsageGrid`（独立组件）2×2：额度 / Token / 缓存 / 状态；无可靠 cache 显示 `—`（不伪造比例）。
- 证据：`SidebarProviderAccounts.test.tsx` 新增「identity 主/alias 副」与「2×2 grid 无 cache 显示 —」；`accountStore.test.ts` 默认 alias；`grokProfiles.test.ts` import 默认 alias `Grok 1`。

## T07 — Account-scoped quota/status/reset

- `GrokProfileService.collectQuota`：仅读 managed `GROK_HOME/auth.json` + `collectGrok` + scoped host credentials，映射 snapshot → account status（ok→available/quota-low、quota-hit→quota-exhausted、auth-missing→auth-expired、rate-limited→quota-low、error→error），A/B 隔离。
- `supervisorRuntime.refreshAccountQuota` 改为 provider-aware 路由：Grok 行走 `grokProfileService`，其余走 `codexProfileService`（修复 Grok 行错用 Codex collector）。
- quota-low 不 fallback（resolver）；reset 后 refresh 恢复 available（collectQuota ok 映射）。
- 证据：`grokProfiles.test.ts` T07 测试（9 passed）；`runtime.test.ts` provider-aware。

## T08 — Tokscale adapter 与 packaging

- `TokenUsageAdapter.inspectCapabilities()` 新增：返回 `source / quality / available / locating`（`dev-path | packaged-resource | runtime-ledger`）。
- `TokenUsageScanner` 接口增加 `locating`；`RuntimeLedgerTokenUsageScanner`（exact / runtime-ledger）与 `PeripheralTokenUsageScanner`（exact / packaged-resource）标注。
- contract `TokenUsageCapabilities` + IPC `getTokenUsageCapabilities` + runtime/ipcHandlers 接线。
- 质量/来源透传与 provenance 保持：exact vs estimated 不混；unavailable 显式标记，不伪装零用量。
- 证据：`tokenUsageAdapter.test.ts`（8 passed）含 capabilities 探测与 exact/estimated 隔离。

## T09 — Security、删除与 refresh hardening

- active Session binding 防 dangling：`removeAccount` 在 `activeAccountBindings.has(accountId)` 时抛 `ACCOUNT_LOCKED`（live Session 使用中不可删）。
- managed-only 删除：`accountStore.remove` 仅 `rmSync` managed credentialRoot，不触碰用户原始 `~/.grok` / `~/.codex`。
- per-account refresh lock：`refreshAccountQuota` 同账号并发合并为一次 collector 调用。
- atomic write / backup / lock 复用既有机制；secret 不投影。
- 证据：`runtime.test.ts` T09（3 passed）覆盖 active-binding 删除防护、unbound 可删、并发 refresh 合并。

## T10 — Grok 双账号真实 E2E 与回归

**状态：BLOCKED / NOT PASS（双账号独立 profile E2E 未取得完整证据）。**

- 本机真实环境：官方 `grok 1.0.5` 已装，host `~/.grok/auth.json` 存在（1 个官方身份，cached_token）；managed `craftstation-accounts` 下的 Grok profile 目录均为**空壳**（无 `auth.json`），无法作为第二个真实官方身份。
- 已做**单账号真实官方 probe**（`ai_workspace/validation/grok_real_probe.cjs`，证据 `v0.5.0-grok-real-probe.json`）：
  - `initialize` → `session/new` → `session/prompt` 全部成功；
  - 真实模型 `grok-4.6`，`stopReason: end_turn`，真实用量 inputTokens ≈ 18180 / outputTokens ≈ 34 / totalTokens ≈ 18207，requestId / apiDurationMs 已记录；
  - 证据含 authMethods（cached_token from `~/.grok/auth.json`），未读取/输出任何 secret。
- 约束：**缺少第二个真实官方 Grok 身份**，无法证明「两个账号独立 GROK_HOME → Official Grok Runtime → Session sticky」全链路；未用 fixture/mock 冒充，未声称 Feature PASS。
- 回归：相关 9 个测试文件 145 passed；`pnpm typecheck` 通过；`pnpm lint` 仅剩 1 个**预存** `codexRouterOverlay.test.ts:52`（`git diff HEAD` 确认非本轮改动，v0.4.12 冻结时已存在，未扩大范围修改）。

## Feature-level Self-check

| 检查                                         | 结果                          |
| -------------------------------------------- | ----------------------------- |
| T01 迁移契约 + 负向测试                      | PASS                          |
| T02 scheduling contract + 稳定错误           | PASS                          |
| T03 Priority/sticky + explicit               | PASS                          |
| T04 RR/random + cursor                       | PASS                          |
| T05 展示顺序 + 4/1 + DnD 不影响 runtime      | PASS                          |
| T06 identity/alias + 2×2 grid                | PASS                          |
| T07 provider-aware quota + reset             | PASS                          |
| T08 inspectCapabilities + quality/provenance | PASS                          |
| T09 active-binding 防护 + refresh lock       | PASS                          |
| T10 真实 Grok 双账号 E2E                     | **BLOCKED（缺第二官方身份）** |
| typecheck                                    | PASS                          |
| lint                                         | 1 个预存错误（非本轮）        |
| 定向 + 相关回归测试                          | 145 passed                    |

## 未宣称项

- 未宣称 v0.5 Feature PASS（T10 双账号真实 E2E BLOCKED）。
- 未宣称 v0.4 五 Harness Feature PASS（F04 仍 BLOCKED）。
- 未进入 v0.5.1 或后续 Fix Cycle；等待 Debugger 独立复检后按结论推进。
