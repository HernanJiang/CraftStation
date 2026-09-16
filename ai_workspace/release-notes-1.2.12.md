## 下载 / Download

请用本页 **Assets** 里的安装包，不要 clone 源码当安装包。

**[CraftStation-Portable-1.2.12-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.2.12/CraftStation-Portable-1.2.12-x64.exe)**

双击即可运行。用户数据在 `C:\Users\<你>\.craftstation\`，不在 exe 旁边。

---

## 中文

### 本版修复

- **Antigravity 对话时闪终端窗**：`agy` 的后台自更新器（`--bg-updater`）会逃出伪控制台自己开一个新控制台，Windows Terminal 接管就弹窗。排查发现 crafting/nativeHarness 路径上的 `agy` 完全没带 `AGY_CLI_DISABLE_AUTO_UPDATE=1` 禁用开关——这正是「每次对话都弹」的缺口。现在该路径和 GUI 会话路径都强制注入；进程扫描还会顺带清掉漏网的 stray updater。
- **Antigravity 思考链 UI 分组**：Claude Opus「上面一大块思考、下面一大块工具」。用真实 `agy` 会话数据库验证：wire 上思考与工具其实是 1:1 交错的，问题出在映射层把没有 `step_index` 的思考事件全部合并进一个锚定在顶部的 item。现在按「连续思考段」拆分，思考与工具按真实顺序交错显示（与 Devin 视图一致）。
- **Devin SWE 模型报 `Client error: Protocol error (invalid_argument): an internal error occurred (trace ID…)`**：Devin CLI 新版把模型目录改成了 `{families:[{variants:[…]}]}` 格式，旧解析器完全解析不出，导致模型目录为空；线程里保存的旧模型 id（如已改名的 `carnelian-bead`）每次开会话都被 Devin 后端以 `invalid_argument` 拒绝。现在正确解析变体 uid，会话创建时校验模型 id，未知 id 自动回退到默认 SWE 模型并记录告警，不再整会话失败。
- **Gemini 池额度用量显示 0%（issue #8）**：纯应用内授权的 Gemini/Antigravity 账号没有保存 `projectId`，额度接口不带项目时落到默认项目、永远返回「未使用 0%」。现在先通过 `loadCodeAssist` 自动发现项目的 `cloudaicompanionProject` 并持久化，之后额度按真实项目统计。
- **子 agent 有时不走主 Agent 的代理**：Windows 下 CLI 程序不读系统代理（WinINET），从任务栏/Explorer 启动 CraftStation 时进程内没有代理环境变量——部分子 agent/one-shot 子进程因此直连失败而主 agent 正常。现在所有 agent 命令在 Windows 上统一注入解析后的代理层（显式环境变量优先 → 系统代理回退 → socks 自动转 http），主 agent、子 agent、one-shot 路由一致。
- **新增诊断开关**：设置环境变量 `CRAFTSTATION_CAPTURE_NATIVE_WIRE=1` 后，原生会话的 wire 帧（已脱敏）会写入临时目录的 ndjson 文件，便于定位「Gemini 经 Antigravity 是否根本不输出 thinking 事件」这类上游问题。

### 已知边界

- **Muse Spark 思考链交错**：Muse SDK 的 Turn 面板把 item 流（重放 backlog）和 delta 流（仅实时）拆成两条异步流，产物内无法还原 wire 真实顺序；待上游 SDK 提供统一事件序后跟进。

---

## English

### Fixes

- **Terminal window flash during Antigravity chats**: `agy`'s background self-updater (`--bg-updater`) escapes its pseudoconsole and allocates a fresh Windows console, which Windows Terminal pops as a stray window. The crafting/nativeHarness lane spawned `agy` without the `AGY_CLI_DISABLE_AUTO_UPDATE=1` kill switch entirely (B-mode binds no account env, so `baseSpawnEnv` arrived empty) — that was the every-conversation gap. The switch is now forced on that lane and the GUI session env, and the periodic process scan reaps any stray updater that still leaks through.
- **Antigravity thinking-chain UI grouping**: Claude Opus rendered as "one block of thinking on top, one block of tools below". Verified against a real `agy` conversation database: the wire interleaves thinking and tool steps 1:1 — the mapping layer collapsed step-less thinking frames into a single item anchored at the turn top. Thinking is now split into contiguous runs so thoughts interleave with tools in true order (matching the Devin view).
- **Devin SWE models failing with `Client error: Protocol error (invalid_argument): an internal error occurred (trace ID…)`**: newer Devin CLI releases answer `models list --format json` with a `{families:[{variants:[…]}]}` shape the old parser cannot read, leaving an empty catalog; a thread pinned to a since-renamed model id (e.g. `carnelian-bead`) then failed every session open. The parser now expands variant uids, session creation validates the model id against the probed catalog, and unknown ids fall back to the default SWE model with a warning instead of failing the whole session.
- **Gemini pool quota stuck at 0% (issue #8)**: accounts authorized in-app never captured a `projectId`; quota requests without a project land on a default project that always reports full quota. CraftStation now discovers the account's `cloudaicompanionProject` via `loadCodeAssist` and persists it, so quota reads scope to the real project.
- **Subagents sometimes bypassing the main agent's proxy**: Windows CLIs ignore the WinINET system proxy, and an app launched from the taskbar has no proxy env vars — some subagent/one-shot children went direct while the main agent tunneled. Every agent command now layers the same resolved proxy env on Windows (explicit env vars first, system-proxy fallback, socks→http normalization), so main agent, subagents, and one-shots share one route.
- **New diagnostic switch**: with `CRAFTSTATION_CAPTURE_NATIVE_WIRE=1`, native session wire frames (redacted) are appended to an ndjson file in the temp dir — useful for provider-side questions such as whether Gemini-via-Antigravity emits thinking events at all.

### Known limitation

- **Muse Spark thinking interleaving**: the Muse SDK's Turn surface splits item replay (backlog) and deltas (live-only) into two async streams, so true wire order cannot be reconstructed in-product; revisit once the upstream SDK exposes a unified event sequence.
