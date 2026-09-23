# CraftStation v1.5.10 — 额度按真正挡住请求的窗口判断，进行中的思考链保持展开

安装包：**[CraftStation-Setup-1.5.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.10/CraftStation-Setup-1.5.10-x64.exe)**

便携版：**[CraftStation-Portable-1.5.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.10/CraftStation-Portable-1.5.10-x64.exe)**

## 用户可见

- Codex、Grok、Kimi、Antigravity 和 OpenAI 兼容渠道的额度，按真正挡住下一次请求的窗口判断。某一条模型小额度、美元加量或重置次数用完，不会再把整个号标成没额度。
- 后面还有健康号时，会跳过已经额度偏低的号。如果剩下的都偏低，就选剩余最多的那个。
- 正在进行的思考和工具链保持展开，能看到最新步骤。这一轮结束后收起。

## 实现

- 共用 `switcherQuota`：周额度优先作为标题，挡住请求的窗口决定 `available` / `quota-low` / `quota-exhausted`。
- 默认优先级切号在健康号和额度低的号之间改排序；轮询和随机不变。
- 当前轮次的工具链不再因为出现思考而自动收起。纯文件修改组仍然默认收起。

## 验证

- `switcherQuota`、账号解析、渠道额度刷新和工具链展开测试已通过。
- Windows x64 双包：`pnpm dist:win` 与 `pnpm dist:win:portable`。

---

# CraftStation v1.5.10 — Clearer quota and a live thinking trail

Installer: **[CraftStation-Setup-1.5.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.10/CraftStation-Setup-1.5.10-x64.exe)**

Portable: **[CraftStation-Portable-1.5.10-x64.exe](https://github.com/HernanJiang/CraftStation/releases/download/v1.5.10/CraftStation-Portable-1.5.10-x64.exe)**

## User-facing

- Quota for Codex, Grok, Kimi, Antigravity, and OpenAI-compatible channels follows the window that actually blocks the next turn. A model carve-out, extra-usage charge, or reset-credit counter no longer marks the whole account empty.
- When another account still has room, CraftStation skips one that is already low. If every account is low, it picks the one with the most remaining.
- The live thinking and tool trail stays expanded so the latest steps stay visible. It collapses when the turn finishes.

## Implementation

- Shared `switcherQuota`: the weekly lane leads the headline, and the blocking window decides `available`, `quota-low`, or `quota-exhausted`.
- Default priority switching reorders healthy accounts ahead of low ones. Round-robin and random are unchanged.
- The live tool trail no longer collapses just because a thought appears. Edit-only groups still start collapsed.

## Verification

- The `switcherQuota`, account resolver, channel quota refresh, and tool-trail tests passed.
- Windows x64 dual packages: `pnpm dist:win` and `pnpm dist:win:portable`.
