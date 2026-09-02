# 03 — Queue busy targets and order follow-ups

**What to build:** Requests to a working target wait durably for its current turn, then deliver once; follow-ups on one link remain ordered and users can cancel before delivery.

**Blocked by:** 02 — Deliver the first idle cross-thread dialogue.

**Status:** ready-for-agent

- [ ] Default delivery neither steers nor interrupts a working target.
- [ ] Outbox/claim idempotency prevents duplicate sends across workers and restarts.
- [ ] One link delivers exchanges in sequence and enforces conservative limits.
- [ ] Cancellation before delivery prevents the target input.
