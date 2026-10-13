# Claude Harness 与电脑操控图标修正 1.10.1

用户截图中的悬浮指针来自 `ComputerUseDesktopOverlay` 内嵌的 Pora SVG。本次复用 CraftStation 的现有应用图标资源，将其转为 80px 内嵌 PNG，以原来的 40px 显示。

Claude 遗漏的根因是 `NATIVE_HARNESS_DESCRIPTORS` 没有注册 Claude，因此目录投影不会生成市场入口。现有安装、登录和 Claude Agent SDK 会话实现保持复用；补齐目录、检测范围和设置路由，并将 `claude` 映射为 `anthropic`，修正 Claude 模型的原生组合。先复现目录缺失、设置误跳 ACP、检测遗漏与原生匹配失败，修复后对应回归通过。

## 验证

- 17 个文件的 339 项相关测试通过，涵盖指针生命周期、Harness 状态投影、安装入口、设置跳转、模型连线、官方品牌、原生执行匹配、线程启动及现有 Claude SDK。
- 完整类型检查通过；变更文件普通、类型感知 lint 通过。
- 隔离 Electron 的 `welcome-dismissal` 和 `baseline` 通过，控制台及运行时错误为 0。
- 证据：`C:/Users/Haona/.craftstation-smoke/computer-logo-20261013/artifacts/baseline/smoke-report.json`。
- 独立真实 Electron 指针验证通过：开发路径和模拟打包资源路径下 Logo 均为 80px PNG、40px 显示，无旧 SVG，运行错误为 0；图片和结果在 `C:/Users/Haona/.craftstation-smoke/computer-logo-native-20261013/`。
- 实际 Supervisor 的公开目录包含 Claude，未安装状态下的市场入口与官方 Logo 显示正确。最终 Electron 基线及 `changed-surface`、`ipc-roundtrip`、`project-mutations` 三项 mock 门禁通过，控制台/运行时错误 0。证据在 `C:/Users/Haona/.craftstation-smoke/claude-harness-20261013/artifacts/final/smoke-report.json`，截图在同级的 `claude-marketplace-final.png`。
- Claude 设置仅在已安装时显示；未安装的隔离测试状态直接跳转会显示已有的 “Agent not found”，市场行实际操作为打开安装器。该探针不作为真实登录失败证据。
- 已安装但未登录的模拟状态下，真实 Electron 显示 Claude 设置与 Login 按钮。截图在 `C:/Users/Haona/.craftstation-smoke/claude-settings-20261013/artifacts/claude-login-page.png`；恢复状态后再次运行基线及三项 mock 门禁通过，错误为 0。两次 Harness 测试窗口均已正常退出。
- 未在本轮执行真实 Claude 登录、付费 Agent 回合或驱动真实桌面输入。

## 发布范围核对

此前稳定版为 `v1.10.0`；本版 `v1.10.1` tag 指向修复提交 `7b87f137`，发布范围为 `v1.10.0..v1.10.1`。该修复提交收录于下表的图标和 Claude 两条。

| 提交或变更                                           | 处理 | 原因                                        |
| ---------------------------------------------------- | ---- | ------------------------------------------- |
| `460be528 chore: bump to next patch version`         | 省略 | 仅版本推进，无用户行为变化。                |
| `48a62390 docs: record v1.10.0 release verification` | 省略 | 仅记录上一版发布证据。                      |
| 本轮电脑操控图标修正                                 | 收录 | 用户可见的旧品牌图标替换。                  |
| 本轮 Claude Harness 补齐                             | 收录 | 恢复官方 Harness 市场、设置和原生匹配入口。 |

已有 `pnpm-lock.yaml` 修改与未跟踪临时材料保留，不纳入本次提交。

## 构建与发布

- `pnpm dist:win`、`pnpm dist:win:portable` 均成功，17 项打包运行依赖与 Windows x64 原生二进制检查通过。
- NSIS 为 148852740 字节，便携版为 127497816 字节。包内版本为 1.10.1，Claude 官方目录和新的指针图标代码均存在，`app-icon.png` 已包含。
- `latest.yml` 仍指向 NSIS，版本与安装包大小匹配；没有被便携版清单覆盖。
- [v1.10.1 GitHub Release](https://github.com/HernanJiang/CraftStation/releases/tag/v1.10.1) 已正式发布为最新稳定版。四项附件的名称、大小与本地一致，正文与本版中英双语说明一致。
- 本地便携版保留 1.10.1 与 1.10.0；1.9.4 便携包、`win-unpacked` 和 `builder-debug.yml` 已归档至 `D:/Work/CraftStation-release-archives/1.10.1-20261013/`，各版安装包和更新清单保留。
- 包验证数据在 `C:/Users/Haona/.craftstation-smoke/claude-settings-20261013/package-verification.json`。
