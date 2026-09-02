# 08 — Prove real multi-Harness cross-thread dialogue

**What to build:** Demonstrate a real Codex-to-Grok request, reply and follow-up across independent threads, plus failure/restart evidence and a second route when credentials permit.

**Blocked by:** 07 — Complete UI, remote sync and restart recovery.

**Status:** ready-for-agent

- [ ] Codex source and Grok target produce non-synthetic official Runtime evidence.
- [ ] Request/reply/follow-up anchors and composition provenance are independently verified.
- [ ] Busy queue, interrupt failure, attention, restart and stale-worker cases have evidence.
- [ ] A second Harness route passes or remains explicitly BLOCKED; no credentials leak.
- [ ] Existing App Controls, Crossagents, composer, remote and native Harness regressions pass.
