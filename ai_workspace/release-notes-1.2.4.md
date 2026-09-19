## CraftStation 1.2.4

便携版：`CraftStation-Portable-1.2.4-x64.exe`

### 本版已修

- Gemini / Muse / DeepSeek 对话里可以展开思考链
- Gemini、DeepSeek 合成栏能显示上下文窗口
- Gemini `503 No capacity available` 重试日志不再当成失败刷屏
- 聊天附件目录对 ACP 可读
- 合成台配方选择器按实际 Harness + 模型显示，不再把黄色待合成标签漏到别的线程

### 已知限制（本版未完全解决）

**合成台 Efficient 模式仍有问题。** 跨厂商格子（例如 Kimi K3-256k + Codex Native）会显示「不可合成」，并要求 CLIProxyAPI。一键「安装并合成」目前不可靠。

**CLIProxyAPI 安装尚未打通。** 组件栏可能一直停在「安装中…」，瓦片仍显示「未安装」，合成不会变成可执行。在 CPA 真正就绪前，请不要指望跨 CLI 投影配方能跑起来。

**OpenCode + Gemini / Antigravity 配方仍可能落到别的模型。** 使用「OpenCode Native Harness - Gemini 3.8 Flash」这类配方时，实际 spawn 有时仍会带上残留账号或其它模型（例如 Chiral）。发送前请看右下角：必须是 OpenCode + 你选的 Gemini，而不是别的 Harness / 模型。

**Auto 仍是默认路径。** 合成台上指定的配方才会按 Recipe 启动；未点「用到对话」时，不要假设当前线程已经在跑那条配方。

未包含 NSIS 安装包。未上传本地验证脚本、截图、`.scratch` 或 `ai_workspace` 临时文件。

---

## English

### Fixed in this release

- Thinking streams can be expanded in Gemini / Muse / DeepSeek chats
- Gemini and DeepSeek craft panels show the context window
- Gemini `503 No capacity available` retry logs no longer flood as failures
- Chat attachment directory is readable by ACP
- The crafting recipe picker now shows the actual Harness + model and no longer leaks the yellow "to craft" badge onto other threads

### Known limitations (not fully resolved in this release)

**Crafting Efficient mode still has issues.** Cross-vendor slots (e.g. Kimi K3-256k + Codex Native) show as "cannot craft" and demand CLIProxyAPI. One-click "install and craft" is currently unreliable.

**CLIProxyAPI installation is not wired through.** The component bar may stay at "installing…", tiles still show "not installed", and crafting never becomes executable. Do not count on cross-CLI projection recipes until CPA is truly ready.

**OpenCode + Gemini / Antigravity recipes may still land on a different model.** With recipes like "OpenCode Native Harness - Gemini 3.8 Flash", the actual spawn sometimes still carries a leftover account or another model (e.g. Chiral). Before sending, check the bottom-right corner: it must be OpenCode + your chosen Gemini, not some other Harness / model.

**Auto remains the default path.** Only a recipe specified on the crafting bench launches as a Recipe; unless you clicked "use in chat", do not assume the current thread is already running that recipe.

No NSIS installer included. No local validation scripts, screenshots, `.scratch`, or `ai_workspace` scratch files uploaded.
