# CraftStation 1.10.1

补齐 Harness 总览中的 Claude Code，电脑操控悬浮指针改用 CraftStation 金色合成台 Logo。

## 用户可见

- Claude Code Harness 现已出现在 Harness 总览与市场，支持安装、更新、状态刷新和登录设置跳转；未选择 Claude 模型时也能找到。
- 选择 Claude 模型后，连线指向 Claude Code Harness；原生组合不再要求兼容桥。
- 电脑操控指针中的旧 `P.` 标志替换为 CraftStation Logo，保留原有尺寸、位置与点击动画。

## 实现

- 补齐 Claude 官方 Harness 目录、检测范围与设置路由，复用现有 Claude Agent SDK 和 CLI 管理链路。
- 将 `claude` 与 `anthropic` 归一为同一模型供应商，修正原生匹配。
- 复用已有应用图标资源，开发环境与打包环境分别读取对应资源路径。
- 生成 80px 内嵌 PNG，以 40px 显示，适配高像素密度屏幕。

## 验证

- 339 项相关测试通过；完整类型检查与变更文件的普通、类型感知 lint 通过。
- 真实 Electron 指针显示验证通过，覆盖开发路径与模拟打包资源路径，运行时错误为 0。
- 隔离 Electron 的 Claude 市场入口和官方 Logo 验证通过；基线及三项 mock 门禁通过，控制台及运行时错误为 0。
- 模拟已安装但未登录状态时，实际 Electron 页面显示 Claude 设置与登录按钮。
- 真实 Claude 登录与付费对话回合未在本轮测试。
- 本补丁提供 Windows x64 安装包与便携版。

---

# CraftStation 1.10.1

Claude Code is now listed in the Harness overview, and the desktop control pointer shows the CraftStation crafting logo.

## User-facing

- Claude Code Harness now appears in the overview and marketplace, with installation, updates, status refresh, and a link to login settings, even before selecting Claude models.
- Selected Claude models connect to Claude Code Harness, and native pairings no longer require the compatibility bridge.
- The computer control pointer replaces the old `P.` mark with the CraftStation logo while retaining its size, position, and click animation.

## Implementation

- Adds the Claude official Harness descriptor, detection scope, and settings route, reusing the existing Claude Agent SDK and CLI management.
- Normalizes `claude` and `anthropic` to the same model vendor to correct native pairing.
- Reuses the existing application icon resource with the appropriate paths for development and packaged builds.
- Embeds an 80px PNG displayed at 40px for high pixel density screens.

## Verification

- 339 relevant tests passed; full type checking and standard and type-aware lint for the changed files passed.
- Real Electron pointer display checks passed for development and simulated packaged resource paths, with no runtime errors.
- The isolated Electron Claude marketplace entry and official logo checks passed; the baseline and three mock gates passed with no console or runtime errors.
- With a mocked installed but signed-out state, the actual Electron page displays Claude settings and its login button.
- Real Claude login and paid conversation turns were not tested in this pass.
- This patch provides Windows x64 installer and portable packages.
