# CraftStation v1.8.8

Harness 市场加入 Pi，流程图和窄输入区更顺手。

## 用户可见

- Harness 总览中的“未关联”改为“Harness 市场”，加入 Pi；未安装的 CLI 提供一键下载并安装，已安装的 Harness 保留更新入口，包括尚未登录的 Harness。没有选中模型时也能浏览市场。
- 修复 Gemini 等模型输出的 Mermaid 分组标题包含未加引号的括号时，流程图回退成原始代码的问题。
- 右侧打开浏览器等面板、输入区变窄时，权限入口收成图标，长模型名称缩略显示，为发送与停止按钮保留空间；权限和模型菜单仍可正常使用。
- 中英文 README 加入五张产品截图，并强调默认使用原生 Harness、支持 Model × Harness 个性化 Recipe，引用 Artificial Analysis 官方评测说明。

## 实现

- Pi 接入 Harness 注册、检测和已有原生运行接口，沿用官方安装脚本与更新命令；安装、更新继续使用共享流程的进度、错误提示与状态刷新。未扩展 Auto 默认组合，Pi 的组合能力保持实验状态。
- Mermaid 首次解析失败后，只对流程图的分组标题补上引号，并使用独立 SVG ID 重试一次。复制和最终失败回退均保留原始代码，不改变节点与连线。
- 输入区按自身宽度收起权限文字，模型摘要参与收缩，发送和停止按钮保持固定尺寸。

## 验证

- 247 项相关 Markdown、输入区、Harness 市场、安装更新、注册及发布说明测试通过；1 项外部集成测试跳过。类型检查、普通及类型感知 lint 通过。
- 安装与更新回归覆盖 Pi 入口、已安装但未登录、WSL 环境选择及成功/失败后的状态刷新；隔离 Electron 检查市场布局与按钮状态，模拟安装回调后显示更新入口，未执行真实 CLI 下载或更新。
- 隔离 Electron 复现并验证截图中的流程图；验证常规 Markdown 表格和分隔列数不一致的表格仍正常显示。
- 在 100%、130%、150% 界面缩放下，检查 300–960px 的五种输入区宽度，共 15 组发送按钮边界与鼠标命中检查通过；真实鼠标点击发送按钮和权限图标成功。
- 最终相关 Electron 冒烟的 9 个自动场景及 5 个模拟门禁通过，控制台与运行时错误为 0；外部认证、真实 Pi 会话及 CLI 下载/更新未作在线验收。

---

# CraftStation v1.8.8

A Harness Marketplace with Pi, readable flowcharts, and accessible Send in narrow composers.

## User-facing

- The Harness overview replaces "Not linked" with a Harness Marketplace, including Pi. Missing CLIs offer one-click download and installation; installed Harnesses keep an update action, including those awaiting sign-in. The marketplace is also available without selected models.
- Mermaid flowcharts from Gemini and other models can render when a group title contains unquoted parentheses, instead of falling back to raw code.
- When a browser or another side panel narrows the composer, permissions collapse to an icon and long model names shorten to leave room for Send and Stop. Both menus remain available.
- The English and Chinese READMEs feature five product screenshots and emphasize native Harnesses by default, personalized Model × Harness Recipes, and a reference to Artificial Analysis's official evaluation methodology.

## Implementation

- Pi joins the Harness registry, detection, and existing native runtime interface, using its official installer and update commands. Shared install/update flows retain progress, error reporting, and status refresh. Auto defaults are unchanged, and Pi composition capabilities remain experimental.
- After the first Mermaid parse fails, quote affected flowchart group titles and retry once with a fresh SVG ID. Copying and any final fallback preserve the original source, including its nodes and links.
- Composer width controls permission-label visibility; model summaries can shrink while Send and Stop retain their dimensions.

## Verification

- All 247 related Markdown, composer, marketplace, install/update, registry, and changelog tests passed; one external integration test was skipped. Type checking and regular and type-aware lint passed.
- Install/update regressions cover the Pi action, installed but unauthenticated Harnesses, WSL environment selection, and refresh after success or failure. An isolated Electron session checked marketplace layout and button states; a simulated install callback revealed the update action. No real CLI download or update was performed.
- An isolated Electron session reproduced and verified the reported flowchart, plus regular Markdown tables and tables with mismatched separator column counts.
- All 15 Send-button boundary and mouse-hit checks passed across five composer widths from 300 to 960px at 100%, 130%, and 150% app zoom. Real mouse clicks activated Send and the compact permission menu.
- The final related Electron smoke run passed nine automated scenarios and five mock gates with zero console/runtime errors. External authentication, a live Pi session, and CLI downloads/updates were not verified online.
