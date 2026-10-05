# CraftStation v1.6.7

## User-facing

- **Crafting workbench redesign**: model and harness cells now match the 3×3 grid's slot size; the right column becomes an "Ingredients" panel where MCP servers, skills and policies appear as same-size ingredient slots with an enabled-state dot; the right column is wider and the result / recipes column is about half as wide to make room; every block shares one card style.
- **Lighter terminal output**: bursts of output (build logs, installs, large files) are delivered in frame-sized batches, cutting supervisor CPU roughly in half and taking almost all of the load off the main process, so scrolling stays smooth.
- **Startup no longer slows with history**: routine database cleanup (expired usage events, old output compaction) now runs after launch instead of before the window appears.
- **Windows: reclaim leftover console hosts**: after a terminal or agent thread exits, CraftStation reclaims a conhost.exe (about 11 MB each) when it can be uniquely matched to that session.
- **Background shutdown protection after a force-close or crash**: production builds now detect when the main process exits and shut down the supervisor, reducing lingering background agents, terminals and helper services.
- **Automatic account-pool failover**: when a ChatGPT account hits its usage limit mid-task, the thread rotates to the next pool account and replays the prompt instead of stopping on the error.
- **Permissions preserved across agents**: switching a thread between agents keeps full access — it no longer silently drops to Ask for approval because the two agents spell the permission differently (bypass/auto and friends).

## Implementation

- ConPTY: node-pty 1.1.0 does not close the pseudoconsole when the client exits, and a later `pty.kill()` is a no-op. The taskkill tree kill stays, and the conhost under the supervisor is then reaped by a unique match against the spawn time window; non-unique matches are logged and never killed (`conptyConhostReaper.ts`).
- `thread-output`: 16 ms per-session batching at the pty.onData bindings (`PtyOutputBatcher`); each batch runs the existing parse / transcript / emit path once, and pending output is flushed before exit handling.
- Database: migration 47 adds an index on `usage_events(ts)`; runtime output compaction and retention pruning moved out of `initDatabase` and run 10 s after startup, with structured failure logs.
- Process lifecycle: the supervisor orphan watchdog now also runs in production builds (1 s polling, worst case under 5 s); Job Object helper start failure, runtime exit and assignment failure all emit structured logs with stable error codes.
- Tooling: the oxlint ignore now matches only the root-level `/main`, so `src/main/**` is linted again, and the lint debt this uncovered is fixed without behavior changes.
- Pool failover: Codex's quota error often lands on `thread/error` after the failed `turn/completed` already settled, or while a sibling internal turn is still tracked — the old gate required the turn to still be live, so the text was deduped away and failover never fired. A 15 s grace now anchors on the live turn's own failed completion. The quota poller also no longer wipes `lastError` when refreshing `quota-exhausted`, which had silently stripped the inference mark's 6 h protection and let dead accounts flip back to `available` and get re-elected.

## Verification

- Managed mock session, same script before → after: 20k-line burst 19,501 → 123 events, supervisor CPU 136% → 67% of one core, main 44% → 2%; scrollback matches the output stream.
- Zero conhost left after closing 5 shells and after a natural shell exit; `taskkill /F` of the main process takes the supervisor subtree down in 354 ms.
- `initDatabase` takes 3.25 ms at 10k usage events / 1k items and 3.68 ms at 200k / 20k, essentially flat across table sizes; `EXPLAIN QUERY PLAN` confirms the retention delete uses `idx_usage_events_ts`.
- Pool failover: 3 new regression cases (post-settle `thread/error`, sibling-masked completion, grace not inherited) plus the accountStore `lastError` preservation case; 140 codex session tests and 96 pool-failover suite tests pass; typecheck and lint clean.
- Full managed mock smoke passes with zero renderer console/runtime errors; one embedded browser screenshot timed out while the other functional checks and screenshots passed. This mode does not validate real accounts, devices or model inference.
- Workbench measurements confirm that model, harness, MCP and skill slots are all 72×72; selecting a model and harness, crafting and saving a recipe, and clearing the grid pass.
