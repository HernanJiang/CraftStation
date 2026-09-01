# Coder 交付：v0.5.8 F33 Grok 真实额度 —— 代理感知 HTTP 修复

日期：2026-08-28
工作树：`D:\Work\CraftStation\craftstation-dev`
分支：`dev`
状态：F33 根因已修复，真实 managed probe 取得数字窗口；交 Debugger 独立复检

## 本轮范围

只修 F33 的真实根因。v0.5.7 已把 native RPC → token billing fallback 的工程链路接好，但真实 managed probe 仍返回 `errorClass=network`。本轮定位并修复了为什么 token-monitor 能拿到数据而我们拿不到。不重开 F32/F34，不扩大到 F29 exact Token 或 v0.4 五 Harness。

## Root Cause

本机 `HTTPS_PROXY=http://127.0.0.1:7897` 是常驻环境变量；`cli-chat-proxy.grok.com` 与 `grok.com` 必须经本地代理才能连通。

- 直接 `fetch("https://cli-chat-proxy.grok.com/v1/billing?format=credits")` → 超时中止（直连被断）。
- 同一地址经 `EnvHttpProxyAgent` → 连通并返回 `401 Invalid or expired credentials`（端点可达，只差凭据）。

`src/supervisor/runtime/usageHttpClient.ts` 用的是 Node global fetch，而 **Node 的 global fetch（undici）从不自动应用 `HTTP(S)_PROXY`**。token-monitor 的 `src/shared/outboundFetch.js` 正是为解决这一点：检测标准代理环境变量后用 undici `EnvHttpProxyAgent` 发起请求。我们抄了它的 billing 端点和 header 语义，却漏了让它真正出网的这一层，于是所有 https 请求在超时后被分类成 `network`。

## 修复（自实现，只参考思想）

- `src/supervisor/runtime/usageHttpClient.ts`
  - 新增 `resolveProxyConfig(env)`：剥离 shell 引号、lowercase 优先于 uppercase、`ALL_PROXY` 兜底；无代理配置时返回 `undefined`，保持原 global fetch 直连路径不变。
  - 显式出现（哪怕为空）的 `no_proxy`/`NO_PROXY` 会传给 dispatcher，避免被 ambient 进程级 `NO_PROXY` 意外绕过。
  - 有代理配置时经 undici `EnvHttpProxyAgent` 发请求；`NO_PROXY` 按请求逐条生效。该 client 同时服务 usage collectors、Claude OAuth refresh 与 Grok token refresh，全部获得代理感知。
  - 错误分类不变：abort 仍映射为 typed `UsageHttpError("timeout")`。
- `package.json`：`undici ^7.29.0` 提升为显式 dependency（此前只是 dev transitive）。已 `pnpm install --ignore-scripts` 更新 lockfile 并链接。
- 已知小噪音：`EnvHttpProxyAgent` 目前带 undici experimental warning（每进程一次），不影响功能。

## Regression Validation

- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/usageHttpClient.test.ts` — 7/7 通过
  - `resolveProxyConfig` 规范化、优先级、`ALL_PROXY` 兜底；
  - 本地 CONNECT 隧道代理集成：显式空 `no_proxy` 时请求确实经过代理（计数断言）；
  - `NO_PROXY` bypass、无代理直连、timeout → `UsageHttpError`。
  - 注：undici `ProxyAgent` 对 http 目标同样走 CONNECT 隧道，测试代理实现了 `connect` 事件。
- `pnpm exec vitest run --configLoader runner src/supervisor/runtime/grokProfiles.test.ts src/supervisor/runtime/grokQuotaTokenFallback.test.ts` — 22/22 通过。
- `pnpm typecheck` — 通过。
- `pnpm exec oxlint --deny-warnings` 本轮改动文件 — 无告警。全仓 `pnpm lint` 仍有 `ai_workspace/temp/` 遗留脚本与 `codexRouterOverlay.test.ts` 的既有报错（均非本轮引入，untracked/checkpoint 遗留）。

## 真实 managed probe（关键证据）

命令（opt-in 环境变量门控，不落凭据）：

```powershell
$env:CRAFTSTATION_REAL_GROK_PROBE="1"
$env:CRAFTSTATION_GROK_ACCOUNT_ID="grok:071e94ac-5fda-4611-a0c8-b529d4707c9b"
$env:CRAFTSTATION_GROK_STORE_ROOT="C:\Users\Haona\.craftstation-dev\craftstation-accounts"
$env:CRAFTSTATION_GROK_PROBE_OUTPUT="...\validation\v0.5.8-grok-quota-probe.json"
pnpm exec vitest run --configLoader runner src/supervisor/runtime/grokQuotaRealProbe.test.ts
```

结果：`status=quota-low`，`quotaWindows=[{ id:"weekly", label:"Weekly credits", usedPercent:94, resetsAt:1788173523816 }]`，`hasLastError=false`，`managedHome=true`，`hostHomeUsed=false`，`synthetic=false`。链路为 managed 官方 CLI `x.ai/billing`（本机 CLI 不支持，`unsupported-method`，不再伪装成 network）→ managed token billing fallback（Bearer → `cli-chat-proxy.grok.com/v1/billing?format=credits`），经系统代理出网成功。

脱敏证据：[v0.5.8-grok-quota-probe.json](../validation/v0.5.8-grok-quota-probe.json)。只含 provider、截断 accountRef、maskedIdentity、managed/host/synthetic 标志、状态、窗口 metadata，不含 token、cookie、auth 内容或物理凭据路径。

## 环境注意事项（交接给后续角色）

- dev app 运行期间执行 `pnpm install` 会在 `@craftstation/codex-protocol` 的 postinstall `generate.mjs` 处 EPERM（`generated.tmp → generated` rename 被 watcher 占用）。本轮已用 copy 恢复 `generated/` 并用 `--ignore-scripts` 完成安装；后续正常 install 前建议先关闭 dev app。
- 运行中的 dev app 仍是旧代码；要在 UI 上看到 Grok 额度数字，需要重启 dev app 后点左下角「模型与用量」。

## Findings 状态

- F33：根因（代理感知缺失）已修复，真实 managed probe 取得 `weekly 94% / resetsAt` 数字窗口。是否 PASS 由 Debugger 独立复检决定。

## 追加：v0.5.8 UI 验收修复（同 Fix Cycle）

用户现场验收指出三个 UI 问题，本轮一并修复：

1. **厂商 logo 单色化**：v0.5.6 修 logo 时工作区自带了一个只调单色 `ProviderIcon` 的本地 `ProviderBadge`，没有用 `SidebarProviderAccounts.tsx` 里已有的彩色品牌体系（官网资产 + 每品牌底色）。已抽出共享模块 [providerBrands.tsx](file:///D:/Work/CraftStation/craftstation-dev/src/renderer/views/MainView/parts/Sidebar/parts/providerBrands.tsx)（`PROVIDER_BRANDS` + `ProviderBrandBadge`，尺寸 avatar/compact/card/row），侧栏与工作区统一复用：Claude/Gemini/Kimi/Qwen/Command Code/Antigravity/z.ai 等显示官网彩色资产，OpenAI/X/Cursor/Copilot/Droid 等官方单色品牌用品牌底色保证深色下可读；Grok 保留 CraftStation 自有 X 字形。本地资产已齐，无需新下载。
2. **账号池卡片太长**：`ManagedAccountPool` 账号列表从 `space-y-2` 单列改为 `grid grid-cols-2 items-start gap-2`，每行两张账号卡，高度减半。
3. **右栏厂商名截断**：右栏 `w-[220px]` → `w-[296px]`，厂商卡名 `text-sm` → `text-[13px]`。

CDP 实测（`--remote-debugging-port` 验证脚本，已删除）：13 张厂商卡 `truncated=false`（含最长的 "Alibaba Token Plan"），账号池 `grid-cols-2` 生效 6 账号，13 个彩色品牌徽标渲染，真实额度百分比 54/100/90/94/100/54（两次采样 89→90 说明在实时刷新）。

回归：`SidebarProviderAccounts.test.tsx` 24/24（badge 断言改为 `data-provider-logo`，Grok 字形回退保留断言）；`pnpm typecheck` 干净；改动文件 oxlint 无告警。账号行徽标不再重复 `provider-badge-*` testid（行级用 `account-provider-icon-*`）。

## 追加二：v0.5.8 UI 验收第二轮（布局归属 / 全称邮箱 / 统一操作行 / Antigravity / 拖拽排序）

用户第二轮验收提出 7 点，全部修复并 CDP 实测：

1. **ChatGPT 卡归位左侧**：根因是「经宿主快照已授权、但无 managed 池账号」的 codex/grok 只按 `signedInAccounts.length === 0` 判定，被渲染进右侧未授权栏。现按快照授权态分流：`leftCardProviders`（codex/grok 快照卡 + 已授权其他厂商）统一渲染进左侧两列 grid；右侧仅放真正未授权的。工作区打开时新增 `getProviderUsage({})` 缓存补水（此前依赖侧栏 rail 挂载才填 store，整页重载后右侧会卡住），此后任何提供商一旦授权即自动从右侧移到左侧。
2. **邮箱全称**：账号池行显示从 `maskedIdentity` 优先改为 `providerAccountId`（完整邮箱）优先并加 `title` 悬浮提示；store 仍保留 masked 字段兼容，仅 UI 不再打码。宿主绑定的 ChatGPT 卡原来连邮箱都没有——`parseCodexAuth` 新增解码 `auth.json` 里 `tokens.id_token` 的 JWT payload 提取 email（`codexEmailFromIdToken`），`OAuthToken` 增加 `email` 字段，codex collector 把它写入快照 `authenticatedAs`。真实强制刷新验证：`status=ok, authenticatedAs=poise.johnson@gmail.com, plan=ChatGPT Plus`。
3. **统一第一行操作**：宿主绑定卡（ChatGPT/Kimi 等）第一行改为与 Grok 池账号行一致：品牌图标 + 邮箱全称 + 状态徽章 + 行内刷新按钮（`refreshAndMergeProviderUsage`），支持登出的厂商再给行内移除按钮（原 Dropdown 菜单删除）。注意：宿主会话型绑定（如本机 ChatGPT 登录）`canSignOut=false`，停用/删除只适用于 managed 池账号，宿主卡只有刷新——这是账号模型差异，非遗漏。
4. **Antigravity 适配**：scanner 本就返回 `status=app-not-running`（LS-only 设计，注释明确不 fallback 到 `agy` 的 Cloud Code 面），但 UI 仍显示「登录/授权」且点了会跑 `agy` 卡死。现在该状态下隐藏登录按钮，显示「应用未运行，启动 Antigravity 后将自动读取额度」。快照由 supervisor 每 ≥2 分钟自动刷新广播补上。
5. **新授权自动放左侧**：由 usage snapshot store 驱动，授权态变化自动迁移（见 1）。
6. **账号自动补位**：左右两栏均为 grid/flex 流式布局，卡片移入移出自动补齐位置，无需额外逻辑。
7. **提供商卡片拖拽排序**：左侧所有卡片（含 codex/grok 快照卡）统一走 `providerOrder` 持久化排序并带 `draggable`；顺带修复 `handleProviderDrop` 潜在 bug——旧实现 `merged` 从旧 `providerOrder` 出发只追加新 id，导致第二次拖拽不持久化，现直接持久化完整新顺序，且不再剔除 codex/grok。账号池区块（ManagedAccountPool）保持固定在顶部不参与拖拽（其内部账号行有自己的拖拽排序）。

CDP 实测（截图 `ai_workspace/validation/v0.5.8-ui-verify3.png`）：左栏 = Grok 账号池（6 账号全称邮箱）+ ChatGPT 卡（drag，含 `poise.johnson@gmail.com` + 活跃 + 刷新 + 5h 57%/周 57%）+ Kimi Code 卡（drag）；右栏 11 张未授权卡无 codex/grok；Antigravity 卡显示提示且无按钮；池账号 title 全为完整邮箱。

回归：`usageCredentials.test.ts` 19/19（新增 id_token email 用例）、`codex.test.ts` collector 15/15、`SidebarProviderAccounts.test.tsx` 24/24、`pnpm typecheck` 干净、改动文件 oxlint 无告警。改动文件：`ModelUsageWorkspace.tsx`、`packages/agents-usage/src/host.ts`、`src/supervisor/runtime/codexCredentials.ts`、`packages/agents-usage/src/collectors/codex.ts`、`usageCredentials.test.ts`。

## 追加三：渠道补齐 — Antigravity 定性 + Command Code 网页会话支持

用户要求对照 token-monitor 补齐已有渠道支持，并指出 Antigravity / CommandCode 实测不行。本轮结论与修复：

### Antigravity：代码链路已与 token-monitor 对等，真实阻塞是账号资格

- 实测：本机仅装 `agy` CLI（v1.1.22），无 IDE。`agy models` 可列出模型（已登录），但任何真实 turn 立即失败：`Eligibility check failed: Your current account is not eligible for Antigravity. Verify your account to continue.`（带代理 / 不带代理结果一致）→ agy 进程直接退出，LS 不会驻留，scanner 返回 `app-not-running` 是正确行为。
- 对照 token-monitor 的 `antigravityProbe.js` 逐项核对：CraftStation 的 `antigravityProcessScan.ts`（agy/language_server 进程树 + CSRF 提取）与 `antigravityLanguageServer.ts`（Connect-RPC `GetUserStatus`/`RetrieveUserQuotaSummary`，https/http 双 scheme、无 token 优先）在发现与线协议两侧均已对等，无码可抄。
- 用户侧解锁路径：在浏览器完成 Google 账号 Antigravity 资格验证（agy 报错里给的链接），之后启动 agy 会话，面板会自动读取额度（app-not-running 提示文案已在上一轮落地）。

### Command Code：新增网页会话（cookie）登录 + `/internal/billing/*` 采集路径

根因：collector 只支持 CLI API key（`COMMAND_CODE_API_KEY` / `~/.commandcode/auth.json`），而本机既没有 CLI 也没有任何凭据；token-monitor 的主路径是浏览器会话——commandcode.ai 的 better-auth cookie（生产环境命名 `commandcode_prod_.session_token`，带 `__Secure-`/`__Host-` 前缀）→ `api.commandcode.ai/internal/billing/credits|subscriptions`。

按既有 qwen/opencode 模式落地（未抄码）：

- `collectors/commandcode.ts`：新增 `COMMANDCODE_INTERNAL_CREDITS/SUBSCRIPTIONS_ENDPOINTS`、`commandCodeCookieRequest`（Cookie + 浏览器 UA + Origin/Referer）、`isCommandCodeSessionLive`（登录确认门的活会话校验）、`collectCommandCodeWithCookie`；`collectCommandCode` 在无 CLI key 时回落到 safeStorage 里的 `commandcode/cookie`。web 面没有 per-period usage summary，月池由订阅 plan allowance 推导（parser 原生支持）。
- `providers.ts` descriptor：`mechanism: "cookie", needsLogin: true, apiKeyFallback: true`（CLI key 粘贴保留为后备）。
- `providerLoginConfigs.ts` + 新增 `commandCodeLoginProbe.ts`：浏览器捕获登录配置，`authCookiePattern: /^(?:__Secure-|__Host-)?commandcode_prod_\./i`，`validateSession` 走 billing credits 探活。
- `usageProviders.ts`：`commandcode: { supportsBrowserLogin: true }`。
- `ModelUsageWorkspace.tsx`：Command Code 卡片动作改为浏览器登录优先（未连接时点「登录/授权」开内嵌浏览器捕获；已连接后「添加账号」开 API key 粘贴）。原来无差别走 `command-code login` 终端命令，本机根本没装该 CLI，是死路。

证据：collector 测试 17/17（新增 3 个 cookie 用例：internal 端点 + Cookie 头 + 401→auth-missing + isCommandCodeSessionLive 2xx/403）；`src/main/usageLogin` + `renderer/components/providers` 共 153/153；typecheck 干净。CDP 实测运行中的 dev app：Command Code 卡点击 → 「登录中…」→ 弹出内嵌 webview 浏览器捕获（截图 `ai_workspace/validation/v0.5.8-commandcode-login.png`），取消正常。用户在浏览器里登录 commandcode.ai 后，cookie 自动捕获密封，下一轮刷新即显示额度。

注意：本机没有任何 Command Code 账号凭据，真实额度数字需用户完成一次浏览器登录后验收。

## 追加四：Antigravity 登录按钮恢复 + Command Code CLI 安装 + 登录链路复验

针对用户最新三点不满（「哪里来的登录中」、要求帮装 command-code CLI、Antigravity 按钮被灭）：

### Antigravity 卡片按钮恢复

- 根因：追加二的 app-not-running 修复把 header 按钮整体隐藏（`{appNotRunning ? null : (<button/>)}`），用户连发起登录的入口都没有。
- 修复（`ModelUsageWorkspace.tsx`）：删除该条件包裹，按钮无条件渲染（未连接时显示「登录/授权」，点击照旧走 `CLI_LOGIN_COMMANDS.antigravity="agy"` 开终端）；提示文案改为「应用未运行或未授权，可点击右上角『登录/授权』在终端启动 Antigravity 完成登录；运行后将自动读取额度」，提示与按钮并存。
- CDP 实测运行中的 dev app：`provider-card-antigravity` buttons=["登录/授权"]、hasHint=true。真实阻塞不变（agy 账号 Eligibility check failed），需用户在浏览器完成 Google 账号资格验证。

### Command Code CLI 安装

- npm 包名是 `command-code`（`@commandcode/cli` 不存在），已全局安装并验证：`command-code --version` → 1.38.2；`command-code --help` 正常（交互入口为 `cmd`，登录在交互会话内触发，无独立 login 子命令）。collector 的 CLI key 后备路径（`~/.commandcode/auth.json` / `COMMAND_CODE_API_KEY`）从此可用，但主路径仍是浏览器 cookie 会话。

### 「登录中」链路复验（回答用户疑问）

- 点击 Command Code 卡「添加账号」→ 按钮变「登录中…」→ 内嵌浏览器抽屉弹出并**真实加载** `https://commandcode.ai/zh`（页面标题「Command Code - 会学习你编码品味的 AI 编码智能体」，bodyLen=4313，Stripe iframe 正常加载），cookie 捕获探针待命；用户在此页面登录后 cookie 自动捕获密封，下一轮刷新显示额度。「登录中…」状态会持续到捕获完成或用户关闭抽屉（关闭=cancel）。
- 复验中发现并处理一个环境坑：HMR 后页面目标曾处于空 body 的坏状态（`document.body` 不存在），`Page.reload` 后恢复正常；与本次代码改动无关。
- 截图证据：`ai_workspace/validation/v0.5.8-final-cards.png`（干净状态：Antigravity 卡按钮+提示并存）、`v0.5.8-final-login-open.png`（commandcode.ai 登录页在内嵌浏览器中打开，已留给用户直接登录）。

回归：`pnpm typecheck` 干净、改动文件 oxlint 无告警。本轮未授权 commit，改动仍在 `dev` 工作树。

## 追加五：卡片布局统一 Grok 化 + 系统浏览器登录（token-monitor 式）+ Kimi 遗留状态清除

用户四点要求：① 已授权卡片展示对齐 Grok（邮箱+备注+刷新/暂停/删除）；② 删除 Antigravity 的「应用未运行或未授权」提示行；③ 授权改用系统默认浏览器，不再弹内置浏览器；④ 删除 Kimi 遗留登录状态（过期 token 导致卡片很久才跳出）。

### 卡片布局统一（`ModelUsageWorkspace.tsx` ProviderCard）

- 已授权区块重写为 Grok AccountRow 同款结构：品牌图标 + 第一行完整邮箱（title 悬浮）+ 备注行（plan，回退厂商名）+ 状态纯文本（与 Grok 行一致直接显示原始 status，暂停时显示「已暂停」）+ `RefreshCw`/`Power`/`Trash2` 三个行内图标按钮 + 下方 `ProviderQuotaCard`。
- **暂停（Power）**：复用既有 `usage.disabledProviders` 设置（Settings → 用量 的同一开关），supervisor `usageService` 的 `enabledProviderIds` 本来就会跳过被禁渠道——暂停=真实停止抓取，卡片保留但半透明冻结，再点 Power 恢复并立即刷新。
- **删除（Trash2）**：有存量的会话授权（cookie/API key）走 `handleSignOut` 真删；宿主绑定（codex/grok 桌面会话）在用量层没有可删的 secret，退化为「停止跟踪」+ toast 说明恢复路径（不动用户真实宿主登录）。
- 表头移除 plan 副标题（已挪进行内备注），卡片 min-height 改按 raw authorized 计算；删除 `appNotRunning` 变量与 Antigravity 提示段；修复 `CLI_LOGIN_COMMANDS.commandcode` 为 `command-code`（该 CLI 无 login 子命令）。

### 系统浏览器登录 + 粘贴 Cookie（对齐 token-monitor 的 openExternal + paste 流程）

- 新 IPC：`submitUsageCookie`（contracts/procedureMap/localHandlers 全链路，`MAIN_LOCAL_PROCEDURE_NAMES` 已登记）。
- `UsageLoginManager.submitCookie`：校验 cookie 名命中 `authCookiePattern`；有 `validateSession` 的渠道（commandcode/opencode/qwen）先过真实探活再密封，过期粘贴直接报错不入库。
- `usageProviders.ts`：`UsageProvider` 新增 `externalBrowserLogin`/`loginUrl`；commandcode（https://commandcode.ai/settings/usage）、opencode（https://opencode.ai/）、qwen（https://bailian.console.aliyun.com/）三个 cookie 渠道切到外部浏览器；`externalBrowserLoginUrl()` helper。
- `useUsageProviderLogin`：新增 `cookie`/`setCookie`/`handleSubmitCookie`（提交→密封→setStored→强刷）；`handleSignIn` 对外部渠道只 `openExternalWithFeedback` 开系统浏览器，不再开内置覆盖层、不再有卡在「登录中…」的状态。
- 卡片侧：点「添加账号/登录授权」→ 系统浏览器打开登录页 + 卡片内展开 Cookie 粘贴表单（带 F12 复制指引），再点「收起」可折叠；设置页 `UsageProviderRow` 同步增加 cookie 粘贴行。
- copilot（device flow）、factory（localStorage）、grok（池登录）维持原内嵌流程不动。

### Kimi 遗留登录状态

- 根因：`~/.kimi-code/credentials/kimi-code.json` 的 access_token 已于 2026-08-27 23:59 过期（expires_in 仅 900s，collector 注释明说 refresh token 从不使用），每次采集都拿过期 token 打 API 慢失败 → 卡片迟迟不更新。
- 处置（用户明确要求删除）：已将该文件移为 `kimi-code.json.bak-expired-20260829`（可恢复备份）。CDP 实测 `refreshProviderUsage({providerIds:["kimi"], force:true})` 立即返回 `auth-missing`，卡片即时显示「登录/授权」，慢跳出问题消除。

### 验证

- `pnpm typecheck` 干净；改动文件 oxlint 无告警；相关 vitest 42 文件 356/356（含新增 submitCookie 3 用例、外部浏览器登录 2 用例；两个覆盖层竞态测试改用仍走内嵌的 grok）。
- CDP 实测（截图 `v0.5.8-final2-cards.png`、`v0.5.8-final3-clean.png`）：Antigravity 卡无提示行只有按钮；ChatGPT 卡 = 邮箱 + ChatGPT Plus 备注 + ok + 刷新/暂停/删除；Command Code 点击后系统浏览器打开登录页且卡片出现粘贴表单、无新内嵌捕获（dev 日志无 [usage-login] 记录）；Kimi 卡 auth-missing；残留的旧内嵌登录 tab 已关闭清场。
- 意外发现：用户已在之前的内嵌页完成 Command Code 登录（tab URL 变为 commandcode.ai/HernanJiang/settings/usage），cookie 已密封，快照 connected（GOAT 计划，周 78%）；该渠道当前为「已暂停」状态，点 Power 即可恢复。

## 追加六：模型与用量工作区导航修复（2026-08-29）

### 用户问题与根因

用户反馈：进入「模型与用量」后，点击左侧线程不能回到线程，左上角返回按钮也失效，只能点击用量工作区右上角的叉退出。

根因是「模型与用量」采用 `panelStore.modelUsageDialogOpen` 控制的 inline workspace，会替换主内容区而不是独立路由；左侧线程的 `openThread()` 和标题栏的 `cycleRecentThread()` 原先只更新线程视图，没有清除此状态，因此线程虽然可能已经切换，主区仍被用量工作区覆盖。

### 修复

- `src/renderer/actions/threadActions.ts`：在 `openThread()`、`openNewThread()`、`openNewThreadSideBySide()` 和 `openNewThreadInWorktree()` 的共享入口关闭 `modelUsageDialogOpen`，保证从左侧线程、新对话和工作树新线程进入时回到对话主区。
- `src/renderer/actions/recentThreadCycle.ts`：`cycleRecentThread()` 在计算最近线程前关闭用量工作区；即使只有一个可循环线程或目标线程就是当前线程，左上角「返回」也能退出用量页。
- 新增回归测试：分别锁定左侧线程打开和标题栏返回在用量页状态下必须清除 `modelUsageDialogOpen`。

### 验证

- 回归前两条新增测试均稳定失败，确认复现了用户描述的问题：`modelUsageDialogOpen` 仍为 `true`。
- 修复后相关 4 个测试文件共 `91/91` 通过：`threadActions.test.ts`、`recentThreadCycle.test.ts`、`panelActions.test.ts`、`SidebarProviderAccounts.test.tsx`。
- `pnpm exec tsc --noEmit --pretty false` 通过。
- 受影响文件 `oxlint` 通过，无告警。
- 真实 Electron/CDP 验收通过：
  - 打开用量页 → 点击左侧线程：`usageOpen: true → false`，主区恢复线程内容；
  - 再打开用量页 → 点击左上「返回」：`usageOpen: true → false`，主区恢复当前线程；
  - 用量页右上角叉的原关闭行为未改动。

本轮只修复导航行为，未改变 F29 exact Token、v0.5.0 Feature 或 v0.4 F04 的 FAIL/BLOCKED 状态。未授权 commit，改动仍在 `dev` 工作树。

## 追加七：额度条文案收敛与账号操作行归位（2026-08-29）

用户现场继续指出：账号卡的“额度充足 / 额度低 / 不可用”状态胶囊是冗余信息；刷新、暂停、删除也不应被挤到邮箱/套餐下面。

本轮修改：

- `src/renderer/views/MainView/parts/Sidebar/parts/ModelUsageWorkspace.tsx`
  - 删除 Provider 卡和 managed 账号行上方的三态状态胶囊；三态仅继续由额度条颜色表达：绿色为额度充足、黄色为额度低、红色为不可用。
  - managed 账号行改为单一 header row：拖拽手柄、彩色厂商图标、完整 provider identity、真实套餐和刷新/暂停/删除操作同排布局。
  - provider snapshot 卡同样将完整身份、套餐和刷新/暂停/删除操作保持在同一行；邮箱过长时允许自然换行，不使用截断覆盖身份。
  - “已用额度 N%”继续只渲染在 `role=progressbar` 内部，进度条外与卡片元信息中不重复。
- `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`
  - 更新旧状态胶囊断言为“不存在”；新增账号操作必须与 identity 同属账号卡且不再渲染状态胶囊的回归断言。
- `src/supervisor/runtime/grokProfiles.test.ts`
  - 增加真实 managed token billing 成功后持久化 `SuperGrok` 套餐的回归覆盖。测试只使用虚构 token/账号和 mock HTTP，不读取或输出本机凭据。

## 本轮验证

- 定向 Vitest：7 个文件 / 114 tests 通过。
- TypeScript：`pnpm exec tsc --noEmit -p tsconfig.json` 通过。
- 受影响文件 oxlint：通过。
- 受影响文件 oxfmt：通过。
- `git diff --check`：通过。
- dev app 已使用带 CDP 的开发配置重启，Vite 为 `http://127.0.0.1:3100`，并已打开到 Codex 的浏览器面板供用户验收。

## 当前状态边界

- Command Code 当前真实缓存仍显示完整邮箱 `hjiang241@connect.hkust-gz.edu.cn` 与套餐 `GOAT`；该身份来自网页会话探活结果。
- managed Grok 账号的真实套餐已通过其各自的 `/v1/settings` bearer 查询持久化；例如当前账号级数据可见 `SuperGrok` 或 `X Premium+`，没有把 provider-wide `SuperGrok` 猜测复制到全部账号。
- Antigravity 仍严格使用本机 Language Server；未运行或资格不足时保持 `app-not-running` / 不可用，不伪造额度。
- Grok 真实额度门仍按项目状态保持 `FAIL/BLOCKED`；F29 exact Token、v0.5.0 Feature、v0.4 F04 也继续保持 `FAIL/BLOCKED`，本轮没有升格为 PASS。
- 全仓 `pnpm lint` 仍可能被 `ai_workspace/temp/` 遗留脚本与既有 `codexRouterOverlay.test.ts` 条件断言报错；这些不是本轮改动引入，不能用全仓 lint 绿灯替代独立 Debugger 验收。

Ready for Debugger re-review; no commit, push, merge, or formal tag performed.
