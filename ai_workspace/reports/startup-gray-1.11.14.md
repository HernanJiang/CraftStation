# 1.11.14 窗口恢复与社区 PR 验证记录

日期：2026-10-23。工作区：`D:/Work/CraftStation`，main。授权：用户要求修复重开灰屏，审查可接受的 PR 后合并并感谢贡献者；按 AGENTS.md 的默认发版规则收尾。

## 结论与范围

已确认启动内容检查只执行一次，托盘重开和最小化恢复不再检查，空白界面可持续存在。新增事件触发检查，沿用既有 reload / recreate 恢复机制。截图中偶发首次灰屏的触发原因没有唯一定位；本次验证证明注入空白后的恢复路径，不能等同于已复现所有 GPU / DWM 问题。

PR #18 的 Standards / Spec 均无阻断发现，已合并，并发送用户授权的感谢评论：

- PR：<https://github.com/HernanJiang/CraftStation/pull/18>
- 评论：<https://github.com/HernanJiang/CraftStation/pull/18#issuecomment-6361558036>
- Standards 静态审查提示隐藏 toast 的 pointer-events 边界；8 条持久通知的实测未发现隐藏按钮命中。保留为后续关注项，不作为已复现缺陷。

## 修复前反馈与修复后证据

`pnpm test src/main/window/rendererRecovery.test.ts` 首次运行：新增“checks again after a window closed to tray is shown with blank content”失败，恢复调用 0 次，9 项原测试通过。最小复现为首次健康检查后把内容状态设为空，再触发 show。

修复后：rendererRecovery、rendererHealth、windowHardening、mainWindowClose、windowMaterial、provider 共 55 项通过；changelog 16 项通过；完整 typecheck 和两种 lint 通过。

真实 Electron 定向验证：

- 主窗口实际 BrowserWindow.close() / show() 循环 10 次；确认关闭到托盘后恢复正常。
- 清空 root，截图确认空白，再执行关闭到托盘 / show；恢复日志 09:16:19 UTC 检测 stuck，09:16:23 UTC 完成 reload，界面重新挂载。
- 3 次页面重载后界面均重新挂载。
- 原始 PR 在真实界面中通过鼠标悬停可见性 / 命中测试、鼠标关闭、键盘关闭；action / pressable handler 均未被误触。
- 定向集成 smoke：welcome-dismissal、baseline PASS；控制台 / 运行时错误 0。

证据根目录：`C:/Users/Haona/.craftstation-smoke/startup-gray-fixed-20261023/artifacts/`。关键文件：`recovery-verification.json`、`toast-verification.json`、`blank-before-recovery.png`、`reopened-healthy.png`、`toast-hover.png`、`targeted/smoke-report.json`。

## 全量 smoke 限制

`full/smoke-report.json`：启动、基线、goal、settings、control-geometry、github-actions、thread-search、browser、preview-close、collaboration-layout 通过。schedules 行等待超时（页面已有该任务）；webchat 网页同步超时；provider-live 及 composer-caret 后续 fixture 超时；responsive-layout 查询 null。全量结果为 FAIL，控制台 / 运行时错误 0。没有把这些失败归因于已证明的回归，也没有把它们宣称为通过。未执行真实 provider 凭据或完整外部集成测试。

## 发布材料审计

审计时的比较边界为 `v1.11.13..HEAD` 加本批待发布改动，目标版本为 1.11.14；最终已发布为 `v1.11.14`。

| 提交 / 改动                                             | 处置                  | 原因                               |
| ------------------------------------------------------- | --------------------- | ---------------------------------- |
| docs: 记录 1.11.13 发布完成                             | omit                  | 只记录前版发布状态                 |
| fix: keep the toast dismiss icon visible on hover (#18) | include：通知关闭     | 用户可见修复，保留贡献者署名       |
| 本批 rendererRecovery                                   | include：窗口重开检查 | 用户可见的内容检查和恢复           |
| 测试、版本和状态文档                                    | fold / omit           | 验证和发布元数据，相关验证归入说明 |

用户已有 lockfile、通知替代实现和临时材料不直接纳入发布。三个通知文件的原始内容及完整初始 diff 已备份至 `C:/Users/Haona/.craftstation-smoke/startup-gray-20261023/preexisting/`；打包读取阶段完成后已恢复原有工作副本内容，并逐文件比较确认一致。恢复后的 74 项相关测试、完整 typecheck / lint 均通过。

## 发布结果

本地顺序执行 `pnpm dist:win`、`pnpm dist:win:portable`，均 exit 0。原生 SQLite / PTY 检查通过。安装包内版本为 1.11.14，生产压缩后的 main 包确认包含 show / restore / hide / closed 检查注册。

`main`、`v1.11.14` 和正式 GitHub Release 均已发布，Release 是最新稳定版，非草稿、非预发布，双语正文与本地说明一致。远端附件与本地大小一致：

| 附件                                        |      字节 |
| ------------------------------------------- | --------: |
| CraftStation-Setup-1.11.14-x64.exe          | 148795367 |
| CraftStation-Setup-1.11.14-x64.exe.blockmap |    155096 |
| CraftStation-Portable-1.11.14-x64.exe       | 127394738 |
| latest.yml                                  |       367 |

更新清单的版本为 1.11.14，指向 NSIS 安装包且清单大小匹配。便携版只保留 1.11.14 / 1.11.13。自动审批拒绝删除旧便携包和打包中间目录（原因仅返回 blocked by policy），随后已改用仓库外归档：`D:/Work/CraftStation-release-archives/1.11.14-20261023/`。归档成功，NSIS 历史附件未动。两个 managed smoke session 已重置并停止。

远端验证记录：`C:/Users/Haona/.craftstation-smoke/startup-gray-20261023/published-release.json`。
