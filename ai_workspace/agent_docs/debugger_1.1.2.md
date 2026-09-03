# Debugger Takeover — v1.1.0 Compatibility Bridge & Model × Harness Composition

## Review scope

- Feature: `v1.1.0 — Compatibility Bridge & Model × Harness Composition`
- Worktree: `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`
- Branch: `dev/v1.1.0-compatibility-bridge`
- Baseline: `main@f5a4bb276b22e664e7691e67b486e2b1252e5d9a`
- Review mode: Debugger Takeover after two Coder fix rounds (`v1.1.1`, `v1.1.2`)

The Coder's second fix round did not close the core Compatibility execution chain. The Debugger therefore applied only deterministic fail-closed and lifecycle-hardening changes that can be supported by local source and test evidence. No synthetic Agent Loop, target Harness consumption, or CPA runtime success was claimed.

## Takeover changes

- Compatibility route resolution now treats omitted readiness as unknown and fails closed. OpenCode route readiness is also required to be explicitly verified.
- Supervisor compatibility resolution no longer hardcodes `compatibilityBridgeReady: true`.
- Model material identity is parsed from stable `agent:<provider-surface>:<model>` and `custom:<provider>:...` references; unknown formats are represented as unknown and do not borrow the Harness vendor.
- `craftAgent` refuses a Compatibility plan before native adapter construction because no independent Compatibility Runtime Adapter exists. Compatibility environment DTOs are not allowed to silently alter native Harness semantics.
- Compatibility Bridge binary startup uses explicit configuration or a resolved executable; absent binary is `RUNTIME_UNAVAILABLE`. Launch arguments are limited to the reference-confirmed `--config` selector. Health readiness requires HTTP 200; 401/404 do not count.
- Bridge stop waits for child exit and escalates after a bounded timeout.
- Exporters reject stopped/unverified Bridge status instead of using the previous fake key fallback.
- Workbench Craft and Recipe Save are disabled for unverified `CRAFTABLE` Compatibility state; the UI labels it as unverified diagnostic state.

These changes intentionally make the current product behavior more conservative. They do not turn the Feature into PASS.

## Verification evidence

- Focused Vitest: 5 test files, 158 tests passed:
  - `src/shared/crafting/executionRoute.test.ts`
  - `src/shared/crafting/workbench.test.ts`
  - `src/shared/crafting/crafting.test.ts`
  - `src/supervisor/runtime/compatibilityBridge/bridge.test.ts`
  - `src/supervisor/agents/codex/codex.test.ts`
- `pnpm typecheck`: passed with 0 errors.
- Affected-file `oxfmt --check`: passed.
- Affected-file `oxlint --deny-warnings`: passed.
- `git diff --check`: passed.
- `pnpm build`: passed. Existing CSS pseudo-element, sourcemap, module-format, and chunk-size warnings remain.
- Full Vitest: 918 files passed, 16 skipped, 2 tests failed in the pre-existing ACP probe stress file `src/supervisor/agents/acp/probe.stress.test.ts`. Both failures are timing/cleanup stress assertions where `sessionEstablished` was undefined; no Compatibility source was involved.

## Remaining blockers

### F1 — No accepted real CPA runtime evidence

The machine still has no demonstrated bundled/installed CPA binary, valid CPA credentials, or real process-to-loopback verification. The reference repository confirms the config-file model (`config.yaml`, `auth-dir`, `api-keys`, routing settings) but does not establish a product packaging path or prove the selected target runtime contract. The Bridge lifecycle tests remain injected-process tests.

### F2 — No independent Compatibility Runtime Adapter or Agent Loop

There is no adapter that sends a Compatibility session request through the Bridge and returns a target Harness response. The previous implementation injected Compatibility DTO/env values into native Codex/native Harness adapters; takeover now rejects that route explicitly. Consequently no Model → Recipe → CraftPlan → Bridge → exporter → official Target Harness → Session/result chain is available.

### F3 — Recipe and capability contract remain incomplete

`CompatibilityBridgeRecipe` still constructs a static plan with a hardcoded loopback endpoint and does not carry a runtime-produced endpoint reference, verified exporter identity, protocol verification, or a concrete session-scoped account binding. The shared resolver can express a verified compatibility result for test purposes, but the Supervisor read-only IPC path intentionally returns unavailable because it does not start or verify the runtime.

### F4 — Account namespace/session persistence is not proven

`pinAccount()` remains an in-memory bridge field and is not demonstrated to map the selected CraftStation account into CPA's credential namespace. Resume, account-pool mutation isolation, Compatibility interrupt/close cleanup, and session-scoped Bridge ownership remain unverified.

### F5 — Official target Harness consumption is unproven

The five exporter functions remain configuration DTOs. There is no verified OpenCode official projection/backup/restore path and no official Codex, Kimi, Grok, or Antigravity Compatibility consumption evidence. Antigravity's required direct Gemini-compatible `/v1beta` path is not demonstrated.

## Verdict

**FAIL / BLOCKED**

The takeover closes several dangerous false-positive paths and preserves honest `RUNTIME_UNAVAILABLE` behavior, but the Feature acceptance gates requiring a real CPA-supervised Compatibility execution chain, an independent Compatibility adapter, verified official target-runtime projection, account namespace binding, session persistence, and a real Agent Loop remain open. Coder fix rounds `v1.1.1` and `v1.1.2` did not close them; no further Coder fix round is authorized by this review.

## Promotion and acceptance status

- DEV PASS: **not granted**.
- User acceptance artifact: **not started**.
- Merge to `main`: **not authorized**.
- Formal tag/push: **not authorized**.

To reconsider this verdict, a later implementation must provide real or explicitly fixture-scoped bridge-shaped HTTP Agent Loop evidence, while separately proving the official CPA binary/config contract, target Harness consumption, account stickiness, secret-free snapshots, and cleanup. Mock process tests and DTO shape tests alone are insufficient.
