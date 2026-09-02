# 07 — Complete UI, remote sync and restart recovery

**What to build:** Desktop and remote users can discover targets, follow every exchange state, jump between both timelines, and recover collaboration after restart without duplicate delivery.

**Blocked by:** 04 — Handle explicit interrupt, attention and failures; 05 — Add bounded context and composition provenance; 06 — Expose agent-facing dialogue MCP tools.

**Status:** ready-for-agent

- [ ] Picker filters by title, Model, Harness, status and worktree.
- [ ] Source/target cards cover queued through replied/failed/cancelled states.
- [ ] Remote/mobile snapshots cannot bypass same-project or authorization policy.
- [ ] Restart recovery is idempotent; UI is accessible and localized.
