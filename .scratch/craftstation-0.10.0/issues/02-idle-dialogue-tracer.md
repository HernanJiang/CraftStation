# 02 — Deliver the first idle cross-thread dialogue

**What to build:** A user can choose an idle same-project thread with another Model/Harness, send a request, and see its real reply projected back while both threads remain independently navigable.

**Blocked by:** 01 — Encapsulate existing thread controls.

**Status:** ready-for-agent

- [ ] Durable link/exchange identity survives restart.
- [ ] Request is delivered once and is anchored in the target timeline.
- [ ] Reply is captured from the matching completed turn, never an older message.
- [ ] Source and target cards expose composition provenance and jump actions.
