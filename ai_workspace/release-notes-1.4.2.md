# CraftStation v1.4.2 — 渠道模型配置、方舟可用与卡死修复

## 用户可见

- 第三方渠道模型可点开配置：已加入的模型行新增展开按钮，上下文窗口、最大输出 Token、输入/输出模态、思考强度档位与默认强度均可改、即时保存；渠道模型的档位同时进入首页强度下拉（此前对话框里填了也不生效）。
- 火山方舟渠道的 Kimi 模型可用：方舟 coding 端点拒收 Responses 负载，Kimi 投影对该 host 直接强制 chat_completions，无需改配置；同通道协议翻转保留给其他中转兜底。
- 修“对话框一直显示工作中”：后台 workflow 跟踪对 manifest 永不出现的条目加 10 分钟 deadline，dock 手动关闭同步停止跟踪；已卡住的重启应用一次即清。
- 修“正在获取模型列表”转圈：两处拉取共用 30 秒客户端超时，转可重试错误态（supervisor 侧本就 12 秒必返回，卡死只可能在渲染/IPC 悬空）。
- 跨 Harness 切换不再把泛 `default` 权限原样保留：重解为目标默认（Kimi 即完全访问），设置里的默认权限对所有模型生效；既有卡住线程点一次执行模式菜单即可。

## 实现

- `prepareVendorCompatRuntime` kimi 分支方舟 host 强制 chat（显式翻转覆盖仍优先）。
- `mergeCustomModelsIntoCapabilities` 合并渠道条目档位（公共列表仍只收无账号条目，内置同名优先）；账号分支同步合并 modelEfforts/modelDefaultEfforts。
- `adaptThreadConfigForCapabilities` 泛 `default` 重解目标默认。
- `threadLiveWorkflowStore` 缺失 manifest deadline + dock dismiss 联动 `markTerminal`；模型列表拉取 `listChannelModelsWithTimeout`。

## 验证

- 新增 20+ 定向用例：Ark 强制 chat 写文件、渠道档位合并、adapt 重解、新开 kimi 草稿 full-access→auto、liveWorkflow deadline、拉取超时重试、行内编辑；`runtime.test.ts` 124、threadSession 等 31 文件 442 例、renderer draft/ChatPane 127 全过；`pnpm typecheck` + `pnpm lint` PASS。

Windows x64 提供 NSIS 安装版和便携版。

---

# CraftStation v1.4.2 — Channel model settings, Ark availability and stuck-state fixes

## User-facing

- Third-party channel models are now configurable: added models get an expander with context window, max output tokens, input/output modalities, thinking tiers and default tier, saved instantly. Channel-declared tiers also feed the homepage effort picker (previously filled-in tiers never took effect).
- Volcengine Ark channels work with Kimi models: the Ark coding endpoint rejects Responses payloads, so Kimi projection forces chat_completions for Ark hosts with no configuration change; same-channel protocol flip remains as a fallback for other relays.
- Fixed the never-ending "working" state: background-workflow tracking drops entries whose manifest never appears (10-minute deadline), and dismissing the dock row stops tracking. Restart the app once to clear an already-stuck state.
- Fixed the hanging "fetching model list" spinner: both fetch paths share a 30-second client timeout that resolves into a retryable error (the supervisor always answers within ~12s; hangs can only come from a suspended renderer/IPC promise).
- Cross-harness switches no longer keep the generic `default` approval verbatim: it re-resolves against the target default (full access on Kimi), so the global default permission applies to every model; threads already stuck on it need one manual menu flip.

## Implementation

- `prepareVendorCompatRuntime` forces chat for Ark hosts on the Kimi branch (explicit flip overrides still win).
- `mergeCustomModelsIntoCapabilities` merges channel-entry tiers (the shared model list still only takes account-less entries; built-ins win on conflicts); the account branch merges modelEfforts/modelDefaultEfforts the same way.
- `adaptThreadConfigForCapabilities` re-resolves a bare `default` against the target default.
- `threadLiveWorkflowStore` missing-manifest deadline plus dock-dismiss linkage to `markTerminal`; model-list fetching via `listChannelModelsWithTimeout`.

## Verification

- 20+ new targeted tests: Ark forced-chat file output, channel tier merging, adapt re-resolution, fresh Kimi draft full-access default, live-workflow deadline, fetch-timeout retry, inline row editing; `runtime.test.ts` (124 tests), 31 threadSession-family files (442 tests) and renderer draft/ChatPane suites (127 tests) all pass; `pnpm typecheck` and `pnpm lint` pass.

Windows x64 NSIS and portable artifacts are provided.
