# Debugger — v1.1.0 Compatibility Bridge & Model × Harness Composition

## Review scope

- Feature: `v1.1.0 — Compatibility Bridge & Model × Harness Composition`
- Worktree: `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`
- Branch: `dev/v1.1.0-compatibility-bridge`
- Baseline: `f5a4bb276b22e664e7691e67b486e2b1252e5d9a`
- Review role: independent Debugger review of the Coder delivery, including source call-chain inspection, focused tests, typecheck, build, and Electron mock smoke.

## Verification evidence

- Focused Vitest: 4 test files passed, 139 tests passed (`executionRoute`, `workbench`, Compatibility Bridge, Codex).
- Expanded regression: 31 test files passed, 199 tests passed, 6 files skipped. `src/supervisor/runtime.test.ts` remains blocked by a pre-existing `better-sqlite3` Node ABI mismatch (native ABI 148, current Node ABI 137); the 95 failures are environment/dependency failures and are not counted as feature evidence.
- `pnpm typecheck`: passed with 0 errors.
- `pnpm build`: passed with existing CSS sourcemap/pseudo-element and chunk-size warnings.
- Electron mock smoke: baseline, mock integrations, IPC round-trip, and runtime/console-error gates passed; 0 runtime/console errors. The smoke does not execute CPA, a Compatibility Session, or a real OpenCode Agent Loop, so it is not Compatibility Feature PASS evidence. Artifact: `C:\Users\Haona\.craftstation-smoke\automated-1788429824135-22264\artifacts\smoke-report.json`.

## Findings — feature-level blockers

### F1. The Compatibility Bridge does not start or supervise CPA

`src/supervisor/runtime/compatibilityBridge/bridge.ts` only flips an in-memory `running` flag. It does not locate/start a CLIProxyAPI binary, create a child process or loopback HTTP service, probe readiness, inject an API key/credential namespace, or handle process errors/exits. `this.process` is never assigned, so `stop()` cannot stop a sidecar.

### F2. The Supervisor never selects a Compatibility runtime

`src/supervisor/supervisorRuntime.ts` still creates `NativeCodexRuntimeAdapter` for Codex and `createNativeHarnessRuntimeAdapter` for other Harnesses without branching on `plan.runtimeBinding.routeType`. No bridge lifecycle, exporter selection, target-Harness configuration, endpoint/key projection, or compatibility-session lifecycle is present.

### F3. Crafter/Registry cannot produce Compatibility Recipes

`src/shared/crafting/crafter.ts` and `registry.ts` register only the native recipes. Cross pairings therefore do not enter the Recipe/CraftPlan chain and commonly resolve to `RECIPE_NOT_FOUND`; the new bridge/exporters are not connected to CraftPlan generation.

### F4. Resolver readiness is not fail-closed

`resolveUiStatus()` in `src/shared/crafting/compatibility.ts` passes `compatibilityBridgeReady: true` unconditionally. It can report `CRAFTABLE` without a CPA, exporter, verified protocol, account pin, or executable target configuration. This contradicts the Manager requirement that Compatibility is craftable only when CPA and the relevant exporter are ready.

### F5. Supervisor fabricates model provider identity

In `src/supervisor/supervisorRuntime.ts` the selected model's `providerKind` is populated from the Harness vendor (`harnessRef?.vendor`) rather than the actual selected model inventory/binding. Cross/native route decisions can therefore be incorrect and account/provider mismatches are hidden.

### F6. Exporters are DTO-only and unverified

The five exporter functions in `src/supervisor/runtime/compatibilityBridge/exporters.ts` return static configuration objects but are not wired to official runtimes with isolated configuration, backup/restore, or cleanup. The hardcoded `craftstation-compatibility-key` is especially inconsistent with the absent bridge key generation. No real or fixture Agent-loop E2E proves execution.

### F7. UI exposes non-executable pairings as craftable

`EfficientWorkbench`, `RecipeSaveDialog`, and `CraftingWorkbenchPage` treat `CRAFTABLE` as executable and display only a generic “compatibility layer” label. They do not show Native/Compatibility route, protocol, capability, degraded/unsupported/not-tested state, or disable Craft/Save when bridge/exporter readiness is absent.

### F8. Session persistence and account pinning are schema/in-memory only

The new route/account/protocol/endpoint fields exist in types, but no evidence shows that Compatibility CraftPlans and session snapshots populate them, that resume reuses the same route/account, or that interrupt/stop preserve the compatibility scope. `pinAccount()` only stores a config in memory; it does not map the selected account to CPA credentials, disable round-robin, create an isolated auth directory, verify provider identity, or fail closed on mismatch.

## Verdict

**FAIL** — the core Compatibility execution chain is not implemented. The passing tests, typecheck, build, and generic smoke establish regression/build health only; they do not establish the feature acceptance gates.

## Fix plan — v1.1.1

Fixes must be implemented in this worktree and re-reviewed before any merge, tag, or push:

1. Implement a real CPA sidecar lifecycle: binary resolution, child-process spawn, loopback-only binding, generated/injected secret-free runtime references, readiness/health probe, stderr/exit/error diagnostics, and deterministic stop/cleanup.
2. Obtain model provider and model ID from the real selected model inventory/binding. Add identity-mismatch and unavailable-provider fail-closed tests.
3. Add Compatibility Recipe registration and CraftPlan generation for supported cross pairings, including route, account, protocol, endpoint reference, exporter, and capability diagnostics.
4. Wire Supervisor `craftAgent` to select Native or Compatibility strictly from the resolved route and to own bridge/exporter/session lifecycle. Native pairings must remain sidecar-free.
5. Make readiness per exporter/target Harness and fail closed. Do not mark `CRAFTABLE` unless CPA, exporter, protocol, account pin, and target configuration are executable and verified.
6. Integrate at least OpenCode projection into the official runtime path and add a mock/fixture Agent-loop integration test. Other exporters may remain unsupported only if their capability state and diagnostics honestly say so; no unverified protocol or hardcoded fake key may be presented as executable.
7. Implement account pinning to a concrete credential namespace/auth-dir, prevent round-robin, validate provider identity, and test selected-account stickiness.
8. Populate and persist Compatibility session fields; test resume, interrupt, stop, endpoint secret exclusion, and account-pool changes while a session is active.
9. Update UI to display explicit `Native`/`Compatibility` route and protocol/capability state, and disable Craft/Save for unavailable, unsupported, degraded, or untested routes.
10. Add integration evidence for the full chain: Model × Harness → Recipe → CraftPlan → Bridge → exporter → target runtime → session/result, plus Native regression proving no CPA process is started.

## Fix acceptance criteria

- At least one supported cross pairing completes a fixture/mock Agent loop through a real bridge-shaped HTTP endpoint and target-runtime adapter, with route/account/protocol diagnostics visible and secret-free.
- CPA process readiness, failure, exit, and cleanup are observable and tested; `stop()` leaves no child process or listener.
- Native pairings never start CPA and retain existing runtime behavior.
- Resolver/UI/Recipe/CraftPlan/Supervisor agree on the same route and fail closed whenever any required capability is absent or unverified.
- Selected account remains sticky and is demonstrably the credential namespace used by the bridge; identity mismatch is rejected.
- Session snapshot and resume preserve route, account, protocol, and endpoint reference without persisting secrets.
- Typecheck, build, focused tests, and relevant regression tests pass, with the `better-sqlite3` ABI issue recorded separately if still present.

## Execution order

1. Bridge lifecycle and test seam.
2. Real model identity plus resolver/readiness contract.
3. Compatibility recipes/CraftPlan and Supervisor route branching.
4. OpenCode executable projection and fixture Agent loop.
5. Account pinning and session lifecycle/resume/interrupt.
6. UI route/capability state and final regression evidence.

## Handoff

Fix #1 is assigned to `Coder-1.1-Compatibility Bridge` (`01a066ae-2dff-7b91-a227-9622b02a0dde`). After the Coder reports completion, this Debugger thread performs Re-review #1. No merge to `main`, push, or formal tag is authorized by this review.
