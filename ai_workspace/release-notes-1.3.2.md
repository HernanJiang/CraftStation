# Release 1.3.2 — 缩放根治、权限默认值修复与更新体验改进

## 用户可见

- **Ctrl+± 缩放后浏览器面板不再错位**：应用内缩放（Ctrl + = / - / 0）后，嵌入的浏览器面板内容此前会整体偏移。根因是测量时读到的视觉像素被二次缩放。现在测量值统一归一回布局像素，且浏览器聚焦时缩放快捷键也能正常生效、可还原。
- **缩放后对话不再出现大片空白**：缩放比例不为 100% 时，虚拟列表测量到的行高被污染，导致消息之间出现大片空白、回访旧对话仍残留。现在所有测量路径统一使用布局像素，缩放任意切换对话排版始终正常。
- **「立即发送」排队消息不再导致整页崩溃**：线程工作中点排队消息的「立即发送」时，若 supervisor 超时，此前会整页崩溃（unhandled rejection）。现在消息会安全放回队列，只会收到一条普通错误提示，文本不丢。
- **新线程现在真正遵守「默认权限 = 完全访问权限」**：此前 Kimi、Claude 等 provider 新建线程时默认权限解析错误（Kimi 被解析成"Ask When Needed"而非真正的 Never Ask），表现为明明设了完全访问却仍弹批准。现在 provider 自己声明的 bypass 姿态优先，Kimi 新线程正确带 `--auto` 启动。已存在的线程不受影响。
- **Grok 上下文容量正确显示 500K**：此前 Grok 线程显示 258K——那是 Grok CLI 上报的自动压缩触发阈值，不是模型真实窗口。现在显示与官方一致的 500K；占用超过阈值时显示也不会来回跳动。Codex、Claude 的显示不受影响。
- **Grok 的表格输出恢复渲染**：Grok 经常输出空表头的 Markdown 表格，此前会被显示成一坨竖线原文。现在这类表格正常渲染为表格。
- **Kimi 额度耗尽后自动换号**：Kimi 5 小时窗口耗尽实际返回 403 配额错误，此前被误判为鉴权失败，号池不切换、下个回合继续撞死同一个账号。现在正确识别并按号池优先级 failover；真正的鉴权失败（forbidden 等）仍然 fail-closed 不误切。
- **Gemini 跑完后不再多弹一条无用错误 toast**：错误回合结束后 Gemini CLI 会自行退出进程，此前被当成第二次失败再弹一条「Native process exited with code 1」盖掉真实错误。现在回合结束后的进程退出降级为静默恢复（下条消息自动重建会话），只剩那条带真实错误的提示。
- **侧边栏项目分组可以一键折叠**：展开的组标题左侧新增 × 按钮，点击即折叠。
- **点右上角版本号即可手动检查更新**：版本号现在是个按钮，点击立即检查 CraftStation 新版本；已是最新时会收到「已是最新版本」提示。
- **后台任务完成时任务栏图标有提示**：窗口不在前台时，线程完成、待批准或出错会在任务栏图标上叠加圆点徽标并闪烁（macOS 弹 Dock）；点回窗口停止闪烁，打开对应线程后徽标消除。遵守「设置 → 通知」的总开关与分类开关。
- **应用更新下载进度不再"卡在 0%"**：GitHub CDN 慢时百分比会长时间停在 0%，无法分辨是卡住还是在下载。现在下载中显示字节级进度与速度（如「3% · 2.2 MB / 85.0 MB · 110.0 KB/s」），更新菜单里还新增「改为在浏览器中下载」兜底项。
- **Devin 等 CLI 的登录不再闪退**：`devin` 未加入 PATH 时，登录终端此前会因找不到命令瞬间关闭，来不及看到任何提示。现在登录命令优先使用已探测到的 CLI 绝对路径执行，全部 6 个内置登录 provider 生效。

## 实现

- 缩放双修：①`useBrowserHostPositioning.measure()` 的 `getBoundingClientRect()` 读数除以当前 zoomFactor 归一为布局像素，并订阅 zoomFactor 变化即时重测；`BrowserTab` 的 `before-input-event` 新增 `resolveAppZoomKeyDown`，webview 聚焦时命中缩放快捷键即 preventDefault 并经 `browserEvent` 的 `app-zoom-shortcut` 定向发给嵌入窗口走 `adjustAppZoom`。②新增 `zoomNormalizedContainerRect.ts`，在 `VirtualChatListRow` 的 ref 里给 LegendList 容器包一层幂等的 `getBoundingClientRect`，按实时 zoomFactor 归一——首测/延迟 shrink/MVCP 锚定所有路径拿到同一坐标系。
- `setPendingSteer` 崩溃：`sendQueuedFollowUpNow` 失败时把已取出的排队消息放回队列（对齐 `flushQueuedFollowUp`），调用点补 `.catch` → console.error + toast。
- 默认权限：`resolveUnrestrictedPermissionConfig` 中 provider 声明的 bypass id（已广告时）优先于通用猜测列表；草稿 UI 与 `createAppThread` 全走同一解析。
- Grok 500K：`preferAdvertisedContextWindow` 新增两条让位规则——grok 线程上报值小于广告窗口（上报的是 auto-compact 阈值）；占用 > 上报窗口且广告窗口更大（真实窗口不可能小于当前占用）。
- Grok 表格：`ItemMarkdown` 的 `isPotentialTableRow` 放宽——行内 `|`≥2 且仅由 `|`/空白构成也视为表格行。
- Kimi 换号：`isKimiPoolQuotaError` 对 403 按文案拆分（`KIMI_QUOTA_WINDOW_RE`：usage limit / quota will reset / 额度耗尽 等命中则配额错误走 failover，否则 fail-closed），httpStatus 与 message 两条路径同规则。
- Gemini toast：`structuredSession.ts` 三处——无活跃 turn 的 NATIVE_PROCESS_CRASHED 降级 warning（生命周期由 onClose→inactive→下条消息透明 respawn 覆盖）；`statusForEvent` 不再因孤立 error 事件翻线程状态；回合后迟到的 canonical error 降级 warning。另统一 canonicalizer `turnState` 与 adapter `deepSeekReasonKind` 的 snake_case 归一（只影响 DeepSeek）。
- 版本号点击：订阅 updateStore 观察 checking→非 checking 跳变，落 idle 时 toast 成功；调 `checkForUpdate({})`（手动语义）。
- 任务栏指示：新 `src/main/taskbarAttention.ts`，镜像渲染层 classifyTransition 语义（用户主动 stop 不算完成），无焦点时 `setOverlayIcon`（内嵌 32×32 琥珀圆点）+ `flashFrame`（macOS dock bounce）；focus 停闪留标，`openThread` 经新 `dismissTaskbarAttention` IPC 撤标；`thread-exited` 自动撤标；`notificationsEnabled` + `notificationStatuses[category]` 实时门控。
- 下载进度：标题栏 pill 与更新菜单复用 store 既有 `downloadTransferred/downloadTotal/downloadBytesPerSecond` 字段显示字节+速度（与侧边栏/About 同数据）；菜单新增浏览器下载项直达 Releases 页。
- 登录闪退：`runAgentLoginCommand` 新增 `resolveLoginBinaryCommand`，用 agent status 的 `executablePath` 改写登录模板首 token（Windows `& '<path>'` / posix `'<path>'`，WSL 项目用 wsl 池）；`devin/detection.ts` 的 `loginCommand` 改函数形态。

## 验证

- 新增测试全过：`taskbarAttention.test.ts` 12 例、`MainTitlebar.test.tsx` 10 例、`CliUpdateMenu.test.tsx` 8 例（含字节进度+浏览器兜底断言）、`agentLoginActions.test.ts`+`devin.test.ts` 48 例、`threadActions.test.ts` 49 例、`unrestrictedPermissions.test.ts` 8 例、`threadContextUsage.test.ts` 18 例、ItemMarkdown 56 例、session.test.ts（Kimi 403）134 例、structuredSession/nativeEventCanonicalizer 新增各 3 例。
- `pnpm typecheck` PASS；全部触碰文件 oxlint 0 警告；i18n 已 extract，zh-CN 新文案补齐。
- 既有基线：`SortableThreadItem.test.tsx` 2 例失败为 HEAD 既有（「unload」菜单项在当前源码不存在，与本批无关）；antigravity/nativeHarness/threadSession 套件 5 例失败同已 stash 对照证实为基线。
