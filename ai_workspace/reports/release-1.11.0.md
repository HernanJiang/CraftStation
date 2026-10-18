# CraftStation 1.11.0 发布验证

- 日期：2026-10-18。
- 工作区：`D:/Work/CraftStation`，`main`。按用户授权集中发布内部迭代 `1.10.3a/b/c/d/e`。
- 正式版本：[v1.11.0](https://github.com/HernanJiang/CraftStation/releases/tag/v1.11.0)，tag 指向 `a9dfdc4d`，包含最终 WSL 启动确认改动。
- [稳定版流水线 39096439780](https://github.com/HernanJiang/CraftStation/actions/runs/39096439780) 的 Windows、Linux、macOS 构建、发布和发布后版本推进均成功。main 开发版本已自动推进到 `1.11.1`，正式发布保持 `1.11.0`。

## 发布内容

- `Alt+Space` 呼出置顶临时对话，可改快捷键；收起后可恢复，关闭即删除线程，不进入主聊天历史。临时窗继承勾选模型并独立记忆最后模型。
- 已选模型与配方稳定置顶，取消后恢复目录顺序；修复窄窗参数菜单越界、缩放布局及菜单拖动区域问题。
- 代理取消失败时保留停止兜底，避免补充消息持续等待引导。
- Windows 每次应用运行默认关闭 WSL 启动门禁，后台扫描跳过未授权环境；用户主动使用时经原生确认框放行，取消不启动，退出应用后需要重新确认。本机已执行 `wsl --shutdown`，发布收尾检查仍未发现 `VmmemWSL`。

## 验证结果与边界

- 合并后 15 个相关文件的 184 项回归、完整类型检查、普通 lint、类型感知 lint 和构建通过。
- 临时对话与模型选择已有 155 项相关单测、48 组 Electron 布局检查，以及模拟对话、主历史/数据库隔离、关闭新建线程、模型记忆和快捷键改绑证据；等待引导修复另有 68 项回归与隔离界面检查。
- WSL 追加改动的 11 个文件、90 项相关回归通过。隔离 Electron 中后台启动和设置扫描未启动 WSL；关闭真实原生确认框返回 `WSL_STARTUP_CANCELLED`，WSL 保持关闭。
- 最新全量模拟检查 14/15 通过，17 个 mock 门禁通过，控制台/运行时错误 0。网页对话导入源复用断言未通过；前序检查另有网页同步超时及主窗代码预览在 150% 缩放下的原生关闭命中失败。本批未修改这些范围，不宣称全量烟测通过。
- 未运行真实账号模型回合或真实 Muse/WSL 启动；允许启动分支由不启动真实进程的测试覆盖。隔离测试实例已重置并关闭。

## 打包和附件核对

- 本地按顺序完成 x64 NSIS 与便携版，WSL 改动追加后已重新双包。17 项运行依赖检查、Electron 原生 SQLite 重建及包内版本、临时对话、WSL 门禁核验通过。
- GitHub Release 非草稿、非预发布，并确认为最新稳定版；共 12 项附件，均已上传且大小有效。发布正文与 `ai_workspace/release-notes-1.11.0.md` 的中英双语说明一致。
- Windows 提供 x64 NSIS、blockmap、便携版与 `latest.yml`；Linux 提供 x86_64 AppImage、amd64 deb 与清单；macOS 提供 arm64 DMG、ZIP、各自 blockmap 与清单。
- 三端更新清单版本均为 `1.11.0`，所有文件引用及大小与正式附件匹配；Windows 清单指向 NSIS 安装包。
- 正式 Windows 安装包为 133162973 字节，便携版为 112372667 字节，blockmap 为 138210 字节。正式双包、blockmap 和三端清单已下载至根仓库 `release/`，本地大小与远端一致。
- 本地构建与 CI 产物分别验证；本地候选核验记录不替代正式远端附件核对。未额外进行 SHA 校验。

核验记录保存在 `ai_workspace/release-1.11.0-local-verification.json` 与 `ai_workspace/release-1.11.0-published-verification.json`；构建日志为 `ai_workspace/build-1.11.0-final-nsis.log` 和 `ai_workspace/build-1.11.0-final-portable.log`。

## 本地收尾

- `release/` 便携版仅保留最新 `1.11.0` 与上个稳定版 `1.10.3`。
- `1.10.2` 便携版、`win-unpacked/` 和 `builder-debug.yml` 已归档至 `D:/Work/CraftStation-release-archives/1.11.0-20261018/`；历史 NSIS 与 blockmap 保留。
- 原有 `AGENTS.md`、`pnpm-lock.yaml` 和无关临时/研究资料保留，不纳入本次发布提交。
