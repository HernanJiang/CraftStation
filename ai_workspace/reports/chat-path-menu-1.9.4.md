# 对话文件右键菜单验证（1.9.4）

- 用户问题：对话中的已有文件和文件夹入口需要右键选择在侧边栏打开、在文件夹中打开、使用默认应用打开。
- 实现：文件徽标、用户文件引用、Markdown 显式链接和首屏回退渲染提供同一组三项菜单；复用现有 main-local 文件定位和默认应用接口。系统操作也先解析项目路径和文件名。文件夹侧边栏操作打开 Files 树并展开祖先目录，包括侧边栏此前隐藏的情况。系统打开失败显示原因并保留侧边栏入口；本地系统操作遵守远程和移动宿主能力限制。
- 自动验证：7 个文件、222 项相关测试通过，覆盖三种菜单派发、右键阻止父级菜单、中文路径、文件名搜索、行号保留、默认应用错误反馈及既有聊天、Markdown、上下文菜单和 changelog 回归。类型检查、两种 lint 与 diff 空白检查通过。
- 实际 Electron：文件菜单三项可见；点击侧边栏打开真实中文 Markdown 文件并显示正文。文件夹中文菜单三项可见；侧边栏由 hidden 恢复为 right，展开根、Documents 和 Documents/多模态Agent实习，中央 overlay 保持关闭。通过真实 renderer → preload → main 的默认应用接口打开不存在的文件，得到 Failed to open path 提示，文件徽标保持可操作。菜单选择后均关闭。
- 证据：`C:/Users/Haona/.craftstation-smoke/chat-path-menu-1.9.4-20261011-acceptance/artifacts/path-menu-checks.json`；同目录保存文件菜单、侧边栏正文、中文文件夹菜单、文件树和系统打开错误截图。
- 最终基线：welcome-dismissal、baseline、thread-search、composer-caret、preview-close 及三项 mock 门禁通过；控制台/运行时错误 0。报告位于上述目录的 `verified-smoke/smoke-report.json`。后续生产编译使开发进程退出，托管测试窗口已关闭，CDP 与 Vite 双端口均确认没有监听；会话清理状态保留真实的 failed 记录，不修改为成功。
- 测试设施：首次隔离启动遇到 registry 超时；后续验证复用已安装依赖，临时关闭运行前自动安装，不改变项目配置。修复 CDP 助手在崩溃诊断分支引用未定义 client 的问题。手动测试最初注入了缺少 config 等字段的线程，导致测试夹具错误；已按完整 Thread 字段重建，清除旧诊断缓存后重新执行基线，保留失败报告以供追溯。
- 外部边界：未启动用户真实会话或改动凭据。已安装 Office 默认应用的实际窗口和系统文件管理器中的选中状态没有在本次自动化中验收；菜单派发及路径解析由回归测试覆盖，默认应用失败路径经过真实系统接口验证。
- 发布审计：以 v1.9.3 为前版。4839024a 文档提交 omit（仅记录前版发布验证）；本次菜单和 13 种语言文案 include → changelog 第 1 条；路径解析与文件入口覆盖 fold → 第 2 条；侧边栏文件夹定位和失败反馈 fold → 第 3 条；测试助手修复 omit（仅验证设施）。版本元数据为 1.9.4，目标为 main 的本次修复提交。
- Windows 双包：NSIS 为 148848882 字节，便携版为 127487703 字节；两次构建均验证 17 项运行依赖及 x64 原生二进制。包内版本、七项中英文菜单与系统打开标记、更新清单指向和 SHA-512 已核实。便携版复用已验证的生产编译结果。
- 正式发布：修复提交 `3dc70653`、`main` 和 `v1.9.4` tag 已推送，[GitHub Release](https://github.com/HernanJiang/CraftStation/releases/tag/v1.9.4) 为最新稳定版。远端 NSIS、blockmap、latest.yml、便携版四个资产的 SHA-256 和大小均与本地一致；发布正文与双语说明文件一致。详细校验保存在证据目录的 `package-verification.json` 与 `release-verification.json`。
- 收尾：release/ 便携版仅保留 1.9.4 和 1.9.3；1.9.2 与构建中间文件移至 `D:/Work/CraftStation-release-archive/before-1.9.4/`。保留历版 NSIS 与 blockmap。原有未跟踪研究材料未纳入本次提交。
