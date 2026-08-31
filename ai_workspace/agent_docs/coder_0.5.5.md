# Coder 交付：v0.5.5 Native Usage Workspace

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
状态：Fix Plan F30/F31 工程实现完成，Ready for Debugger Re-review

## 本轮实现

### F30：inline workspace

- 左下角「模型与用量」入口只切换 `modelUsageDialogOpen` 状态，不再在 `SidebarProviderAccounts` 内挂载内容。
- `MainPageLayout` 在 usage 状态下用 `ModelUsageWorkspace` 替换主内容区，并关闭右侧运行面板；左侧 Sidebar 保持。
- usage workspace 自带标题与返回/关闭按钮，不渲染 HeroUI Modal 或 `role="dialog"`。
- usage workspace 分为主列与右列：主列展示已授权账号/厂商，右列保留完整未授权厂商目录与添加入口。
- 生产树中 workspace 只由 `MainPageLayout` 挂载，避免 Sidebar 与主区重复渲染。

### F31：统一额度卡与主列布局

- 新增 `AccountQuotaCard`：managed Codex/Grok 账号统一展示 `5h 限额`、`周/月限额` 两条长 bar，以及恢复时间、exact per-account 输入/输出 token、账号状态和失败原因。
- 新增 `ProviderQuotaCard`：Kimi 等已授权 provider snapshot 使用相同的长 bar 与底部元数据结构。
- 账号没有 account-scoped quota 或 exact token breakdown 时保持 `--` / 「暂无精确用量」，不把 provider 全局数据复制到账号。
- 用户现场补充要求已落实：主列已授权厂商池使用 `grid-cols-2`，每行两列厂商；厂商池内部账号长条保持整行宽。右侧未授权目录仍为单列。
- 保留 provider 原有真实 CLI/API-key 登录入口，Grok/Codex 仍走 managed profile 登录路径。

## 修改文件

- `src/renderer/views/MainView/parts/MainPageLayout.tsx`
- `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx`
- `src/renderer/views/MainView/parts/Sidebar/parts/ModelUsageWorkspace.tsx`
- `src/renderer/views/MainView/parts/Sidebar/parts/AccountQuotaCard.tsx`
- `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`
- `PROJECT_STATUS.md`

## Regression Validation

- `pnpm exec vitest run src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx --reporter=verbose`
  - 23 tests passed。
  - 覆盖 workspace 切换、无 `role="dialog"`、Sidebar 不重复挂载、主列两列厂商、Grok/Codex managed login、Kimi snapshot 长条卡、失败可见性和 exact token 缺失语义。
- `pnpm run typecheck`
  - 通过。
- 触及文件 `oxlint`
  - 通过。
- 触及文件 `oxfmt --check`
  - 通过。
- `git diff --check`
  - 通过。
- 仓库级 `pnpm run lint`
  - 未全绿；失败来自既有 `src/supervisor/agents/codex/codexRouterOverlay.test.ts:52`，以及工作树中未提交的 `ai_workspace/temp/` 临时脚本/草稿解析与转义问题。本轮触及源码的 lint 已单独通过，未修改或清理这些并行/临时文件。

## 边界与状态

- 未进行真实 Grok billing 探针；真实 billing / exact Token 证据仍 BLOCKED。
- v0.4 F04 仍 FAIL/BLOCKED，不升格为 PASS。
- 未使用 CLIProxyAPI、旧 DSH、Gemini CLI 或 Model API 假 Harness。
- 未读取或导入 Codex Router `xai-*.oauth.json`，未覆盖 `~/.grok`，Renderer 未接触 secret。
- 未 commit、tag、push 或 merge main。

请 Debugger 读取本交付文档与 `PROJECT_STATUS.md`，在 `dev` worktree 执行独立 Re-review。
