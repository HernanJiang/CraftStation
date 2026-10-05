## CraftStation v1.7.5

### Fixed — Account Pools

- **Codex Plus accounts now rotate out when the 5-hour quota hits.** Plus never reports the `session-5h` window to the usage poller, so a 5h-quota death was invisible and the account kept burning failed turns. Turn-level `usage_limit_reached` failures are now recorded as an axis-scoped block (`session-5h` vs `weekly`, classified from the error's reset hint) that blocks scheduling until it expires — and live `account/rateLimits/updated` pushes from the app-server write real windows onto the bound account in both chat and crafted lanes.
- **Recovery is evidence-driven, on both axes independently.** A healthy poll can no longer erase a still-live 5h block; a lagged sub-100 reading can't un-mark an axis a failed turn just exhausted; expired windows heal the account lazily without waiting for the next poll. Disabled and auth-expired rows are never silently revived, and generic 429 throttling never burns an account.
- **Kimi gets the same treatment.** HTTP 402 balance failures mark the weekly axis; `403` "5-hour usage limit … quota will reset" responses mark `session-5h` with a bounded recovery window; 401 auth failures stay fail-closed.

### Added — Threads

- **Live output speed in the working indicator.** The "工作中" pill and its details popover now show an estimated `≈ N tok/s` decode rate for the current turn — computed from streamed output, pausing across tool calls. It's an estimate from text, not a billing number.

### Assets

| File                                  | Notes                          |
| ------------------------------------- | ------------------------------ |
| `CraftStation-Setup-1.7.5-x64.exe`    | Windows installer (x64)        |
| `CraftStation-Portable-1.7.5-x64.exe` | Portable build — unzip and run |
