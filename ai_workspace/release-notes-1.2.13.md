# Release 1.2.13 — 第二批用户验收修复（待发布）

状态：代码与测试已完成，待提交推送与打包。

## 用户可见

- Antigravity/Gemini 每次使用不再弹终端（无窗启动；kill/退出语义不变）。
- 聊天里模型输出的 `<plan>` 这类裸标签不再整行消失，原样显示；autolink 与代码块不受影响。
- 模型选择器不再列出没配置过的渠道（如 Muse Code）；全空时有指引去「渠道与额度」；管理模型页仍是全目录。
- 新草稿默认模型 = 列表第一个；自己在菜单里点过的选择会被记住并恢复。
- 右上角更新菜单纳入本应用：有新版时出应用行（安装版后台下载 → 重启安装；便携版跳 Releases 下载），badge 计入。
- 排期自检（Schedule）跑 Kimi 不再全红 `native identity is absent`。

## 根因

- 终端弹窗：`windowsHide` 仍分配隐藏 conhost，Windows Terminal 接管即闪（真机每个 agy 会话必带 conhost）。`detached` 后零 conhost（真机验证）。
- 标签被吞：micromark 把裸 `<tag>` 当 HTML，sanitizer 剥掉未知元素。
- 选择器：1.2.6“未配置保留”展示与“没选过的渠道不该出现”的预期冲突，按后者改。
- 默认模型：providerConfigs/lastDraft/最近线程三层自动记忆把历史默认值 perpetuate；改为仅显式点选记忆。
- 自更新：electron-updater 链路本就完整，缺的只是更新菜单的入口行。
- Kimi 自检：CLI 凭据文件本来就没有身份字段，presence 校验才是诚实语义（与 Antigravity ADC 同）。

## 验证

- transport 无窗 3（含真 conhost 断言）/ markdown 转义 4 + 渲染回归 1 / 选择器过滤 4 / 草稿默认 2（含 Cursor 变体归一化）/ 更新菜单 2 / nativeProfile 14，全过。
- 触碰面回归：ChatPane markdown、menu、draft、settings、updates 相关套件全过；`tsc` 零新增；`oxlint` 零警告；i18n 已提取，zh-CN 已补。
- 已知边界不变：Devin 个人用量数字暂无 CLI 可用源；Muse MSP 交错走 OpenCode 原生路由绕开。

# Release 1.2.13 — second user-acceptance batch (pending)

## User-visible

- No more terminal popups on Antigravity/Gemini use (console-less spawn).
- Bare `<tag>` placeholders in chat no longer vanish; autolinks and code blocks untouched.
- Model picker lists only configured channels, with a setup hint when empty.
- Fresh drafts default to the first listed model; explicit menu picks stick.
- The titlebar update menu now covers the app itself (restart-to-install / package download, badged).
- Scheduled Kimi runs no longer fail with `native identity is absent`.
