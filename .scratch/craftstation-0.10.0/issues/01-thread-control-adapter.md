# 01 — Encapsulate existing thread controls

**What to build:** Put the existing long-lived thread list/read/create/send/wait/interrupt/stop behavior behind one CraftStation-owned adapter without changing current MCP users.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Existing App Controls thread tool contracts remain compatible.
- [ ] Live, inactive-resumable, non-resumable and self-target paths have seam-level tests.
- [ ] MCP handlers no longer duplicate direct Supervisor/DB orchestration.
- [ ] Stable errors and credential redaction remain intact.
