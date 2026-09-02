本轮只修用户明确列出的 Provider、项目创建、上下文窗口、重复控件和结构化输出显示问题；不做无关 UI/Provider 架构重构，不改变 Kimi 的额度适配，不把 mock/fixture 当成真实 Provider E2E PASS。

## 一、已确认的真实根因

1. **Antigravity 登录链路**
   - `src/renderer/views/MainView/parts/Sidebar/parts/ModelUsageWorkspace.tsx:499-502` 对 Antigravity 特殊调用 `signInAndImportAntigravityAccount()`。
   - `src/renderer/actions/agentLoginActions.ts:233-266` 进入 `startUsageLogin` → `UsageLoginManager` → `AntigravityOAuthManager` 的自定义 OAuth。
   - `src/main/usageLogin/UsageLoginManager.ts:278-280` 明确路由到自定义 OAuth；其 callback/client/redirect 位于 `AntigravityOAuthManager.ts:7-23,104-124,231-415`。
   - 但 `src/renderer/components/providers/usageProviders.ts:77-83` 已注明 Antigravity 的真实授权由 `agy`/language server 所有，CraftStation 不应复刻该 OAuth；`agy` 原生检测读 OS keyring/配置目录。因此自定义 OAuth 成功只会写 CraftStation usage bucket，不会让原生 `agy` 变成同一账号，导致检测、账号池、Runtime 状态分裂。

2. **Codex “正在工作、无输出”**
   - 第一版正常路径与当前 `CodexStructuredSession`、`CodexAppServerRpc`、stdout JSONL 解析、canonical mapping、renderer 状态同步没有发现实质生命周期差异。
   - 真实行为差异来自 `5059a25`：`threadOverrides.ts` 将 Home cwd 改为 `~/.craftstation/workspace-home/<threadId>`。
   - 标准 GUI 路径 `SpawnPipeline → CodexStructuredSession` 没有在 `thread/start`/`thread/resume` 前创建该目录；`f19f58c` 只覆盖 crafted、通用 ACP 和 OpenCode，漏掉 Codex structured path。渲染器先乐观设为 working，启动失败/事件未到达时就会留下计时器和空聊天。
   - 事件链本身为 `threadSessionManager.ts:526-613` → `structuredTurnQueue.ts:24-63` → `agents/codex/acp.ts:657-768` → `serverPool.ts/stdioTransport.ts` → `appServerRpc.ts:410-462` → `acp.ts:1080-1296` → `sessionRuntimeLifecycle.ts:70-176` → `renderer/app.tsx:212-259`，本轮会在修 cwd 前后补真实边界测试，不用超时掩盖。

3. **ChatGPT/Codex “账号身份未知”**
   - `AccountStore.add()` (`src/supervisor/runtime/accountStore.ts:224-265`) 允许没有 `providerAccountId/maskedIdentity` 的记录，先创建 UUID 和 credentialRoot，状态初始为 `unavailable`，也没有 provider+identity 去重。
   - Codex `importAuthJson()` (`src/supervisor/runtime/codexProfiles.ts:142-176`) 只要求 access token，不要求稳定账号身份；JWT/account_id/email 都可能缺失，因而插入未知账号。
   - 新登录 `agentLoginActions.ts:189-231,458-581` 只在 Promise 返回 false 时清理；进程崩溃/强制关闭/中断可能留下 pending row。`collectQuota()` 成功时只要状态 available 就可能保留无身份账号。
   - Renderer 又在 `ModelUsageWorkspace.tsx:1404-1410,1503-1507,1808` 过滤掉无身份 Codex 账号，导致错误账号仍在 `accounts.json`，却无法在正常账号池中删除。
   - 现有 `AccountRow` 已有删除动作 (`ModelUsageWorkspace.tsx:1060-1095`)，缺的是让未知记录进入池列表并以失效态呈现。

4. **OpenCode 登录无反馈**
   - 用量卡的 `CLI_LOGIN_COMMANDS` (`ModelUsageWorkspace.tsx:49-57`) 把 OpenCode 绑定到 `opencode providers login`，并在 `handleAccountAction()` (`:504-525`) 先截获该分支。
   - 这个 CLI 命令只配置 OpenCode CLI provider 的 `auth.json`，不是 `opencode.ai` usage cookie；卡片 callback (`:504-516`) 只清 spinner/成功时刷新 usage，没有成功、失败、无效 Key 的 toast 或状态反馈。
   - 正确的 usage 登录路径已经存在：`useUsageProviderLogin.ts:74-80,163-185` → 外部浏览器 → `auth/__Host-auth` cookie 校验 → sealed secret → `refreshProviderUsage({ force: true })`。`OpenCodeProviderSettings.tsx:109-143` 的 CLI 登录路径要保留，因为那里配置的是 CLI provider credentials。

5. **新建项目名称多一个 `/`**
   - `CreateProjectModal.tsx:111-123` 将 `splitPathLeaf(picked).tail` 直接作为 name。
   - `shared/createProject.ts:76-84` 的 `splitPathLeaf` 是显示用 contract，故意保留分隔符；测试也明确断言 `/leaf` 保留 `/`。
   - `validateProjectName()` (`createProject.ts:34-43`) 拒绝 `/`，所以自动填入 `/EQ-Agent` 后 Create disabled。

6. **上下文窗口只显示 ChatGPT/Codex**
   - Renderer 不是硬编码 ChatGPT；`buildModelPickerControls.tsx:224-267` 只有在当前模型实际拥有超过一个 `modelContextSizes` 时才显示 Context selector。
   - `contextSize` 是最大上下文容量；Codex 运行时将它映射为 `model_context_window`，压缩触发阈值为 `floor(max*0.95)` (`codexContextWindows.ts:114-138`)，不是第二个通用 picker。
   - 其他 provider 的能力元数据可能只报一个 context size，或其 runtime 根本没有消费 `ThreadConfig.contextSize`。全局复制 Codex 选项会产生“UI 可选、Runtime 不生效”的假兼容。
   - 另有 presentation override 丢失根级 context 字段的问题：`shared/agentSelection.ts:65-101` 在 override 存在时剥离 `contextSizes/modelContextSizes/defaultContextSize`；Cursor GUI 的 ACP capability builder (`supervisor/agents/cursor/detection.ts:377-446,737-757`) 也不输出这些字段。

7. **分支/工作树控件重复**
   - 上方控件是 `DraftContextBar.tsx:73-162`，通过 `UniversalDockedChatInput.tsx:16-50` 挂在聊天框上方；它是 live checkout 的 branch/review 控件。
   - 下方重复控件是 `ThreadDraftComposerArea.tsx:1328-1382` 的 `WorktreeModeSelect + BranchSelector`，由 `ThreadDraftView.tsx:1353-1450` 传入；它实际承载新线程 draft 的目标 worktree/branch 选择。
   - `e33202b` 同时引入两层 shell，后续只细修了两边，没有迁移 owner，因此不能只删除下方 block，否则会丢新线程工作树选择能力。

8. **结构化架构输出没有灰色背景**
   - 普通 assistant 文本走 `AssistantMessage.tsx:80-108` → `SmoothItemMarkdown` → `ItemMarkdownInner.tsx:121-153`；只有显式 Markdown fenced code 才走 `MdCodeBlockFrame/markdownCodeBlockClass` 的灰底。
   - 用户给出的 tensor/pipeline 文本是普通 Markdown/prose，没有消息类型或结构化 block 标记，所以和普通回答共用黑色 Surface。

## 二、最小实现步骤

### P1：Provider 登录、账号、Codex Runtime

1. **Antigravity 改走 native `agy` 登录**
   - 移除 `ModelUsageWorkspace` 的 Antigravity usage-card 特殊自定义 OAuth 分支，改复用现有 `runAgentLoginCommand`/登录 Terminal 的 native `agy` 路径。
   - 复用 `SingleAgentSettings.tsx:384-428`、`ThreadAuthRequiredDock.tsx:67-92` 的 completion contract：shell/OSC 完成后刷新对应 agent status，再刷新 usage/account list；成功、取消、非零退出分别给明确 toast。
   - 保留 `AntigravityProfileService` 对已经获得的 host OAuth bundle 的账号级 quota 能力，但不声称它已经切换了 `agy` 的 OS-keyring 账号；如果 native `agy` 没有可验证的 per-account seam，UI 明确标为 ambient/native login 限制。
   - 增补 renderer action/card 测试：点击 Antigravity 调 `agy`，不调 `startUsageLogin({providerId:"antigravity"})`；完成后 status/usage refresh；失败和取消有反馈。

2. **Codex 标准 GUI path 创建 Home cwd**
   - 在 `CodexStructuredSession` 创建/打开 thread 的边界，使用现有 `resolveThreadWorkspace()` + `ensureThreadWorkspace()`，确保同一 `threadId` 的 `thread/start`、resume fallback、fork/rollback 使用相同已存在目录。
   - 不改变真实项目 cwd；不改事件映射协议；不加超时重试。
   - 增补标准 `ThreadSessionManager → StructuredTurnQueue → CodexStructuredSession` 的 Home GUI 回归测试：目录在 app-server request 前存在，`thread/start.cwd` 正确，模拟 `turn/started → item/agentMessage/delta → item/completed → turn/completed` 后 assistant 文本到达且状态回 idle。

3. **ChatGPT/Codex 未知账号防产生、可清理**
   - `CodexProfileService.importAuthJson()` 在 `store.add()` 前必须拿到稳定身份（`account_id` 或 id_token email）；只有 access token 但无身份的 auth 文件明确返回 typed `ACCOUNT_PROJECTION_FAILED`，不再创建未知 row。
   - Codex 导入按 provider + normalized provider identity 去重：已有相同身份时复用/更新原账号 credential scope，不再追加 UUID row；成功后刷新同一 row 的 quota/identity。
   - 新建 Codex profile/login 在 supervisor 侧增加失败/取消/进程异常的回滚，删除本次创建的 pending row 和 credentialRoot；只对“无身份 + 未探测 + unavailable/error + 无 quota/lastQuotaAt”的历史孤儿做安全清理，不误删 auth-expired 或曾成功探测的账号。
   - ManagedAccountPool 对 Codex 传入完整 `codexAccounts`，不再只传 `signedInCodexAccounts`；`AccountRow` 对无身份未初始化记录显示“账号身份未知（已失效）”，禁止 select/reauth/正常 quota 操作，但保留现有 trash/remove seam。为紧凑 ProviderCard 同步提供简单 remove callback，确保所有错误记录都有手动清理入口。
   - 测试：无身份 import 拒绝、重复 import 不增行、失败 login 回滚、孤儿 prune、有效+未知账号并存时未知行仍可删除且不可选。

4. **OpenCode usage-card 登录分流**
   - 仅从 `ModelUsageWorkspace.tsx` 的 usage-card `CLI_LOGIN_COMMANDS` 移除 `opencode`；不要改 `OpenCodeProviderSettings` 的 `opencode providers login`。
   - 让 OpenCode usage card 走 `useUsageProviderLogin.handleSignIn()` 的外部浏览器/cookie flow；保留现有 live-session validation，成功后强制刷新 usage/login state，失败/取消/Key 或 Cookie 无效都 toast 明示。
   - 增补 card-level 测试：不执行 `runAgentLoginCommand`/CLI provider login；调用外部登录；cookie submit 触发 force refresh；invalid/stale candidate 不改变 stored state；settings 页 CLI login 回归测试保留。

5. **Unsupported capability 文案**
   - 找到实际渲染“独立线程创建接口/跨线程管理接口”两条文案的 capability/status source；若状态来自 provider 不支持而非执行异常，将其从 `error/failed` 映射为 `unsupported`，显示“暂不支持 / Unsupported”，保留真正启动错误的红色失败态。
   - Antigravity 的 MCP/header 约束不放宽：`supportsMcpHttpHeaders`, `supportsMcpAtProjectLocation`, `resolveComposerMcpScope` 继续 fail-closed；只补信息性解释/状态分类。
   - 增补 Antigravity capability snapshot/UI 测试，分别覆盖 unsupported 与真实 runtime failure。

### P2：项目名称与上下文窗口

6. **项目名自动填充去掉前导分隔符**
   - 只在 `CreateProjectModal.tsx:117-121` 的“浏览目录后自动填名”分支做 `leaf.tail.replace(/^[\\/]+/u, "")`，不改 `splitPathLeaf()` 的显示 contract。
   - 保持用户手动输入的 `/` 仍按当前项目名校验拒绝，避免悄悄改变用户输入。
   - 增加 `CreateProjectModal.test.tsx`：mock `/Users/me/projects/EQ-Agent`，点击 Browse 后 name 为 `EQ-Agent` 且 Create enabled；保留 shared splitPathLeaf 既有测试。

7. **上下文最大窗口与压缩阈值按 provider 能力兼容**
   - 先修共享 presentation capability 合并：当 GUI/SDK override 没有声明 context 字段时，保留其自身明确兼容的 root context metadata；对模型 ID 不兼容的 provider 不盲目继承，优先修 producer。
   - Cursor：补齐 GUI ACP capability builder 的正确 `contextSizes/modelContextSizes/defaultContextSize`，仅在 ACP/SDK 实际支持的模型 ID 上显示多选项。
   - 逐 provider 审核能力元数据与 runtime 消费点：只有能把选定最大上下文真正传给 provider 的 provider 才显示选择器；未实现消费链的 provider 继续显示单值提示或“暂不支持”，不做假 UI。
   - Codex 保持现有行为：选定最大窗口 N，运行时设置 `model_context_window=N`，压缩阈值由 `floor(N*0.95)` 自动计算；不额外伪造一个通用“压缩窗口”参数。
   - 若某 provider 经过代码核对确实支持多个最大窗口，再在其 detection capability 和 launch/app-server adapter 同步接入，补 provider-specific tests；否则在 UI 中明确“该模型只有一个可用上下文配置/暂不支持自定义压缩窗口”。
   - 测试：`capabilitiesForPresentation` 不丢合法 context metadata、buildModelPickerControls 对多选能力显示/单值能力不显示、每个已支持 provider 的 launch payload 确实携带选择值、Codex N→95% 阈值保持。

### P3：分支/工作树控件移动

8. **保留 draft 功能，移除重复 owner**
   - 从 `ThreadDraftComposerArea.tsx:1328-1382` 抽取现有 `WorktreeModeSelect + BranchSelector` 为一个轻量 `DraftWorktreeControls`（只抽取当前 block，不重构 Provider/Composer）。
   - 给 `DraftContextBar`/`UniversalDockedChatInput` 增加一个 draft-controls slot，把同一个 controls node 放到上方聊天框 context bar 的右侧/分支控件附近；继续使用原有 state、handlers、`baseBranch/worktreeMode` 计算。
   - 从下方移除旧 `data-draft-worktree-row` block；保留 launch payload 的 `worktreeMode`, `worktreeBranch`, `worktreeBaseBranch`, transfer/copy 行为。
   - 确认 compact、quick composer、Home/full draft 三条渲染路径都只出现一份控件；增加 DOM count/launch payload 测试，验证控件已在 `data-draft-context-bar` 内且不存在下方重复行。

### P4：结构化架构输出灰底

9. **仅对结构化技术 pipeline block 加灰底**
   - 不把所有 assistant message 改成灰色；在 `ItemMarkdownInner`/消息渲染层增加一个窄范围的结构化 block 识别（优先使用明确的 block marker/消息 metadata；若当前 wire 没有 marker，再用连续 tensor-shape/arrow/pipeline 行的保守识别）。
   - 将识别出的 block 包在与 `markdownCodeBlockClass` 相同的灰色 surface（圆角、padding、等宽字体、可横向阅读）；普通中文解释、标题、列表和真实 fenced code 保持现状。
   - 优先支持用户示例中的 `CLIP/HuBERT → Linear → visual_tokens/audio_tokens → modality_router → Z → matcher → LoRA` 结构；不改变文本内容、Markdown link/image、代码块复制能力。
   - 增加 `ItemMarkdownInner.test.tsx`：结构化 pipeline 得到灰底 block；普通 assistant prose 不得套灰底；显式 fenced code 的既有样式/复制测试不回归。

## 三、验证与交付

1. 对每个修复块运行受影响定向测试、`oxfmt --check`、`oxlint --deny-warnings`、`git diff --check`。
2. 运行：
   - `pnpm typecheck`
   - `pnpm lint`
   - Antigravity/OpenCode/Codex/account/project/context/draft/markdown 定向 Vitest
   - `pnpm run build:renderer`
   - `pnpm run build:electron`
3. 用 managed launcher 只启动一个当前 `main` 验收实例；不启动第二个 Dev/Mock 窗口，不使用 blanket-kill。验证 renderer crash screen、unhandled rejection、console errors 为 0。
4. 真实 Provider 验收只记录实际结果，不把测试账号、mock OAuth、fixture 或 smoke baseline 写成真实账号 PASS。尤其单独标注：
   - Antigravity native `agy` 登录与 OS-keyring 账号是否真的成功；
   - Codex 标准 GUI path 是否流式输出、Stop 后是否可继续；
   - 号池 Codex/Grok 是否使用指定 managed account；
   - OpenCode web-cookie login 与 CLI provider login 的区别；
   - 同线程切换和跨线程协作的真实 UI/restart 结果。

## 四、明确不做

- 不改 Kimi 额度适配逻辑。
- 不为 Antigravity 猜测不存在的 `HOME`/profile/token 环境变量，不伪造账号池切换成功。
- 不全局复制 Codex 上下文选项到不消费 `contextSize` 的 provider。
- 不迁移或覆盖各 CLI 原生 session 数据库。
- 不删除正常的 OpenCode Settings CLI 登录入口。
- 不顺手重构 Provider 架构、通知架构或全部 Composer UI。
