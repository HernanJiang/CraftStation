# Manager Plan — v0.6.0 Native Provider Authentication & Ark Token Plan

状态：`USER ACCEPTED RUNNABLE CANDIDATE / LOCAL MAIN PROMOTION AUTHORIZED / FEATURE GATES BLOCKED`
允许工作树：`D:\Work\CraftStation\craftstation-dev`（`dev`）

## Part I — Ideate Brief

这是独立于 v0.5.7 F33 的新 Feature。目标是：

- Antigravity 使用系统默认浏览器 Google OAuth、localhost/loopback callback、主进程 code exchange、安全存储与额度刷新；禁止内置终端/内置网页登录。
- 删除独立 Gemini usage provider、collector、login、quota card；保留 Gemini CLI agent/runtime、模型/MCP/Skills/session/analytics，并保留 Antigravity 内部 Gemini quota 分组。
- 新增 Volcengine Ark 原生 Token Plan：API Key、AK/SK V4、Coding Plan/Agent Plan、5h/daily/weekly/monthly parser、稳定错误映射与测试。

不使用 CLIProxyAPI，不重写 Gemini CLI 或 Antigravity agent runtime，不改变 Item/Recipe/Crafter ontology，不把未知 Ark endpoint/字段当成事实。

## Part II — Feature Spec & Plan

### Gate Check

Feasibility/Alignment：OK（现有 Antigravity collector、usage IPC、safe storage 与 loopback OAuth 参考可复用）。Practicality：分票据执行。Info Completeness：Ark 官方 endpoint、字段、V4 签名与 Plan API 由 T01 先核验，未知即 fail closed。

### Deep modules

1. Antigravity OAuth Broker：`startLogin/cancelLogin/getAuthState/refresh`；隐藏系统浏览器、state/PKCE/nonce、loopback、exchange、rotation、safe storage 与错误映射。
2. Usage Provider Catalog：独立 Gemini usage 从 descriptor/collector/login/UI catalog 移除，不触碰 Gemini runtime；保留 Antigravity Gemini group。
3. Ark Token Plan Collector：`inspectCapabilities/collect(credentials, clock)`；隐藏官方 endpoint、API Key/AK-SK V4、plan 选择、窗口 parser、normalization 与错误映射。

### Execution order

`T01 -> T02 -> T03 -> T04 -> T05 -> T06 -> T07 -> T08 -> T09 -> T10`。T05、T06 依赖 T01；单 Coder 默认仍按编号执行。T10 后 Debugger 在 dev 独立验收，PASS 只代表 `DEV PASS / USER ACCEPTANCE PENDING`。

### Acceptance gates

- Antigravity：真实系统浏览器 OAuth、正确 state/loopback、主进程 exchange/refresh、安全存储和脱敏 IPC；Gemini 与 Claude & GPT 内部分组可刷新。
- Gemini：独立 usage descriptor/collector/login/quota card 消失；Gemini CLI runtime/MCP/Skills/session smoke 通过；Antigravity Gemini group 保留。
- Ark：官方来源证据、API Key/AK-SK V4、Coding/Agent Plan、5h/daily/weekly/monthly reset、auth/signature/rate-limit/quota/network/unavailable 映射；不得以 fixture 冒充真实 E2E。
- 全局：不引入 CLIProxyAPI；不修改 v0.5.7；不提交 token/account metadata。

### Execution gate

用户已于 2026-08-29 明确要求“现在开始执行”，因此解除本 Feature 的实现阻塞门。该授权仅覆盖在 dev worktree 执行 v0.6.0，不授权 commit、push、tag、dev→main promotion；v0.5.7、F29、Grok 真实额度与 v0.4 F04 的历史质量状态保持不变。

完整 Manager 说明见根治理仓 `D:\Work\CraftStation\ai_workspace\agent_docs\manager_0.6.0.md`；本文件是 dev worktree 的执行入口。Tickets 位于 `D:\Work\CraftStation\craftstation-dev\.scratch\craftstation-0.6.0\issues\`。

## Part III — Accepted Candidate Closeout（2026-08-31）

用户已在原生 Electron 应用中完成当前候选的手动验收，并明确授权 Manager 执行本地 `dev -> main` 收口。

本次授权的准确语义：

- 接受当前可运行候选，允许完整归档 Dev 的已验收源码、测试、正式文档和依赖变更。
- 允许以 fast-forward 方式提升到本地 Main，并创建清晰标注的 accepted-candidate checkpoint tag。
- 不允许 push GitHub；不创建正式 `v0.6.0` PASS tag。
- 不改变 Debugger 对 v0.6.0 的 `FAIL / BLOCKED` verdict：F35 真实 Antigravity Google OAuth E2E 与 F36 真实 Ark 线上凭据仍打开。
- F33 Grok 真实 billing、F29 exact Token、v0.5.0 与 v0.4 F04 继续 `FAIL / BLOCKED`。

运行缓存、Cookie、账号或凭据材料、`ai_workspace/temp/`、未跟踪的 `ai_workspace/validation/` 运行产物、误生成目录和一次性 Ticket 草稿不进入 Git；它们在收口时移到仓库外可恢复隔离区。
