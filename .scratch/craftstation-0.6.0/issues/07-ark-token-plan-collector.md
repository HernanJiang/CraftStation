# 07 — Ark Token Plan Collector & Parsers

**What to build:** 通过官方 Ark API/SDK 实现 Token Plan collector，将 API Key 或 AK/SK V4 请求结果规范化为 UsageSnapshot，解析五小时、daily、weekly、monthly 窗口并保留 reset 时间。

**Blocked by:** 06 — Ark Credential Contract

**Status:** ready-for-agent

- [ ] AK/SK V4 canonical request/signature 与官方 endpoint/region 事实一致。
- [ ] Coding Plan 与 Agent Plan 响应分别解析，未知 plan/字段 fail closed。
- [ ] 5h、daily、weekly、monthly 窗口及 absolute reset timestamp 解析有 fixture tests。
- [ ] collector seam 不向调用方暴露 raw body 或 secret。
