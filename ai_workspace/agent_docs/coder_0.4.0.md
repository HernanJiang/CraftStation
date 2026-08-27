# Coder — v0.4.0

## 当前职责与边界

本报告对应 Manager `v0.4.0 — Multi-Account Pool, Provider Quota & Token Usage Control Plane`。本轮 Coder 负责后端与 shared control-plane 实现；并行 frontend task 负责右侧多工具、Composer 和 Git Review 文件，因此本 Coder 后续未修改 `UnifiedRightPanel.tsx`、`ThreadView.tsx`、`DraftContextBar.tsx`、`ThreadComposerSection.tsx`、`UniversalDockedChatInput.tsx`、`AppShell.tsx`、`GitReviewPanel.tsx`、`GitReviewSidebar.tsx` 和 `BranchSyncGraph.tsx`。

T01-T10 的实现与自动化自检已完成，Feature 仍未由 Coder 宣称最终 PASS；真实双 profile 验收和 Debugger review 仍是质量门。

本轮修复循环继续完成了后端/shared 的验收缺口修复：Account Store 的读改写现统一在排他锁内完成；selected 账号被删除或禁用时会原子选择下一个 enabled 账号；Resolver 的 ordered auto 选择返回正确的 `priority-fallback`，selected 账号处于非 fallback 错误状态时停止。Native Codex usage 通知已改为统一 `usage.spent` 累计 contract，并与 native runtime 保持 legacy Codex 模块隔离。

## 已完成切片

### T01 — Repository Audit

- 审计记录：[v0.4.0_t01_repository_audit.md](../validation/v0.4.0_t01_repository_audit.md)
- CodeGraph：2,870 files、39,951 nodes、149,992 edges；同步后 index up to date。
- 根仓库与产品 Working Copy 的 v0.3.2 PASS 基线、远端限制和 ownership 已记录。

### T02 — Peripheral Sidecar

- 新增 `native/peripheral-sidecar` Rust crate。
- versioned JSONL contract：`protocolVersion`、`requestId`、`method`、`params`、`result/error`。
- stdout 仅协议，stderr 仅诊断；TypeScript client 支持 correlation、timeout、crash、restart、shutdown。
- 真实 smoke 已通过：`ping`、`version`、`shutdown` 三帧正确返回，进程正常退出。
- `cargo check` 与 `cargo build --release` 通过。

### T03 — Token Usage

- 新增 `TokenUsageSummary`，显式区分 `source`、`quality`、`coverage`、period 和 unavailable reason。
- `RuntimeLedgerTokenUsageScanner` 保留 exact Runtime Ledger 语义；Tokscale/peripheral scanner 作为 derived/estimated 并列来源。
- scanner 不可用时返回 unavailable，不把 0 伪装成真实使用量。
- exact scanner 现在提供 tool/model/project/session/account 五类 breakdown；生产 Supervisor 通过只读 `state.sqlite` reader 消费现有 `tokens_v2` ledger，不创建第二套账本。
- `usage_events` 新增四个维度列；migration v36 与 safe schema drift repair 同时覆盖旧数据库。

### T04 — Account Store / Resolver

- 新增 provider-agnostic `AccountStore`、`AccountView`、`AccountResolver`。
- metadata 与 credential material 分离；AccountView 不包含 credentialRoot、token 或 raw auth。
- 支持 0/1/N、selected、enabled、priority order、remove、状态更新、原子 projection、backup/recovery、stale lock recovery。
- Windows 物理 profile 目录与逻辑 accountId 分离，避免 `:` 进入 NTFS 目录名。
- resolver 规则：explicit > selected > ordered；explicit unavailable 不 fallback；quota-low 不 fallback；quota-exhausted/auth-expired/unavailable 才可 auto fallback；transient/error 停止并保留诊断。
- metadata mutation 的 read/modify/write 已统一锁内执行，避免多实例 stale snapshot 丢更新；删除/禁用 selected 账号的选中状态保持一致。

### T05 — Shared IPC / State Stores

- 新增 account list/add/remove/select/order/enable/resolve、Token Usage get/refresh、Codex profile create/import/quota-refresh procedures。
- Supervisor handlers 保持 thin delegate。
- 新增 renderer `usageAccountsStore` 与 `tokenUsageStore`，并接收 supervisor `usage-accounts` / `token-usage` events。
- 旧 `providerUsageStore` 和 provider quota procedures 保持兼容。
- 复用既有 Sidebar Provider Accounts 入口增加 Codex account list、auth.json import、selected、drag reorder、quota refresh 和 Token Usage 来源/质量展示；没有创建第二个 AccountsManager 入口。
- 前端 T06 并行任务已完成并完成整合回归；统一 Composer、右侧多工具 dock、Git Review 左右布局、窄窗布局和 Composer Git/分支入口均通过对应专项测试。

### T07/T08 — Codex Profile / Session Binding

- `resolveCodexToken({ codexHome, allowWslFallback })` 支持 managed profile scope；managed profile 禁止 WSL fallback。
- `CodexProfileService` 支持 auth.json import、managed projection、profile create、Codex quota collector 与状态分类。
- 新 Codex CraftAgent 在 spawn 前解析 Account，给 official app-server host 设置受管 `CODEX_HOME`；binding 保存在 Entity metadata，运行期不热迁移。
- Thread 的 `account_binding` 已加入 SQLite schema、migration、普通 upsert、全量 sync 和安全 row mapping，重启/resume 不再丢失 sticky account binding。
- native app-server 的 token usage event 读取 `total.totalTokens`（兼容旧版累计组件计数），不使用 per-turn `last` 计数，支持 counter reset epoch 与 fresh baseline。
- 初始 native usage event 直接携带 launch accountId，避免 Thread 写回稍晚时丢失账号归属。

### T09/T10 — Adapter / Packaging / Guards

- 新增 `ProviderAccountAdapterRegistry`，隐藏 provider-specific identity/credential/quota/launch environment。
- 新增 Core ontology guard：Crafting core 不导入 Account/Token/sidecar；Codex official runtime 不导入 CLIProxyAPI。
- 新增 sidecar staging script 与 Electron `extraResources` staging。
- `scripts/build-desktop-artifact.mjs --skip-build --check-runtime-deps` 通过；sidecar 已在 Windows x64 生成 staging binary。
- `appendUsageEvents` 已明确登记为 device-owned local procedure，修复远程路由完整性回归；sidecar 构建目录和 staging binary 已加入 `.gitignore`，可由准备脚本重建。
- ACP capability probe 的 Windows 进程树回收改为非阻塞 taskkill，避免 teardown 延长调用方 timeout。

## 实际验证

- TypeScript `tsc --noEmit -p tsconfig.json`：PASS（串行恢复 codex-protocol generated 目录后验证；使用本地 `node_modules/.bin/tsc.cmd`，规避 dev watcher 触发 pnpm postinstall）。
- 新增/受影响控制面、Native Codex、UsageService、Crafting boundary、Supervisor、Sidebar account UI、Thread/Composer、UnifiedRightPanel、GitReview 和 App 回归测试：20 个测试文件 / 169 个测试 PASS。
- 修复循环后端/数据库/native/sidecar/boundary 回归：13 个测试文件 / 295 个测试 PASS；包含 Native Codex account usage、Thread binding persistence、ACP probe stress、process tree 和 remote procedure routing。
- 最新工作树全量 `pnpm exec vitest run --configLoader runner`：845 个测试文件 PASS、8 个 SKIP；9,487 个测试 PASS、46 个 SKIP（账号归属补丁前的完整 suite）。账号归属补丁后的 13 文件 / 295 测试 targeted 回归同样通过。
- `cargo check` 与 `cargo build --release`：PASS。
- 全项目 `oxlint --deny-warnings .`：PASS；受影响范围 `oxfmt --check`：PASS；`git diff --check`：PASS。
- touched backend/shared format：PASS；`git diff --check`：PASS。
- packaging runtime dependency dry-run：PASS，15 emitted runtime dependencies validated。
- CodeGraph sync：2,870 files、39,951 nodes、149,992 edges；index up to date。
- 真实 sidecar JSONL smoke：`ping`、`version`、`shutdown` 三帧通过，stderr 诊断未污染 stdout 协议。

## 已知未完成项

- T06 的右侧多工具/Composer/Git Review UI 已由并行 frontend task 完成；本 Coder 已完成最终集成回归。
- 为恢复全局 typecheck，曾对并行 frontend 正在修改的 `GitReviewPanel.tsx` 做过一次最小兼容修复（补回 `wrapLines`/`WrapText`）；已向并行 Agent 明确告知，后续不再触碰该文件。
- 真实双 profile 官方 CLI login/import、per-account quota、sticky Session、quota-exhausted fallback 仍需在有真实账号的环境执行；没有凭据时不得用 synthetic PASS。
- 完整 desktop build/install matrix（Windows x64/arm64、macOS、Linux）尚未在本轮本机执行。
- 本轮未执行 commit/tag/push；`native/peripheral-sidecar/target/` 与 `resources/peripheral-sidecar/` 是已忽略、可重建的本地构建产物，不作为源码交付。

## 交接状态

T01-T10 实现与自动化自检已完成，当前状态为 `READY FOR DEBUGGER REVIEW`。真实双 profile quota/sticky/fallback 需要有真实凭据的人工验收；没有凭据不得用 synthetic PASS 替代。
