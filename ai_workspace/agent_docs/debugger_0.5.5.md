# Debugger — v0.5.5 FAIL / Fix Plan

> 对应 Feature：`v0.5.0 — Account Pool + Quota + Token Usage Stabilization`
>
> 角色：Debugger
>
> 日期：2026-08-28
>
> 工作树：`D:\Work\CraftStation\craftstation-dev`（分支 `dev`，HEAD `7ae6506` + 未提交 v0.5.3/v0.5.4）
>
> Verdict：**FAIL**
>
> Lifecycle：`FIX CYCLE v0.5.5`
>
> Requires Manager Re-plan: **No**
>
> Requires Ideate Revision: **No**
>
> 上一轮复检：[debugger_0.5.4-review.md](file:///D:/Work/CraftStation/craftstation-dev/ai_workspace/agent_docs/debugger_0.5.4-review.md)
>
> 用户现场：点击左下角「模型与用量」仍弹出 `Modal`；Grok 账号用 2x2 额度格，Kimi 已绑定账户才是长条 5h / 周额度。用户明确否掉弹窗，并要求每个账号都按 Kimi 长条额度展示。
>
> 不得宣称 Feature PASS，不得 merge main，不得打正式 `v0.5.0` tag。v0.4 F04 仍 FAIL/BLOCKED。真实 Grok billing / exact Token 本轮**不作为修复目标**。

## Review Scope

本轮不是再复检 F28/F29 工程接线，而是用户对产品壳层的新验收：

1. 「模型与用量」不能再单独跳出一个窗口。
2. 点击左下侧栏入口后，主对话框区域 **加上** 右侧侧栏这一整块，都变成账号/额度/添加账号页面。
3. 每个账号都要像截图里的 Kimi「已绑定账户」那样：一整排长条 5h 限额 + 周/月限额；下面再加一小行写恢复时间、输入 token、输出 token、账号可用状态。

核对源码：

- `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.tsx`
- `src/renderer/views/MainView/parts/Sidebar/parts/AccountUsageGrid.tsx`
- `src/renderer/views/MainView/parts/MainPageLayout.tsx`
- `src/renderer/state/panelStore.ts`
- `src/renderer/actions/panelActions.ts`
- `src/renderer/views/MainView/parts/Sidebar/parts/SidebarProviderAccounts.test.tsx`

## Evidence

### 现场（Debugger 已自己打开现有 `pnpm dev` 窗口）

- 左下角按钮 `aria-label="Provider accounts"` 仍调用 `openModelUsageDialog()`。
- 出现 `role=dialog` / `Modal.Heading`「模型与用量」。
- 左侧 Grok 账号仍是 2x2：额度 / Token / 缓存 / 状态。
- 中间 Kimi 已绑定账户已是用户要的形态：`5h 限额`、`周/月限额` 长条 + 百分比。
- 右侧未授权厂商目录仍在（F25 保持）。
- Grok 额度查询失败文案可见（F28 可见性保持），但展示形态被用户否掉。

### 源码

- `SidebarProviderAccounts` 底部按钮：`onClick={() => usePanelStore.getState().openModelUsageDialog()}`。
- `ModelUsageDialog()` 整页包在 `Modal.Backdrop` / `Modal.Container` / `Modal.Dialog` 里。
- `ManagedAccountPool` 每个账号走 `AccountUsageGrid`，不是 `UsageBar`。
- Kimi 等 `ProviderCard` 已登录分支才用本地 `UsageBar`：`label="5h 限额"` / `label="周/月限额"`。
- `MainPageLayout` 始终渲染 `<AppContent />` + `<MainRightPanel />`，没有 usage workspace 替换。

## Findings

### F30 — 「模型与用量」不得弹窗，必须替换主区 + 右侧栏

**严重度：P0**

用户原话：不要单独跳出一个窗口；点击左下角「模型与用量」后，把主对话框以及右边侧栏这一整个块，变成账号余额、预览和添加账号页面。

当前：`modelUsageDialogOpen` 只控制一个覆盖在对话上的 Modal，后面的会话区和 App 右侧栏仍在。

必须改成：

1. 左下角点击后 **不渲染** `role="dialog"` / HeroUI `Modal`。
2. 左侧 Sidebar 保持。
3. `MainPageLayout` 的 `content` + `rightPanel` 整块换成 inline usage workspace。
   - `rightPanelOpen={false}`（或等价：不渲染 `MainRightPanel` / Git overlay）。
   - 不显示当前会话 `AppContent`。
4. workspace 自己带页头「模型与用量」和关闭/返回；关闭后回到原来的主区 + 右侧栏。
5. workspace 内部仍分两列：
   - 左/主列：已授权账号池与已绑定账户预览（可滚动）。
   - 右列：未授权厂商目录 + 添加账号（保留 F25 完整内置目录）。
6. 现有刷新逻辑保留：进入页面时 `listAccounts`，再对有 identity 的 managed Codex/Grok 并行 `refreshAccountQuota`，并 `refreshTokenUsage({ periods: ["today","month","allTime"] })`。
7. 可继续复用 `modelUsageDialogOpen` 这个 store 字段，但语义变成 workspace 开关，测试和 UI 不得再出现 dialog。

### F31 — 每个账号都按 Kimi 长条额度展示，并补恢复时间 / token / 状态

**严重度：P0**

用户原话：额度显示应同时参考截图上已有的 Kimi 和 Grok；每个账号都要像 Kimi 那样展示一整排长的周额度和 5 小时额度；下面再加一小行写各个额度的恢复时间、输入 token 量、输出 token 量以及账号可用状态。

当前：

- Kimi `ProviderCard` 已绑定账户：长条 5h / 周月，**没有**恢复时间、输入/输出 token。
- Grok/ChatGPT managed 账号：2x2 `AccountUsageGrid`（额度错误文案 / Token 文案 / 缓存 — / 状态），**不是**长条。

必须改成统一账号卡：

1. **不要**在账号卡上再画 2x2 额度格作为主展示。
2. 头部：邮箱/掩码身份（主）+ 别名（副）+ 状态徽章 + 现有操作（登录授权 / 刷新 / 启用禁用 / 移除）。选号、右键改名、登录授权按钮 `stopPropagation` 保持。
3. 主体两根与 Kimi 相同的长条：
   - `5h 限额`
   - `周/月限额`
4. 窗口映射：
   - 有 `quotaWindows` 时，按 id/label 识别 5h / session / weekly / monthly；认不出就按顺序：第一条 5h，第二条 周/月。
   - 只有有效 `usedPercent` 才画百分比填充；失败/unavailable/空窗口画空轨 + `--%`，失败原因放到下方小字，**禁止**再画死 `—` 大方块冒充成功。
   - Kimi 等 provider snapshot 继续用现有 `fastWindow` / `longWindow`。
5. 长条下方 **一行小字**，包含：
   - 各窗口恢复时间（有 `resetsAt` 就格式化，没有就「恢复时间未知」）
   - 输入 token
   - 输出 token
   - 账号可用状态（`available` / `unavailable` / `quota-exhausted` / `auth-expired` 等，可用中文）
6. Token 数字只允许 exact per-account `byAccount` 的 `inputTokens` / `outputTokens`。没有 exact 数据时写「输入 — / 输出 —」或「暂无精确用量」，**不要**把 provider 全局 summary 套到账号。
7. 已授权 Grok 卡不再依赖 `col-span-2` 去“占两列”。新页面主列里每个账号都是 **整行宽卡**。未授权厂商卡仍在右列紧凑单列。

## Out of Scope

- 不重复打已耗尽 poi，不把真实 Grok billing 成功当作本轮完成条件。
- 不复活 CLIProxyAPI / 旧 DSH / Gemini CLI / Model API 假 Harness。
- 不读取/导入 Codex Router oauth / cookie / refresh token，不覆盖 `~/.grok`。
- 不 commit / tag / push / merge main。
- 不宣称 Feature PASS；v0.4 F04 继续 FAIL/BLOCKED。
- 不要全仓格式化；不要修改无关的 `codexRouterOverlay.test.ts`。

## Fix Acceptance Criteria

1. 点击左下角「模型与用量」后，页面中 **没有** `getByRole("dialog")` / 「关闭模型与用量」Modal 按钮。
2. 会话主区和 App 右侧栏被 usage workspace 替换；左侧 Sidebar 仍在。
3. workspace 可见「模型与用量」、Grok/ChatGPT 账号池、Kimi 等已绑定预览、右侧完整默认厂商目录。
4. 每个已授权/已绑定账号都有 `5h 限额` 和 `周/月限额` 长条，不再出现账号级 2x2「额度 / Token / 缓存 / 状态」主网格。
5. 每张账号卡下方有一行小字，覆盖恢复时间、输入 token、输出 token、账号状态。
6. 关闭/返回后恢复原来的会话主区 + 右侧栏。
7. 定向测试更新并通过；`pnpm run typecheck` 通过；触及文件 oxlint / oxfmt / `git diff --check` 通过。

## Fix Execution Order

1. **F30**：把 `ModelUsageDialog` 抽成 inline workspace，接到 `MainPageLayout` 的 content+rightPanel 替换；左下角入口只切 workspace，不 open Modal。
2. **F31**：抽出统一 `AccountQuotaCard`（或等价），Kimi snapshot 与 managed Grok/Codex 账号共用长条 + 底部小字；删除账号卡上的 `AccountUsageGrid` 主展示。
3. 更新 `SidebarProviderAccounts.test.tsx`：打开断言 workspace 而不是 dialog；断言 Grok 账号卡含 `5h 限额` / `周/月限额` 和底部 token/状态行。
4. 自检：定向测试、typecheck、触及文件 lint/format、`git diff --check`。写 `coder_0.5.5.md` 后通知 Debugger 复检。

## Suggested Tests

- 点击 `getByRole("button", { name: "Provider accounts" })` 后 `queryByRole("dialog")` 为 null。
- `getByTestId("model-usage-workspace")` 可见，含「模型与用量」。
- seed 一个 Grok managed account 后，账号卡有「5h 限额」「周/月限额」，没有「缓存」作为主格标题。
- seed exact `byAccount` input/output 后，底部小字能看到对应数字；无 exact 数据时不显示假成功总量。
- 右侧未授权目录在 `disabledProviders` 含 Gemini/Cursor 时仍能看到这两张卡（F25 回归）。
- 关闭 workspace 后，「模型与用量」页消失，不再占主区。

## Next Step

Coder 在 `craftstation-dev` 一次性修 F30/F31，完成后写 `ai_workspace/agent_docs/coder_0.5.5.md` 并通知本 Debugger 线程复检。未授权 commit。
