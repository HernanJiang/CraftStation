# CraftStation v1.9.4

## 用户可见

- 对话中的文件、文件夹徽标和 Markdown 文件链接新增右键菜单：在侧边栏打开、在文件夹中打开、使用默认应用打开。
- 文件仍可左键快速打开；文件夹的侧边栏操作展开右侧文件树，保持对话可见。
- 相对路径、文件名引用和带行号的引用复用项目路径解析；默认应用打开失败会显示原因，仍可在侧边栏查看。

## 实现

- 复用现有文件管理器的系统定位和默认应用接口，覆盖回复、用户文件引用与 Markdown 首屏回退渲染。
- 补齐 13 种界面语言的菜单文案；远程和移动端继续按宿主能力提供可用操作。
- 修复隔离测试助手在读取渲染器崩溃信息时使用未定义变量的问题。

## 验证

- 222 项相关测试、类型检查和两种 lint 通过；实际 Electron 文件预览、文件夹展开、中文菜单和系统打开失败反馈通过。
- Electron 基线与三项 mock 门禁通过，控制台/运行时错误 0；Windows x64 安装包与便携版均校验版本、更新清单与原生依赖。已安装 Office 默认应用及系统文件管理器的窗口未在本次自动化中验收。

---

# CraftStation v1.9.4

## User-facing

- Right-click file and folder badges or Markdown file links in conversations to open them in the sidebar, reveal them in their folder, or open them with the default application.
- Left-click still opens files directly. Opening folders in the sidebar expands the Files tree while keeping the conversation visible.
- Relative paths, bare filename references, and line references share project path resolution. Default application failures show a reason while keeping sidebar access available.

## Implementation

- Reuses the file manager's existing system reveal and default application interfaces across assistant replies, user file references, and initial Markdown fallback rendering.
- Adds menu translations for all 13 interface languages. Remote and mobile hosts continue to expose operations according to their capabilities.
- Fixes an undefined variable in the isolated test helper's renderer crash diagnostics.

## Verification

- All 222 related tests pass, along with type checking and both lint modes. File previews, folder expansion, translated menus, and system opening failure feedback pass in real Electron.
- Electron baseline scenarios and three mock gates pass with zero console or runtime errors. Both Windows x64 packages are checked for version, updater metadata, and native dependencies. Installed Office application and native file explorer windows were not exercised by this automation.
