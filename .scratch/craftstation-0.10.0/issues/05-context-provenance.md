# 05 — Add bounded context and composition provenance

**What to build:** Users can explicitly attach a safe context capsule, while every request/reply shows the real source and target Recipe, Model, Harness and Runtime provenance.

**Blocked by:** 02 — Deliver the first idle cross-thread dialogue.

**Status:** ready-for-agent

- [ ] Default context capsule is empty beyond explicit request and minimum identity.
- [ ] Selected messages/summary/state/recent turns obey budget and allowlist redaction.
- [ ] Cross-worktree targets show a warning and do not imply file synchronization.
- [ ] Optional v0.9 Segment provenance works when available without a hard dependency.
