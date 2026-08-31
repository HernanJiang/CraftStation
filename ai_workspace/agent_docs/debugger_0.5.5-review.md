# Debugger — v0.5.5 Re-review

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + 未提交 v0.5.3/v0.5.4/v0.5.5）
>
> Coder 交付：[coder_0.5.5.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/coder_0.5.5.md)
>
> Fix Plan：[debugger_0.5.5.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.5.md)
>
> Verdict：**FAIL / BLOCKED**（F30 / F31 工程项关闭；Feature 不能 PASS）
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。真实 Grok billing / exact Token 本轮仍不是完成条件。不启动 v0.5.6 代码 Fix Cycle。

## Review Scope

独立复检 Coder v0.5.5 对 F30 / F31 的修复，不以 Coder 自检代替质量门。Computer Use 本轮 kernel 失败，产品壳层以源码 + 定向测试为准，不伪装点过现场窗口。

## Independent Validation / Evidence

- 定向 Vitest：`SidebarProviderAccounts.test.tsx` **23 passed**
- `pnpm exec tsc --noEmit -p tsconfig.json`：**通过**
- 触及文件 type-aware oxlint：**通过**
- 触及文件 `oxfmt --check`：**通过**
- 触及文件 `git diff --check`：**通过**
- Computer Use：本轮 node_repl / @oai/sky kernel 报 failed to write kernel assets，未能再次点击现场窗口。生产接线以源码为准。
- `pnpm dev` 已在跑，不再要求用户先起服务。

## Spec Fidelity

- F30：点左下角「模型与用量」不应再弹 Modal；主区 + 右侧栏整块切成账号/额度 workspace。源码路径成立。
- F31：每个已授权账号按 Kimi 长条展示 5h 限额 + 周/月限额，底部一行恢复时间 / 输入 token / 输出 token / 状态。源码路径成立。
- 主列已授权厂商为 `grid-cols-2` / `data-layout=two-column`。
- F25 右列完整内置目录保持。
- 真实 Grok billing / F29 exact Token / v0.4 F04 仍不满足 Feature PASS。

## Integration / Regression / Edge Cases

- Sidebar 入口只 `openModelUsageDialog()`，不挂 HeroUI Modal。
- `MainPageLayout` 在 `modelUsageDialogOpen` 时：`content=<ModelUsageWorkspace />`，`rightPanel=null`，`rightPanelOpen=false`，左侧 Sidebar 保留。
- `ModelUsageWorkspace` 是普通 `div[data-testid=model-usage-workspace]`，无 `role=dialog`。
- managed Codex/Grok 走 `AccountQuotaCard`；Kimi snapshot 走 `ProviderQuotaCard`；不再用 2x2 `AccountUsageGrid` 作主展示。
- managed token 只读 `tokenUsageStore.response.summaries.byAccount` 且 `quality != estimated`；测试锁定 provider-wide `42%` 不得出现在账号卡。
- 残余（不升格为强制 Fix Cycle）：`closeAllPanels()` 不清理 `modelUsageDialogOpen`；`AccountQuotaCard` 会显示 derived 品质数字；`ProviderQuotaCard` 读 `snapshot.tokens.input/output`。

## Findings

1. F30 / F31 产品壳层工程项 **关闭**。
2. Feature v0.5.0 **不能 PASS**：真实 Grok billing 仍 unavailable/network；F29 exact Token 证据未关闭（`tokens_v2` 仍空）；v0.4 F04 仍 FAIL/BLOCKED。
3. Computer Use 本轮不可用，不伪装现场点击证据。
4. 不启动 v0.5.6 代码 Fix Cycle；F30/F31 壳层不再打回 Coder。

## Verdict

`FAIL / BLOCKED`

- F30 工程项：**关闭**
- F31 工程项：**关闭**
- Feature v0.5.0：**不能 PASS**
- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- 不启动 v0.5.6 代码 Fix Cycle
- 未授权 commit / push / merge main / 正式 tag

## Fix Plan

不启动新的代码 Fix Cycle。F30 / F31 壳层已关闭。剩余门禁是真实 billing / exact Token / v0.4 F04，不能用 synthetic PASS 或再打壳层迭代解决。

## Fix Acceptance Criteria

- 官方 Grok billing 可连通，产品路径能展示可用的 5h / 周额度而不是 unavailable/network 占位。
- F29 存在非空、非 estimated 的 per-account exact Token 证据（`tokens_v2` / byAccount）。
- 不要把 F30/F31 壳层或测试绿灯当成 Feature PASS。
- v0.4 F04 仍 FAIL/BLOCKED，不得升格。

## Fix Execution Order

1. Coder 停着，不要开 v0.5.6。
2. 等待可连通的官方 Grok billing 与一次真实 managed turn。
3. Debugger 再做产品级额度 / Token 复检。
4. 仍不得 commit / push / merge main / 打正式 `v0.5.0` tag。

下一步：等待可连通的官方 Grok billing 与一次真实 managed turn，再做产品级额度/Token 复检。F30/F31 产品壳层不再打回 Coder。
