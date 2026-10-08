# ChatGPT 网页实时同步（1.9 候选）

在 CraftStation 聊天框输入文字，提交给已登录的 ChatGPT 网页；网页正在生成的回复持续回显到 CraftStation。模型和网页工具由 ChatGPT 网页自身运行。

## 使用

1. 点击顶部的 **ChatGPT 网页**，创建新对话。
2. 在打开的内置浏览器中登录 ChatGPT，选择网页中的模型。现有浏览器登录状态可继续使用。
3. 等待本地输入框显示 **已连接**，在 CraftStation 输入并发送。
4. 回复生成时可点击本地停止按钮；打开网页可以查看原始对话、选择模型或处理网页提示。
5. 使用会话下拉框继续已有网页对话。已同步文本和网页地址保存在应用数据目录的 `chatgpt-web-sessions.json`。

当前入口标为 **实验**，仅支持桌面端文字对话。正文复用现有 Markdown 渲染，保留网页可读取的代码、表格、公式和链接。附件、图片、Canvas、语音以及网页工具的交互控件仍在网页中使用；网页未公开在正文 DOM 中的内容无法映射。网页改版可能需要更新兼容逻辑。

## 发送与恢复

- 网页输入框有草稿时，提示用户先处理草稿，避免覆盖。
- 同一次提交只点击一次发送，生成中的回复更新原消息，避免重复追加。
- 网页显示登录失效、回复加载失败或连接中断时，保留已有内容并显示原因。先打开网页处理问题，再显式重新连接；已提交的消息不会自动重发。
- 重启恢复会话地址和已同步历史，不重放未完成请求。网页长对话移除早期 DOM 时，保留已经同步且有稳定身份的消息。

## 实现边界

`ChatGptWebRuntime` 通过 `WebChatBrowser` 接口驱动内置浏览器的可见输入框和按钮，读取回复 DOM；渲染端经类型化 IPC 接收会话快照。只驱动正式的 `https://chatgpt.com` 页面。登录由网页管理，不导出 Cookie，不使用隐藏聊天接口。

这是一条独立网页对话路径，当前没有注册为 Agent Harness，也没有把网页工具、MCP、Skills 或原生 Agent Session 声称为 CraftStation 能力。Auto 与 Recipe 保持现有执行路径。

## 验证

自动测试覆盖多轮输入、流式替换、停止、网页草稿、断线、身份校验、历史恢复与 DOM 改版兼容。隔离 Electron 冒烟使用固定网页回复，经过真实 renderer → preload → main → webview，检查输入、第一段回显、最终 Markdown、停止、错误恢复和断线。

最终结果：302 项相关测试、类型检查、两种 lint、生产构建和覆盖审计通过；冷启动冒烟通过，控制台/运行时错误为 0。报告和截图位于 `C:/Users/Haona/.craftstation-smoke/chatgpt-web-1.9-final-display/artifacts/`，测试窗口已停止。

```powershell
pnpm test src/main/chatGptWeb/runtime.test.ts
node .agents/skills/interactive-testing/scripts/run-craftstation-smoke.mjs --mode mock --scope changed
```

真实 ChatGPT 测试已确认文字提交、最终回复解析，以及生成中正文从 115 字增长到 135 字。首次回复曾在网页中显示“无法加载此回复”，刷新同一会话后恢复。实时网页的停止按钮使用 `aria-label="停止"`，已加入兼容并由固定网页回归覆盖；真实联网的本地 UI 完整回合仍需用户在候选版本中登录验收。

本候选位于 `dev/1.9-chatgpt-web`，尚未合入 `main` 或发布。
