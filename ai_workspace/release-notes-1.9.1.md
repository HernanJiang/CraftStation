# CraftStation 1.9.1

## 用户可见

- `/goal` 由 Craft-Harness 统一管理。普通回合结束后自动检查并续跑，压缩、恢复会话和切换模型不丢失目标；只有模型提交具体完成证据才进入完成状态。
- 支持 `/goal pause`、`/goal resume`、`/goal clear` 和目标栏按钮。排队消息、待回答或批准请求、计划模式会阻止自动续跑；自动回合没有工具调用时停止重复生成，保留目标供用户继续。
- 远程压缩与网络、传输中断按设置的次数和间隔重试。重试耗尽保留目标，用户 Stop 或新输入取消旧重试；额度和鉴权失败沿用原有账号处理。
- 修复新线程首轮漏注册目标、恢复前误标阻塞和会话已关闭时继续按钮无效。升级保留旧目标的完成状态和已用预算，旧账号额度停止在恢复额度后可继续；界面统一显示 Craft-Harness。

## 实现

- 共享目标状态机持久保存状态与累计用量，提供线程绑定的 `create_goal`、`get_goal`、`update_goal` MCP 工具；完成需要证据，同一模型阻塞需要三个连续回合的审计。
- 原生 CraftSession、structured 会话和可信 CLI hook 消费同一调度规则。CraftStation 启动的 Codex 关闭原生 goal 自动调度，保留官方 Agent Loop、工具、Session 和上下文压缩。
- 统一原生与 structured 网络重试分类，识别截图中的远程压缩错误及经过解释转换的原始错误。修复 Stop、模型参数和旧回合重试的边界。
- 补齐原生 DeepSeek 的 Cordis MCP 配置与 OpenCode 启动配置，OpenCode 按 MCP 凭据隔离进程；通用 ACP 使用 stdio 目标通道，禁止静默移除目标服务。凭据保留在子进程环境中。
- 纯 PTY 没有可信回合生命周期或工具进度时，不能保证自动续跑和失败重试；支持范围以实际运行时能力为准。

## 验证

验证结果见 `ai_workspace/reports/goal-craft-harness-1.9.1.md`。真实 Codex 已验证两轮自动续跑、暂停、关闭会话后恢复、无工具回合停止空转、工具完成证据与清除；Kimi 在隔离实例启动时返回 `Authentication required`，不计为真实通过。其他 provider 的真实额度、鉴权与平台组合未逐一验收。

---

# CraftStation 1.9.1

## User-facing

- Craft-Harness manages `/goal` consistently. Goals continue after ordinary turns and survive compaction, session recovery and model changes; completion requires concrete evidence reported by the agent.
- Use `/goal pause`, `/goal resume`, `/goal clear` or the goal controls. Queued messages, pending questions or approvals and plan mode prevent automatic continuation. An automatic turn without tool calls stops repeating while retaining the goal for the user to continue.
- Remote compaction, network and transport failures follow the configured retry count and interval. Exhausted attempts retain the goal; Stop and newer input cancel old retries, while account handling continues to own quota and authentication failures.
- Fixes cover missing first-turn registration, premature blocking before session recovery and resume controls with a closed session. Upgrades retain existing goal completion and spent budgets, and goals stopped by the previous account's quota can resume after quota is restored; goal UI identifies Craft-Harness consistently.

## Implementation

- A shared goal state machine persists lifecycle state and cumulative usage, with thread-bound `create_goal`, `get_goal` and `update_goal` MCP tools. Completion requires evidence, and a model-reported blocker requires an audit across three consecutive turns.
- Native CraftSession, structured sessions and trusted CLI hooks share continuation rules. CraftStation-launched Codex disables its native goal scheduler while retaining the official Agent Loop, tools, Session and context compaction.
- Native and structured paths share network retry classification, including the reported remote compaction error and its projected explanation. Stop, model settings and stale retry boundaries are corrected.
- Native DeepSeek receives Cordis MCP configuration and native OpenCode receives launch configuration, with OpenCode processes isolated by MCP credentials. Generic ACP uses a stdio goal channel and refuses to silently drop required goal tools. Credentials remain in child-process environments.
- Pure PTY paths without trustworthy turn lifecycle or tool progress cannot guarantee automatic continuation and failure retries; support follows actual runtime capabilities.

## Verification

See `ai_workspace/reports/goal-craft-harness-1.9.1.md` for validation results. Real Codex passed two-turn automatic continuation, pause, resume after closing the runtime session, stopping an automatic turn without tool calls, tool-reported completion and clearing the goal. Kimi returned `Authentication required` at startup in the isolated app and is not counted as a live pass. Other providers' real quota, authentication and platform combinations were not individually accepted.
