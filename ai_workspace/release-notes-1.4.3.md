# CraftStation v1.4.3 — 端到端稳定性修复与第三方渠道真实额度

## 用户可见

- 聊天中的文件/artifact 链接恢复可点：PDF、TeX、任意扩展名路径与裸文件名都能点开进右侧文件面板；项目树未加载完时不再误拒合法路径；打开失败会弹提示而不是静默无反应。
- 合成台 Harness/CLI 面板秒开：先渲染持久化的已配置状态，后台再探测健康度；单个 Harness 探测超时不再拖住整页（每个探测 60s 独立超时 + 跨挂载去重）。
- 渠道模型可完整编辑：已添加模型旁的铅笔按钮打开编辑窗口，可改上下文窗口、最大输出、输入/输出模态、思考档位与默认档位，即时保存并在重启后保留。
- OpenCode 用量自愈：opencode.ai 前端重建导致订阅接口 id 轮换、用量空白；现在自动从线上站点重新解析 id 并持久化缓存，用量恢复显示；凭证经双密封存储，重启应用不再掉登录。
- 计划/Schedule 等内置 MCP 工具在所有 Harness 下都能收到结构化参数：第三方 bridge 把 `recurrence` 等对象参数转成字符串时，接收层按工具声明的 schema 还原为对象/数组，字符串参数不受影响。
- 第三方兼容渠道显示真实额度条：阶跃星辰账号按 `/v1/accounts` 显示余额（已用百分比 + 剩余金额）；one-api/new-api 中转的额度窗口附带金额；没有额度接口的渠道保持 Token 用量行，不造假。

## 实现

- `parseProjectPathRef` 放开扩展名识别、空 `rootNames` 视为校验不可用；`MdAnchor` 失败弹 toast，死链渲染为纯文本。
- `CraftingWorkbenchPage` stale-while-revalidate + `refreshHarnessInflight` 去重；`AgentStatusService` native probe 60s `AbortSignal` 超时。
- `CustomModelDialog` 编辑模式 + `mergeCustomModelsIntoCapabilities` 渠道条目能力合并；`customModels` schema 新字段全 optional。
- `fetchOpenCodeSubscriptionText` 识别"全拒"签名 → live chunk 重解析 server-function id → `HostPort.serverIdCache`（`usage-server-ids.json`）持久化 → 重试一次；`usageHost` 接线文件缓存。
- `coerceStringifiedJsonArgs` 接入 `StreamableHttpMcpIngress` 与 `OwnSubagentsMcpIngress`；schedules zod 预处理 `"true"`/`"5"` 标量。
- `collectQuota` 探测链：host 匹配的 provider 余额端点（StepFun）优先，one-api billing 兜底；`AccountQuotaWindow` 扩 `used/limit/remaining/currency`；prepaid 零余额标 `quota-exhausted`。
- `usageSecretStore.writeAll` tmp 文件名带 pid+随机后缀 + Windows EPERM/EBUSY rename 有界重试（修复主进程与 supervisor 并发写冲突）。

## 验证

- 新增测试：文件链接解析、Harness SWR、模型编辑、OpenCode 自愈/缓存、双 ingress 参数解包、StepFun 余额折算/耗尽/postpaid、卡片余额渲染；`pnpm typecheck` + `pnpm lint` PASS。
- 真机实测：阶越星辰渠道 `collectQuota` 返回 `余额 usedPercent=0 remaining=15 limit=15 CNY`。

Windows x64 提供 NSIS 安装包和便携版。

---

# CraftStation v1.4.3 — End-to-end stability fixes and real channel quotas

## User-facing

- File and artifact links in chat are clickable again: PDFs, TeX, any extension, and bare filenames open into the right-side file panel; paths are no longer rejected while the project tree is still loading, and failures now surface a toast instead of doing nothing.
- The crafting workbench's Harness/CLI panels open instantly: persisted state renders first, health probes run in the background, and one timed-out Harness can no longer stall the page (per-probe 60s timeout, cross-mount dedupe).
- Channel models are fully editable: the pencil beside each added model opens a dialog for context window, max output, input/output modalities, thinking tiers, and the default tier — saved instantly and kept across restarts.
- OpenCode usage self-heals: the site's rebuilds rotated its subscription endpoint id and blanked the card; the id is now re-resolved from the live site and cached on disk, and credentials survive restarts via dual-sealed storage.
- Schedule and other built-in MCP tools receive structured arguments under every Harness: when a third-party bridge stringifies object parameters such as `recurrence`, the ingress restores them against the tool's declared schema — plain string parameters are untouched.
- Third-party compatible channels show real quota bars: StepFun accounts report their balance from `/v1/accounts` (used percent plus remaining amount); one-api/new-api relays attach dollar amounts; channels without a quota endpoint keep the token row — nothing is faked.

## Implementation

- `parseProjectPathRef` accepts any extension and treats an empty root-name set as validation-unavailable; `MdAnchor` toasts on failure and dead links render as text.
- `CraftingWorkbenchPage` stale-while-revalidate with `refreshHarnessInflight` dedupe; `AgentStatusService` adds a 60s `AbortSignal` timeout to native probes.
- `CustomModelDialog` edit mode plus channel-entry capability merging in `mergeCustomModelsIntoCapabilities`; all new `customModels` schema fields are optional.
- `fetchOpenCodeSubscriptionText` detects the all-rejected signature, re-resolves the server-function id from live chunks, persists it through `HostPort.serverIdCache` (`usage-server-ids.json`), and retries once.
- `coerceStringifiedJsonArgs` wired into `StreamableHttpMcpIngress` and `OwnSubagentsMcpIngress`; schedule zod schemas additionally accept `"true"`/`"5"` scalars.
- `collectQuota` probe chain: host-matched provider balance endpoints first (StepFun), one-api billing as fallback; `AccountQuotaWindow` gains `used/limit/remaining/currency`; prepaid zero balance marks `quota-exhausted`.
- `usageSecretStore.writeAll` uses pid+random tmp names and a bounded rename retry for transient Windows EPERM/EBUSY locks.

## Verification

- New tests cover link parsing, harness SWR, model editing, OpenCode self-heal/cache, both MCP ingresses, StepFun balance conversion/exhaustion/postpaid, and card rendering; `pnpm typecheck` and `pnpm lint` pass.
- Live-verified: the configured StepFun channel returns `balance=15 / granted=15` through `collectQuota`.

Windows x64 NSIS installer and portable builds are provided.
