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

此前稳定版为 `v1.10.0`；目标为当前 `main` 的 1.10.1，核对时尚未创建目标 tag。

| 提交或变更                                           | 处理 | 原因                                        |
| ---------------------------------------------------- | ---- | ------------------------------------------- |
| `460be528 chore: bump to next patch version`         | 省略 | 仅版本推进，无用户行为变化。                |
| `48a62390 docs: record v1.10.0 release verification` | 省略 | 仅记录上一版发布证据。                      |
| 本轮电脑操控图标修正                                 | 收录 | 用户可见的旧品牌图标替换。                  |
| 本轮 Claude Harness 补齐                             | 收录 | 恢复官方 Harness 市场、设置和原生匹配入口。 |

已有 `pnpm-lock.yaml` 修改与未跟踪临时材料保留，不纳入本次提交。
