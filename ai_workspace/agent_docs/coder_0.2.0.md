# Coder 0.2.0 — UI Refactor Iteration

> 版本:`v0.2.0` | 角色:UI 重构(非 my-workflow 正式流程) | 性质:**仅 UI 重构迭代,不涉及功能迭代**

## 角色声明

本文档面向 CraftStation 项目的所有 Agent:当前由我负责 `v0.2.0` 的 UI 界面修改。

- 这是一次**纯 UI 重构迭代**:只调整视觉呈现、样式系统与界面结构,不新增、不修改、不移除任何产品功能。
- 所有 domain 语义(`Item`、`Recipe`、`Crafter`、`CraftPlan`、`Entity`、`Session`)、数据流、状态管理、IPC/桥接、共享契约(`@/shared/*`)保持不变。
- 其他 Agent 在 0.2.0 期间如需改动 `src/renderer/` 下的组件样式,应先与本迭代对齐;功能层改动不在本迭代范围内。

## 本次改动范围(Working Copy `craftstation/`,分支 `codex/v0.2.0`)

| 文件                                                   | 改动                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/components/common/BrandWordmark.tsx`     | 品牌字标双色化:`Craft` 保持前景色,`Station` 使用 craft 琥珀主色,跨主题预设保持一致品牌识别                                                                                                                          |
| `src/renderer/components/thread/ThreadDraftChrome.tsx` | `ThreadDraftHero` 增加产品定位标语 `Agent Runtime Composition System` 与 Ingredients -> Result 合成示意符号;compact 模式保持精简                                                                                    |
| `src/renderer/components/crafting/CraftingGrid.tsx`    | Craft Table 视觉重构:Minecraft 合成台式布局(两个 Ingredient Slot -> 箭头 -> Result Slot),消除硬编码 `neutral-*` 色值,全面接入主题 token(`--surface`、`--border`、`text-muted` 等),所有 `data-testid` 与文案保持不变 |
| `src/renderer/components/thread/ThreadDraftView.tsx`   | Craft Table 切换按钮去硬编码 `neutral-800` 色,接入主题 token                                                                                                                                                        |

## 不变式(Invariants)

- `CraftingGrid` 全部 `data-testid` 与测试断言文案原样保留,功能测试 4/4 通过。
- `ThreadDraftView` / `QuickComposerOverlay` / `app` 相关测试 79/79 通过。
- `pnpm typecheck` 通过。
- 未触碰 `src/shared/`、`src/main/`、`src/preload/` 及任何功能逻辑。

## 设计约定(v0.2.0 起生效)

- 品牌 craft 强调色:amber(琥珀)系,用于 Craft Table、品牌字标与合成相关强调;语义状态色(success/warning/danger)保持既有 token,不品牌化。
- 新增界面元素一律使用主题 token,禁止再引入硬编码 `neutral-*` 色值。
- UI 文案仍走 `@lingui` 既有约定;本次新增文案保持现状,后续国际化统一收口。

## 验证

- `pnpm vitest run src/renderer/components/crafting/CraftingGrid.test.tsx` — 4 passed
- `pnpm vitest run ThreadDraftView / QuickComposerOverlay / app` — 79 passed
- `pnpm typecheck` — pass

---

## 迭代约定(用户确认,0.2.0 起生效)

- 每次小范围 UI 修改后,版本号递增:`0.2.1`、`0.2.2`……
- 每次修改完成后,启动桌面应用向用户展示效果;若启动过慢,允许以纯 UI 静态预览图代替。
- 每次迭代的改动与版本号同步记录到 `PROJECT_STATUS.md` 与本角色文档。

---

## 总方向:Codex 风格整体重构(0.2.x 系列)

目标(用户规范):把 CraftStation 从"聊天应用范式"重构为 **Agent Engineering Workbench** —— Codex Desktop 的专业 Agent 工作流体验 + CraftStation 独有的 Ingredient/Recipe/ Harness 组合架构。不是 Codex 的简单换皮。

### Codex 风格要点(基于参考截图与设计规范提炼)

- 近黑背景 + 微抬升深色面板 + 细发丝边框;单一强调色;开发者工具气质(Linear/VS Code/Raycast 感)
- 左侧栏:品牌头 + 图标导航行 + 分组小节标签(置顶/项目式)+ 用户 footer
- 中央区:问候语 + 建议卡片(探索/构建/审查/修复)+ 底部上下文条(项目/本地/分支)+ 圆角 Composer
- 右侧 Inspector:审查/终端/浏览器/文件等快速入口行 + 快捷键标注
- 交互哲学:Everything is inspectable;Progressive disclosure

### 五大面映射到 CraftStation

1. Workspace Navigation(左侧栏):Projects / Sessions / Harness Library / Recipes / Models
2. Agent Execution Center(中央):Session 时间线(Plan -> Tool -> Changeset)
3. Harness Inspector(右栏):Diff / Harness 组成 / Recipe Graph / Artifacts
4. Artifact Review System:变更集与产物审查
5. Runtime Control Center(底部 Composer):Agent Command Console(Model/Runtime/Permission/Execute)

### 迭代日志

| 版本        | 内容                                                                                                                                                    | 状态 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0.2.0       | 品牌字标双色化;Hero 标语 + 合成示意符号;CraftingGrid 合成台式重构(主题 token 化);Craft Table 切换按钮 token 化                                          | DONE |
| 0.2.1       | 左侧栏新增 Workbench 导航区:Models / Harness Library / Recipes 三个可折叠小节,数据来自真实 crafting registry(只读陈列);Codex 式小节标签与计数徽标       | DONE |
| 0.2.2       | 右侧 Inspector 新增 Harness 面板标签:Recipe 卡片 + Model/Harness Ingredient 组成树(Component 明细)+ Result Item 预览;数据来自真实 registry/crafter,只读 | DONE |
| 0.2.3(计划) | Composer 改造为 Agent Command Console:项目/本地/分支上下文条 + Execute 语义                                                                             | 待做 |
| 0.2.4(计划) | Home 中央区:问候语 + 建议卡片(探索/构建/审查/修复)Codex 式首屏                                                                                          | 待做 |
| 0.2.5(计划) | 顶部 Command Bar:项目选择 / 当前 Harness·Model·Runtime / 搜索·命令面板·设置                                                                             | 待做 |

### 不变式

- 每步仅 UI;数据来源只能是既有 registry/store 的只读读取;不改任何功能行为
- 每步完成后:相关测试通过 + typecheck 通过 + PROJECT_STATUS 版本号递增

---

## 方向调整(用户指示,0.2.3 起)

暂停分面规范重构,优先做 **Codex 首屏 1:1 复刻**(仅轻微微调,保留 CraftStation 品牌名)。素材来源:本机已安装的 Codex 桌面版(`C:\Program Files\WindowsApps\OpenAI.Codex_*\app\resources\app.asar`),已提取官方吉祥物 hero 动画(mp4 + still,暗/亮两套)与 GA logo,存放于 `craftstation/src/renderer/assets/`。

### 迭代日志(续)

| 版本        | 内容                                                                                                                                                                                                                                     | 状态 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0.2.3       | 新线程草稿页首屏 1:1 复刻 Codex Home:官方吉祥物循环动画(`DraftHomeHero`)+ 问候语 + 四张建议卡片(探索代码/构建功能/审查代码/修复问题,蓝/紫/绿/橙彩色图标);卡片点击聚焦输入框,无功能行为                                                   | DONE |
| 0.2.4       | 侧栏顶部 1:1 复刻 Codex:品牌行(CraftStation logo + 名称 + 下拉箭头 + 搜索/铃铛)+ 导航行(新对话[真实]/拉取请求[真实]/站点[占位]/已安排[真实]/插件[占位]);Codex 吉祥物替换为 CraftStation logo,中心 `>_` 眨眼 + 四周 28s 慢旋(纯 CSS 动画) | DONE |
| 0.2.5(计划) | Composer 区 1:1:上下文条(项目/本地/分支)+ "随心输入"占位 + +/完全访问/模型选择/语音 底行                                                                                                                                                 | 待做 |

| 0.2.5 | 修复吉祥物双重脸:程序化擦除 logo 中心烘焙 `>_`(亮度阈值,保留底纹),叠加层负责眨眼;Workbench 分组从侧栏移至右侧 Harness Inspector(改名 Registry);侧栏新增 Codex 式「项目」分区标签;footer 头部新增 Provider Accounts 厂商订阅登录入口(真实登录流);Composer 上方新增上下文条(项目/本地/分支) | DONE |

| 0.2.6 | 吉祥物 `>_` 上移 7% + 改为 logo 同源金色(#FAB856)带微光;Provider Accounts 收成头像式入口(三个重叠厂商徽标 + 省略号),点击弹出 HeroUI Modal 认证列表(真实登录流);侧栏 footer 移除 Work/拉取请求/计划 快捷行(迁移到顶部 Codex 导航,新增 Work→GitHub Actions);Composer 上下文条改为 Codex 式圆角条(项目/本地/分支) | DONE |
| 0.2.7 | Codex home 细节对齐：吉祥物 `>_` 从 -7% 下移到 -5%；暗色 token 中性化对齐 Codex(surface #131316 / content #0e0e10 / sidebar #141417,去蓝色相)；zh-CN 补齐全部新字符串翻译(问候语/建议卡/厂商账户等)；侧栏品牌行改为 Dropdown 菜单(Settings/Remote Access 带状态点/Hide sidebar),footer 只留 Provider Accounts；厂商徽标换成官方 SVG glyph(codex 云/claude 星芒 #d97757/gemini 星标 #4e8fef)；Composer 沉底布局(spacer 锚定系统停用 enabled:false,hero 改为 flex 居中),测试改为断言无 spacer | DONE |
| 0.2.8 | 输入框 1:1 复刻 Codex：清理内部提示 dock，登录逻辑归口至左下角账户中心；上下文条 DraftContextBar 改造为胶囊条并融合右侧 Craft Table 动作入口，移除冗余控制行；输入框大圆角 1.5rem + 细发丝边框对齐 Codex；完全访问权限切换高亮为标志性琥珀橙；模型药丸 pin 至右侧；测试与类型检查全部通过 | DONE |
| 0.2.9 | Codex 顶栏与面板交互收敛：侧栏品牌改为静态 Logo/名称并移除无效下拉箭头；主内容顶栏左侧显示当前项目、右侧增加右栏/底栏布局开关；辅助栏目默认隐藏，点击后复用真实 Harness/Recipe/Model/文件/Git/终端/浏览器等面板，并按左右或上下接近 1:1 的初始尺寸展开；Composer 与上下文条进一步大圆角化，彻底移除聚焦白色发光边及其 DOM/CSS | DONE |
| 0.2.10 | Codex 圆角与交互逻辑收敛：移除窗口左上及 Composer 上方两个无效 Home 入口；原 Craft Table/Chat Draft 切换改为「自动模式 / 高效模式 / 创造模式」，自动模式表示默认模型与原生 Harness、高效模式暂为极简 Harness UI 预览、创造模式进入现有真实 CraftingGrid；右/底辅助栏首次打开不再预选 Harness，而是显示「审查 / 终端 / 浏览器 / 文件 / 合成台」入口选择页，点击后再加载对应真实面板；隐藏不属于本轮入口集合的 Usage/Notes 标签；建议卡、侧栏行、面板按钮、Registry、Harness Inspector、CraftingGrid 等统一为 Codex 式圆角矩形 | DONE |

### v0.2.9 验证

- TypeScript：`tsc --noEmit -p tsconfig.json` — PASS
- 相关组件/状态测试：`ThreadDraftView`、`ThreadComposer`、`panelStore`、`usePanelVisibility` — 83 passed
- oxlint（本轮涉及 TS/TSX 文件，`--deny-warnings`）— PASS
- 真实 Electron 桌面窗口：默认收起、右侧等分展开、底部等分展开均已交互验证；截图见 `ai_workspace/temp/window_0.2.9*.png`

### v0.2.10 验证

- TypeScript：`tsc --noEmit -p tsconfig.json` — PASS
- 相关组件/状态测试：`ThreadDraftView`、`ThreadComposer`、`CraftingGrid`、`panelStore` — 89 passed
- oxlint（本轮涉及 TS/TSX 文件，`--deny-warnings`）— PASS
- 真实 Electron：三模式按钮可操作；创造模式真实显示 CraftingGrid；右栏首次打开保持无工具选中；点击「合成台」后才加载真实 Harness/Recipe/Model Inspector；最终恢复自动模式且右/底面板收起
- 截图：`ai_workspace/temp/window_0.2.10.png`、`window_0.2.10_tools.png`、`window_0.2.10_creative.png`、`window_0.2.10_crafting_panel.png`

---

## v0.2.11 — UI 深度重构：Inset Workspace / Titlebar / Multi-Tab Tools / Inventory Crafting

> 性质：**仅 UI 重构迭代与既有状态/Action 接线，不涉及底层功能迭代**。

### 本轮完成

- 全局窗口改为 Codex 式双层暗色结构：40px 贯穿 Titlebar + 大圆角 Inset Workspace。
- 左侧栏默认宽度 210px，支持 160–400px 拖拽；品牌、搜索、通知、三合一新建、项目分组快捷操作、更新/账户/订阅/设置完成统一圆角化。
- Composer 改为元信息条与主输入底座无缝拼接，保留真实 Chat/CLI、附件、模型/上下文/推理参数、合成台入口和通用 `SessionMetrics`。
- 参数胶囊新增真实 Chat/CLI 界面选择；无模型检测结果时固定显示“自定义”，不再退化为空白按钮；`/model` 继续打开真实 ProviderModel 控件。
- 右侧工具栏采用会话内多标签体系；首次打开不默认选择工具，用户可手动打开审查、终端、浏览器、文件、合成台；支持 `+`、最大化、关闭工具 Tab 与关闭右栏。
- 工具 Tab 状态与 `panelStore` 同步：关闭当前 Tab 后回到最近剩余 Tab，关闭最后一个 Tab 后返回工具选择页。
- 合成台重构为 3×3 Crafting Grid + Result Slot + Inventory Drawer；支持真实 Item 选择、筛选、拖放、Recipe 自动填充与 Craft/Spawn Action；主要操作文案完成中文版收敛。
- Harness Inspector 复用真实 Registry/Crafter 数据，展示 Model、Harness、Recipe、Result Item 与兼容状态。
- 侧栏“新建对话 / 项目”、工具“添加工具”等 v0.2.11 新文案补齐 zh-CN。

### 真实交互验收

- 正式桌面窗口：`CraftStation (dev)`，PID `26496`，保持运行并支持 HMR。
- 隔离 Electron CDP 实例：在不修改正式用户数据的独立 profile 中验证首屏、参数菜单、工具选择页、合成台和多 Tab 关闭回退。
- 截图：
  - `ai_workspace/temp/window_0.2.11_home.png`
  - `ai_workspace/temp/window_0.2.11_parameters.png`
  - `ai_workspace/temp/window_0.2.11_tools.png`
  - `ai_workspace/temp/window_0.2.11_crafting.png`

### v0.2.11 验证

- TypeScript：`tsc --noEmit -p tsconfig.json` — **PASS**。
- 定向测试：6 个测试文件，`123/123` — **PASS**。
- oxlint：本轮核心 TS/TSX 文件使用 `--deny-warnings` — **PASS**。
- 真实 Electron + CDP：首屏、参数菜单、工具入口、CraftingGrid、多标签新增/关闭/回退 — **PASS**。
- jsdom 输出两条 `HTMLCanvasElement.getContext()` 未实现提示，不影响测试通过。
- 全工作区 `git diff --check` 仅报告既有 `src/main/browser/browserHistory.ts:126` EOF 空行；不是 v0.2.11 UI 改动，未擅自修改。

---

## v0.2.12 — 原生图标、顶栏开关、多账号 Footer 与 Composer 参数收敛

> 性质：**仅 UI 重构迭代与既有状态/Action 接线，不涉及底层功能迭代；未启用 `my-workflow`**。

### 本轮完成

- Windows 开发版设置独立 `AppUserModelId`，并以 CraftStation 品牌源图重新生成包含 16–256px 多尺寸的 `icon.ico` / nightly 图标；`BrowserWindow` 继续使用真实品牌图标路径。
- 工作区工具栏开关移至主工作区右上角，改为无边框、无外圈的纯图标按钮；删除右下角旧浮动开关，继续调用真实 `panelStore.toggleAuxiliaryPanel("right")`。
- Sidebar Footer 改为单一多账号入口：ChatGPT / Claude / Gemini Logo 与 `...` 共同组成一个按钮，副标题为“多账号登录”；右侧独立保留“齿轮 + 设置”按钮。
- Composer 建立三层暗色阶梯：窗口底板 `#141414`、顶部元信息标签 `#1c1c1c`、主输入底座 `#232323`；原生窗口首帧暗色也同步为 `#141414`。
- 顶部元信息条支持真实项目切换，空会话显示“无项目”，保留本地/WSL 与 Git 分支；右侧上移真实合成台入口与折叠式自动/高效/创造模式。
- 输入底座在 `+` 后显示真实权限胶囊；模型参数胶囊显示 Provider Logo、模型与推理强度。
- 参数菜单收敛为“上下文窗口大小 / 模型列表 / 推理强度 / 重置为默认设置”，移除用户可见的 Chat/CLI 与快速选项；底层 terminal provider 与内部 presentation state 保留，不破坏现有 Runtime 能力。
- 输入区底部保留约 28px 呼吸空间与通用 `SessionMetrics` 单行指标。
- 补齐 zh-CN 的“无项目”“切换工具面板”，并更新原先依赖可见 Chat/CLI Tab 的过时测试。

### v0.2.12 验证

- TypeScript：`tsc --noEmit -p tsconfig.json` — **PASS**。
- 定向测试：7 个测试文件，`131/131` — **PASS**。
- oxlint：本轮核心 TS/TSX 文件使用 `--deny-warnings` — **PASS**。
- 真实 Electron：开发进程完整重启，正式窗口 `CraftStation (dev)` 保持运行；首屏、右上工具开关、三层 Composer、无项目、本地、权限、模型 Logo、Footer 多账号入口均已在真实桌面窗口验收。
- 截图：`ai_workspace/temp/window_0.2.12_home.jpg`、`window_0.2.12_taskbar.png`、`window_0.2.12_taskbar_zoom.png`。
- 全工作区 `git diff --check` 若仍仅报告 `src/main/browser/browserHistory.ts:126` EOF 空行，则该问题为既有改动，不属于 v0.2.12。

---

## v0.2.13 — 三层暗色、统一 Titlebar、设置页、订阅账户与 3×3 合成台

> 性质：**仅 UI 重构迭代与既有状态/Action 接线，不涉及底层功能迭代；未启用 `my-workflow`**。

### 本轮完成

- 全局暗色阶梯收敛为底板/侧栏/Titlebar `#111111`、主工作区 `#1c1c1c`、Docked Header `#202020`、Composer `#262626`，主工作区继续使用 16px 内嵌圆角与细描边。
- 全局 Titlebar 收敛为 38px，加入侧栏、后退/前进、拉取请求、计划、工作、插件、技能、用量及自定义快捷入口；真实更新状态显示在窗口控制按钮左侧。
- Sidebar Logo/标题可返回空白主页；Footer 改为厂商 Logo 组合的“多账号登录”入口、独立“齿轮 + 设置”和更多菜单。
- “订阅账户”改为宽幅多厂商网格卡片，支持结构化多账号 Mock、账号状态、独立 5h 与周/月用量条，并保留既有真实 Provider 登录 Hook。
- Settings 增加统一的 38px Titlebar 与内嵌圆角主区，删除旧版底部返回/隐藏侧栏操作；设置侧栏底部统一为品牌、搜索设置与通知入口。
- Composer 将计划模式和权限体系合并为单一选择器，继续通过既有 `mode` / `permission` 控件 Action 接线；模型胶囊保留厂商 Logo、模型名与推理强度，用户可见 CLI 入口保持移除。
- `SessionMetrics` 增加可选 `weeklyQuotaPercent`，指标条显示周额度、5h 额度、输入/输出/缓存 Token 与缓存命中率。
- Hero 标题增大至 24px 级别，四张引导卡片加高并统一圆角。
- 合成台升级为真实 3×3 Crafting Grid：9 个 52px Slot、7 个 Ghost Slot、68px Result Slot；Model/Harness 拖放、Recipe/Crafter、Craft/Spawn 及旧测试标识继续复用真实链路。
- Windows 开发版 `AppUserModelId` 更新为 `com.craftstation.dev.v0.2.13`，原生窗口背景同步为 `#111111`。

### v0.2.13 验证

- TypeScript：`tsc --noEmit -p tsconfig.json` — **PASS**。
- 定向测试：6 个测试文件，`102/102` — **PASS**。
- oxlint：本轮核心 TS/TSX 文件使用 `--deny-warnings` — **PASS**。
- Production build：`pnpm build` — **PASS**；仅存在 Vite/CSS pseudo-element、sourcemap 与 chunk size 既有警告。
- 全量测试基线：809 个测试文件、9374 个测试通过；14 个测试文件、23 个测试失败。失败集中于 Windows macOS symlink 权限、旧 CraftStation 品牌断言、旧 1024 图标断言、ACP/PowerShell 包装命令漂移、USD 本地化、计时压力、旧 Dropdown Mock 与已删除 Composer 白色 glow 断言，不属于本轮 UI 接线范围。
- `git diff --check` 仅报告既有 `src/main/browser/browserHistory.ts:126` EOF 空行，本轮未覆盖用户或其他角色修改。
- 真实 Electron：`CraftStation (dev)` 已重启并保持运行，主进程 PID `37700`；截图为 `ai_workspace/temp/window_0.2.13_home.png`。

---

## v0.2.14 — UI 像素级修补与走样纠正

> 性质：**仅 UI 像素级修补与既有 Action 接线，不涉及底层功能迭代；未启用 `my-workflow`**。

### 本轮完成

- 主工作区与底板进一步解耦：右侧、底部外边距统一为 10px，保留 16px 大圆角，描边提升为 7% 白色并增加双层深色阴影，强化 Inset Panel 悬浮层次。
- 工作区工具面板开关继续固定在主卡片右上角内部；更新胶囊继续位于全局 Titlebar 窗口控制按钮左侧。
- Sidebar Logo 与文字点击改为调用真实 `openNewThread()`，直接返回新对话空白页；彻底删除中下部重复的 `+ 新线程` 横条，顶部只保留单一 `+ 新对话 / 项目` 入口。
- Hero 标题调整为 24px、半粗体和高亮白；四张引导卡片提升至最小 108px、高内边距与 `rounded-xl`，图标、标题和副文本纵向拉开，并增加轻微上浮 Hover。
- Docked Header 使用 `-mb-px` 与 Composer 单点咬合，移除重复负边距，消除上下拼接露底黑线；Composer 收敛为 `#272727` 与 8% 白色描边。
- 非紧凑 Composer 输入区最小高度提升到 56px，内部留白接近 `p-3.5`；权限胶囊、厂商 Logo、模型与推理强度继续复用真实控件。
- `SessionMetricsBar` 的周额度与 5h 额度槽统一为 `36px × 3.5px`，使用 `white/10` 暗槽与 `neutral-300` 填充，文字统一为弱灰单行指标。
- Windows 开发版 `AppUserModelId` 更新为 `com.craftstation.dev.v0.2.14`。

### v0.2.14 验证

- TypeScript：`pnpm typecheck` — **PASS**。
- 定向测试：5 个测试文件，`109/109` — **PASS**。
- oxlint：本轮 6 个核心 TS/TSX 文件使用 `--deny-warnings` — **PASS，0 warning**。
- Production build：`pnpm build` — **PASS**；仅存在既有 Vite、CSS `::highlight`、sourcemap 与 chunk size 警告。
- `git diff --check` 仍仅报告既有 `src/main/browser/browserHistory.ts:126` EOF 空行，本轮未覆盖用户或其他角色修改。
- 真实 Electron：`CraftStation (dev)` 已重新启动并最大化，Renderer 命令行已确认携带 `--app-user-model-id=com.craftstation.dev.v0.2.14`；桌面窗口保持运行。
- 截图：`ai_workspace/temp/window_0.2.14_home.png`。

---

## v0.2.15 — Codex 像素级色板、单圆角主区与模型用量弹窗

> 性质：**仅 UI 像素级重构与既有 Action 接线，不涉及底层功能迭代；未启用 `my-workflow`**。

### 本轮完成

- 全局底板、Titlebar 与 Sidebar 收敛为 Codex 冷黑色 `#121214`；Titlebar/Sidebar 使用 `rgba(18, 18, 20, 0.82)`、`blur(24px)` 与 `saturate(130%)`，Shell 保留实底避免透明窗口透出桌面。
- 主工作区改为 `#17181c`，只保留左上角 12px 圆角，其余三角为直角；右侧与底部贴边，仅顶部和左侧保留 5% 白色极细边线，删除上一版外边距和大阴影。
- Composer 阶梯色更新为 Docked Header `#1c1d22`、主输入底座 `#212228`；权限/计划胶囊、模型 Logo、推理强度和通用 `SessionMetrics` 继续复用既有真实控件。
- 工作区工具开关继续固定在主工作区内部右上角，不回退到全局 Titlebar。
- Sidebar Footer 删除多余 `...`，改为两行“模型与用量 / 新模型”，右侧仅保留“设置”；顶部“用量”和左下角“模型与用量”统一调用共享 Action。
- 新增全局阻挡型“🔑 模型与用量”弹窗状态与 Action，纳入 Overlay 判定；弹窗使用右上角 `✕`，移除底部关闭按钮。
- 厂商卡片按 OpenAI 兼容账户、Codex、Claude、GitHub Copilot、Cursor、Grok、Gemini 排序；未授权时保持紧凑，授权后才展开账号、状态和用量条。
- Provider 卡片与模型入口显式应用彩色厂商 Logo；真实 Provider 登录 Hook 保持接线，OpenAI 兼容入口继续跳转 Settings → agents。
- Windows 开发版 `AppUserModelId` 更新为 `com.craftstation.dev.v0.2.15`。

### v0.2.15 验证

- TypeScript：`pnpm typecheck` — **PASS**。
- 定向测试：2 个测试文件，`36/36` — **PASS**。
- oxlint：本轮核心 TS/TSX 文件使用 `--deny-warnings` — **PASS，0 warning**。
- Production build：`pnpm build` — **PASS**；仅保留既有 Vite、CSS `::highlight`、sourcemap 与 chunk size 警告。
- 本轮文件定向 `git diff --check` — **PASS**；未处理工作树中既有 `src/main/browser/browserHistory.ts` EOF 空行。
- 真实 Electron：`CraftStation (dev)` 已重新启动、最大化并置于前台，模型与用量弹窗保持打开；Renderer 已确认携带 `--app-user-model-id=com.craftstation.dev.v0.2.15`。
- 真实 Electron 截图：
  - `ai_workspace/temp/window_0.2.15_home.png`
  - `ai_workspace/temp/window_0.2.15_model_usage.png`

---

## v0.2.16 — 毛玻璃统一、已授权模型头像组与工具面板接线

> 性质：**仅 UI 细节精修与既有状态/Action 接线，不涉及底层功能迭代；未启用 `my-workflow`**。

### 本轮完成

- Sidebar 与 Titlebar 统一应用 `rgba(18, 18, 20, 0.82)`、`blur(24px) saturate(130%)` 毛玻璃材质；Sidebar 使用 5% 白色右边框，与顶部形成连续底板。
- 左下角“模型与用量”移除旧仪表盘图标，改为 18×18、1.5px `#121214` 描边的重叠 Provider Avatar Group。
- Avatar Group 直接从既有 `providerUsageStore` 派生已授权 Provider；无授权账户时默认展示 ChatGPT、Claude、Gemini，超过三个授权 Provider 时显示 `+N`。
- Footer 文案统一为“模型与用量 / ✨ 添加新模型”，整块区域继续调用共享 `openModelUsageDialog()` Action。
- “模型与用量”弹窗标题区只保留一个大钥匙图标，删除标题前重复小钥匙；`Codex` 用户可见名称正式调整为 `ChatGPT`。
- Provider 卡片按 ChatGPT、Claude、Gemini、GitHub Copilot、Cursor、Grok、Kimi Code 排序，并落地 OpenAI 绿、Claude 珊瑚橙、Gemini 蓝紫渐变、Copilot 深紫、Cursor 银灰、Grok 黑白、Kimi 深蓝品牌色。
- 主工作区右上工具栏开关固定为 `absolute top-3 right-3 z-20`，从全局 `auxiliaryPanelPlacement` 派生展开状态，并继续调用真实 `toggleAuxiliaryPanel("right")`；补充 `aria-pressed`。
- Workspace Frame 增加相对定位上下文；右侧多标签工具面板沿用既有响应式布局和宽度过渡，打开时主工作区平滑收缩。
- Windows 开发版 `AppUserModelId` 更新为 `com.craftstation.dev.v0.2.16`。

### v0.2.16 验证

- TypeScript：`pnpm typecheck` — **PASS**。
- 定向测试：3 个测试文件，`38/38` — **PASS**。
- oxlint：本轮核心 TS/TSX 文件使用 `--deny-warnings` — **PASS，0 warning**。
- Production build：`pnpm build` — **PASS**；仅保留既有 Vite、CSS `::highlight`、sourcemap 与 chunk size 警告。
- 本轮文件定向 `git diff --check` — **PASS**；未处理工作树中的既有或其他角色改动。
- 真实 Electron：`CraftStation (dev)` 已加载 `com.craftstation.dev.v0.2.16`；首屏、模型与用量弹窗、右侧工具面板展开/收起均在真实 Renderer 中完成验收。
- UI 运行态核验：
  - Titlebar 与 Sidebar 计算样式均为 `rgba(18, 18, 20, 0.82)`、`blur(24px) saturate(1.3)`，Sidebar 右边框为 5% 白色。
  - 弹窗标题为纯文本“模型与用量”，可见钥匙数量为 1；ChatGPT 命名及 OpenAI、Claude、Gemini、Copilot、Cursor、Grok、Kimi 品牌色均符合本轮规范。
  - 右侧工具开关 `aria-pressed` 在 `false -> true -> false` 间切换；展开过程中主区宽度由约 `2368px` 逐帧收缩至约 `1268px`，面板显示审查、终端、浏览器、文件、合成台入口，收起后主区恢复。
- 真实 Electron 截图：
  - `ai_workspace/temp/window_0.2.16_home.png`
  - `ai_workspace/temp/window_0.2.16_model_usage.png`
  - `ai_workspace/temp/window_0.2.16_tools.png`
