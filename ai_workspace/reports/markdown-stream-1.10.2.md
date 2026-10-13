# 聊天流式文本丢字符修复

日期：2026-10-13。工作区：`D:/Work/CraftStation`，直接修复 `main`。

## 原始数据核对

只读检查 `C:/Users/Haona/.craftstation/state.sqlite` 与 Kimi 原生 `wire.jsonl`，只输出与故障相关的短表达式，没有打印完整 Prompt 或凭据。

- 线程：`340c2a99-0085-44bf-b546-f2cdbda0c781`。
- Kimi 会话：`session_6d16b340-e41a-4b3e-9658-47293944c9b7`，原生第 20 回合。
- 原生正文长度 761，保留 `slow.next = slow.next.next`；CraftStation 对应正文长度 740，已变成 `slow.next = slow.next`。
- 原生思考长度 1495，包含 `as ` 后跟反引号；CraftStation 思考长度 1422，出现 `asslow`。
- 原始输出完整，丢失发生在渲染前的 ACP 映射，随后被存储。直接给实际 Markdown 渲染组件输入完整文本能够正确渲染。

## 复现与根因

复现命令：`pnpm test src/supervisor/agents/acp/canonicalMapping.test.ts -t 'preserves repeated suffixes'`。

修复前，输入片段如下，正文输出只剩一个右侧 `.next`，思考还丢失了结尾反引号。两个标准 chunk 用例均失败。

```text
['`slow.next = slow', '.next', '.next', '`']
```

1. 标准 ACP chunk 被送入 `snapshotOrDelta`，其中 `prior.endsWith(incoming)` 将合法重复增量视为重放；相等或前缀判断也可能误删合法增量。
2. 技能目录过滤将仅有反引号等分隔符的片段识别为目录标题，思考中包含空格与反引号的片段因此被整体丢弃。

修复让标准正文、思考直接追加增量；快照兼容仅留在非标准嵌入字段，并取消后缀去重。分隔符片段归为普通内容。没有修改 Markdown 解析器、sanitizer 或消息存储格式。

## 回归证据

- 38 个文件、774 项相关测试通过。
- 发布说明数据完整性另有 16 项测试通过。
- 完整 `pnpm typecheck` 和变更文件两种 lint 通过。
- 回归测试经过实际映射和渲染组件，检查渲染前 Markdown 及 DOM `textContent`，避免空格归一化断言掩盖问题。
- 测试覆盖 `.next.next`、单个 `.next`、`a.b.c`、`as slow`、重复空格、反引号旁空格、相同增量、前缀重叠、逐字符拆分和所有两段切分位置。
- 既有非标准 `reasoning_content` 累计快照、技能目录过滤、表格、公式、Mermaid、代码块等相关测试通过。

## Electron 验证

会话与产物：`C:/Users/Haona/.craftstation-smoke/markdown-delta-20261013/`。

- 真实聊天 DOM 保留三条行内代码、`as slow`、思考摘要及展开正文。
- 粗体、列表、表格、代码块验证通过。
- 自动基线、设置、控件几何及 `ipc-roundtrip`、`provider-skill-delivery`、`skills-manager` 三项 mock 门禁通过，报告控制台/运行时错误 0。
- 手动布置场景时曾使用不完整的 `config` 触发视图边界错误；补齐合法模型配置并重试后完成验收。该错误来自测试布置，不属于本次产品缺陷。
- 截图：`artifacts/markdown-preserved.png`、`artifacts/markdown-thinking-expanded.png`；自动报告：`artifacts/smoke-report.json`。
- 只使用隔离数据与确定性消息，未修改真实线程，未发起真实账号付费回合。

## 发布变更归类

- `v1.10.1..HEAD` 仅有既有发布结果文档提交：omit，治理记录不单列用户变更。
- 本次流式修复：include，归入“聊天”。
- 分隔符误判修复：include，归入“Markdown”。
- 版本号、测试、验证报告：omit，已折入本版验证说明。

## 边界

修复后新消息逐字符保留；已持久化的损坏旧消息不会自动恢复，本轮未重写真实数据库。
