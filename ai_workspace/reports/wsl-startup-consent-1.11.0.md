# WSL 启动确认验证（1.11.0）

- 工作区：`D:/Work/CraftStation`，`main`；按用户追加要求纳入本次集中发布，内部记为 `1.10.3e`。
- 用户要求：CraftStation 默认不唤起 WSL，主动使用前需确认；Muse 的 WSL 路径暂不使用。已按用户指示执行 `wsl --shutdown` 并确认 `VmmemWSL` 退出，没有修改 Windows 自启设置。

## 行为与实现

- 每次应用运行，主进程为 supervisor 设置关闭的 WSL 启动门禁。后台状态与凭据扫描、桥接初始化和网络/UNC 探测在未授权时跳过 WSL。
- 主动启动 WSL 对话、终端、Windows Muse 或选择 WSL 目录时，由主进程显示原生确认框；默认按钮为“取消”，关闭确认框同样取消。
- 取消不发送授权或启动请求。并发操作共用同一确认结果；成功授权只覆盖本次应用运行，退出后重新确认，supervisor 意外重启可保留本次已授予的许可。
- 原生 Windows、Linux、macOS 启动行为保持原有路径；不删除 Muse 能力，也不改变系统启动项。

## 验证

- 11 个相关测试文件共 90 项通过，包含取消后的零启动请求、UNC 后台读取被拦截、并发确认、授权失败、WSL 命令与桥接/网络探测门禁、扫描跳过，以及原生启动路径。
- 完整类型检查、变更文件普通 lint 与类型感知 lint 通过。
- 隔离 Electron 启动、设置页与全量模拟检查期间，系统未出现 `VmmemWSL`。原生确认框截图已人工查看；确认框显示前 WSL 仍关闭，随后仅关闭该隔离会话拥有的确认框，实际返回 `WSL_STARTUP_CANCELLED`，WSL 继续关闭。
- 全量模拟检查 15 项中 14 项通过，17 个 mock 门禁通过，控制台/运行时错误 0。网页对话检查在 `craftstation-webchat-smoke.mjs:221` 的“导入源网页没有复用线程或标签”断言失败；本批未修改该功能，不宣称全量通过。
- 未确认真实 WSL 启动、未运行真实 Muse 或账号模型回合；允许分支由不启动真实进程的测试覆盖。

证据目录：`C:/Users/Haona/.craftstation-smoke/wsl-consent-1.11.0-20261018/artifacts/`。原生框截图为 `wsl-native-consent.png`；完整模拟记录为 `smoke-report.json`。测试及类型/lint 日志保留于 `ai_workspace/*-1.11.0-wsl.log`。

Windows 首轮双包生成后用户追加本项，已从更新后的源码重新构建 NSIS 与便携版并核验包内门禁；正式三端流水线与 1.11.0 发布完成。发布记录见 `ai_workspace/reports/release-1.11.0.md`。
