# 04 — Handle explicit interrupt, attention and failures

**What to build:** Users can explicitly interrupt a busy target before sending, while attention requests and runtime failures return accurate, actionable exchange states.

**Blocked by:** 03 — Queue busy targets and order follow-ups.

**Status:** ready-for-agent

- [ ] Interrupt-and-send waits for official settled confirmation and fails closed.
- [ ] Approval/reply attention is surfaced with target navigation, not auto-answered.
- [ ] Auth, quota, binary, capability and runtime errors never silently fallback.
- [ ] Timeouts, cancellation and cleanup have stable, redacted diagnostics.
