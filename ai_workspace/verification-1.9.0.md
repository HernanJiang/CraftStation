# 1.9.0 验证与发布

## 已实现并验证

- 网页正文与组件：真实 Electron renderer → preload → main → 原网页，隔离固定网页全流程 16 项通过。输入 9、计算器返回 81、滑块改变图表，公开 MCP Apps 形状的初始化与工具调用仍由原宿主处理。
- 展开/关闭、继续修改草稿、480px 发送、多轮停止、网页强度读取和应用、导入去重、删除取消/确认及活动回合断线均通过。PNG 保存验证当前图像字节传递到既有原生保存接口。
- Mermaid：截图原始代码先在真实 Mermaid 失败，有限修复后真实 Electron 显示 9 个节点、12 条连线。相关回归先失败后通过；复制保持原文。
- Ultrafast：明确不支持的套餐和未开放的目录会在提交前拒绝；目录可撤回选项，后续回合使用新档位；仅明确的实际档位报告才确认，完成回复或请求回显不算证据。确认、降档、拒绝和未报告状态已覆盖。
- 582 项相关测试及 22 项新增/发布说明检查通过，4 项条件性用例未运行。类型检查与两种 lint 通过。相关冒烟 7 个场景、4 个 mock 门禁通过，控制台与运行时错误为 0；mock provider 门禁不能代替真实账号验收。

## 证据

- 最终网页与相关冒烟：`C:/Users/Haona/.craftstation-smoke/web-widgets-1.9-acceptance-20261009/artifacts/`，所属测试进程已停止。
- Mermaid 回放：`C:/Users/Haona/.craftstation-smoke/web-widgets-1.9-final-20261009/artifacts/mermaid-repaired.png`，所属测试进程已停止。
- 工作区检查：`ai_workspace/tests-1.9-final.log`、`tests-1.9-final-small.log`、`typecheck-1.9-release.log`、`lint-1.9-release.log`。

## 外部验收待完成

1. 用户账号的完整本地 UI 网页回合，以及真实 Visualizations 和第三方 MCP Apps 组件。历史已有真实网页提交、生成中回复读取、实际强度读取等局部证据，本轮固定网页不能替代当前账号的完整验收。
2. 具有 Ultrafast 权限的真实账号。CLI 0.161.0 已执行无文件读写的真实回合，但明确提示模型目录未声明 Ultrafast、参数会被省略，随后普通回复成功；此结果不能算 Ultrafast 生效。当前候选会阻止这种静默省略；实际档位未报告时继续显示未报告。

## 候选构建记录

正式发布前，版本工作树中的 Windows x64 双包已通过 `pnpm dist:win`、`pnpm dist:win:portable` 构建，生产编译、17 项运行依赖和原生二进制检查通过：

- 版本工作树 `release/CraftStation-Portable-1.9.0-x64.exe`：112549539 字节。
- 版本工作树 `release/CraftStation-Setup-1.9.0-x64.exe`：133426990 字节。
- NSIS blockmap 与 latest.yml 保留，更新清单指向安装包。候选 release 下的打包中间文件已移出，归档至 `D:/Work/CraftStation-release-archive/candidate-1.9.0-intermediates/`；稳定版的 release 目录未改动。

在方便重启时退出旧版并打开候选便携版，从“新增 → 网页对话 → ChatGPT”进入，登录或复用自己的网页登录状态，在新的临时网页对话中验证完整回复及组件交互。Ultrafast 需要官方目录明确提供该档位的账号；实际档位没有报告时，验收结果继续记为未报告。

## 正式发布

用户查看 dev 后明确授权“直接发布吧”。版本分支已快进合入 main，正式发布提交为 `99dcbe56`；[三端 stable 工作流](https://github.com/HernanJiang/CraftStation/actions/runs/37911587289) 的所有构建、发布与发布后任务全部通过。[v1.9.0](https://github.com/HernanJiang/CraftStation/releases/tag/v1.9.0) 已设为最新稳定版，12 个资产均上传完成，正文为本版中英双语说明：

- Windows x64 NSIS（133319374 字节）、便携版（112501660 字节）、blockmap 与 `latest.yml`。
- Linux x64 AppImage、amd64 deb 与 `latest-linux.yml`。
- macOS arm64 DMG、自动更新 ZIP、两份 blockmap 与 `latest-mac.yml`。
- 三端清单版本均为 1.9.0，分别指向正式 NSIS、AppImage 和 ZIP；按用户要求只核对版本、文件、大小，不额外检查 SHA。

发布工作流自动把 main 的后续开发版本推进到 1.9.1，正式 tag 保持 v1.9.0。网页映射仍标为实验，上述外部真实账号验收边界保留；正式构建成功不替代这些账号能力的验收。

正式 Windows 双包、blockmap 和三端清单已下载至根仓库 `release/`，六个文件大小与 GitHub 资产一致，三端清单的版本及目标已核对。便携备份只保留 1.9.0 与 1.8.9；旧 1.8.8 已归档到 `D:/Work/CraftStation-release-archive/before-1.9.0/`，历版安装包与 blockmap 保留。用户试用的 1.9.0 dev 窗口继续运行。
