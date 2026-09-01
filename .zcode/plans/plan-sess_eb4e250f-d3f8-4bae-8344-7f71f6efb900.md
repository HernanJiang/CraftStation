## 目标与交付边界

分别修复两个既有 Feature worktree，把它们推进到“自动化工程门通过、可交给用户亲自验收”的状态：

- `D:\Work\CraftStation\.worktrees\v0.9-cross-harness-handoff`
- `D:\Work\CraftStation\.worktrees\v0.10-cross-thread-collaboration`

不会把 mock、单元测试或进程退出码表述成真实产品 PASS。不会自动执行真实 Provider 验收；真实 Codex/Grok/第二 Harness 的操作留给用户。未经明确授权，不 merge `main`、不 tag、不 push，也不提交代码。

## 全程保护措施

1. 将根仓库和两个 worktree 当前的大量 dirty 文件视为受保护现场。
2. 禁止 `reset --hard`、`clean`、宽泛 `restore/checkout`、删除未跟踪文件或覆盖用户修改。
3. 每次只编辑已读取且属于当前 Feature 的文件；全局 Poracode→CraftStation 品牌迁移、package/lockfile 和 launcher 改名不混入 Feature 修复。
4. v0.9 和 v0.10 不跨 worktree 写入；分别验证、分别交付用户验收。
5. 当前 v0.9 migration 37–39 与 v0.10 独立分支 migration 37 的集成冲突，不在本轮偷偷合并解决。两个版本经用户分别验收后，Manager 集成时保留 v0.9 的 37–39，并把 v0.10 collaboration migration 编排为 40，同时添加 36→latest、39→latest 和实验数据库 reconciliation 测试。

---

## 第一阶段：修复 v0.9.1 的三个 Debugger Finding

### 1. 闭合 active execution fencing（F1）

- 复用 `RuntimeExecutionEnvelope`：`segmentId + runtimeSessionId + bindingEpoch`。
- 增加唯一的 Renderer active-execution 状态来源；它只能由 Supervisor 的 initial Segment/active Segment snapshot 或已通过 event fence 的 runtime event 更新，Renderer 不自行推导 epoch。
- 确保首次 crafted Session 建立后也会向 Renderer 发布当前 binding，而不只在 handoff 完成后更新。
- 将 envelope 贯穿所有 crafted active command：
  - 普通 Prompt；
  - slash command；
  - interrupt；
  - set/clear steer；
  - permission/question resolution；
  - close/unload/delete。
- Supervisor 对 crafted Thread 执行 fail-closed：缺失 envelope、旧 Segment、错误 runtimeSessionId 或 bindingEpoch 均返回稳定错误；legacy terminal/non-crafted Thread 保持原兼容行为。
- 将 `request.opened` 的 origin execution 存入 pending request model；resolution 必须同时匹配当前 active binding 与 request 创建时 binding。旧 Segment 的 permission/question 不能解析到新 Session。
- remote runtime event 保留 origin envelope；无法证明 origin 的持久化 fallback 不得绕过 crafted request fence。

### 2. 修复真实验收 false-green（F2）

- 重构 `crossHarnessHandoff.integration.test.ts`，把“环境 preflight 阻塞”和“产品链路已经启动后的断言失败”分离。
- 只有 Runtime 尚未开始时，才允许把明确的 `AUTH_REQUIRED`、`QUOTA_OR_LIMIT`、`RUNTIME_UNAVAILABLE` 写成 `BLOCKED BY ENVIRONMENT`。
- 一旦链路开始，产品异常、断言失败、缺少响应、Segment 数量错误必须使测试失败，不能被 catch-all 降级成环境阻塞。
- Codex A、Grok B、Codex C 都必须有真实 completed assistant response；artifact 只保存脱敏 summary（是否非空、长度、hash），不保存正文、凭据或 hidden reasoning。
- 验证同 Thread/同 workspace、三个不同 Segment、ordinal 和 bindingEpoch 单调递增，以及 B/C 新 native Session identity。
- `REAL_NATIVE_CHAIN_COMPLETED` 只能在全部断言成功后写入。
- scenario 逐项记录 `passed / blocked / unverified / failed`：三段 continuation、queue/replace/cancel/safe boundary、abort 成功与超时、prepare/bootstrap rollback、stale event/input、restart recovery。
- 添加专门的 false-green 回归：B/C 无响应、Segment 数错误、产品异常都必须失败。
- 本轮不伪造真实证据；如果环境仍是 quota blocker，artifact 继续保持 blocked/unverified。

### 3. 修复 migration regression（F3）

- 将 `projectsThreads.test.ts` 的 schema 36 硬编码改为 `LATEST_SCHEMA_VERSION`。
- 增加 v32→39 升级断言：三张新表、关键索引、唯一 active Segment 约束及 legacy project 数据保留。

### 4. v0.9 验证门

依次执行：

1. coordinator、ledger、checkpoint、crafted request、runtime、Renderer command/reducer/UI focused tests；
2. migration 定向测试；
3. remote procedure regression；
4. touched-files format/lint 和 `git diff --check`；
5. typecheck、renderer build、Electron build；
6. broader suite，并把 Feature regression、既有失败和环境失败分开报告。

不会自动运行真实 credentialed Provider gate。完成后状态更新为 `ENGINEERING FIX COMPLETE / READY FOR USER ACCEPTANCE`，不是 PASS。

---

## 第二阶段：收口 v0.10 的工程和证明缺口

### 1. 先恢复可重复的本地工具链

- 保留当前 package/lockfile dirty baseline，不擅自重写。
- 尝试使用当前 frozen lockfile、`--ignore-scripts` 只同步 workspace links；随后单独生成 Codex protocol、准备 native binding。
- 不从根仓库或其他 worktree 复制 generated/node_modules。
- 如果 frozen install 暴露 package/lockfile 本身不一致，只记录为受保护的全局品牌迁移 blocker，不用宽泛 install 覆盖现场；Feature 测试优先使用已有确定性设施。

### 2. 冻结并验证 target policy

按 v0.10 Manager 文档的跨组合目标执行：

- same project；
- non-self；
- source/target 的 resolved Model 或 Harness 至少一项不同；
- 同 Harness/不同 Model 允许；同 Model/不同 Harness 允许；完全相同 tuple fail-closed；
- 判断使用 resolved runtime provenance，而不是直接比较 UI 字段。

service、target picker、MCP 和 remote gateway 使用同一 policy，并增加 self、cross-project、same tuple、不同 Model、不同 Harness 的 contract tests。UI 把“可选择/可恢复/当前可运行”分开表达，避免把 resumable 误写成 credential/quota ready。

### 3. 补齐 T01–T07 直接测试证据

- **Collaboration service/adapter**：保留并扩展 idle、busy queue、idempotency、claim、cancel、attention、interrupt fail-closed、reply anchor、follow-up、restart recovery。
- **App Controls MCP**：直接覆盖 `ask_thread`、`read_thread_exchange`、`wait_for_thread_reply` 的 payload、participant policy、timeout/cursor、causal parent、错误投影；证明不会旁路 service 直接 send/interrupt。
- **Migration**：验证 collaboration 表、索引、FK/cascade、source idempotency unique、link sequence unique 和数据保留，而不只断言 migration 名称。
- **Remote/headless**：直接覆盖 list/request/read/wait/cancel、actor/participant/cross-project 拒绝、ID 投影/反投影、snapshot 脱敏，以及所有入口复用同一个 service。
- **Renderer UI**：新增 Dialog、Activity、ThreadView 行为测试：target 搜索/禁用、worktree warning、默认 queue、显式 context、interrupt 二次确认、提交错误、cancel、poll cleanup、reply/error card、jump、keyboard/listbox accessibility。
- UI 的 wait 语义冻结为基于 exchange 的受控轮询；文档不再声称存在未实现的单独 wait 按钮。
- `agentMcpSupported` 继续 fail-closed；若 production capability resolver 尚无可信来源，就明确保持该真实门为 blocked，不伪造支持。

### 4. 建立“用户验收入口”，但不替用户操作真实链路

- 不把当前损坏的品牌迁移 smoke runner 混进 Feature 修复。
- 先用隔离 profile 的现有 Electron dev/test 启动方式完成本地 UI/control-plane smoke；不使用用户正式 Thread 数据。
- 准备一份脱敏验收清单和 artifact 目录约定，覆盖：
  - Codex source → Grok target；
  - reply projection；
  - 同一 ConversationLink follow-up；
  - target busy 默认 queue；
  - explicit interrupt 二次确认和失败不投递；
  - needs-attention；
  - restart 后 queued/in-flight/replied 恢复；
  - stale claim 不重复投递；
  - cross-worktree warning；
  - 第二 Harness route。
- 自动化只准备和启动候选；到真实 Provider 操作时停下，由用户亲自在已经打开的应用中验收。

### 5. v0.10 验证门

依次执行：

1. collaboration core focused tests，并确认 SQLite suite 实际运行而非 skip；
2. MCP、migration、remote/headless、Renderer UI 定向测试；
3. App Controls、Crossagents、composer 和 Harness regression；
4. touched-files format/lint 与 `git diff --check`；
5. typecheck、renderer build、Electron build、总 build；
6. 在真实 Provider 测试保持 env-gated 的前提下执行 broader suite。

完成后状态更新为 `T01–T07 ENGINEERING COMPLETE / T08 READY FOR USER ACCEPTANCE / DEBUGGER PENDING`，不是 PASS。

---

## 最终交付给用户

1. 给出两个 worktree 的精确分支、HEAD、实际修改文件和自动化结果；既有/环境阻塞单独列出。
2. 不生成 `report_0.9.md` 或 `report_0.10.md`，除非独立 Debugger 后续给出 PASS。
3. 先启动 v0.9 隔离候选供用户亲自验收；用户结束后再启动 v0.10，避免把两个独立分支误表述为已经集成。
4. 用户确认两者后，才进入独立 Manager 集成阶段：保留 main-only 安全/packaging 修复，解决 migration 40 和重叠路径，再交付一个同时包含 0.9+0.10 的最终候选。
5. 全程不自动 merge、tag、push。
