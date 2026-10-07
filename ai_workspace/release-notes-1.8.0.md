# CraftStation v1.8.0

## 用户可见

- 补齐 13 种语言的界面翻译，覆盖模型选择、账号面板、设置、合成台与状态提示。
- 会话中调用过的 Skills 持续生效，每轮重新注入；覆盖 GUI、运行中转向、会话重启与合成台创建的线程。
- 修复旧设置因字符编码不一致造成的全局指令乱码。
- 修复 Windows 下关闭 OpenCode 会话时，服务器短暂占用临时文件导致退出失败的问题。

## 实现

- 按会话累积已调用的 Skill，续接与重建时保留，并通过各 Runtime Adapter 的每轮指令通道发送。
- 将 `iconv-lite` 补入生产打包的运行依赖清单，修复三平台打包前检失败。
- OpenCode 临时目录改为异步清理并有限重试；真实服务测试使用独立临时工作目录。

## 验证

- TypeScript 类型检查、普通 lint 与类型感知 lint 通过。
- 生产编译与 17 项运行依赖校验通过。
- 最终针对性回归 142 项通过，包含 OpenCode 真实服务启动与会话退出；1 项环境依赖测试跳过。
- 13 个语言目录未发现缺失译文，英文译文未发现中文残留。

---

# CraftStation v1.8.0

## User-facing

- Complete UI translations for all 13 supported languages, covering model selection, account panels, settings, the crafting grid, and status messages.
- Skills invoked during a session stay active and are injected again with each turn, covering GUI chat, mid-flight steering, session restarts, and crafted threads.
- Recover saved global instructions corrupted by character encoding mismatches in older settings.
- Fix Windows OpenCode session shutdown failures caused by temporary files briefly remaining locked by the server.

## Implementation

- Accumulate invoked Skills per session, preserve them during continuation and runtime rebuilding, and send them through each Runtime Adapter's per-turn instruction channel.
- Add `iconv-lite` to the production runtime dependency staging list, fixing packaging preflight failures on all three desktop platforms.
- Clean up OpenCode temporary directories asynchronously with bounded retries; use isolated temporary workspaces for real-server tests.

## Verification

- TypeScript checks, standard lint, and type-aware lint passed.
- Production compilation and validation of all 17 runtime dependencies passed.
- Final targeted regression: 142 tests passed, including real OpenCode server startup and session shutdown; 1 environment-dependent test skipped.
- All 13 language catalogs passed the missing-translation check, with no Chinese text found in English translations.
