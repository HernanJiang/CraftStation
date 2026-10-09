# CraftStation 1.9.0 候选

## 用户可见

- 在 CraftStation 输入并发送到已登录的 ChatGPT 网页，实时读取回复、停止生成并恢复已保存的网页会话。
- 网页图表、计算器和模拟器以交互卡片显示，支持点击、拖动、滚动和键盘操作，以及展开、保存当前 PNG 和继续修改。
- 创建或导入账号对话，读取并切换网页实际提供的思考档位；删除原对话前显示确认，网页成功后再移除本地记录。
- 网页对话复用输入框，提供本地/网页远程切换、Remote 分区和全局置顶。
- Ultrafast 检查账号与官方模型目录，提示用量规则，并区分请求档位与明确报告的实际档位。拒绝、降档和未报告状态均明确显示。
- 修复 Mermaid 分组和连线标签中的括号导致图表退回代码显示，以及关闭初始化浏览器标签时的延迟访问错误。

## 实现

组件运行和 MCP Apps 消息桥留在原网页，CraftStation 通过有界输入事件映射交互。会话、组件、画面身份及原网页地址均校验；旧画面、移位和遮挡会拒绝操作。PNG 保存当前画面，未导出离线交互程序。

## 验证

582 项相关测试通过，4 项条件性用例未运行，另有 22 项新增/发布说明检查通过；类型检查和两种 lint 通过。隔离 Electron 网页全流程 16 项、相关界面/IPC 7 个场景和 4 个 mock 门禁通过，控制台/运行时错误为 0。截图中的原始 Mermaid 已渲染为 9 个节点、12 条连线。候选构建结果见 PROJECT_STATUS.md。

本候选尚未发布。真实账号的完整网页 UI 回合、Visualizations/第三方 MCP Apps 和具有 Ultrafast 权限的服务端回合仍需验收；当前 CLI 明确提示模型目录未开放 Ultrafast，因此不能宣称实际生效。

---

# CraftStation 1.9.0 candidate

## User-facing

- Send from CraftStation to your signed-in ChatGPT website, follow streaming replies, stop generation and reopen saved web conversations.
- Charts, calculators and simulators appear as live interactive cards with clicks, dragging, scrolling, keyboard input, expand, save PNG and continue-editing actions.
- Create or import account conversations and select the website's actual thinking options. Deleting the original conversation requires confirmation; local records are removed only after website success.
- Web conversations share the composer, with Local/Web remote choices, a Remote section and global pinning.
- Ultrafast checks account and official model support, explains usage rules and distinguishes the requested tier from an explicitly reported execution tier, including rejected, downgraded and unreported states.
- Flowcharts recover from unquoted parentheses in group and edge labels, and closing an initializing browser tab avoids delayed access to destroyed web contents.

## Implementation

Components and MCP Apps messaging stay in the original webpage. CraftStation forwards bounded input events after checking the session, component, captured frame and page identity; stale, moved or obstructed targets reject input. PNG saves the current image rather than an offline interactive application.

## Verification

582 related tests and 22 additional/change-log checks passed; four conditional cases did not run. Type checking and both lint passes succeeded. The isolated Electron web workflow passed 16 checks, with seven related UI/IPC scenarios and four mock gates, and no console/runtime errors. The original screenshot diagram rendered with nine nodes and twelve edges. Candidate artifact results are recorded in PROJECT_STATUS.md.

This candidate is unpublished. The complete real-account web UI workflow, real Visualizations/third-party MCP Apps, and an entitled Ultrafast service response still require acceptance. The current CLI explicitly reports that Ultrafast is absent from the model catalog, so actual Ultrafast execution is not claimed.
