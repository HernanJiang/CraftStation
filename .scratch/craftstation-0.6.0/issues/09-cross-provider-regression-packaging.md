# 09 — Cross-Provider Regression & Packaging

**What to build:** 将 Antigravity OAuth/quota、Gemini runtime 保留、独立 Gemini usage 移除和 Ark Token Plan 汇入统一 provider surface，完成开发与打包环境的 binary/config resolution 回归。

**Blocked by:** 04 — Antigravity Quota Refresh Integration; 05 — Remove Standalone Gemini Usage Surface; 08 — Ark Error Mapping & Usage Projection

**Status:** ready-for-agent

- [ ] 五个 provider/runtime 相关现有路径无意外回归，尤其 Gemini CLI agent/runtime。
- [ ] Antigravity system-browser auth 与 quota refresh 的 IPC/UI 状态一致。
- [ ] Ark dev/package helper resolution 可在支持和缺失环境下诊断。
- [ ] 不引入 CLIProxyAPI，不提交账号库、token、cookie 或 auth 产物。
