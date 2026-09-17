# Release 1.2.13 — Devin 凭证固化与额度窗口 + Muse OpenCode 原生路由（已推送，待打版）

状态：已提交（`b55114d1`）并推送到 `origin/main`；`v1.2.13` tag 与便携包待发版时再打。

## 用户可见

- Devin 登录一次就留住：`devin auth login` 之后，渠道卡常显邮箱与 Plan（Pro），不再每次打开都像没登录一样要求重新授权。
- 用量卡支持每天 / 每周 / 每月三档窗口：接口返回数字即自动渲染（目前官方不对 CLI 会话 token 开放个人用量数字，见已知边界）。
- Muse Spark 走 OpenCode 原生：muse 模型 + OpenCode Harness 即走官方 OpenCode runtime（`opencode-go` provider），思考与工具按 OpenCode 自己的事件顺序渲染，不再经过 MSP 自定义会话的交错坑。
- git 默认走梯子：`NO_PROXY` 去掉 github 直连，`git ls-remote` 已通。

## 根因

- `devin auth login` 的持久化本身正常（`%APPDATA%\devin\credentials.toml` 内 `windsurf_api_key` 会话 token）。
- 用量采集调的是不存在的 `api.devin.ai/v3/users/me`、`/v3/usage`（真机真 token 与假 token 均为 404），于是永远返回“ok 但无身份、无额度”空卡。
- `credentials.toml` 不含任何身份字段；`DEVIN_API_KEY` 粘贴路径同样撞上 404。

## 改动

- `resolveDevinToken`：文件凭证叠加 `devin auth status` 身份（Email/User ID/Plan，10 分钟进程缓存，`windowsHide`，失败降级为裸 token）；env/粘贴 key 绝不混入 CLI 身份。
- 探测器：按文件内容（有效 token）判定登录态，不再只看文件存在；与解析器共用同一判定；WSL 侧同步为 grep 判定；凭证路径统一到 `nativeDevinCredentialPaths`（补上 XDG 缝隙）。
- 采集器：daily/weekly/monthly 三窗口解析（嵌套对象、`<window>_used/_limit` 扁平字段、旧无范围形状回退 monthly）；usage 端按窗口优先、me 端补空缺。
- 描述符 `windowIds` 与用量圆环（daily 外环、weekly/monthly 内环）同步。
- Muse OpenCode 原生路由：新增 `recipe:muse-opencode-native`（providerID `opencode-go`）、`OPENCODE_NATIVE_MODEL_VENDORS` 加 `muse`、`openCodeNativeVendorFor` 加 muse 分支、`OPEN_CODE_PROVIDER_FACTS` 加 muse fact、`familyForModel` 认 `muse`/`meta` vendor。muse+muse 原生 pairing 与 MSP 会话不动。

## 验证

- 新增/扩展单测全过：`devin auth status` 解析（含 Plan 优先、Tier 回退、未登录拒绝）、身份缓存 TTL、文件登录固化、env key 隔离、裸 token 降级、三窗口解析与合并。
- `packages/agents-usage` + Devin 相关 48 文件 / 460 测试全过；合成路由（crafting/opencodeNative/兼容矩阵）19 文件 / 151 测试全过；触碰文件 `oxlint --deny-warnings` 0 错误；`tsc` 本批 0 新增错误。
- 真机一次性验证：`resolveDevinToken` 读到真实邮箱 + Pro（临时测试已删除）。

## 已知边界

- Devin 个人用量数字：v3 接口要 `cog_` service user + 企业权限，v1/v2alpha 要 service key，会话 token 一律 401；`devin auth status` 无数字。暂无 CLI 本地可用的数字源，不伪造，待官方开放个人用量接口后直接渲染。
- Muse MSP 自定义会话的思考/工具交错：`@muse-code/sdk` Turn 面板限制（`items()` 重放 backlog、`deltas()` 仅 live，两条流无统一序号），产物内无法彻底修复；本版起 Muse Spark 默认走 OpenCode 原生路由绕开，MSP 路径保留给 muse+muse 原生 pairing。

# Release 1.2.13 — Devin credential persistence & usage windows (pending)

Status: code and tests done, not committed/pushed (`github.com:443` is proxy-blocked; will align and ship once the network recovers).

## User-visible

- Devin sign-in sticks: after `devin auth login`, the channel card keeps showing email + plan instead of asking to re-authorize every time.
- Usage card supports daily/weekly/monthly windows, rendered automatically when the API returns numbers (currently not exposed to CLI session tokens — see known limits).

## Known limits

- Devin personal usage numbers: no CLI-local source exposes them (v3 needs a `cog_` service user with enterprise permissions, v1/v2alpha need service keys, session tokens get 401 everywhere). Not faked; renders automatically once upstream exposes a personal endpoint.
- Muse Spark thinking/tool interleaving: `@muse-code/sdk` Turn surface limitation, cannot be fixed in-product (carried over from 1.2.12).
