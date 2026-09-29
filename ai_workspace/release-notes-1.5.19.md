# CraftStation v1.5.19 — Codex / Kimi / Grok 快速模式开关

安装包：**[CraftStation-Setup-1.5.19-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.19/CraftStation-Setup-1.5.19-x64.exe)**

便携版：**[CraftStation-Portable-1.5.19-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.19/CraftStation-Portable-1.5.19-x64.exe)**

## 用户可见

- 模型选择器新增 **Fast（快速模式）开关**，只出现在原厂确实有快速档的模型上：
  - **Codex / ChatGPT**：走官方 fast service tier（`service_tier="fast"`），按目录元数据判定支持面。
  - **Kimi**：`kimi-for-coding` 开 Fast 后切换为官方 HighSpeed 档 `kimi-for-coding-highspeed`（约 5-6× 速度、约 3× 配额）。
  - **Grok**：`grok-4.7` 等基座模型的官方 fast 变体（`grok-4.7-fast`）合并成一个 Fast 开关，不再在模型列表里重复出现。
- Fast **默认关闭**——普通模型是默认档；你在某模型上开过一次后按模型记忆。Grok 因模型在启动时绑定，切换 Fast 需重开会话生效。
- 安全兜底：Fast 永远不会编造模型 id——对没有官方快速档的模型，残留的 fast 标记自动回落普通档。

## 实现

- 新增 `src/shared/fastModelVariants.ts`：`splitFastModelVariants` 在 detection 层把已广告的 fast 变体行折叠进基座模型（仅当基座也在目录中），`fastVariantModelId` 负责 wire 层基座→变体拼写，未知家族返回 `null`。
- Kimi：`buildKimiProbeCapabilities` 折叠 highspeed 行并声明 `fastModels`；PTY/ACP 两条 `-m` 路径在 `config.fast` 时发变体 id；ACP configOption 别名表新增 `-highspeed`。
- Grok：`probeCapabilities` 同样折叠 `-fast` 行；`pushSharedFlags` 在 `config.fast` 时把 `-m` 重写为 `grok-X-fast`（`session/set_model` 是 no-op，模型启动时绑定）。
- ACP：新增 `resolveAcpSessionModelId` 供不稳定 `set_model` 路径使用；`sessionConfigSync` 在同模型 fast 翻转时重发 `set_model`。
- `adaptThreadConfigForCapabilities` 丢弃目标模型无 fast 变体的 `fast:true`；Codex 既有 `service_tier` 链路不变。

## 验证

- 294 provider/shared + 1403 renderer/codex 测试全过；`pnpm typecheck` 与 oxlint 零告警。

---

# CraftStation v1.5.19 — A Fast toggle for Codex, Kimi, and Grok

Installer: **[CraftStation-Setup-1.5.19-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.19/CraftStation-Setup-1.5.19-x64.exe)**

Portable: **[CraftStation-Portable-1.5.19-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.19/CraftStation-Portable-1.5.19-x64.exe)**

## User-facing

- The model picker gains a **Fast** toggle, shown only on models with a genuine fast lane:
  - **Codex / ChatGPT**: requests run on the official fast service tier (`service_tier="fast"`), gated by catalog metadata.
  - **Kimi**: `kimi-for-coding` switches to the official HighSpeed variant `kimi-for-coding-highspeed` (~5-6x speed, ~3x quota).
  - **Grok**: official fast variants like `grok-4.7-fast` collapse into one Fast choice on the base model instead of cluttering the list.
- Fast is **off by default** — the normal tier is the default; enabling it is remembered per model. Grok binds its model at launch, so toggling Fast takes effect on a new session.
- Safety: Fast can never fabricate a model id — a stale flag on a model with no official variant degrades to the normal tier.

## Implementation

- New `src/shared/fastModelVariants.ts`: `splitFastModelVariants` folds advertised fast-variant rows into their base model (only when the base is also advertised); `fastVariantModelId` spells the variant at the wire layer and returns `null` for unknown families.
- Kimi: probe folds the highspeed row into `fastModels`; PTY/ACP `-m` paths emit the variant id when `config.fast`; ACP aliases gain `-highspeed`.
- Grok: probe folds `-fast` rows; `pushSharedFlags` rewrites `-m` to `grok-X-fast` under `config.fast` (model is launch-bound; `session/set_model` is a no-op).
- ACP: new `resolveAcpSessionModelId` for the unstable `set_model` path; `sessionConfigSync` re-sends `set_model` on a same-model fast flip.
- `adaptThreadConfigForCapabilities` drops `fast:true` when the target model has no fast variant; Codex's existing service-tier path is unchanged.

## Verification

- 294 provider/shared + 1403 renderer/codex tests pass; `pnpm typecheck` and oxlint clean.
