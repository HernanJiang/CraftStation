# Ideate v0.3.0 — CraftStation Native Codex Runtime

> 状态：`IDEATE AGREED`
>
> 日期：2026-08-25
>
> 本文记录已达成的产品与架构方向，不是 Manager Feature Spec、Ticket 列表或实现授权。

## 1. Feature Intent

v0.3.0 的目标是把 Codex 从“CraftStation Composition 外包给 PoraCode Runtime 执行”迁移为：

```text
OpenAI Model Item
+
Codex Harness Item
-> Native Recipe
-> Crafter
-> CraftPlan
-> CraftStation Codex Runtime
-> Official codex app-server
-> Entity
-> Session
```

CraftStation 成为 Codex Harness 的 Composition、Control 与 Presentation Plane；官方 Codex Runtime 继续拥有 Agent Loop 与 Harness 内部行为。

建议 Feature 名称：

```text
v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane
```

## 2. Meaning of Runtime Parity

“与 Codex Harness 完全一致”在本 Feature 中正式解释为：

- 使用用户实际安装并认证的官方 Codex Runtime。
- 通过官方 `codex app-server` 与其 JSON-RPC protocol 驱动 Thread、Turn、Tool、Approval、MCP、Skills、Compaction 与 Session lifecycle。
- 未在 CraftStation UI 中显式覆盖的配置继续使用 Codex 自己的 config、requirements、account 与 runtime resolution。
- Context usage、状态、压缩、工具调用、权限请求与错误以官方 Runtime 返回的信息为事实来源。
- CraftStation 不重写、不模拟、不替换 Codex Agent Loop。

Runtime parity 不表示：

- 两次非确定性模型生成必须逐字相同。
- CraftStation UI 必须复制 Codex CLI/TUI 的视觉布局和键盘操作。
- CraftStation 必须重新实现 Codex 的上下文压缩、工具系统、MCP、Skills 或子 Agent。
- 所有 experimental app-server capability 在任意 Codex 版本中都必须可用。

最终验收比较的是 Runtime identity、effective configuration、protocol semantics、events、lifecycle 与能力行为，不比较随机生成文本是否完全一致。

## 3. Ownership Model

### CraftStation Owns

- Model Item 与 Harness Item 的发现、展示和选择。
- Slot resolution、Recipe、Crafter、Result Item 与 CraftPlan。
- Harness Runtime Registry 与 Codex Runtime Module。
- Codex app-server process supervision、transport connection 与 capability negotiation。
- Entity、Session 与 composition provenance。
- Prompt/Turn 控制、流式事件订阅和 UI projection。
- Approval、permission、MCP elicitation 等 server-initiated request 的 UI 展示与用户决策回传。
- CraftStation 自己的错误语义、observability 和 persistence seam。

### Official Codex Owns

- Agent Loop。
- Model request orchestration。
- 上下文选择、token accounting 与自动压缩。
- Tool Loop、shell、patch、web 与其他原生工具行为。
- MCP connection、tool execution 与 OAuth/runtime 状态。
- Skills discovery、loading 与 invocation。
- 子 Agent、review、goal、steer、interrupt 等原生行为。
- Codex Thread/Turn persistence、resume 与 fork 语义。
- Sandbox、permission profile 与 approval execution semantics。

## 4. Scope of the PoraCode Refactor

本 Feature 重构的是 PoraCode 的整条 Codex Harness 适配链，不是为每一个 OpenAI/Codex 模型分别编写 Adapter，也不是重写其他 Harness。

所有官方 Codex-compatible Model Items 共享同一个：

```text
CraftStation Codex Runtime Adapter
```

模型差异由 Model Item、Recipe 输入和 CraftPlan runtime configuration 表达。

v0.3.0 最终 Codex 产品路径不得依赖或 fallback 到：

```text
ThreadSessionManager
SpawnPipeline
PoraCode AgentAdapter
PoraCode CodexStructuredSession
PoraCode canonical event mapping
PoraCode Codex hook plugin
```

PoraCode 的 Desktop、Electron、Workspace、IPC、数据库、Terminal、Git/Worktree 与其他尚未迁移的通用基础设施可以继续保留。这里要求的是 Codex execution critical path 独立，不是本 Feature 一次性重写整个 PoraCode-based Desktop。

## 5. Proposed Architecture

目标产品路径：

```text
React Craft Table / Session UI
        ↓
CraftStation application command
        ↓
Crafter.compile
        ↓
CraftPlan
        ↓
HarnessRuntimeRegistry
        ↓
CraftStationCodexRuntime
        ↓
CodexAppServerProcessHost
        ↓
Codex JSON-RPC Connection
        ↓
Official Codex Thread / Turn
        ↓
Native Codex events and server requests
        ↓
CraftStation event projection
        ↓
React UI
```

建议 Module：

```text
src/supervisor/harness-runtime/
├── interface.ts
├── registry.ts
└── codex/
    ├── index.ts
    ├── runtime.ts
    ├── processHost.ts
    ├── rpcConnection.ts
    ├── session.ts
    ├── eventProjection.ts
    ├── approvalBroker.ts
    ├── capabilityDiscovery.ts
    ├── errors.ts
    └── protocol/
        └── generated/
```

Codex Module 对外保持小 Interface，把 process、transport、JSON-RPC、schema compatibility、event routing 和 server request correlation 隐藏在内部 implementation。

## 6. Model Discovery and Replacement

Codex 系列模型不应长期硬编码在 CraftStation。

目标链路：

```text
official app-server model/list
        ↓
Codex capability discovery
        ↓
Model Item definitions
        ↓
Registry
        ↓
Crafting Grid Model Slot
```

官方返回的 model identity、reasoning effort、service tier 与 capability metadata 用于构造或刷新 Model Items。

用户在首次 Craft 前更换模型，只改变 Model Ingredient 并重新编译 CraftPlan。

若未来支持已运行 Session 中途更换模型，必须生成新的可追溯 CraftPlan revision，并通过官方 Codex 的 settings/turn override 语义执行；不得静默修改原 CraftPlan。该行为是用户显式、确定性的重新合成，不等同于 Phase 4 的自动 Runtime Re-Crafting。

## 7. CraftPlan Direction

CraftPlan 必须从当前“主要携带 model/runtime binding”扩展为 UI/Crafting 决策交给 Native Runtime 的完整编译产物。

目标信息包括：

- Recipe、Ingredients、Result 与版本 provenance。
- Harness kind、Runtime Adapter identity 与 protocol identity。
- Model identity。
- Workspace 与 runtime roots。
- 用户显式选择的 reasoning effort、service tier、approval policy、permission profile 或 sandbox policy。
- 用户显式选择的 MCP、Skills roots 与其他 Codex launch/turn configuration。
- 可选的 Codex Thread ref 与 resume intent。

配置规则：

1. 用户显式选择的配置必须忠实传给官方 Runtime。
2. 用户未显式选择的配置必须省略，由 Codex 原生配置层解析。
3. 不无条件注入固定 reasoning summary、context size、sandbox、approval policy 或自定义 `CODEX_HOME`。
4. CraftPlan 是不可变的 composition record；运行中配置变化需要新的可追溯 revision 或 Session runtime event。
5. MCP、Skills、permission 与 context 在本 Feature 中可以先作为 Runtime Configuration，不提前升级为新的一级 Item。

## 8. Session and Event Model

生产 Session 不再以“发送 Prompt 后等待完整字符串或 60 秒超时”为核心抽象。

目标采用：

```text
submit input
-> receive Turn identity
-> subscribe to runtime events
-> handle server requests
-> observe Turn completion or interruption
```

Session 至少需要表达：

- submit/start turn
- steer active turn
- interrupt
- resolve approval or user input request
- manual compact
- review
- update supported settings
- resume/fork
- terminate/close
- subscribe/snapshot

生产 Turn 不设置任意固定的 60 秒完成超时。允许对 app-server spawn、initialize 与单次 RPC acknowledgement 设置合理 transport timeout，但长任务由事件、进程状态和用户控制决定生命周期。

## 9. Event Fidelity

CraftStation 同时保留：

```text
Native Codex event envelope
+
CraftStation normalized UI projection
```

原则：

- UI 可以消费稳定的 CraftStation event。
- 未识别的新 Codex event 不得静默丢弃。
- Approval 和其他 server-initiated requests 必须保留 request identity 并能够回传 response。
- Context 和 token UI 使用官方 `thread/tokenUsage/updated`。
- 自动与手动压缩使用官方 `contextCompaction`/Turn events。
- 敏感 Prompt、Token、Cookie 与 credential 不写入普通日志。

## 10. Native Environment Policy

默认行为是继承用户现有 Codex 环境：

- 使用用户实际选择或系统解析到的官方 `codex` binary。
- 使用正常 Codex `CODEX_HOME` resolution。
- 使用用户现有 account/auth、config、requirements、skills 与 MCP 配置。
- CraftStation UI 显式覆盖的选项才作为 thread/turn override。

未来如果增加隔离 profile、独立 `CODEX_HOME` 或 provider account environment，必须在 UI 与 CraftPlan 中显式表达，不能作为隐藏默认值。

## 11. Migration Strategy

采用 Strangler Refactor，不执行未验证的大爆炸删除：

1. 在旧路径旁建立 CraftStation-owned Codex Runtime Module。
2. 通过官方 generated schema、fake app-server 与真实 app-server 分层验证。
3. 让 Codex Native Recipe 只使用新 Module。
4. 迁移 UI events、approvals、usage、resume 与 lifecycle。
5. 使用 dependency guard 阻止新 Codex Module 导入旧 PoraCode Runtime。
6. 取得完整真实验收证据。
7. 移除产品 fallback 和旧 Codex execution path。
8. 确认无生产引用后再删除遗留 Codex adapter implementation。

legacy implementation 可以在开发迁移期作为对照存在，但 Feature 最终 PASS 时不得成为产品 fallback。

## 12. Required Capability Areas

v0.3.0 需要覆盖：

- binary/version/account/auth discovery
- `model/list` 与 Model Item refresh
- app-server initialize/initialized
- thread start/resume/fork/read
- turn start/steer/interrupt/completion
- assistant/reasoning streaming
- command、file change、tool 与 MCP events
- approval、permission 与 elicitation request/response
- token usage 与 context display
- automatic/manual compaction
- Skills list/change/invocation
- MCP status/reload/OAuth integration
- subagent/review/goal 等受当前官方版本支持的事件
- process crash、auth、rate limit、unsupported capability 与 recovery
- persistence、resource cleanup 与 observability

Experimental capability 通过 runtime discovery 和 feature gating 暴露。官方版本不支持的能力应在 UI 中明确禁用或降级，不由 CraftStation 模拟。

## 13. Acceptance Direction

最终不能再以 synthetic round-trip 或稳定失败诊断作为成功验收。

至少需要真实证明：

```text
Model Item
-> Recipe
-> CraftPlan
-> CraftStation Codex Runtime
-> official codex app-server
-> thread/start or thread/resume
-> turn/start
-> streaming events
-> real Codex response
-> second turn on the same Session
```

并验证：

- Codex 产品路径不依赖旧 PoraCode Codex Runtime classes。
- 产品没有 legacy Codex fallback。
- UI 显式配置与官方 effective settings 一致。
- UI context/usage 来自官方 Runtime。
- 长 Turn 不因固定 60 秒被终止。
- Approval、MCP、Skills、compaction、resume、interrupt 和 cleanup 在支持范围内可用。
- 未识别事件和官方错误不会被静默吞掉。

## 14. Out of Scope

- 重写 Codex Agent Loop 或 Codex Core。
- 同时重写 DeepSeek Harness、Grok Build 或所有 PoraCode Agent integration。
- 一次性移除全部 PoraCode Desktop 基础设施。
- Auto-Crafting、Interaction-Aware Search、Model Fingerprint 与 Learned Router。
- 将 Context、MCP、Skills、Permission 全部提前升级为一级 Item。
- 要求不同运行产生逐字相同的模型输出。
- 为官方未提供的 experimental capability 自建不兼容替代实现。

## 15. Resolved Decisions

- v0.3.0 优先于 DeepSeek Harness 和 Grok Build 的下一轮接入。
- 当前 `v0.2.16` 继续保持 UI-only，关闭后再启动 v0.3.0。
- Codex 集成入口使用官方 `codex app-server`，不通过 PTY 模拟 CLI。
- Codex 系列 Model Items 共享同一个 Codex Harness Runtime Adapter。
- 最终产品路径不依赖或 fallback 到旧 PoraCode Codex Adapter。
- 默认继承用户现有 Codex 环境，只有 UI 显式选择才覆盖。
- 官方 Runtime 拥有 Agent Loop、Context、Compaction、Tools、MCP、Skills 与 Subagents。
- CraftStation 拥有 Composition、Control、Presentation、provenance 和事件投影。
- Stable protocol 是最低承诺；experimental capability 通过版本和 capability gate 使用。

## 16. Next Workflow Step

Ideate 已完成，可以进入：

```text
Architect Brief
-> Manager Feature Spec / Tickets
-> Coder
-> Debugger
```

进入正式大型项目工作流前，由用户显式调用 `$my-workflow` 并指定下一角色。
