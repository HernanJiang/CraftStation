## Release 1.2.16 — 启动同步检查更新 + Gemini 闪终端窗根治（2026-09-17，发布流程中）

- **启动时同步检查更新**：标题栏更新菜单的自动检查（mount/CLI 集合变化时）本就同时探 CLI 与 CraftStation 应用更新；本批把自动路径改为静默——`checkForUpdate` IPC 新增可选 `{ automatic: true }`，自动检查失败按“无更新”处理不 toast，手动菜单“检查”保持真实错误通知。main 侧启动 30s 首查 + 每小时轮询逻辑不变。
- **Gemini(Antigravity) 每次工具调用都闪 PowerShell 窗（根治）**：1.2.13 用 `detached:true` 消掉了 agy 自身的控制台，但 DETACHED_PROCESS 子进程没有任何控制台，导致它派生的每个 console 子系统孙子进程（agy shell 工具 → pwsh、language_server、stdio MCP）都各分配一个全新的**可见**控制台——每次 tool call 弹一个 pwsh 窗。真机实验证实：`windowsHide:true`（CREATE_NO_WINDOW）下子进程的隐藏 conhost 无窗口句柄，且孙子进程 `GetConsoleWindow()=0` 完全无控制台、无窗口；`detached` 下孙子进程 `VISIBLE=True`。修法：nativeTransport 去掉 detached（`noConsole` 选项随之失效已删除）、antigravityAccountProbe 同步去 detached；顺手补 `pi/mcpExtension.ts` stdio MCP spawn 缺失的 `windowsHide`（全仓唯一缺口）。测试文件改为 `nativeTransportWindowsConsole.test.ts`，新增「孙子进程无可见控制台」真机断言。
- 验证：`pnpm typecheck` PASS；触碰文件 oxlint 0 警告；updates/ipc/CliUpdateMenu/MainTitlebar/nativeHarness/antigravity/pi 目标测试全过；`nativeAdapter.test.ts` 的 DeepSeek max-tokens 续跑 1 例失败已用 stash 基线对比证实为 HEAD 既有失败，与本批无关。
- 用户已验收，按惯例提交推送并双包构建发布（release notes 见 `ai_workspace/release-notes-1.2.16.md`）。

## Release 1.2.13 — 第二批用户验收修复（2026-09-17，已发布到远端）

- 已提交 `f8186f7` 并 push，tag `v1.2.13` 已打并推送；NSIS 安装包与便携版（`release/CraftStation-Setup-1.2.13-x64.exe` + `CraftStation-Portable-1.2.13-x64.exe` + blockmap/latest.yml）均已打出并上传到 GitHub Release v1.2.13（Latest）。发版惯例已更新：以后默认双包（见 AGENTS.md）。

## Release 1.2.15 — 更新菜单无反馈修复（2026-09-17，已发布为 Latest）

- 用户在更新菜单点“检查”后没有任何应用行：三种静默路径——main 侧去重/慢查无显式 checking 回执；下载停滞（无进度、无错误、无超时）导致后继检查全部对空 promise 放行；本地菜单在 main 未回执前无本地进度行。
- 修法：`beginCheck` 入口即发 `checking`（去重也发）；菜单在本地检查中而 main 仍 idle/error 时显示“正在检查应用更新…”；下载 120 秒无字节即判 transient-network 可见错误并释放门闩（迟到完成仍可落地）。
- 另：v1.2.14 已为 Latest（含双包），本版验证后发 1.2.15。
- 已提交推送，双包已打出并上传到 GitHub Release v1.2.15（Latest，4 文件齐）。便携版保留 1.2.15 + 1.2.14。

## Release 1.2.14 — 聊天结尾与档位修复（2026-09-17，已发布为 Latest）

- v1.2.13 为安装包专版（其便携包资产已从 Release 撤下，版本号保持纯净）；本批（消息尾部收拢、可复制、chip toast、英文档位）发为 v1.2.14。
- 双包均已打出并上传到 GitHub Release v1.2.14（Latest，安装包 + blockmap + latest.yml + 便携版）。便携版保留 1.2.14 + 1.2.13 两份；中间产物已清。
- 注意：`pnpm dist:win:all` 会连带打 arm64，本机编不过；双包一律分两次打（`dist:win` + `dist:win:portable`）。

- 基于 1.2.12 在 `main` 直接修复。含：Antigravity 终端弹窗根除、裸 XML 标签被吞、选择器隐藏未配置渠道、默认模型改为列表第一个、本应用进右上更新菜单、Schedule Kimi 自检失败，外加 1.2.12 批次的 Devin 凭证固化与 Muse OpenCode 原生路由（已推送 `b55114d1`/`97f0cc5b`，本批在其之上）。并行批次 23 个 WIP 文件封在 `peer-WIP-2026-09-17` stash（恢复：`git stash pop` 前先与 owner 线程确认；`v1.1 skeleton` 与 `wip-model-usage-ui` 两个旧 stash 不动）。
- **Antigravity 每次使用都弹终端（根因）**：`windowsHide:true` 仍会分配隐藏 conhost，真机验证每个 `agy` 会话进程必带 conhost 子进程；Windows Terminal 接管即闪。改用 `detached:true`（transport 新增 `noConsole` 选项，agy 会话 + account probe 启用，仅 Windows）后真机验证零 conhost。kill/退出语义不变，残留由现有 reaper 覆盖。
- **Antigravity/Gemini 输出错乱**：模型 emits 的裸 `<plan>`/`<response>` 等伪 XML 被 micromark 当 HTML 解析、sanitizer 剥掉未知元素，整行凭空消失（真机渲染复现确认）。新增 `escapeBareAngleTags` normalizer：fence/行内代码之外把 tag-like `<` 转义，`<https://…>`/`<mailto:>`/`<user@host>` autolink 原样保留；另有渲染回归测试。
- **模型选择器里的 Muse Code**：muse 经 WSL 检出 installed（`authState: missing`，且用户从未配置该渠道），按 1.2.6“未配置保留”逻辑展示。现改为：未配置渠道默认不进选择器（当前选中豁免，保证已开线程不丢行）；全空时显示“暂无已配置渠道 — 去「渠道与额度」登录后即可使用”；管理模型页仍是全量目录。
- **默认模型**：旧逻辑恢复各种自动持久化的 model（providerConfigs/lastDraft/最近线程），把历史上误写入的 `big-pickle` 当默认值 perpetuate。现改为：新草稿默认取可见列表第一个；仅菜单显式点选写入新增的 `defaultModels` 设置并恢复；agent 恢复同样只认显式记忆。`resolveRecentThreadModel` 随之删除。
- **右上更新菜单**：原来只查 CLI，本应用自更新藏在别处。“检查”同时触发 `checkForUpdate`；有可用更新时菜单顶部出现本应用行（安装版：下载进度 → 重启安装；便携版：下载安装包跳 Releases），badge 计入；沿用 electron-updater 原有下载/安装链路（OpenCode 式：后台下好 → 一键重启生效）。
- **Schedule Kimi 自检全红**：`kimi native identity unavailable: native identity is absent`。真机确认 Kimi CLI 凭据文件本来就没有身份字段（只有 access/refresh token），`verifyProfileIdentity` 的 koko 收集恒为空 → 所有托管账号（含排期）运行必挂。改为与 Antigravity ADC 同语义的 presence 校验（文件存在 + access_token 可解析）；删掉死代码 `collectIdentityValues`。
- **梯子默认**：`NO_PROXY` 去掉 github 直连（上一批已做，本机持久化生效），git 默认走 `127.0.0.1:7897`。
- 验证：各模块目标单测全过（transport 无窗 3、markdown 转义 4+1 渲染、buildItems 4、draft 默认 2、更新菜单 2、nativeProfile 14）；`tsc`/`oxlint` 目标文件干净；i18n 已 extract + zh-CN 补齐；待全量回归确认零新增后提交推送、打 NSIS 安装包。

## Release 1.2.12 — Antigravity/Devin/Gemini 修复批次（2026-09-17）

- 基于 1.2.11 在 `main` 直接修复。便携包 `CraftStation-Portable-1.2.12-x64.exe`。
- **Antigravity 闪终端窗**：`agy --bg-updater` 自 AllocConsole 逃逸 pseudoconsole 弹窗。nativeHarness crafting 路径此前完全没注入 `AGY_CLI_DISABLE_AUTO_UPDATE=1`（B-mode 下 baseSpawnEnv 为空），已在该 lane + GUI 会话 env 双重兜底；进程扫描顺带 reap 漏网的 stray updater。
- **Antigravity 思考链 UI**：thinking 事件缺 `step_index` 时全部坍缩进单个 turn 顶部 item（真实 agy 会话数据库证实 thinking 与 tool 在 wire 上 1:1 交错）。canonicalizer 现按「连续思考段」拆分多个 item，思考与工具按真实顺序交错渲染。
- **Devin 模型目录解析失效**：`devin models list --format json` 新版返回 `{families:[{variants:[…]}]}`，旧解析器只认 `{models:[…]}`，导致目录为空、stale 模型 id（如已改名的 `carnelian-bead`）每次会话被 Devin 后端以 `invalid_argument` 拒绝。现在解析变体 uid，会话创建时校验模型 id，未知 id 自动回退默认 SWE 并告警。
- **Gemini 池额度 0%（issue #8）**：纯应用内授权的账号没有 `projectId`，`fetchAvailableModels` 落到默认项目永远返回满额度。现在先 `loadCodeAssist` 发现 `cloudaicompanionProject` 并持久化。
- **子 agent 代理**：CLI 不读 WinINET 系统代理，Explorer 启动时子 agent/one-shot 直连而主 agent 走代理。`buildAgentCommand` Windows 分支统一注入解析后的代理 env（env 变量优先、系统代理回退、socks 转 http），主/子 agent 路由一致。
- **诊断**：新增 `CRAFTSTATION_CAPTURE_NATIVE_WIRE=1` wire 帧抓包（脱敏），用于诊断 Gemini 经 Antigravity 是否根本不产出 thinking step（SDK/上游层面确认）。
- 已知边界：Muse Spark 思考/工具交错受 `@muse-code/sdk` Turn 面板限制（`items()` 重放 backlog、`deltas()` 仅 live），本版无法在产物内彻底修复，待上游提供统一事件序。
- main 上存在 62 个与本次改动无关的既有测试失败（渲染层/codex mapping 等），本批次验证方式为「与干净 main 基线对比 0 新增失败 + 1 个既有失败被顺带修复」。

## Release 1.2.11 — Devin team settings 超时（2026-09-16）

- 基于 1.2.10 在 `main` 直接修复。便携包 `CraftStation-Portable-1.2.11-x64.exe`。
- Devin ACP `session/new` 刷新 `GetCliTeamSettings` 时 10 秒超时会 fail-close，界面报 `Failed to load team settings`。现在把本机 HTTP 代理写入 `%APPDATA%\devin\config.json`（`proxy.mode=manual`），并重试该 `session/new`。

## Release 1.2.10 — Devin 登录终端 PowerShell 回退（2026-09-16）

- 基于 1.2.9 在 `main` 直接修复。便携包 `CraftStation-Portable-1.2.10-x64.exe`。
- Devin「登录/授权」打开终端时，若 PowerShell 7 路径无效，回退到 Windows PowerShell / cmd，不再 toast `start-shell` 失败。

## Release 1.2.9 — Gemini/Antigravity 思考展开与收尾格式（2026-09-16）

- 基于 1.2.8 在 `main` 直接修复；GitHub Release 中英双语。便携包 `CraftStation-Portable-1.2.9-x64.exe`。
- 用户可见：
  - Gemini 后台任务回执与 `<system_information>` 不再进入对话/思考。
  - 思考项在步进结束和回合完成时关闭，不再一直展开。
  - 收尾信封不再把整段快照（含工具日志）重贴到最终回答后面。

## Release 1.2.8 — Devin 渠道认证 / 模型勾选 / 浅色用量页 / Gemini 503（2026-09-16）

- 基于 1.2.7 在 `main` 直接修复；GitHub Release 中英双语。便携包 `CraftStation-Portable-1.2.8-x64.exe`。
- 用户可见：
  - 「渠道与额度」出现 Devin 卡片：登录/授权或 API Key；认证后进入已配置渠道。
  - Devin ACP 数十个细分模型默认隐藏，仅「管理模型」勾选的进入首页选择器。
  - 浅色模式覆盖「模型与用量」工作区、账号卡片、额度条、「管理模型」输入与名单，以及侧栏左下角字迹。
  - Gemini 503 容量重试不再出现在错误坞/状态栏；Windows 后台探测补 `windowsHide` 减少黑窗闪现。
- 用户数据仍在 `~\.craftstation\`，与 exe 分离。

## Release 1.2.7 — Devin CLI / 凭据弹窗 / 浅色顶栏 / 便携版更新（2026-09-16）

- 基于 1.2.6 在 `main` 直接修复与功能补齐；GitHub Release 中英双语。便携包 `CraftStation-Portable-1.2.7-x64.exe`。
- 用户可见：
  - 全功能接入 Devin CLI（合成台 Native Harness、一键安装、ACP Session、MCP 注入、检查更新）。
  - 凭据/Key/AK-SK 填写改为 Modal，未授权时首次点击不再无反应。
  - 浅色主题下顶部栏与侧边栏跟随浅色语义色，不再硬编码深色渐变。
  - 应用更新源改为 `HernanJiang/CraftStation`；检查超时 8s；便携版发现新版本打开 GitHub Releases，不自动覆盖 exe。
  - 合成台未安装 Harness 点击整行即下载安装，失败 Toast 可重试，不再跳到代理设置。
  - Gemini 503 容量重试噪声不再刷到会话错误里。
- 用户数据仍在 `~\.craftstation\`，与 exe 分离；分发只需一个 Portable exe。

## Release 1.2.6 — 首页入口 / Harness 实时检测与安装 / CLI 更新交互 Hotfix（2026-09-16）

- 对应 GitHub Issues：#3（CLI 更新指示显示但点击无效、双击时更新页瞬间开关）、#4（Harness/CLI 不支持直接安装）。基于 1.2.5 在 `main` 直接修复，commit `24701bb3`，tag `v1.2.6` 已 push，GitHub Release 已发布（`CraftStation-Portable-1.2.6-x64.exe`，131 MB，未签章问题无）。
- 修复内容与根因：
  - 首页四张 suggestion card 原为 UI-only（仅 `focusComposer()`），改为真实导航：合成台 / Harness → `openModelUsageWorkspace({tab:"crafting"})`、侧边栏 → 既有 `toggleSidebar()`、模型管理 → `{tab:"models"}`、配方管理 → `{tab:"recipes"}`（`DraftHomeHero.tsx`）。
  - 「合成台」一级入口统一显示为「合成台 / Harness」：workspace tab、顶栏 pinned 快捷键（zh-CN `Crafting Table` msgstr）、管理模型帮助文案；内部 tab id 保持 `crafting`。
  - 模型目录骤减根因：`useManagedComposerProviders` 与 `ThreadDraftView` 用 `usageChannelsReady`（accounts hydrate || storedLogin）翻转「全部已安装 / 仅已配置」两套列表。修复后目录恒等于真实检测结果（installed − disabled − deepseek 排除），已安装未配置渠道保留并带 `unconfigured` 标记，ProviderModelMenu provider header 渲染「未配置」徽标；账号绑定自定义渠道显式 `unconfigured:false`。
  - 合成台 `refreshHarness()` 原来只读 control plane projection（supervisor 侧仅对既有 AgentStatus 做 projection，不探测机器）。现打开/手动刷新先 `refreshAgentStatuses(currentWslDistros, {agentKinds: NATIVE_HARNESS_AGENT_KINDS})`（7 类 native harness agent kinds，supervisor 侧自动 `invalidateExecutablePathCache` + Windows user/machine registry PATH 重读），再读 projection；supervisor 检测事件只触发 projection re-read，杜绝事件循环。real 验证：Muse 行刷新后 未安装→未配置（WSL 真实探测生效）。
  - 一键安装：新增 `src/renderer/actions/installNativeAgent.ts`（`runNativeAgentInstall`，从 `NATIVE_AGENT_REGISTRY_ENTRIES` 取官方 installCommand 走 `runAgentInstallCommand`，exit 0 后 scoped `refreshAgentStatuses`）；`HarnessCliPanel` unavailable 行渲染「安装」chip + 「安装中…」状态，Settings `SingleAgentSettings` 的 per-env install 同步改用该 shared action。不 hardcode vendor installer。
  - CliUpdateMenu 闪断根因：`Dropdown.Trigger onPress` 在同一次 press 里 `runCheck({force:true})`，`setUpdates` 替换数组导致 menu item collection 在 popover 建立过程中重建。修复：Trigger 只开菜单；显式「检查更新」菜单项与 mount keyset 自检执行 check；`setUpdates`/`setAvailableCliUpdates` 对相同 keyset+latest 保持数组身份。real 验证：单击 Kimi 更新项一次 → 恰好一次 `updateAgentBinary` → 真实升级 0.42.0→0.43.1 → agent status + availability 自动刷新 → 徽标 3→2，全程无闪动。
- Antigravity（agy 1.2.3，`C:\Users\Haona\AppData\Local\agy\bin`）：Case A 真机验证 PASS（打开合成台即「就绪」，刷新后稳定）；Case B（运行中安装）与 Muse 同路径真机验证（未安装→未配置），未单独重装 agy。DetectionSpec 保持 `binary: "agy"`，无假 alias。
- 测试：新增 `DraftHomeHero.test`（4 卡导航）、`useManagedComposerProviders.test`（hydrate 前后不收缩/Antigravity 未配置标记/disabled 消失）、`installNativeAgent.test`（未知 kind 拒绝/成功刷新/失败报错）、`CliUpdateMenu.test`（trigger 不触发 check/单击一次更新/数组身份稳定）、`HarnessCliPanel`+`CraftingWorkbenchPage` 扩展（真实 detection on open/refresh、事件仅 projection、安装成功/失败状态迁移）；`MainTitlebar.test` 按「trigger 不再强制 check」新契约改写。`pnpm typecheck` PASS（顺手修复既有 `ThreadDraftView` modelDefaultEfforts 与 `compatibilityBridge/install.ts` exactOptionalPropertyTypes 两个既有类型错）；触碰文件 `oxlint` 0 错误；全量 vitest 1070 文件，失败文件集与 HEAD 基线完全一致（19 个既有失败，含 provider-live/terminal-pty 等 smoke 门与 codex/runtime 等，均为并行批次/环境遗留，与本批无关）。
- Smoke：`--scope changed/full --mode mock` 失败集与 HEAD 基线 full-scope 完全一致（provider-live、provider-skill-delivery、terminal-pty、schedules、github-actions、browser 六门为 main 既有失败）；managed real 会话 CDP 驱动验证：四卡导航、合成台 tab/面板、Antigravity 就绪、刷新真实探测、更新菜单稳定打开 3s+、Kimi 单击一次真实更新成功、模型目录多厂商全量可见，0 renderer console error。
- 边界：Case B 未在本机重装 agy 复现（与 Muse 共享同一条 scoped refresh 链路）；smoke provider-live/terminal-pty 等六门为 main 既有失败未在本轮修复；CLI 一键安装依赖本机 curl/npm 等官方安装器存在。

## 当前用户覆盖约定 — 2026-09-05

- 工作模式：用户已明确启用 `my-workflow`，目标是持续修复 CraftStation 的已知 bug，直到达到可用状态；具体完成度以可复现的测试、构建、运行 smoke 与外部依赖证据为准，不把未验证能力标为完成。
- 写入位置：当前默认只在 Product Git Root 的 `main` 修改与验证，不为 bug、缺陷或 hotfix 新建 Feature worktree；所有 Dev 分支与 Dev worktree 从本轮起封存、不再写入或验收。
- 角色模型：Coder 使用 `gpt-6-astra`（ChatGPT-6 Astra），思考强度 `medium`；Debugger 使用 `grok-4.6`（Grok 4.6），思考强度 `high`。此前 Muse 模型线程因 endpoint/model 路由失败，不再作为当前角色配置。
- v1.0.1 Antigravity Bug Fix：用户截图复现 `gemini-3.8-flash` 搭配 `high` 被传入 Antigravity CLI，CLI 明确拒绝该 effort 并退出；已创建独立 Codex Coder 线程 `01a06f80-6911-7473-97f2-5a5a6c165550`（标题 `Coder-1.0.1-Antigravity Effort`，`gpt-6-astra` / `medium`），直接在 `main` 修复；完成自检后由 Coder 创建 `Debugger-1.0.1-Antigravity Effort`（`grok-4.6` / `high`）。
- 首批 Coder：此前的 Muse Coder 线程已失败（一个为 `unsupported_model`，一个为上游 tool-call 协议错误）；当前有效 Codex 线程为 `01a06f74-6ea1-7f22-bbfc-b7fe5a74afe9`，标题 `Coder-1.0-Main Bug Fixes`，使用 `gpt-6-astra` / `medium`，已重新派发；Coder 完成自检后负责创建一对一 `Debugger-1.0-Main Bug Fixes`，使用 `grok-4.6` / `high`。
- 线程隔离：每个 Coder、对应 Debugger、Assistant 都使用独立线程；Coder 完成一个修复批次并自检后创建一对一 Debugger 线程。由于所有修复默认写入同一 `main` 工作区，修复批次按串行顺序推进，避免并发写冲突。
- 当前 Manager：本项目当前活动 Codex Manager 线程为本线程（thread `01a06f69-5720-77e0-b3c4-9397ef740d68`，标题为 `Manager`）；不创建第二个 Manager。线程协作通过 Codex Thread API 完成，不依赖 CraftStation 应用内聊天。
- 安全边界：保留现有未提交工作区现场，不执行 reset、checkout、清理或覆盖；未获得用户明确授权前不执行版本分支 promotion、正式 tag 或 push。
- 数据状态：已按用户要求删除 C:\Users\Haona\.craftstation-dev\state.sqlite 及 SQLite 的 -wal / -shm 临时文件；.craftstation-dev 目录本身保留，后续 main 运行不再使用该数据库。

## main 直接修复 — 启动死锁致全功能不可用（2026-09-10）

- 症状：页面空白、新会话无法对话、所有账号显示未绑定/登录中、授权窗口打不开。用户运行的是当天 10:59 构建的 `release-portable-v101-fixed`（便携版 1.0.1）。
- 根因：主进程 boot 死锁。`main.ts` 中 `appControlsMcpReady = appControlsMcpIngress.start().then(recoverThreadCollaboration)` 位于 `Promise.all` boot 门禁内，而 `recover()` 对可恢复 exchange（created/queued/needs_attention）会调 `refreshSnapshot`/`tryDeliver` → `supervisorClient.call` → `await startedGate`；`startedGate` 只在门禁之后的 `supervisorClient.start()` 时 resolve。用户库 `state.sqlite` 里有一条 2026-09-09 遗留的 `queued` exchange（thread-exchange-1ac11395），于是每次启动：门禁等恢复、恢复等 supervisor、supervisor 等门禁 → supervisor 永不启动，所有 supervisor IPC（listAccounts、startThread、CLI 登录等）永久挂起。headless host（`createHeadlessRemoteHost.ts:450-451`）顺序本来就是对的。
- 修复（`src/main/main.ts`）：`appControlsMcpReady` 恢复为只等 ingress 启动；`recoverThreadCollaboration()` 移到 `supervisorClient.start()` 之后 fire-and-forget（带错误日志）。改动未提交，与现成批量一致留在工作区。
- 数据处置：经诊断后将该 stale `queued` exchange 标记为 `cancelled`（error 字段注明原因与日期），避免修复后每次启动补发一条隔了一天的旧 prompt；其余 14 条历史 exchange 未动。账号数据从未丢失（accounts.json 完好），只是 supervisor 死了读不到。
- 验证：`pnpm typecheck` PASS；`build:electron` + 重打便携包 PASS；真实 baseDir 冷启动 supervisor 正常拉起（便携版主进程下出现 supervisor.cjs 子进程）；CDP 实测 `listAccounts` 秒回 14 个账号（修复前该调用永久 hang）；首页 composer、模型选择器（Antigravity · Gemini 3.8 Flash · High）、既有线程消息流全部渲染正常；无卡在"登录中…"的按钮；renderer 0 控制台错误。最终以便携 exe 原样重启（无 CDP）交付用户使用。
- 已知边界：真实发一条消息、真实 OAuth 授权窗口待用户目视验收；`thread-collaboration`/`app-controls` 4 个单测失败属并行批次未提交半成品（与本次改动无关，main.ts 不被这些测试导入）；`isWelcomeSeen()` 的"每次启动都显示欢迎页"是 committed 的既有设计（兼作加载屏），未动。

## main 直接修复 — Meta 等模型任务完成后计划卡不变（2026-09-15）

- 症状（用户运行 1.1.1/1.1.2 便携版）：任务已完成、回复已渲染，但顶部胶囊 `Step x/y` 计划进度永远卡住不更新、不消失。Meta 类模型走 Muse MSP 路径必现；不发最终全完成 plan 更新的 ACP/Codex/Claude 路径同样存在。
- 根因双层：①Muse MSP `mspSession.finishTurn` 只发 `turn.completed`，从不关闭打开的 plan 项（todo 列表很少全部 tick 到 completed），plan 项永远停留 `started/updated`；②renderer `threadTodoState.selectLatestThreadTodoDockCandidate` 对最新 plan 候选只认"全部 completed 才撤 dock"，被 turn 末关闭但步骤未全完成的 plan 项（ACP `closeOpenTurnItems`、Codex `turn/completed`、Claude turn close）同样让 Step 段永久滞留。
- 修复（main 未提交，与现成批量一致留在工作区）：
  - `src/supervisor/agents/muse/mspSession.ts`：`finishTurn` 先经新 `closeOpenPlanItem()` 关闭打开的计划项（复用 fold 的 todo 快照，保留 harness 最后真实步骤状态，对齐 ACP turn 末关闭语义），并重置 `lastTodoSignature` 使下一轮把 todo 列表重新发布为全新 plan 项（跨轮计划 dock 延续）。
  - `src/supervisor/agents/muse/mspCanonicalMapping.ts`：新增导出 `closeMusePlanItem`；plan 项 id 改为每实例唯一（`muse-plan-<threadId>-<uuid>`），杜绝关闭后同 id 重开（renderer 对重复 `item.started` id 本来直接忽略）；`planStatus` 导出。
  - `src/renderer/components/thread/threadTodoState.ts`：最新 plan 候选项 `state === "completed"` 时撤下 dock（时间线计划卡仍保留最后真实状态），与正常完成的计划行为一致。
  - `src/renderer/state/slices/runtimeEventReducer.ts`：plan 项被 Claude 聚合器以同 id 重开（`item.started`）时允许复位为 `started`，避免 turn 末关闭后计划 dock 整会话无法回归。
- 证据：新/改单测全过——`mspCanonicalMapping` 20/20（含 closeMusePlanItem、唯一 id）、`mspSession.test.ts` 新建 2/2（finishTurn 接线）、`threadTodoState` 15/15（含 completed 未全完成撤 dock、updated 跨轮保留两例）、`runtimeEventSlice` 36/36（含 plan reopen）；主+type-aware `oxlint --deny-warnings` 0 错误；邻居回归（acp canonicalMapping/session、claude、planAggregator、ThreadStatusCapsule、chatPaneSelectors 等）537 通过。`pnpm typecheck` 与 ThreadView.test 2 例、codex canonicalMapping 4 例失败均为并行批次未提交半成品所致，已用 stash 基线对比证实与本批无关。
- 待用户：重启应用后用 Meta 模型跑一个多步任务目视验收（完成后 Step 段应消失而非卡住）；真实出流量验证受外部模型额度约束。

# PROJECT_STATUS.md

## v0.7.0 Main Integration Record — 2026-09-01

- 用户已明确授权将 `dev/v0.7-native-harnesses`（Feature commit `4b92a43`）合入本地 `main`；本地 merge commit 为 `f570b178b3b8b2eb6a33398b45fd95780039bf75`，未 push、未 tag、未发布。
- 合入范围包括 Native Harness composition、官方 Antigravity/DeepSeek carrier seam、DeepSeek API adapter、OpenCode 兼容保留、Crafting UI/IPC、Codex agentic/runtime 回归证据及治理文档。
- 真实能力边界保持诚实：Antigravity、Grok、Kimi、Codex Native 的既有证据按各自 artifact 记录；官方 DSH 与 DeepSeek API/provider 结果仍受认证/外部 provider 限制；Command Code 或普通 API 证据不冒充官方 DSH。
- 本次合并成功不等于 v0.7 Feature 全部外部模型/高级能力永久 PASS；未验证能力继续按 `implementation missing`、`AUTH_REQUIRED` 或 `RUNTIME_UNAVAILABLE` 表达。

## Release 1.0.0 — 2026-09-04

- v1.0.1 / v1.1.0 / v1.2.0(+v1.3 Computer Use 续体) 三分支已全部兼容合并进 `main`：`567965a` → `3082918` → `45b99ab`；package.json 定版 **`1.0.0`**（`9bceee6`）。
- 最终 main 全链路验收：install/typecheck/lint/build PASS；**全量 vitest 927 文件 / 10184 测试全部通过（exit 0，两次确认）**；真实应用启动 smoke 全场景 PASS（0 控制台错误）；CPA 兼容 tracer 真实流量 E2E PASS；Computer Use 真实 Windows GUI 验收 PASS（13+ 项操作）。
- 最终验收报告：`ai_workspace/reports/report_release_1.0.0.md`。
- 2026-09-04 续验：Kimi 原生腿 **PASS**（`kimi -p` 真实回包 `KIMI_NATIVE_OK`，kimi 0.36.1）。DeepSeek 已升级官方 `dsh` 到 **0.1.2-rc.1**，但 `dsh --profile headless` 在官方 plugin tree 崩溃（缺 `pi-ai` openai.json；`@deepseek-ai/dsh-llm` 无 `assertNever` export），仍 **BLOCKED**（上游 CLI 缺陷，不是缺安装）。Gemini/Antigravity 原生仍 **PASS**。ChatGPT-via-CPA 仍 **BLOCKED**：产品凭据根是 `~/.craftstation`（`AccountStore`=`craftstation-accounts/`，隔离 Codex home=`agent-plugins/codex/home`）。本轮用该库投影到本仓库 CPA `:18317`（pid 35360，已停）后 `POST gpt-5.5` 仍 HTTP 503 / `refresh_token_invalidated`。库在，但 ChatGPT 凭据与宿主 `~/.codex` 是同一套已作废 refresh（账号 `77092101-...`，last_refresh 2026-08-24）；managed Codex 账户 `codex:002993b5-...` 的 profile 目录为空壳。live 需交互式登录进 CraftStation 自己的账户库，不是再刷宿主 `codex login`，也未动 Codex-Router `:28081`。Muse Code / Muse Spark 未进入本轮产品接线：WSL Ubuntu 已安装官方 **Muse Code 1.0.2 (1.0.2-R2040.1)**，`muse --version` PASS，但未提交的 `harness:muse` composition 已丢弃；live 仍 **BLOCKED**。Computer Use 复跑需控制台解锁。
- 未 push、未打 tag；发布动作待用户明确授权（本轮用户未下达 push/tag 指令）。

> CraftStation 当前动态状态的唯一来源。长期规则见 `AGENTS.md`，外部仓库精确基线见 `reference/BASELINES.md`。

## 如何接手本项目

云端 / 本地 Manager 先读这 4 个文件，不要扫描整个 Repo：

1. 本文件 —— 当前 Feature、Verdict、Git 检查点、Next Step
2. `AGENTS.md` / 产品仓 `CRAFTSTATION.md` —— 硬规则与仓库边界
3. `IDEA_GUIDE.md` —— Ideate Mode 提示词
4. `ai_workspace/agent_docs/manager_1.0.1.md` —— 当前产品执行 Feature 的 Ideate + Plan（v1.0.1 Native Profile Runtime）
5. `ai_workspace/agent_docs/manager_1.1.0.md` —— 并行 Feature v1.1.0 Compatibility Bridge 的 Ideate + Plan（worktree 内同源文件）
6. `.worktrees/v1.2.0-mcp-skills-capability/ai_workspace/agent_docs/manager_1.2.0.md` —— 并行 Feature v1.2.0 Unified MCP + Skills Capability Foundation 的 Ideate + Plan

当前冻结点：

- 当前执行 Feature：`main bug-fix batch 1 — account identity regression`。Coder 已完成初步审查，发现 Kimi native identity 测试 fixture 的确定性回归，正在修复；Debugger 尚未创建。`r`n`r`n- 历史当前执行 Feature：`v1.0.1 — Native CLI Multi-Account Profile Runtime`。worktree `.worktrees/v1.0.1-native-profile-runtime`，分支 `dev/v1.0.1-native-profile-runtime`，基线 `main@f5a4bb2`。Status：**`DEBUGGER RE-REVIEW #2 PASS (DEV)`**（`b2edbde`，候选 `66ba9eb`）。Fix #2 fail-closed 门禁/secret boundary/Kimi 控制面独立复核通过；本机真实官方 codex app-server `account/read` + `account/rateLimits/read` receipt 到位（生产 transport 路径）；managed Codex / Kimi receipt 两腿为文档化 BLOCKED（外部交互式凭据依赖，运行时诚实 UNVERIFIED）。`report_1.0.md` 授权生成；merge/tag/push 仍需用户授权。
- 并行 Feature：`v1.1.0 — Compatibility Bridge & Model × Harness Composition`。worktree `.worktrees/v1.1.0-compatibility-bridge`，分支 `dev/v1.1.0-compatibility-bridge`。Status：**`v1.1.3 DELIVERED / READY FOR DEBUGGER RE-REVIEW`**（`dd0d0e1`+`399901b`；前判 FAIL/BLOCKED 经 `manager_1.1.0-replan.md` 授权重受理）。已交付：独立 CompatibilityRuntimeAdapter（真实 CLIProxyAPI release 二进制 v7.2.149 置于 worktree `.tools/` 不提交；`/healthz` readiness；模型契约轮询验证 fail-closed；OpenCode 隔离 provider 配置导出；官方 `opencode run --format json` 无头 Agent Loop；sessionID→native sessionRef resume；stdin-ignore 与隔离 cwd 修复）+ supervisor 兼容围栏接线（native Codex 路径零改动，baseline guard 升级为架构断言）+ **真实流量 E2E 通过**（fixture xai 凭据经 CPA 自动 OAuth 刷新 → 官方 OpenCode → 真实上游回包含 `CRAFTSTATION_E2E_OK`、native sessionRef `ses_*`；另有 curl→CPA→grok-4.3 真实回包 `CRAFTSTATION_BRIDGE_OK` 手动证据）。兼容套件 12/12、crafting/runtime 回归 176/176、**全量 vitest 全绿（exit 0，本项目首次）**。不得表述为 PASS，等 Debugger 独立复检。
- 并行 Feature：`v1.2.0 — Unified MCP + Skills Capability Foundation` 与 **v1.3.0 Computer Use（续体）**。worktree `.worktrees/v1.2.0-mcp-skills-capability`，分支 `dev/v1.2.0-mcp-skills-capability`。Status：**`v1.2.0 RE-REVIEW PASS (DEV)`（`e8f3ece`，候选 `de052d3`，F1–F8 全关 + 真实应用 smoke PASS）+ `v1.3.0 Computer Use 真实 GUI 验收 PASS`（`3bd4228`）**。v1.3 已完成：真实 Windows 驱动（PowerShell + Win32 SendInput shim）对本机真实桌面执行 enable/api/list_apps/list_windows/launch_app/get_window/get_window_state(真实截图)/activate_window/click/type_text/press_key/scroll/drag/disable 全部 13+ 项操作通过（真实启动 Store Notepad 并键入验证；环境门控 `CRAFTSTATION_CU_E2E=1`）；修复裸名 `notepad` 启动缺陷（Store 别名不在 PATH）。Capability 链：Registry（built-in MCP + 插件清单）→ spawnPipeline 每线程 loopback HTTP MCP 注入（AgentAdapter 腿）已通；Resolver 层 built-in 感知已接线（`9b34c0c`：BuiltInMcpCandidate 进 resolver（Auto/Efficient 策略 + not-available 诊断 + profile 排除），supervisor 把解析结果以 loopback HTTP MCP 并入 AgentAdapter 注入集；测试 9/9）。v1.1.3 Debugger Re-review **PASS (DEV)**（`c19c49a`，含 resume 会话连续性真实探针：暗号 BANANA42 经 resumeSession+(-s) 由真实模型答出；report_1.1.md 已更新为 PASS 结论）。ChatGPT-via-CPA 腿定性 **BLOCKED**：宿主 codex CLI 重新登录轮换并作废 fixture refresh token（refresh_token_invalidated），需用户交互式重登后方可产生该腿真实回包。发布版本号 `1.7.0`。
- main 侧 v1.1 未提交骨架已处理：src 骨架（executionRoute、compatibilityBridge、codex acp 变体等）为 dev/v1.1.0 前置草稿，已 stash 归档（`v1.1 skeleton WIP superseded by dev/v1.1.0 fde6c87`），不得再作为实现来源。
- 本机原生依赖事件：pnpm store 刷新曾把 better-sqlite3 换成 Node-ABI 预编译并使 electron-rebuild 静默空转；`ensure-native-deps.mjs` 已加 `--force` 根因修复并落 main（`59541c5`），main 与 v1.0.1 / v1.1.0 / v1.2.0 工作树的 Electron-ABI binding 均已重建并通过校验；vitest 统一经 `CRAFTSTATION_BETTER_SQLITE3_NATIVE_BINDING` 使用 `dist/server-native` Node-ABI binding。
- 下一步执行序：① v1.0.1 / v1.2.0 生成验收报告与用户候选收口；② v1.1.0 按 re-plan 执行 v1.1.3 Coder 轮（获取 CPA release 二进制 → 独立 Adapter → OpenCode tracer E2E → 账号绑定持久化）；③ v1.3 Computer Use 接入 Capability 系统（`src/main/computer-use` infra 已在库，需经 Capability Registry/Resolver/AgentAdapter 暴露 + Windows 真实 GUI 验收）；④ 原生 Provider × Harness 真实流量矩阵与 MCP/Skills/合成台全链路验收；⑤ 全部 PASS 后按用户授权合并 main 并定版 `1.0.0`，对最终 main 重跑全链路验收。
- 当前并行 Feature：`v0.9.0 — Cross-Harness Session Handoff` 与 `v0.10.0 — Cross-Thread Collaboration`，分别位于目标拓扑下的独立 Feature worktree；两者尚未完成 Coder 自检或 Debugger 验收，不得表述为 PASS。不要写入这两个 worktree。
- v0.9 Manager Plan：`.worktrees/v0.9-cross-harness-handoff/ai_workspace/agent_docs/manager_0.9.0.md`；Plan commit `7d1e2485eb86fe2f7c982dbf02c20144e46bd54a`。
- v0.10 Manager Plan：`.worktrees/v0.10-cross-thread-collaboration/ai_workspace/agent_docs/manager_0.10.0.md`；Plan commit `0bbba5f66e5b7be782443206c02781ed6825ba77`。
- Coder 协调状态：两个 Coder 的源码与未提交测试均已无损迁移到新 Feature worktree，并已按新路径恢复原有 Coder 线程继续执行。此前的平台协调异常不是 Feature FAIL，也不是代码损坏。
- Git 拓扑迁移已完成：`D:\Work\CraftStation` 直接承载 Product Git `main`；并行版本开发工作树直接位于 `.worktrees\<version-feature>`，分别检出 `dev/<version-feature>`。本项目已取消共享 `dev` 分支和共享 Dev 工作树。
- 当前历史阻塞 Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface`。
- Debugger 独立复检：**FAIL / BLOCKED**（`ai_workspace/agent_docs/debugger_0.6.0.md`）；OAuth broker / Gemini usage 移除 / Ark parser / titlebar 工程项可关闭；F35 真实 Google OAuth E2E 与 F36 真实 Ark 线上凭据仍 BLOCKED；Feature 不能 PASS。
- Coder 交付：`ai_workspace/agent_docs/coder_0.6.0.md`。
- v0.5.0 继续 **FAIL / BLOCKED**；F33 真实 Grok billing 与 F29 exact Token 未关闭。
- v0.4.0 仍 **没有 PASS**，检查点 `checkpoint-v0.4.12` / `b1af0e2`
- 下一步：v0.9 与 v0.10 在各自版本开发工作树继续执行；有真实 Google / Ark 凭据时才补 v0.6 F35/F36 脱敏证据。未经用户授权不得 merge main、创建正式 tag 或 push。远端 `origin/dev` 保留为迁移前历史，不再是默认集成线。
- 产品源码与治理文档推送到 `https://github.com/HernanJiang/CraftStation.git`

## Roadmap

CraftStation 的长期路线收敛为四个阶段。当前版本只推进当前阶段所需的最小闭环，不提前实现后续阶段的研究算法。

### Phase 1 — Runtime Foundation

基于 CraftStation 建立独立、可诊断、可恢复的 Harness Runtime 基础设施。

- 保留 CraftStation 的 Desktop、Workspace、Session persistence、Terminal、Git/Worktree、MCP 和已有 Agent integration。
- 建立 `crafting`、`registry`、`harness-runtime` 与 `provider/API` seam。
- 分别接入 DeepSeek Harness、Codex Harness、Grok Build Harness；统一 CraftStation 所需语义，不统一各 Harness 内部 agent loop、transport 或 process architecture。
- 依次证明 `Model -> Vendor Harness -> Entity -> Session -> real response`，并覆盖错误透传、resume、terminate、资源清理和 observability。

### Phase 2 — Native Composition Runtime

证明 CraftStation 不是三个 CLI wrapper，而是真正的 Harness Composition System。

```text
Model Item + Harness Item
-> Native Recipe
-> Crafter
-> CraftPlan
-> Harness Runtime
-> Entity
-> Session
```

- Model Item 与 Harness Item 保持独立。
- `auto` 只是 Slot resolution mode，不是 Item 或 Router。
- Result 仍是 Item，可保留 provenance 并进入后续 Recipe。
- Crafter 在 V0 只做 deterministic `resolve / validate / compile`，不加入 AI 搜索。

### Phase 3 — Evaluation and Auto-Crafting

在 Runtime 与 Composition 稳定后，建立经验数据和有限预算下的 Recipe 选择能力。

- 建立 `Model × Recipe × Task × Environment × Budget` performance matrix。
- 研究 Model×Item、Item×Item 和 Model×Item×Item 的 interaction / synergy。
- 比较 global-best、per-model、random、Bayesian 或 factorization 等 baseline 与 typed semantic Recipe search。
- 研究 evaluation budget、regret、oracle gap、evaluations needed 和 latency/token cost。
- 在已证明 Model preference 差异后，再进入 Cold-Start Model-Aware Crafting、behavioral probes 和 top-k Recipe prediction。
- Auto-Crafting、Model Fingerprint、Interaction-Aware Search、Cold-Start 和 Learned Router 均属于本阶段研究范围，不进入前两阶段核心 Runtime。

### Phase 4 — Recursive and Adaptive Composition

让成功的组合结果成为新的可复用知识，并支持运行过程中的 Recipe 变化。

- 研究 `Result -> reusable Item -> future Recipe` 的 Recursive Recipe Abstraction。
- 从稳定 Recipe 中抽象新的 typed Item，例如 `RepositoryContextPack`，再参与后续 Recipe。
- 研究 Runtime Re-Crafting：根据 Session phase、failure signal 或 environment state，在 `Recipe_t -> Recipe_t+1` 间安全切换。
- 该阶段再考虑 online decision、contextual bandit、MDP 或 controller learning；在前面阶段稳定前不提前引入。

### Cross-Phase Principles

- CraftStation 是工程基础，不是 CraftStation 的最终 domain；DeepSeek Harness、Codex Harness、Grok Build Harness 是独立 Runtime。
- 采用 Strangler Refactor 与 deep-module 原则，不做一次性全仓 rename 或统一重写各 Harness 内部实现。
- Runtime / Programming Model 先于 Auto-Crafting / Agentic Algorithm；基础设施没有真实运行证据时，不扩大算法 scope。
- 正式的一等 Domain 术语保持 `Item`、`Component`、`Ingredient`、`Slot`、`Recipe`、`Result`、`Crafter`、`Entity`、`Session`。

## Planned Next Feature (Planning Only)

- Feature：`v0.6.0 — Native Provider Authentication & Ark Token Plan Surface` 已进入 Debugger 复检，**FAIL / BLOCKED**
- Manager Plan：`ai_workspace/agent_docs/manager_0.6.0.md`
- Debugger：`ai_workspace/agent_docs/debugger_0.6.0.md`
- Tickets：`.scratch/craftstation-0.6.0/issues/`
- 状态：`DEBUGGER FAIL / BLOCKED`（F35/F36 缺真实凭据）
- 历史共享 Dev 已归档；后续 Feature 只允许使用 `D:\\Work\\CraftStation\\.worktrees\\<version-feature>` 与 `dev/<version-feature>`。
- 当前不执行：commit、push、任一版本开发分支 → `main` promotion 或正式 tag；v0.5 与 v0.4 F04 状态保持 FAIL/BLOCKED。

## Future Feature — v1.0.0 (Ideate Only)

- Feature：`v1.0.0 — Efficient Model × Harness Composition`
- Manager Ideate：`ai_workspace/agent_docs/manager_1.0.0.md`
- 状态：`IDEATE COMMITTED / NOT EXECUTING / NOT READY FOR PLAN`
- 目标：完善高效/兼容模式，让用户显式选择 Model Item 与 Harness Item，通过统一 Compatibility Layer 解析整个 Model × Harness matrix，并生成可审计的 Recipe / CraftPlan。
- 工作台：高效/兼容模式采用四格；自动模式采用九格。高效模式右下角显示 `Recipe 配置名称 · 模型名称`。
- 模型适配层暂定为 implementation-level Adapter/Binding，不提升为一级 Item；Provider/Auth 通过 opaque profile/auth reference 投影到官方 Harness。
- 高效模式四格配置是组合入口；每次 Model × Harness × Profile 配置变化都必须生成并展示当前组合的 `CapabilityResolution`（能力来源、状态、差异和诊断），用户明确 Craft 后才进入 Recipe/CraftPlan。
- 当前待拍板：四格第三/第四槽位、九格自动模式是否只读、全矩阵“可尝试但不保证可执行”的状态语义、Adapter 持久化和首条真实 tracer bullet。
- 执行门：未进入 Plan；不创建 Coder/Debugger，不修改当前 v0.6、v0.7、v0.8 的执行状态，不执行 commit/push/merge/tag。
- 与 v1.1.0 的关系：组合 UX / Model × Harness 产品概念保留。其“统一 Compatibility Layer”执行架构被 `v1.1.0` 的 Native Route + CLIProxyAPI Compatibility Route 取代；不静默改写本条历史。

## Parallel Feature — v1.1.0 (Plan Ready / Executing)

- Feature：`v1.1.0 — Compatibility Bridge & Model × Harness Composition`
- Manager Plan：`.worktrees/v1.1.0-compatibility-bridge/ai_workspace/agent_docs/manager_1.1.0.md`（Product Git Root 同步副本：`ai_workspace/agent_docs/manager_1.1.0.md`）
- 状态：`PLAN READY / EXECUTING`
- 工作树：已创建 `.worktrees/v1.1.0-compatibility-bridge` / `dev/v1.1.0-compatibility-bridge`，基线 `main@f5a4bb2`（`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`）。
- 目标：完全保留现有 Native Harness 路径；仅在非原生 Model/Subscription × Harness 时引入 CLIProxyAPI Compatibility Bridge，按目标 Harness 选择协议，再启动官方 Target Harness。
- 硬约束：Native pairing 永远绕过 CLIProxyAPI；CLIProxyAPI 不是 Usage Authority；不重做 Account Pool / Quota / Tokscale / Token Monitor；Antigravity 直接使用 Gemini-compatible `/v1beta`，不加 OpenAI→Gemini proxy。
- 范围：Codex、Kimi Code、OpenCode、Grok Build、Antigravity。OpenCode 作为第一条 Compatibility tracer bullet。
- Tickets：T01–T13，由 `Coder-1.1-Compatibility Bridge` 在本 worktree 连续执行；Debugger 由 Coder 自检后创建，Manager 不预创建。
- 执行门：已进入 Plan 并派发 Coder。不得表述为实现完成或 PASS。不改变当前产品执行 Feature `v1.0.1`，也不写入 v0.9 / v0.10 / v1.0.1 worktree。未经用户授权不得 merge/tag/push `origin/main`。

## Parallel Feature — v1.2.0 (Plan Ready / Executing)

- Feature：`v1.2.0 — Unified MCP + Skills Capability Foundation`
- Manager Plan：`.worktrees/v1.2.0-mcp-skills-capability/ai_workspace/agent_docs/manager_1.2.0.md`
- 工作树：已创建 `.worktrees/v1.2.0-mcp-skills-capability` / `dev/v1.2.0-mcp-skills-capability`，基线 `main@f5a4bb2`（`f5a4bb276b22e664e7691e67b486e2b1252e5d9a`）。
- 范围：复用 Poracode 成熟 MCP/Skills/Plugin/AgentAdapter 基础设施，补 origin metadata、Managed copy import、Capability Resolver 与 Auto/Efficient 选择。不重造平行系统，不写外部 CLI 配置，不实现 Computer Use，Creative 细粒度本版本不阻塞。
- 执行门：已进入 Plan 并派发 Coder。不得表述为实现完成或 PASS。不写入 v0.9 / v0.10 / v1.0.1 / v1.1.0 worktree，也不把 main 上的 v1.1 未提交骨架带进本 Feature。未经用户授权不得 merge/tag/push `origin/main`。

## Lifecycle Snapshot

| Field             | Current Value                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Major Stage       | `v0`                                                                                                       |
| Lifecycle State   | `v0.9.0 + v0.10.0 / CODER IN PROGRESS`                                                                     |
| Active Feature    | `v0.9.0 — Cross-Harness Session Handoff`；`v0.10.0 — Cross-Thread Collaboration`                           |
| Active Ticket     | 两个 Coder 分别继续各自 Manager Plan 的剩余 Tickets                                                        |
| Current Fix Cycle | 尚未进入 Debugger Fix Cycle                                                                                |
| Current Role      | Coder（并行）／Manager（拓扑治理）                                                                         |
| Review Status     | v0.9/v0.10 尚未验收；v0.6 F35/F36、v0.5 F29/F33、v0.4 F04 保持 FAIL/BLOCKED；Main Promotion NOT AUTHORIZED |

## Historical v0.3 Closeout

- Feature：`v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane`
- Final tag/HEAD：`v0.3.2` / `67bbea5` (`feature(v0.3): Codex native app-server runtime — PASS`)
- Verdict：PASS
- Report：`ai_workspace/reports/report_0.3.md`
- 说明：此前的 v0.3.1/v0.3.2 re-review 文本是历史过程记录，不再代表当前阻塞状态。

## Completed Feature

- `v0.1.0 — OpenAI Model + Codex Harness Native Recipe` **PASS**
- Debugger Closeout：`ai_workspace/agent_docs/debugger_0.1.4.md`
- Report：`ai_workspace/reports/report_0.1.md`
- 产品路径：Craft Table -> `craftAgent` -> `CodexHarnessRuntimeAdapter` -> TSM
- 本机真实 Codex response 未取得；关闭证据为非 synthetic 的 `RUNTIME_UNAVAILABLE` 诊断
- 历史 v0.1 Working Copy 记录已被后续 main/dev 生命周期取代；不得再使用旧 `craftstation/` 路径作为开发入口。

## Historical v0.2 Goal

完成并关闭 `v0.2.16 — UI 细节精修与品牌规范落地`（纯 UI 与既有交互接线、无功能迭代）。`v0.3.0` 的 Manager Plan 已就绪，但在 v0.2 关闭前不启动产品实现。不要把旧 `deepseek-harness/` 路线当作工作副本。

## Active v0.4 Feature

`v0.4.0 — Native Multi-Harness Compatibility`

- Status：`FAIL / BLOCKED — v0.4.12 checkpoint freeze（用户授权 Git 收口；不是 Feature PASS；不要开 v0.4.13）`
- Coder delivery：`ai_workspace/agent_docs/coder_0.4.12-native-harness.md`
- Debugger review：`ai_workspace/agent_docs/debugger_0.4.12-rereview-native-harness.md`
- Checkpoint freeze：`ai_workspace/agent_docs/debugger_0.4.12-checkpoint.md`
- Prior Fix Plan：`ai_workspace/agent_docs/debugger_0.4.12-native-harness.md`
- Prior re-review：`ai_workspace/agent_docs/debugger_0.4.10-rereview-native-harness.md`
- Manager document：`ai_workspace/agent_docs/manager_0.4.0.md`
- Next-version Ideate：`ai_workspace/agent_docs/manager_0.5.0.md`
- Grok Account Control Brief：`ai_workspace/agent_docs/debugger_0.5.0-grok-account-control-brief.md`
- Current evidence：F08–F24 工程项已关闭；F04 五 Harness 产品级真实 response 仍 BLOCKED。新 Session 的 `craftAgent` 当前不传 `accountId`，走 Auto；点账号行只改 selected。不能把「无论选哪个都能回复」当成 per-account sticky PASS。
- Binding finding：用户希望耗尽时静默填补、不要把「Grok 额度已耗尽」挡在聊天前面。这与冻结的 F20 explicit 语义冲突，必须由下一版本 Manager / Ideate 拍板，不能静默改代码。

## main 直接修复 — 胶囊 Git 工具面板（2026-09-06）

- 范围（main 未提交）：`ThreadStatusCapsule.tsx`（新建，未跟踪）+ `ThreadView.tsx` / `ThreadPane.tsx` / 两份单测 + `zh-CN/messages.po`（`i18n:extract` 同步新串）。
- 完成：面板头 `Git 工具` + `...` 菜单（在 Git 面板中打开/刷新状态）+ 收起/展开；分支行换真实 `BranchSelector`（仅主项目线程，worktree 线程静态显示，跟 `ComposerGitEntry` 一致）；非 repo 显示初始化按钮；任务区改 `目标` + 右上小【标记完成】（已完成态显示已完成）；Thread 旧四按钮区删除；`projectName` 等 6 个旧 props 级联清理到 `ThreadPane`。
- 证据：`tsc --noEmit` PASS；scoped `oxlint --deny-warnings` 0 错误；`oxfmt` 已整形；`ThreadStatusCapsule.test.tsx` 22/22 + `ThreadView.test.tsx` 26/26（含新增 init/收起/菜单/标记完成用例）。
- 待用户：rebuild 重启后目视验收面板（分支切换 popover 位置、初始化、收起态），再决定收口。
- 2026-09-06 已执行 `pnpm run build`（renderer + electron 全过）并重启正式版：旧实例主进程 `47788` 已停，新主进程 `32920` + renderer/supervisor 子进程正常，`AppActivate` 已推前台。请按上条目视验收 Git 工具面板。
- 2026-09-06 胶囊统一入口二批（8 点要求）：①删输入框左侧 Git/Branch 两套入口（`DraftContextBar` 去 `ComposerGitEntry` + 发布槽，`ThreadDraftComposerArea` 去分支/worktree portal 块，删 `ComposerGitEntry.tsx` 及单测；草稿改走默认分支启动）；②胶囊缩略固定 `Agents?·Step?·Changes·Branch·Commit/Push`（`+590 -101 · main · 2 ahead`），每段可点；③面板分 `git/branch/commit/task` 四视图原地展开（分支=搜索+当前+未提交+列表+新建+`BranchSyncGraph`，提交=分支+差异+输入框+未暂存数+提交/提交并推送/推送走现成 `gitCommit`/push runner，空信息诚实禁用）；④卡片压平（`rounded-lg`、去嵌套底色、紧凑行高、`h-7` 按钮）；⑤目标区仅有计划/目标/可标记时显示，无空闲占位。证据：`tsc` PASS，主 + type-aware `oxlint` 0 错误，6 文件 140 单测全过，`i18n:extract` 已同步；`pnpm run build` 全过并重启正式版（新主进程 `52064`，5 进程正常，已推前台）。待用户目视验收。
- 2026-09-06 按图 2 重做（小面板三行 + 左展开卡片）：缩略去掉 Commit/Push 段与 ahead 显示（`+326 -27 · main`）；面板收窄为 `Git 工具` 三行（更改→右侧栏 Git 页；分支/提交或推送→左侧展开卡片，单开互斥，同行再点收起；子 Agents/目标仅有状态时以条件行出现，Agents 行点开左侧列表）；删旧四视图/detail 行/四按钮/push-label 等无用状态与 `gitSyncWord`，`CapsuleBranchView/CommitView` 改挂左卡片。证据：`tsc` PASS，主 + type-aware `oxlint` 0 错误，6 文件 140 单测全过（含新开卡片/提交/行序用例），`i18n:extract` 已同步；`pnpm run build` 全过并重启正式版（新主进程 `53080`，5 进程正常，已推前台）。待用户按图 2 目视验收。
- 2026-09-06 贴边/默认关/颜色三修：①左右卡片连体（同一 fixed 容器 flex 行，左卡紧贴小面板，删 `+248` 数学）；②默认全关（缩略分段只开面板不清卡，行点击才展开，关闭即重置）；③颜色对齐输入框（面板/左卡/`...`菜单/胶囊按钮统一 `bg-[var(--composer-surface)]`，hover 统一 `hover:bg-[var(--row-hover)]`，边框统一 `--hairline`，输入框 focus 用 `--focus`，删全部 `#1c1c1f`/`#242428`/`white/` 硬编码，深浅主题都跟变量走）。证据：`tsc` PASS，主 + type-aware `oxlint` 0 错误，6 文件 140 单测全过，`i18n:extract` 已同步；`pnpm run build` 全过并重启正式版（新主进程 `53752`，5 进程正常，已推前台）。待用户验收贴边/默认关/深浅两套主题。
- 2026-09-06 跟随主卡片：面板锚点改打开期间 200ms 轮询重测（变化才 setState），侧栏开合/分屏等应用内布局不再触发 window resize，卡片始终跟胶囊走。`tsc`/`oxlint`/27 单测过，`pnpm run build` 全过并重启正式版（新主进程 `25444`，5 进程正常，已推前台）。待用户开侧栏验证跟随。
- 2026-09-06 面板横向改锚到聊天框右缘（`closest([data-craftstation-thread-pane])`，纵向仍跟胶囊），开侧栏/分屏自动贴对话框右边。`tsc`/lint/27 单测过，build 全过并重启正式版（新主进程 `5764`，已推前台）。
- 2026-09-06 修正：上次 rebuild 生效了但位置没动，根因是胶囊头部被 portal 到主布局（`MAIN_THREAD_HEADER_PORTAL_ID`），`closest()` 从按钮出发永远够不到 pane 而静默回退到旧锚点。现改锚主内容头（整列对话框宽度，开侧栏自动收窄），`tsc`/lint/27 单测过，`pnpm run build` 确认 renderer 重编（26.78s，产物时间戳新鲜）并重启正式版（新主进程 `53616`，已推前台）。待用户验证贴边。
- 2026-09-06 五项修复（main 直接改）：①SubAgent：`closeAllPanels` 改为连带清 `subAgentPanelContext`（原来只关不忘，fallback 必复活死页面；显式关 tab 本来就清），面板可见时剪掉 item 已不存在的幽灵 context；旧“关闭保留”单测按新契约改写。②Grok 池：`tryPoolFailover` 对无绑定会话不再直接放弃——池中有可用行则现解现转，无池才 fail-closed；渲染层连续相同报错合并为一条。③Codex 门：`resolveThirdPartyAccountForLaunch` 删跨 channel 回退（同名 model 在别家 channel 的条目曾把原生 Codex 劫进第三方分支触发未验证拦截），只认同 channel 精确匹配，加回归单测；安全门本身原样保留。④全局缩放：`view.zoom-in/out/reset` 命令 + `Ctrl+=/-/0`（BACKFILL 老用户也有）+ `zoomFactor` 持久化 + AppProvider 经 CSS `zoom` 整应用生效；终端不豁免（VS Code 对齐，随 UI 一起缩）。⑤胶囊：侧栏开则 wrapper 转 absolute 悬浮（`data-capsule-slot`），关则回流式；`lg:pr-[264px]` 让位仅侧栏关闭时生效。证据：`tsc` PASS，主+type-aware `oxlint` 0 错误，相关 12 文件 207 单测 + /goal 批 332 单测全过，`i18n:extract` 已同步；`pnpm run build` 全过（新产物 `ThreadView-DMLsFeQb.js`）并重启正式版（新主进程 `7448`，已推前台）。待用户按 6 点验收；其中 2/3 需真实额度与 Codex 流量，单测只覆盖到调度与判定层。
- 2026-09-06 用户要求重建：单独跑 `build:renderer` 确认重编（27.96s，同源内容 hash 不变即当前），产物时间戳新鲜，已杀旧进程重启正式版（新主进程 `49456`，已推前台）。
- 2026-09-06 修正2：用户红箭头明确右边缘=右上角侧栏按钮（⊞）的右边缘同一竖线。上次锚的 portal 目标 div 不含最右按钮，仍差几像素。现锚整行 header（新增 `data-main-content-header`），右边缘恒等于侧栏按钮右边缘。`tsc`/lint/30 单测过，`pnpm run build` 确认 renderer 重编（24.42s，新 hash 产物）并重启正式版（新主进程 `20780`，已推前台）。
- 2026-09-06 统一 `/goal + Prompt`（本轮只做此形态）：①持久化 `threads.goal`（contract + v44 migration + mapper + sync + slice，真实库已升到 44）；②Native First：codex 走原生 `thread/goal/*`（提交时逐轮 `controlGoal(edit)` 注册，首轮 launch 后补注册），其余走 fallback；③fallback 用 `goalContext` 随 `sendThreadInput/startThread` 发送，supervisor 只拼发送串（paint 保持 raw prompt，不伪装用户消息；终端仅 launch 时可见注入一次）；④`/goal` 提交拦截（设值/替换，不发消息不画泡；草稿无线程则诚实 toast）；⑤`×` 真停（interrupt + codex clear + 删 durable）；⑥输入框左行 Goal chip（图标+截断+hover 卡 +×），目标行仅 goal 模式，任务左卡（goal 全文+agent 目标+多步列表），多步 0→N 自动开卡；⑦SideChat 创建时快照继承、之后独立，转正随行；⑧开胶囊卡且右侧空闲时主区 `lg:pr` 让位，侧栏开则悬浮；⑨`no rollout found` 纳入两处 stale-ref 自愈。证据：`tsc` PASS，主+type-aware `oxlint` 0 错误，21 文件 332 单测全过（含新 threadGoal/提交/停止/快照/自愈用例，1 处旧“/goal 当消息发送”断言按新契约改），`i18n:extract` 已同步；`pnpm run build` 全过并重启正式版（新主进程 `27504`）。待用户真实 `/goal` 走一遍验收。已知诚实边界：终端后续 turn 不重注、steer 不带 goal、移动端不挂 goal、无自动 done/failed 态、草稿不支持、bottom-dock 页签按占用保守处理。
- 2026-09-07 模型选择器/缩放漂移/effort/OpenCode 批：①缩放漂移改修共享根因——新增 `overlayZoom.ts`（`--app-zoom` 变量 + `craftstation-overlay-zoom-root/content` 包裹层，factor=1 时 DOM 不变），`ResponsiveMenuSurface`（radix content 包裹 + ReproducibleMenuContent 同包裹 + fixed 降级同步补偿）与裸 Dropdown（Composer+按钮/Mode/模型、DraftParameterMenu、ThreadStatusCapsule `...` 菜单）共用同一层；`Ctrl+=/-/0` 只收放 Composer 文本区（`--composer-zoom`），不再动 document 全局缩放（全局缩放只剩设置页滑杆/侧栏按钮）；设置默认值改回 1.0。②effort 默认值集中化——`resolveHighestCompatibleEffort`（多最高→显式最高；未知→保留）/`resolveCompatibleEffort`（单值域/无 tier 则 omit，禁 `""`），五处调用统一，Antigravity argv 按 family slug 基匹配（`gemini-3.8-flash` 不再 `--effort ""`），`ThreadDraftView` effort state `undefined` 化（禁 `""` 流入 UI/Harness/CLI）；推理强度默认 `High`（`performanceMode==power` 为 `Max`，multi 为 `High`）。③OpenCode 中途退出收敛——`sdkSession.failUnsettledTurnOnServerExit`（real exitCode/signalCode 进 phase/status/error，unsettled turn 发 `failed` + terminal event，不再 ghost running）；`openCodeNative/session` 同步 `serverDeath`（`watchChildExit` + `withServerDeathRace`，会话内等待/事件流/外层 run 统一收敛，timeout 由 start 统一释放）；`transport` child-exit 停 SSE 重连。证据：`tsc` PASS，主+type-aware `oxlint` 0 错误（`transport.test.ts` 一处 `vi.fn` 缺泛型已补），相关 25 文件 400+ 单测全过（含新 overlay/effort/OpenCode 退出用例，1 处旧 effort 默认断言按新契约改），`i18n:extract` 已同步；`pnpm run build` 全过并重启正式版（新主进程 `45140` + 4 子进程）。全量 vitest 16 文件失败，经查均为并行批次未提交半成品（HeroUI `Toast` mock 漂移、`needsBrowserSessionForUsage` mock 漂移、`dbInsertThreadNativeSession` 断言、opencode.ai URL 断言），错误签名与本批标识符无关，非本批回归，未动他人文件。待用户按 11 点验收；其中 Grok 全池耗尽、Codex 真实创建、Muse Spark 无限 Running 需真实环境，仍 UNVERIFIED。
- 2026-09-07 Add to project 菜单改向上开：`ProjectSwitchMenu` compact（`ProjectSwitchMenu.tsx:247`）用 `placement="bottom end"`，输入框 living 在窗口底部，长项目列表向下开直接出视口且 RAC 未 flip；hero 同病（`placement="bottom"`）。改为 compact `top start`、hero `top`（与 ProviderModelMenu/ComposerAddMenu 同契约），菜单加 `max-h-80 overflow-y-auto`，两处 Popover 补 overlayZoom 包裹。证据：`tsc` PASS，`oxlint --deny-warnings` 0 错误，`ProjectSwitchMenu.test.tsx` 12/12（含新 `opens the compact/hero menu upward` + `max-h-80` 用例），`DraftContextBar.test.tsx` 6/6；隔离调试会话 CDP 实测（fixture 真应用，HMR 生效后）：`data-placement=top`，菜单 y=712 h=66 全在视口内。`pnpm run build` 全过并重启正式版（新主进程 `33440` + 4 子进程）。模式选择菜单（`CraftModeSwitch`，`top end`）在同一 fixture 实测右对齐像素级正确（menu right=1178=trigger right，无溢出），其在用户截图中的右裁剪因未能复现而未改，等用户明确具体症状（右裁/遮挡卡片/点击无反应）再动。
- 2026-09-07 模式菜单缩放错位（用户明确：只在缩放时）：`CraftModeSwitch` 是 Composer 区唯一没加 overlayZoom 包裹的菜单，zoom≠1 时 fixed 定位被根 zoom 二次缩放，漂移量=(zoom-1)×distance。隔离真应用 CDP 实测复现（zoomFactor=1.25 经 `__craftstationDev.stores` 走生产路径）：修前 menu right=1613 vs 视口 1460（溢出 153px，与 trigger 右缘错位 323px = 0.25×1290，与用户截图一致）；补 `overlayZoom.root/content` 包裹后修后 right=1290=trigger right（对齐误差 0，视口内余 170px），截图确认三行全可见。`ThreadComposer` 权限菜单（`DraftExecutionModeControl`，`top start`）同病一并包裹（含 `useSharedSettings` 接线；该文件另有并行批次 `fullAccessPolicyId` 52 行未提交修改，我的改动与其无交集）。证据：`tsc` PASS（中途一处 `className={... || undefined}` 类型错已改直传空串），`oxlint --deny-warnings` 0 错误（`vi.fn` 补泛型），`CraftModeSwitch.test.tsx` 3/3 + `ProjectSwitchMenu` 12/12 + `ThreadComposer/Section/DraftView` 115/115；`pnpm run build` 全过并重启正式版（新主进程 `35616` + 4 子进程）。待用户在缩放下验证模式菜单；其余 90+ 处非 Composer 菜单未动（越界重构，另立项再说）。
- 2026-09-07 Model ↔ Harness Compatibility Layer（ additives only，原生零改动）：①`src/shared/harnessCompatibility.ts`（新，纯函数）：`RouteMode=native|gateway-direct|cpa-translate|unsupported`、`resolveCompatibilityFamily`（muse-/muse-spark-/muse-/meta/ 按模型判 family，其余委托既有 `resolveModelFamily`；`autoHarnessResolver.ts` 本体未动）、`preferredHarnessForCompatibilityFamily`（muse→muse）、`isNativeModelHarnessPair`（`openai-compatible` 永非原生）、四象限协议路由（同协议 passthrough→gateway-direct，异协议→cpa-translate，无 CPA/未知上游协议/无下游协议一律 unsupported fail-closed）、`resolveAutoCompatibilityRoute`（nativeCompatible=true 时在 affinity/CPA 之前直接返回 native，原生流量永不经过 Gateway）。②`src/supervisor/agents/muse/compatibilityAdapter.ts`（新）：`buildMuseIsolatedRuntime` 生成 `<runtime>/muse/<session>/muse/config.json`（gateway BaseURL + 本地临时 bearer + model + model_catalog + limits + metadata），返回 `XDG_CONFIG_HOME/DATA_HOME` 隔离 env；真实上游 key 永不落盘，不读不写 `~/.config/muse`，会话间命名空间隔离，缺参 fail-closed。③CPA Workbench Item：`craftingWorkbenchStore` 加 `cpaHelper{present,selected}` + 幂等 `ensureCliProxyApiItem()`（单例复用、无重复）+ `clearCliProxyApiSelection()`；`CraftingWorkbenchPage` 在 resolution.source==="compatibility-layer" 时 ensure、否则 clear（native 永不自动选中）；`EfficientWorkbench` 加 `cpa` prop 显示 `CLIProxyAPI · 已自动选中` 行（无通用 item 系统下的诚实最小映射）。④Auto UI 双 Logo：`DraftParameterMenu` 在 capabilityMode==="auto" 时 trigger 改为 `[Harness Logo] Harness Name / [Model Logo] Model Name` 两行（harness 图标取 affinity kind，model 行沿用现有 provider/model 图标与 label；非 auto 保持单行原样），title tooltip 载明 `Provider · Family · Harness · Route(Native/Compatibility)`；OpenCode Go + muse-spark 显示 `[Muse] Muse / [Muse] Muse Spark…` 且 tooltip 明确 Provider=OpenCode Go。证据：`tsc` PASS，主+type-aware `oxlint` 0 错误，`oxfmt`+`i18n:extract` 已跑；新测 `harnessCompatibility` 17/17（含原生三元组 native 回归、OpenCode Go Muse gateway-direct、chat-only cpa-translate、efficiency 四分支、workbench 幂等/复用/清除）+ `compatibilityAdapter` 4/4 + `DraftParameterMenu` 4/4 + store/workbench 12/12，邻居回归（autoHarnessResolver/executionRoute/compatibility/muse/DraftView 等）75/75 全过；`pnpm run build` 全过。正式版重启未执行：用户打包版进程（`CraftStation`/`CraftStation-Portable`，17:29 起）持有默认 userData 单例锁，dev 实例按设计被拒（0.56s exit 0，`main.ts:679`），非构建/启动回归；期间对正式库的缓存改名排查已全部原样恢复，`~/.craftstation-smoke/menu-zoom*` 会话已 stop，`bootcopy/bootcheck` 已删。待用户重启其正式版 picked up 新构建后验收。诚实边界：spawnPipeline 经 CPA 网关的真实出流量接线、CPA 二进制在位编排（现为外部 `CLIPROXY_BINARY_PATH` 侧车）与 `/muse-code/models` 厂商 schema 对拍未在本批做，属下一步；本批为决策层 + item + adapter + UI + 测试。
- 2026-09-07 用户要求一行：Auto 双 Logo 由两行改单行 `[Harness Logo] Harness名 · [Model Logo] Model名`（`DraftParameterMenu` trigger 内联一行，testid/tooltip 不变，`DraftParameterMenu.test.tsx` 4/4）；`tsc`/lint 过，`pnpm run build` 全过；按既往流程停掉占锁的桌面实例（含用户打包版，codex/OpenCode CLI 任务进程未动）并重启 dev 正式版（新主进程 `53972` + 4 子进程，均有 CPU）。待用户目视验收单行效果。
- 2026-09-07 合成台页重做（只动合成页）：①真实链修复——`shared/crafting/vendors.ts`（新）规范厂商（codex→openai、grok→xai、kimi→moonshot、gemini/antigravity→google…），`executionRoute` 改用 `isSameModelVendor`（原来 `codex===openai` 永假，真原生组合也被判 IMPOSSIBLE，这就是全不可合成的根因）；`supervisorRuntime.resolveCraftingCompatibility` 的 `compatibilityBridgeReady` 由硬编码 false 改为读 `compatibilityBridgeService.getStatus().running` 真实状态；`compatibility.ts` 透出 routeReason 并译成中文真实原因（跨厂商点名缺 CLIProxyAPI 桥）。②新 IPC `getCompatibilityBridgeStatus`（secret-free，无 apiKey）+ handler，组件区 `ComponentsInventory` 实读该状态显示 CLIProxyAPI（运行中 endpoint/未运行/未知），无硬编码。③布局：顶部左合成台（2x2 输入→箭头→结果格，下方清空+合成主操作区）| 中紧凑结果详情（结果名+状态+真实原因+模型/Harness各一行）| 右我的配方（limit=100 可滚动，点击回填联动全页）；下方三列首排选中摘要（模型/Harness/组件各 `*-selection-summary`）+ 候选 `max-h-72` 滚动；删 SharedInspector 右下栏；tab 高效合成台→合成；Harness/CLI 右栏保留。证据：`tsc` 0，`oxlint` 主+type-aware 0 错误；新测 vendors 4/4、executionRoute 真实配对 6 例、ComponentsInventory 3/3、EfficientWorkbench 增至 7（含原因行/主按钮禁用语义），`workbench.test.ts` 两处旧断言按修正契约改（openai-vs-codex 本是同厂商，改用 openai-vs-xai 做真跨厂商），相关 9 文件 69/69；隔离真应用 CDP 截图确认新布局（合成台主视觉/配方右上/三列摘要/CLIProxyAPI 未运行诚实态）；`pnpm run build` 全过，按授权停桌面实例重启 dev（新主进程 `32776` + 4 子进程）。诚实边界：跨厂商仍不可执行（桥未运行，fail-closed 保留，只给真实原因）；组件多选槽、配方回填后 resolution 自动重算（既有效果链）。
- 2026-09-07 胶囊单行可见性 + 彩色大 Logo：①`DraftParameterMenu` 去 auto 门控（之前用户看不见即被该门控吞掉；只要能 resolve 就显示），trigger 改用 `ProviderBrandBadge size=row` 双 badge。②Harness 卡传 vendor（xai/moonshot/openai）而品牌表 key 是 agent kind（grok/kimi/codex），对不上全掉字母 fallback；新增 `brandIdForVendorKind` 映射。③品牌：grok 接入已 vendored 的 `grok.png` 真实 X 标；新增 deepseek（品牌蓝底+字母，无假 logo）、muse（Meta 蓝底+已注册 ∞ glyph）；无新增素材故 sources.json 不动。④库存卡 badge `avatar`(18px)→`card`(40px)。证据：`tsc` 0，`oxlint` 0；新 `providerBrands.test.ts` 3/3，`DraftParameterMenu` 4/4；隔离真应用双截图：合成台 Harness 列彩色大 Logo（OpenAI 旋涡/X 白标/Antigravity 彩标/OpenCode/Kimi/DeepSeek 蓝 D）+ 首页胶囊 `Codex · 5.5 · High` 单行双 badge；`pnpm run build` 全过，重启 dev（新主进程 `48588` + 4 子进程）。诚实边界：deepseek/muse 暂无 licensed 彩色 logo 素材（字母/字形+品牌色底），要真彩标需补 favicon 级素材另立项。
- 2026-09-07 合成台微调（用户图注）：①底部胶囊改回单色（`DraftParameterMenu` 去掉彩色 badge，恢复 `ProviderIcon tone=active` 以往颜色；Harness·Model·Effort 单行与 tooltip 不变）。②彩色只用在合成台：库存卡/合成格/右侧 Harness 面板统一经 `brandIdForVendorKind` 取真彩标（合成格 avatar→compact，右侧面板 avatar→compact）。③合成按钮放大：`size=sm + text-base` 被 HeroUI 锁字号，改 `size=lg`（实测 16px）+ `h-12`（实测 48px），清空同高。④合成结果格改 `items-center`，落在左 2x2 中线延长线上。证据：单测 14/14（capsule/panel/slots），`tsc`/lint 0，隔离真应用双实测（面板彩色行/按钮 48px·16px）；`build` 全过，重启 dev（新主进程 `41436` + 4 子进程）。
- 2026-09-07 Harness 显示 CLI 产品名：`Kimi · K3` 这类 family 名读不懂；`COMPATIBILITY_HARNESS_LABELS` 改为 CLI 产品名（Kimi→Kimi Code、Grok→Grok Build，其余 Codex/Antigravity/OpenCode/Muse 与原生 descriptor label 一致），且原生时直接取账号所属 provider 的真实 label（如 Kimi Code），兼容态取 affinity CLI 名。证据：单测（label 表断言 + Kimi Code 原生用例）23/23，`tsc`/lint 0，`build` 全过，重启 dev（新主进程 `34544` + 4 子进程）。
- 2026-09-07 Ctrl +/- 后输入框卡出视口：根因是单位混用——RO `contentRect` 给未缩放 px，`getBoundingClientRect`/鼠标坐标给缩放后 px；`SplitPaneContainer` 的挂载 effect 与每次 render 的收敛 effect 直接把 gBCR 写成 CSS px，zoom 下二次放大（1.5x 时 pane 渲染 2.25x，composer 被顶出 390px），且切对话必 render 必 corrupt、RO 不回补（未缩放尺寸没变就不触发）。隔离真应用活体实证（RO 536.33 vs gBCR 804.49 vs computed 536px）。修：新 `layout/rootZoom.ts`（`rootZoomFactor` + `readUnscaledRect`），split 容器两处读取 + 分隔条拖拽 delta 归一化，`useResizablePanels` 三处拖拽 delta 与主区 cap 同理。证据：新 `rootZoom.test` 4/4 + 容器 zoom 回归（1.5x 下仍写 1000x600）18/18，layout+AppShell 52/52，`tsc`/主+type-aware lint 0；新构建隔离应用 zoom=1.5 下 pane 链最大比 1.5（单次正常缩放）、composer clip -12。`build` 全过，重启 dev（新主进程 `2044` + 4 子进程）。
- 2026-09-07 右侧栏按线程绑定：`panelStore` 加 `threadAuxiliaryPanels` 快照（placement/tab/tabs/browser/usage/notes 开关；payload 上下文与布局 chrome purposely 全局）+ `capture/restoreThreadAuxiliaryPanel`，`openThread` 入口处 park 旧线程、恢复目标线程（无快照则默认关闭；同线程 refocus 跳过）。证据：`panelStore.test` 36/36（含捕获/恢复/覆盖新断言），隔离真应用 live store 驱动验证（A right+browser ⇄ B hidden 互切正确），新构建启动截图正常。诚实边界：浏览器页内 URL/标签页仍全局（browser store 未动），多 pane 下以 focused 线程为准；从 home 进线程会恢复该线程快照（多为关闭态）。

## Repository State

- Product Git Root：`D:\Work\CraftStation`，分支 `main`，HEAD `3ff2b9917909cdd8f95bc9316a6ac7f43e2ba96f`。
- 版本开发工作树：统一位于 `D:\Work\CraftStation\.worktrees\<version-feature>`；每个工作树直接检出对应 `dev/<version-feature>` 分支，不存在共享 Dev 集成线。
- 当前登记：v0.7 `dev/v0.7-native-harnesses` @ `7ae6506e`；v0.8 `dev/v0.8-opencode-native` @ `20be0e1a`；v0.9 `dev/v0.9-cross-harness-handoff` @ `7d1e2485`；v0.10 `dev/v0.10-cross-thread-collaboration` @ `0bbba5f6`。
- 旧共享本地 `dev` 分支已保留为归档分支 `archive/dev-before-flat-worktrees-20260831` @ `adf7cde4`；远端 `origin/dev` 未修改，后续不得作为默认开发或集成入口。
- 旧 `D:\Work\CraftStation\dev` 已从 Git worktree 注册表移除并完整移出产品仓，归档到 `D:\Work\CraftStation-MigrationBackup\root-worktrees-migration-20260831`；迁移中遇到的失效 pnpm/workspace junction 已单独保留在同一备份根目录。
- 旧 `D:\Work\CraftStation\craftstation-dev`（含旧 detached v0.9/v0.10）已在逐字节校验后移动到 `D:\Work\CraftStation-MigrationBackup\legacy-craftstation-dev`，并从 Git worktree 注册表清除。
- 旧 `D:\Work\CraftStation\craftstation\release-portable` 被当前运行的 `CraftStation-Portable-0.6.0-x64.exe` 占用，暂作可恢复迁移残留；应用关闭后可整体归档，不得作为源码或工作树使用。
- GitHub origin：`https://github.com/HernanJiang/CraftStation.git`（产品仓 `main`）。
- 根仓库没有 tracking remote；云端 Manager 以 GitHub 产品仓治理文档为准。
- 产品仓检查点 tag：`checkpoint-v0.4.12`（不是 PASS tag，也不是 `v0.4.0`）。
- 旧 `deepseek-harness/`：`NOT PASSED / SUPERSEDED / DO NOT USE`。

## Next Step

1. v1.2.0 Coder 只在 `D:\Work\CraftStation\.worktrees\v1.2.0-mcp-skills-capability` / `dev/v1.2.0-mcp-skills-capability` 按 `manager_1.2.0.md` Part II 连续执行 T01–T12；Manager 发布 Plan 后不轮询等待。不得表述为 PASS。
2. v1.0.1 Coder 只在 `D:\Work\CraftStation\.worktrees\v1.0.1-native-profile-runtime` / `dev/v1.0.1-native-profile-runtime` 继续 Native Profile Runtime；不得表述为 PASS。
3. v1.1.0 Coder 只在 `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge` / `dev/v1.1.0-compatibility-bridge` 按 `manager_1.1.0.md` Part II 连续执行 T01–T13；Manager 发布 Plan 后不轮询等待。
4. v0.9 Coder 只在 `D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff` / `dev/v0.9-cross-harness-handoff` 继续剩余 Tickets 和 Feature-level self-check。
5. v0.10 Coder 只在 `D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration` / `dev/v0.10-cross-thread-collaboration` 继续 focused tests、typecheck 与 Feature-level self-check。
6. v1.2.0 Coder 自检后创建一对一 `Debugger-1.2-MCP Skills Capability`（`gpt-5.6-sol / high`）；其他 Feature 的 Coder 完成后分别创建一对一 Debugger。Debugger 在各自版本开发分支完成候选收口并通知 Manager，不合入共享 Dev。
7. 用户验收并明确授权后，Manager 才将指定 `dev/<version-feature>` 分支收口到 `main`。未经授权不得 merge main、创建正式 tag 或 push；v0.6 F35/F36、v0.5 F29/F33 与 v0.4 F04 的证据门保持原判。
