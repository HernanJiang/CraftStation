按你最新确认的范围执行：产品仓库中不再保留 Lightcode 或 PoraCode 的可见/可执行命名，统一改为 CraftStation；同时删除旧页面 CLI/TUI 展示和模式切换冗余，但保留仍有独立用途的终端基础设施。不会修改 `reference/` 只读上游资料，也不会修改 Git 历史；不会执行 reset、checkout、覆盖恢复或清理无关工作区改动。

一、完整盘点并分层处理旧命名

1. 在产品工作区中搜索大小写不敏感的 `lightcode`、`poracode`、`.poracode`、`PORACODE`，排除 `reference/`、`.git/`、`node_modules/`、构建产物和缓存。
2. 为每个命中点分类：
   - 当前产品数据目录、工作区目录、构建/发布配置、桌面/移动端身份、测试 fixture、文档和注释：改为 CraftStation。
   - 旧迁移逻辑、旧品牌 marker、旧品牌环境变量和旧品牌 UI 文案：删除或改为当前 CraftStation 逻辑，不保留兼容入口。
   - 仅用于通用协议/实现的普通术语：只有包含旧品牌含义时才改，不做无意义的全局替换。
3. 同步重命名产品内部符号和文件名，避免只改字符串后还残留 `Poracode*` 标识。例如 `poracodePaths`、`poracodeData`、`resolvePoracodeBaseDir`、`PORACODE_DATA_DIR` 等会改成 CraftStation 对应名称，并更新所有 import、测试和构建入口。

二、移除旧迁移和旧身份痕迹

1. 删除只负责 Lightcode/PoraCode 迁移的旧迁移分支、marker、旧路径判断和相关测试；不再从旧品牌目录迁移，也不再生成旧品牌 marker。
2. 将当前桌面/移动/打包身份全部统一到 CraftStation：
   - userData/data-root。
   - electron-builder mirror、clone/build utility、probe 目录、Vite ignore。
   - macOS/Windows/Linux 产品名、可执行文件名、移动端 manifest/Capacitor/Android/iOS 标识，以及相关测试。
   - 旧 `com.lightcode.*` 升级身份和 Lightcode updater 名称也一并改掉，因为你明确要求不留下任何 Lightcode 痕迹。
3. 对外部协议中必须保留的字段，只保留协议要求的通用字段；如果某字段只是上游遗留品牌别名，则改名或移除，并同步 schema、IPC、环境变量和文档。
4. 不改 `reference/`，不试图抹掉 Git 历史；构建生成的 `dist/` 和缓存目录只在验证时重新生成，不作为手工修改目标。

三、删除旧页面 CLI/TUI 展示冗余

1. 删除确认没有生产引用的：
   - `PresentationModeTabs`。
   - `TerminalPromptPanel`。
   - 相关过时测试、导出和注释。
2. 清理 `ThreadDraftComposerArea`、`ThreadDraftView` 中只用于 Chat/CLI 选择的无效 props、回调和 mode-picker 分支；保留真正用于终端能力 provider 或开发者终端的必要设置。
3. 更新 Antigravity、Kimi、Grok、OpenCode 的旧 terminal-only fixture 和产品文案，避免页面继续宣称它们支持 CLI/Chat 选项。
4. 保留以下不是旧 PoraCode 页面 UI、且仍有实际用途的代码：
   - 其他真正 terminal-capable provider 的 TerminalThreadContent、TerminalPane、xterm 和 mobile terminal。
   - 独立开发者 Terminal。
   - 登录/认证 Terminal。
   - structured runtime 的后台启动、ACP/stream-json、MCP、探测和必要的旧会话执行兼容层。
5. 继续使用 capability-aware presentation resolver，使四个目标 provider 的历史 terminal row 在渲染和启动前都归一为 GUI；不因删除页面入口而让旧数据卡死在 terminal 分支。

四、修复并更新测试

1. 当前产品路径测试统一使用 `.craftstation`、`CraftStation` 和 CraftStation 的实际身份；保留旧品牌测试只在本次明确范围内删除，不保留 Lightcode/PoraCode fixture。
2. 修复 Codex Router 测试对应的真实隔离逻辑：CraftStation-owned Codex private home 必须保留，只过滤外部 host Router overlay。这里修的是 CraftStation 的 Codex 配置隔离，不是恢复 Codex CLI 页面。
3. 更新 Todo Dock 测试以匹配当前 GUI plan-progress capsule；不把已经移除的旧 “Thread todo dock” 或 “Move todo dock to right panel” selector 强行塞回页面。
4. 将 placement/collapse 等纯状态断言移动到 store/action 测试，保留真实 `ThreadTodoDock` 组件测试；修复 GUI capsule 的硬编码中文 accessible label，改为 Lingui 文案。
5. 对重命名后的 imports、IPC、环境变量、打包脚本和移动端配置补齐回归测试。

五、验证和收口

1. 先运行旧命名残留扫描，确认产品源码、脚本、配置、测试、文档中不再出现 Lightcode/PoraCode；明确列出不能改的 `reference/`/Git 历史/生成物边界。
2. 运行受影响的 targeted tests，特别是：
   - channel/data-root/migration/probe。
   - Codex Router overlay。
   - provider detection/structured sessions。
   - renderer/mobile ThreadView。
   - Todo Dock/composer。
   - packaging/mobile configuration。
3. 运行 `pnpm typecheck`、`pnpm lint`、scoped formatter、`git diff --check`、`pnpm test` 和 `pnpm build`。
4. 对全量失败逐项判断是本次重命名/删除引入、环境依赖还是 stale fixture；不通过删功能或放宽断言掩盖。
5. 最终报告会清楚列出：旧命名删除范围、保留的通用 Terminal 范围、Codex Router 与本次路径改名的关系、Todo Dock 失败的实际原因、最终测试/build 结果，以及真实 provider E2E 与 fixture/mock 证据的边界。
