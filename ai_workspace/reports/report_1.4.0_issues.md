# v1.4.0 发布前问题修复报告

本报告承接第二轮架构与性能优化。用户追加授权修复 GitHub 未完成问题、Antigravity 额度及授权删除，并打包上传；语言结构按用户决定保持。

## 问题核验

| 问题                             | 核实结果与处理                                                                                                                                                        | 证据                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| #1 兼容桥配方无法保存            | 确认残留 Bug：弹窗只允许 NATIVE；同时打开弹窗前已持久化。允许 CRAFTABLE 确认保存，保留兼容状态，取消不落库，回车也遵守可保存条件。启动仍做验证。                      | `RecipeSaveDialog.test.tsx`、`CraftingWorkbenchPage.test.tsx`             |
| #8 Antigravity 额度              | 真实旧模型接口返回全部剩余 1，但汇总接口的 Claude 周余额为 0.66428894 / 0.9425456。模型接口没有周额度；池与单渠道读取统一优先使用账户自己的汇总接口，保留旧接口降级。 | `antigravityProfiles.test.ts` 红→绿；真实 UI 四窗口与 34% / 6%            |
| #9 新项目首会话完全访问权限      | 原有修复及 v1.4.0 默认权限统一路径保留；显式设置优先、错误输入保守、计划/草稿/运行权限语义不丢失。                                                                    | shared agents、前轮原生/structured/PTY 契约测试                           |
| #10 任务栏完成指示               | 已有实现，未重复添加。Windows 未读完成角标与注意状态保留。                                                                                                            | `taskbarAttention.test.ts`、`MainTitlebar.test.tsx`                       |
| #11 更新长期 0%                  | 已有下载字节/速度、无进度 watchdog、浏览器下载兜底，复验未回归。                                                                                                      | `autoUpdater.test.ts`、`CliUpdateMenu.test.tsx`；未覆盖真实覆盖安装       |
| #12 Devin 登录找不到命令         | 已有绝对 executablePath 登录启动修复；PowerShell 和 POSIX 引用均复验。                                                                                                | `devin.test.ts`、`agentLoginActions.test.ts`；未代替用户完成新 OAuth 登录 |
| 用户追加：Devin/其他渠道无法删除 | Devin 清理路径过去缺失；Cookie/OpenCode 删除错误被吞；外层忽略 false；旧额度请求可回填缓存。补齐凭据路径复用、错误传递和请求代际隔离，清理 Devin 身份缓存。           | 主进程/Hook/UsageService 红→绿；隔离系统目录的真实界面删除                |

GitHub 查询时仅以上 6 个 Open Issues；其余 #2/#3/#4/#5/#7 已关闭，不重复发布旧修复。关闭问题的状态不等于本轮重新完成所有外部场景。

## 验证

- 本轮定向 27 文件 / 320 测试通过；版本记录与弹窗 2 文件 / 18 测试通过，覆盖重叠。
- 最终类型检查、完整 lint 通过。完整 mock smoke 复跑 9 个自动场景和 16 个模拟门通过，错误列表为空。首次运行因手动验证残留的额度面板遮挡计划页面而失败；关闭面板并确认 DOM 后复跑成功，原失败日志保留。最终报告位于 `v140-logout-fixture/artifacts/full-reset/smoke-report.json`。
- Antigravity：隔离副本复用现有凭据，真实 IPC 返回两个账号各 4 个窗口；界面出现 34% / 6%。通过实际删除按钮移除一个账号，刷新后仍不存在，另一账号额度有效。源账号与凭据未修改。
- Devin：mock 环境仅提供隔离 OS HOME/APPDATA；删除操作使用真实 Electron renderer → IPC → 主进程文件清理链路。两处合成凭据文件均不存在，`deletedIdentityAbsent=true`、`canLogin=true`。这不是一次真实外部 OAuth 重登录。
- 自动化操作一次动态导入出现 CDP `Promise was collected`，实际操作已完成，经 DOM 和文件检查确认后未重复执行删除。
- 证据目录：`C:/Users/Haona/.craftstation-smoke/v140-issues-final/artifacts/`（真实额度截图）、`C:/Users/Haona/.craftstation-smoke/v140-logout-fixture/artifacts/`（Devin 与全量 mock smoke）。脱敏原始响应与测试日志在 `ai_workspace/validation/1.4.0/`，不提交秘密或真实身份截图。

## 功能保全与性能

本轮未改变语言实现、官方 Harness 内部能力、池调度、降级接口与 Recipe 启动校验。额度只读旧窗口仍为旧版本服务保留；缺失窗口不伪造百分比。授权删除只操作明确管理的凭据文件，OpenCode 同文件其他 provider 项保持。环境变量提供的 Devin 凭据无法通过删文件移除，界面会说明来源及处理方式，不能假报删除成功。

性能沿用 `report_1.4.0_round2.md` 的最终对照，不借本轮修复夸大整体提速：单线程持久化、保留高亮堆和安装内容有测量改善；8 线程交错没有显著提速，逐事件全读历史压力用例仍有退化，整机 CPU/内存没有匹配基线。本轮汇总成功时不再额外请求模型额度，但未对该网络路径宣称固定速度提升。

## 发布记录核对

从 v1.3.4 到候选的非 merge 提交逐项处置：`docs(1.3.4): mark released` 为上一发布状态记录，omit；`refactor: unify crafting runtime and optimize resources for v1.4.0` 纳入架构、权限、聊天、持久化和性能条目；`docs: record v1.4.0 candidate delivery and verification limits` 折入验证；本次问题修复纳入额度、授权、配方和版本记录条目。未将已有 #9/#10/#11/#12 修复重复宣称为本轮新增功能。

继承的 2026-06-28 同号 changelog 原文归档于 `changelog_1.4.0_inherited.json`；同号条目改为本仓库 2026-09-19 发布说明，其他历史条目保留。应用 changelog URL 改为本仓库的原始文件，避免读取不属于本项目的域名内容。双语说明见 `../release-notes-1.4.0.md`。

## 未验证项

未逐一验证全部 8 个账号与所有渠道的真实 OAuth 删除后重新登录；未执行用户正在运行的 1.3.4 的覆盖安装；完整外部问答/审批/steer/模型切换矩阵、跨 Harness handoff、真实 MCP/Computer Use、SSH/WSL、其他桌面平台与移动真机仍以第二轮报告的边界为准。自动化和 fixture 证据不替代这些验收。
