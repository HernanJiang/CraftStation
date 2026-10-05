## v1.7.17

### Fixed

- **Antigravity**: a turn that already delivered its answer no longer reports failure and replays itself — a `result` frame reporting an error after the response completed (e.g. `write tcp` on a trailing call) now completes with a warning instead of feeding Craft-Harness a retryable error that regenerated the identical reply (the doubled answers + endless error/retry loop).
- **Antigravity**: `API error (attempt N)` retry chatter and post-answer process exits surface as warnings rather than failures — `agy` exits 1 right after its closing frames and internally retries API calls, neither of which is a turn outcome.
- **Antigravity**: the stray terminal window is gone for good — `last_check.timestamp` is now primed on every send and refreshed on a 5-minute interval for the session's lifetime, so the ~15-minute gate can no longer expire mid-session and let the detached `--bg-updater` allocate its own visible console.
