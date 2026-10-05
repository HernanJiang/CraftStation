# CraftStation v1.7.2

## User-facing

- **Auto-update CLIs**: Settings → Agents → General gains an "Auto-update CLIs" toggle (on by default). When a version check finds a newer release, each agent CLI updates through the same pipeline as the titlebar menu — including account-pool managed binaries. Turn it off to keep checks read-only; the titlebar update menu stays fully manual-capable either way.
- **Grok updates actually land**: updating Grok from the titlebar now refreshes the per-account `GROK_HOME/bin` binaries that pool sessions launch, not just the global npm install. Sessions on pooled accounts no longer hit `426 Grok CLI outdated` after a successful update, and the update menu reports the version your threads really run.
- **Thread renames stick**: titles now track provenance (placeholder / AI-generated / manual). An auto-generated title arriving late can no longer overwrite a rename you already made — manual names always win.

## Implementation

- New `Thread.titleSource` (`fallback` | `agent` | `user`) persisted end to end: schema migration 48 (`threads.title_source`, legacy rows treated as locked user titles), row mapper, sync upsert, remote broadcast diff, launcher and remote command paths. `renameThread` enforces precedence atomically and `titleGen` only writes over `fallback`.
- Detection plumbing: `DetectProbeCtx` / `AgentStatusService` now carry `baseDir`, so provider probes can see the account-pool root. Grok's `versionProbe` reports the oldest managed profile binary — the version sessions actually execute.
- New `postUpdate` adapter seam in `agentRegistryService`: after a successful update and before the status refresh, the adapter may propagate/repair runtime artifacts. Grok implements it via `managedGrokBinaries` — enumerates `craftstation-accounts/profile-*/bin`, detects the newest `grok-<semver>` executable (directory entries don't count), copies the fresh binary over each canonical `grok`, and reports locked profiles as stale instead of failing the whole update.
- Update commands may carry explicit env (`command.env`) independent of runtime `baseSpawnEnv` opt-outs.
- `CliUpdateMenu` mount auto-check applies discovered updates serially through `runCliUpdateBinary` when the new setting is on — same dedup, refresh and toast path as manual clicks.

## Verification

- typecheck clean; oxlint (plain + type-aware) clean.
- Full suite: 1109 files / 12,322 tests pass. The only failure is `compatibilityRuntimeAdapter.e2e` — it makes a real upstream call through a live CLIProxyAPI sidecar and fixture credentials, unrelated to this diff.
- New coverage: managed-binary sync/version probing (12+), Grok versionProbe against real temp profiles, explicit-env isolation in `updateAgent`, auto-update on/off in `CliUpdateMenu`, and titleSource provenance across store/titleGen/DB round-trips.

**Full Changelog**: https://github.com/HernanJiang/CraftStation/compare/v1.7.1...v1.7.2
