# CraftStation v1.5.9 — 自定义模型重启后仍走原来的账号

安装包：**[CraftStation-Setup-1.5.9-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.9/CraftStation-Setup-1.5.9-x64.exe)**

便携版：**[CraftStation-Portable-1.5.9-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.9/CraftStation-Portable-1.5.9-x64.exe)**

## 用户可见

- 更新并重启后，阶跃星辰这类自定义模型（例如 `step-5-preview`）会重新用上你已经配好的账号，不再报 `Model not found`。
- 对话被切到 Devin、模型仍是这个自定义模型时，再发一条消息会回到 OpenCode 和原来的账号，不再拿别的 Harness 去跑它。

## 实现

- OpenCode 再启动时，如果调用方把账号丢了，会按自定义模型把对应的 OpenAI 兼容账号绑回去，并加载那份隔离配置。
- 发送未知家族的自定义模型时，会按模型 id 找回账号。已知家族（例如 ChatGPT）仍只走自己的渠道。
- 跨 Harness 切换且没有可续的新会话时，不再保留旧 Harness 的 session id。
- `craftstation/` 是 OpenCode 内部渠道名，不会再被当成模型名传出去。

## 验证

- `thirdPartyRouting`、`modelSlug`、`runtime` 与 changelog 对应测试已通过。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.9 — Custom models stay on their account

Installer: **[CraftStation-Setup-1.5.9-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.9/CraftStation-Setup-1.5.9-x64.exe)**

Portable: **[CraftStation-Portable-1.5.9-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.9/CraftStation-Portable-1.5.9-x64.exe)**

## User-facing

- After an update and restart, a custom model such as StepFun `step-5-preview` uses the account you already configured, instead of failing with `Model not found`.
- If the thread was moved to Devin while that custom model was still selected, the next message returns to OpenCode and the same account, instead of asking the other harness to run it.

## Implementation

- When OpenCode starts again and the caller dropped the account, the matching OpenAI-compatible account is bound back and its isolated config is loaded.
- Sending an unknown-family custom model looks the account up by model id. Known families, such as ChatGPT, stay on their own channel.
- A cross-harness switch with no new session to resume no longer keeps the previous harness session id.
- `craftstation/` is OpenCode's internal provider id and is no longer passed through as a model name.

## Verification

- The `thirdPartyRouting`, `modelSlug`, `runtime`, and changelog tests passed.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
