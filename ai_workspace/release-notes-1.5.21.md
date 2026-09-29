# CraftStation v1.5.21 — 看得见的快速模式与真实 Grok Fast

安装包：**[CraftStation-Setup-1.5.21-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.21/CraftStation-Setup-1.5.21-x64.exe)**

便携版：**[CraftStation-Portable-1.5.21-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.21/CraftStation-Portable-1.5.21-x64.exe)**

## 用户可见

- **快速模式有了看得见的开关**：Fast 从之前几乎无感的纯图标按钮，改为与「模型列表 / 推理强度」平行的带标签开关（⚡ 快速模式），开启时高亮。普通模型仍是默认档，Fast 只是可选候选。
- **Grok Fast 用真实模型**：官方快速档实为 `grok-4.7-build-fast`——现在正确折叠成 Grok 4.7 上的快速模式开关，启动时绑定的也是这个真实变体 id，不再出现独立的「4.7 Fast」行，也不会编造 `grok-4.7-fast` 这种不存在的 id。
- **自定义渠道可删除**：「管理模型」选中 OpenAI 兼容渠道后，详情头部新增「删除渠道」（带确认），会同时移除账号凭证与该渠道下已添加的自定义模型。

## 实现

- `splitFastModelVariants` 支持 `-build-fast` 后缀，且后缀剥出的基座不在目录时继续尝试下一后缀；`AgentCapability` 新增 `fastModelVariants`（目录实测 base→variant 映射），grok/kimi detection 写入。
- 所有 wire 路径（PTY `-m`、ACP `agent stdio`、unstable `session/set_model`）优先查 `fastModelVariants` 映射，`acpFastVariantByBase` 沿 `CreateStructuredSessionInput` → session factory → `AcpSessionConfigSync` 贯通。
- `ModelManagementPage`：openai-compatible 渠道详情加 `ConfirmDialog` 确认的删除入口，走 `bridge.removeAccount` + 绑定自定义模型清理。

## 验证

- 216 个相关测试全过（新增：`-build-fast` 折叠、catalog 映射优先于启发式、sync 映射注入、无映射兜底）；`pnpm typecheck` 与 oxlint 零告警。

---

# CraftStation v1.5.21 — A Fast switch you can see & the real Grok fast model

Installer: **[CraftStation-Setup-1.5.21-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.21/CraftStation-Setup-1.5.21-x64.exe)**

Portable: **[CraftStation-Portable-1.5.21-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.21/CraftStation-Portable-1.5.21-x64.exe)**

## User-facing

- **A Fast switch you can see**: Fast mode is now a labeled toggle beside the model list and reasoning-strength pickers (⚡ Fast mode), highlighted when on. The normal tier stays the default; Fast is an opt-in candidate.
- **Grok Fast binds the real model**: the official fast tier is `grok-4.7-build-fast` — it now folds into a Fast switch on Grok 4.7 and is the id actually launched, instead of a separate "4.7 Fast" row or a fabricated `grok-4.7-fast`.
- **Removable custom channels**: selecting an OpenAI-compatible channel in model management now offers 删除渠道 (with confirmation), which removes the account credential and its custom models together.

## Implementation

- `splitFastModelVariants` accepts the `-build-fast` suffix and keeps trying suffixes when a stripped base isn't advertised; `AgentCapability` gains `fastModelVariants` (catalog-derived base→variant map) written by grok/kimi detection.
- All wire paths (PTY `-m`, ACP `agent stdio`, unstable `session/set_model`) consult `fastModelVariants` first; `acpFastVariantByBase` threads from `CreateStructuredSessionInput` through the session factory into `AcpSessionConfigSync`.
- `ModelManagementPage`: confirmed 删除渠道 for openai-compatible channels via `bridge.removeAccount` plus bound custom-model cleanup.

## Verification

- 216 targeted tests pass (new: `-build-fast` folding, catalog map precedence, sync-map injection, heuristic fallback); `pnpm typecheck` and oxlint clean.
