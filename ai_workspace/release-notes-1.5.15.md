# CraftStation v1.5.15 — Step Code 成为一等 Native Harness

安装包：**[CraftStation-Setup-1.5.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.15/CraftStation-Setup-1.5.15-x64.exe)**

便携版：**[CraftStation-Portable-1.5.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.15/CraftStation-Portable-1.5.15-x64.exe)**

## 用户可见

- Step Code（StepFun 官方 CLI）现在是正式的 Native Harness：会出现在 Harness & CLI 面板中，可直接从面板安装，也能在合成台里作为 Harness Item 与 Step 系列模型组成原生 Recipe。
- Step Code 纳入「检查 CLI 更新」：最新版本通过 StepFun 官方发布 manifest 探测，更新执行其内置 `step update`。
- Step 系列模型（`step-*`、`step/*`、`stepfun/*`）在已安装 Step Code 时，Auto 默认路由到 Step Code 原生 Harness，不再回退到 OpenCode；仅在 Step Code 未安装时才按既有设计走 OpenCode 兜底。

## 实现

- 注册 `STEPCODE_NATIVE_HARNESS_DESCRIPTOR`（vendor `stepfun`，transport `pi-jsonl-rpc-stdio`，`step --mode rpc`）并接入 `StructuredNativeHarnessRuntimeAdapter` + `createStepCodeAdapter`。
- Crafting Registry 新增 `stepfun:step-5-preview` 模型 Item、`harness:stepcode` Harness Item 与 `recipe:stepfun-stepcode-native`。
- 合成台探测列表补入 `stepcode`；CLI 更新的最新版本来源接入官方 `latest.json`；`inferNativeHarnessFromModel` 识别 Step 家族模型并映射到 `stepcode`。

## 验证

- `nativeHarnessRegistry`、`autoHarnessResolver`、`thirdPartyRouting`、`minimaxZcodeIntegration`、`updateAgent` 相关测试全部通过；`pnpm typecheck` 与 oxlint（含 type-aware）零告警。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.15 — Step Code as a first-class native harness

Installer: **[CraftStation-Setup-1.5.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.15/CraftStation-Setup-1.5.15-x64.exe)**

Portable: **[CraftStation-Portable-1.5.15-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.15/CraftStation-Portable-1.5.15-x64.exe)**

## User-facing

- StepFun's official Step Code CLI is now a first-class native harness: it appears in the Harness & CLI panel where you can install it, and it shows up in the workbench as a Harness Item that pairs with Step-family models through a native recipe.
- Step Code joins CLI update checks — the latest version comes from StepFun's official release manifest, and updates run its built-in `step update`.
- Step-family models (`step-*`, `step/*`, `stepfun/*`) now route to the Step Code native harness under Auto whenever Step Code is installed, instead of falling back to OpenCode; the OpenCode fallback only applies when Step Code is not installed.

## Implementation

- Registered `STEPCODE_NATIVE_HARNESS_DESCRIPTOR` (vendor `stepfun`, transport `pi-jsonl-rpc-stdio`, `step --mode rpc`) wired to `StructuredNativeHarnessRuntimeAdapter` + `createStepCodeAdapter`.
- Crafting Registry gained the `stepfun:step-5-preview` model Item, the `harness:stepcode` Harness Item, and `recipe:stepfun-stepcode-native`.
- The workbench probe list now includes `stepcode`; CLI update checks read the official `latest.json`; `inferNativeHarnessFromModel` maps Step-family model ids to `stepcode`.

## Verification

- `nativeHarnessRegistry`, `autoHarnessResolver`, `thirdPartyRouting`, `minimaxZcodeIntegration`, and `updateAgent` tests pass; `pnpm typecheck` and oxlint (including type-aware) are clean.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
