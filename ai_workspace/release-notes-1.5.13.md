# CraftStation v1.5.13 发布说明

## 中文

- **新能力：agent 回合内 `wait` 工具。** 内置 `craftstation` MCP 服务器新增 `wait`，任一 harness 的 agent 可在当前回合内阻塞等待：集成终端 pane 有新输出（可选正则过滤）、pane 退出，或 worktree 内文件 create/modify/delete 时提前返回，否则按 `timeoutSeconds`（上限 30 分钟）超时返回。监控类循环不再每个轮询间隔花一次 shell 调用。底层走 `ThreadStateBroker` 的事件驱动唤醒（`thread-output` / `project-tree-changed` / `git-changed`），无轮询风暴。
- **新建线程默认完全访问权限。** 用户手动创建、agent 跨建、调度创建的线程统一应用「设置 → 一般」中的默认权限级别（出厂默认 Full Access，可调回 Ask）。
- **Codex 订阅 401 修复。** managed Codex profile 不再把 `sk-svcacct-` service-account key 带进 ChatGPT 订阅请求：导入与启动时消毒 `auth.json` 的旁路凭据字段，`access_token` 必须 JWT 形态；同时剥离 `CODEX_API_KEY` / `CODEX_ACCESS_TOKEN` 环境变量，杜绝它们劫持托管会话。
- **切换项目保留草稿。** 聊天框中未发送的 prompt 在切换项目时随 composer 一起迁移，不再丢失。

## English

- **New: in-turn `wait` tool for agents.** The built-in `craftstation` MCP server now exposes `wait`, letting an agent in any harness block inside its turn until a watched signal fires — new output on an integrated Terminal pane (optionally regex-gated), a pane exit, or a file create/modify/delete under the worktree — or until `timeoutSeconds` (max 30 min) elapses. Monitoring loops no longer spend a shell call per poll. Wakes are event-driven via `ThreadStateBroker` (`thread-output` / `project-tree-changed` / `git-changed`).
- **New threads default to Full Access.** Threads created by you, by other agents, or by schedules all apply the default permission level from Settings → General (factory default Full Access; adjustable back to Ask).
- **Codex subscription 401 fixed.** Managed Codex profiles no longer leak a `sk-svcacct-` service-account key into ChatGPT subscription requests: `auth.json` is sanitized on import and before spawn, `access_token` must be JWT-shaped, and `CODEX_API_KEY` / `CODEX_ACCESS_TOKEN` env vars are stripped so they cannot hijack a managed session.
- **Drafts survive project switches.** An unsent composer prompt migrates with you when switching projects instead of being orphaned.
