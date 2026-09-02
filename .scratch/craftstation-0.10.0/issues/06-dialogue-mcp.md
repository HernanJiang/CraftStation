# 06 — Expose agent-facing dialogue MCP tools

**What to build:** Authorized agents with built-in MCP can ask a target thread, wait on the exact exchange, and read its reply without guessing the target's latest message.

**Blocked by:** 03 — Queue busy targets and order follow-ups; 04 — Handle explicit interrupt, attention and failures; 05 — Add bounded context and composition provenance.

**Status:** ready-for-agent

- [ ] High-level ask/read/wait tools share the Thread Collaboration Module with UI.
- [ ] Legacy thread tools retain compatibility and map to the new delivery contract.
- [ ] Self, cross-project, unauthorized, loop and hop-limit requests are rejected.
- [ ] Capability reporting distinguishes UI support from in-Harness MCP support.
