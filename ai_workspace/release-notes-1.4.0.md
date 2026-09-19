# CraftStation v1.4.0 — 架构统一、额度修复与资源优化

## 用户可见

- Antigravity 账号池显示 Gemini / Claude 的 5 小时与周额度，修复旧接口遗漏周额度导致全部显示 0% 的问题。
- 删除 Devin 授权会清理本机 CLI 的新旧凭据位置；其他渠道的删除失败不再被当成成功，注销前的请求不能复活已删除账号。
- 兼容桥配方支持确认保存，取消不会提前写入；启动时继续验证运行条件。自定义模型、第三方 API、可选 CPA 与目标 Harness 保持独立绑定。
- 修复 Windows 聊天文件引用偶发打不开、新线程默认权限传递、快速停止、用户消息重复或未落盘、重载后无法在原会话追问等问题。
- 保留所有现有功能、历史边界、恢复与降级路径；保留 Swift/Java 系统桥接、CSS/HTML、构建脚本及现有 Rust sidecar。

## 实现

- 统一 Item → Recipe → Result Item → CraftPlan → Entity → Session 契约、运行实例生命周期和权限传递，保留官方 Harness 内部能力。
- 共享会话事件快照、限制代码高亮缓存、回收空闲日志引用、复用 SQLite 语句并修复 WAL 多连接竞争。
- Windows 安装内容移除约 33.29 MiB 的 SQLite 编译中间文件，保留所需原生模块。
- 定点基准：1,000 次持久化耗时 210.42 → 145.45 ms，CPU 时间 187 → 110 ms；高亮压力场景保留堆 24.72 → 4.39 MiB。8 线程交错持久化没有明显提速，整机 CPU / 内存没有匹配前后基线，不宣称普遍下降。

## 验证

- 前轮全量 11,855 通过、66 跳过；最终恢复修复另有增量复验。本轮问题定向 320 通过，版本记录与保存弹窗另行 18 通过（有重叠，不相加为独立覆盖数）。
- 最终类型检查、lint、完整 mock 冒烟通过：9 个自动场景、16 个模拟门，运行错误 0。
- 真实凭据验证 Antigravity 两个隔离账号：Claude 周额度分别为 33.6% / 5.7%，界面显示 34% / 6%；删除其中一个后刷新未复活，另一个保持可用。
- 在隔离系统目录中通过真实 Electron 界面删除 Devin 测试授权，两处凭据文件均移除，账号身份消失并恢复登录入口。没有删除用户真实凭据。
- Codex / Kimi 原生、第三方 Responses → Codex、Codex → CPA → Kimi / OpenCode 等真实聊天验证及性能原始证据见第二轮报告。
- 完整外部授权重登录、全 Provider 组合、SSH/WSL、macOS/Linux/mobile 真机与覆盖安装升级仍未全部验证；测试通过不代表所有外部功能已逐一验收。

完整报告：`ai_workspace/reports/report_1.4.0_issues.md`、`report_1.4.0_round2.md`；Windows x64 提供 NSIS 安装版和便携版。

---

# CraftStation v1.4.0 — Unified architecture, quota fixes and resource improvements

## User-facing

- Antigravity accounts now show both five-hour and weekly Gemini / Claude limits, fixing the misleading all-zero display caused by omitting weekly consumption.
- Removing Devin authorization clears both current and legacy local CLI credential files. Credential deletion errors are reported, and responses started before logout cannot restore deleted identities.
- Compatible bridge recipes can be saved after confirmation; cancelling does not persist them. Runtime checks remain in place at launch. Custom models, third-party APIs, optional CPA and target harnesses keep independent bindings.
- Fixed Windows chat file links, default permission propagation, rapid Stop, missing or duplicated user messages, and follow-up turns after reloading an existing session.
- Existing features, boundaries, recovery and fallback paths remain. Swift/Java system bridges, CSS/HTML, build scripts and the existing Rust sidecar are retained.

## Implementation

- Unified Item → Recipe → Result Item → CraftPlan → Entity → Session contracts, runtime ownership and permissions while preserving official harness internals.
- Shared session history snapshots, bounded highlighting caches, reclaimed idle logging references, reused SQLite statements and fixed concurrent WAL writes.
- Removed approximately 33.29 MiB of SQLite build intermediates from Windows installations while retaining required native modules.
- Focused benchmarks: 1,000 persistence batches decreased from 210.42 to 145.45 ms elapsed and from 187 to 110 ms CPU time; retained highlighting heap decreased from 24.72 to 4.39 MiB. Eight interleaved threads showed no meaningful speedup. No matched whole-app CPU or memory baseline is available, so no general reduction is claimed.

## Verification

- The earlier full suite passed 11,855 tests with 66 skipped, followed by targeted checks for final recovery fixes. This issue batch passed 320 targeted tests; another 18 changelog/dialog checks passed with overlapping coverage.
- Final typecheck, lint and full mock smoke passed: nine automated scenarios, sixteen mocked gates and zero captured runtime errors.
- Two isolated Antigravity accounts returned real Claude weekly usage of 33.6% and 5.7%, rendered as 34% and 6%. Deleting one account remained effective after refresh without affecting its sibling.
- A real Electron UI deletion against isolated synthetic Devin credentials removed both credential files, cleared the displayed identity and restored sign-in. Actual user credentials were not deleted.
- Earlier live runs covered native Codex/Kimi, third-party Responses → Codex and Codex → CPA → Kimi/OpenCode; detailed evidence and benchmarks are retained in the round-two report.
- Complete external reauthorization, every provider combination, SSH/WSL, macOS/Linux/mobile devices and installation upgrades have not all been verified. Passing tests do not imply exhaustive external acceptance.

Reports: `ai_workspace/reports/report_1.4.0_issues.md` and `report_1.4.0_round2.md`. Windows x64 NSIS and portable artifacts are provided.
