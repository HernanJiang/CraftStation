# Debugger — v1.1.0 Compatibility Bridge & Model × Harness Composition

## Re-review #1 scope

- Feature: `v1.1.0 — Compatibility Bridge & Model × Harness Composition`
- Fix cycle reviewed: `v1.1.1`
- Worktree: `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`
- Branch: `dev/v1.1.0-compatibility-bridge`
- Baseline: `main@f5a4bb276b22e664e7691e67b486e2b1252e5d9a`
- Review role: independent Debugger re-review of the Coder delivery, including source call-chain inspection, focused tests, typecheck, static checks, official CLI/reference verification, and lifecycle/secret-free acceptance gates.

This is a Feature-level review. Passing focused tests and typecheck are regression evidence only; they do not establish a real Model → Harness Agent Loop.

## Independent evidence

- Focused Vitest: 5 files, 154 tests passed.
- `pnpm typecheck`: passed.
- `git diff --check`: passed.
- Feature-scoped `oxlint --deny-warnings`: failed (`bridge.ts:133` `preserve-caught-error`; `bridge.test.ts` `require-mock-type-parameters`).
- Feature-scoped `oxfmt --check`: failed on affected bridge, exporter, route, recipe, and Supervisor files.
- Official local CLI versions checked: OpenCode `1.18.25`; Antigravity `agy` `1.1.25`.
- Product-root `reference/CLIProxyAPI` checked independently. The reference is a Go sidecar whose configuration is primarily managed through `config.yaml`, `api-keys`, `auth-dir`, and related configuration entries. It does not establish the submitted `--host --port --api-key --auth-dir` command-line contract.
- No real bridge-shaped HTTP Agent Loop was demonstrated. No evidence proves a real CPA process was launched with a valid configuration, that an official target Harness consumed the projected configuration, or that a target Harness returned an Agent response through the bridge.
- No code changes, commit, merge, tag, push, or main promotion were performed by this review.

## Findings

### F1 — The bridge still cannot be accepted as a real CLIProxyAPI launcher

`src/supervisor/runtime/compatibilityBridge/bridge.ts` now has injectable `spawn` and health-probe code, but it still defaults to `cliproxyapi.exe` / `cliproxyapi` without reliable binary discovery or a product packaging path. It passes `--host`, `--port`, `--api-key`, and `--auth-dir` without generating/managing the reference CPA configuration model. `credentialNamespace` remains an in-memory field and is not projected into a CPA credential namespace. The `/health` probe treats `404` and `401` as ready, which does not prove the bridge API is usable. `stop()` sends `SIGTERM` but does not await process exit or verify that the child process and listener have been released. The tests use a mock process/fetch and do not establish the real bridge contract.

### F2 — There is still no independent Compatibility Runtime Adapter

`src/supervisor/supervisorRuntime.ts` branches only around bridge setup and then continues to instantiate `NativeCodexRuntimeAdapter` or `createNativeHarnessRuntimeAdapter`. There is no independent Compatibility adapter with a proven request/response path. `runtimeOptions.compatibilityConfig` is injected into existing adapters, but no evidence proves those official runtimes consume it. OpenCode remains coupled to the native server pool/binding resolver, and environment-variable injection for the other Harnesses is not proof that their official CLIs use the projected endpoint. The required `CPA → Target Harness Agent Loop` is absent.

### F3 — The Compatibility Recipe remains a static plan generator

`CompatibilityBridgeRecipe` matches almost any valid Model × Harness pair that is not an obvious native pair. Matching does not incorporate actual bridge readiness, exporter readiness, protocol capability, account pin, or target configuration executability. The recipe hardcodes `http://127.0.0.1:8317`, does not carry a concrete `accountId` or exporter identity into the binding, and has no capability matrix or verified session binding. Crafter/Recipe and Supervisor can therefore disagree about whether the same combination is executable.

### F4 — Resolver and Supervisor readiness are still not strictly fail-closed

`resolveUiStatus()` still uses `compatibilityBridgeReady ?? true`, and Supervisor compatibility resolution passes `compatibilityBridgeReady: true`. A ready Harness in one of the five supported lists can therefore become `CRAFTABLE` when CPA is absent, the sidecar is not listening, the health API is unusable, exporter capability is unverified, credentials are not pinned, or target configuration is not executable. The implementation does not make `CRAFTABLE` contingent on all required capabilities being explicitly verified.

### F5 — Model provider identity is still unreliable

The Supervisor prioritizes `payload.modelEntryRef.split(":")[0]`. For an identifier such as `agent:codex:terminal:gpt-5.3`, that yields `agent`, not the model provider `codex`. The implementation does not reliably query the authoritative model inventory/binding and falls back to `harnessRef.vendor` when the format is unknown. That fallback can again fabricate Model provider identity and can hide an incompatible pairing. Unknown or ambiguous identity is not rejected fail-closed.

### F6 — Exporters remain DTOs, not verified official-runtime projections

`src/supervisor/runtime/compatibilityBridge/exporters.ts` returns static `TargetHarnessConfig` objects. It does not generate, isolate, back up, restore, or validate target Harness configuration, and it does not verify that official Harnesses consume the fields. The `status.apiKey ?? "craftstation-compatibility-key"` fallback is a hardcoded fake credential; an unstarted or unverified bridge must not be presented as executable with such a key. There is no OpenCode Agent Loop evidence and no actual Codex/Kimi/Grok/Antigravity Compatibility runtime evidence.

### F7 — Workbench UI and recipe save flow still treat Compatibility as ordinary craftable state

The actual Workbench UI was not updated to display an explicit Native/Compatibility route, protocol, or supported/degraded/unsupported/not-tested capability state. `EfficientWorkbench` still treats `CRAFTABLE` as craftable, `CraftingWorkbenchPage.handleCraft()` only blocks `IMPOSSIBLE`, and `RecipeSaveDialog` still allows Compatibility recipe saving. A generic “compatibility layer” label is not an executable readiness or capability diagnostic.

### F8 — Session persistence and account pinning remain type/in-memory scaffolding

The new schema fields are not populated consistently by actual OpenCode, Native Codex, or Structured session snapshots. Compatibility CraftPlans do not carry a concrete account binding, `pinAccount()` only stores in-memory configuration, and `credentialNamespace` is not mapped to CPA credentials/auth-dir semantics. The bridge is Supervisor-global rather than session-scoped, so multiple-account isolation is not demonstrated. Resume does not prove reuse of route/account/protocol/endpoint; close/stop does not prove Compatibility Bridge release; interrupt does not have Compatibility lifecycle acceptance evidence.

## Verdict

**FAIL** — the Compatibility execution chain remains unproven and materially incomplete. The focused tests and typecheck pass, but the core Feature acceptance gates for real CPA supervision, Compatibility runtime selection, verified exporter projection, strict readiness, account/session binding, UI honesty, and a real Agent Loop are not closed.

## Fix plan — v1.1.2

1. Reconcile the bridge with the actual CLIProxyAPI reference contract. Add reliable binary/config discovery or an explicit unavailable diagnostic; generate an isolated, loopback-only CPA configuration without persisting secrets in CraftPlan/session snapshots; require a meaningful authenticated readiness probe; await and verify child/listener shutdown; test spawn failure, early exit, timeout, health failure, and cleanup.
2. Introduce a distinct Compatibility Runtime Adapter or an explicit target-runtime adapter seam whose request path is demonstrably bridge-shaped. Keep Native adapters untouched and prove Native pairings never instantiate/start CPA.
3. Define one authoritative capability/readiness object consumed by resolver, recipe, CraftPlan, Supervisor, and UI. Require explicit verification of CPA, target exporter, protocol, account binding, and target configuration before `CRAFTABLE`; unknown/ambiguous states must fail closed.
4. Resolve Model identity from the authoritative inventory/binding, including multi-colon references such as `agent:codex:terminal:gpt-5.3`; reject unknown identity instead of using Harness vendor as a substitute. Add regression tests for valid, ambiguous, and unknown references.
5. Replace static exporter DTOs with a verified projection seam. At minimum, implement and test OpenCode through its official runtime/config path with isolated backup/restore and a fixture bridge-shaped Agent Loop. Mark other Harnesses unsupported/not-tested unless their official consumption path is proven; remove fake-key fallbacks.
6. Put concrete route, account, protocol, endpoint-reference, exporter, and capability diagnostics into the CraftPlan. Remove the hardcoded endpoint or make it a runtime-bound value produced by the same lifecycle that starts the bridge.
7. Make account pinning session-scoped and credential-namespace-backed, prevent round-robin drift, validate provider identity, and cover resume, interrupt, close/stop, and account-pool mutation while active. Keep secrets out of persisted plans/snapshots and diagnostics.
8. Update Workbench, Craft action, and Recipe Save UI to show Native/Compatibility and capability state, and disable Craft/Save for unavailable, unsupported, degraded, or untested combinations.
9. Fix the reported `oxlint` and `oxfmt` failures, then rerun focused tests, relevant regression tests, typecheck, build, and the bridge-shaped integration evidence.

## Fix acceptance criteria

- At least one supported cross pairing completes a fixture/mock Agent Loop over a real loopback HTTP bridge-shaped endpoint through a distinct or demonstrably configured Compatibility runtime adapter and returns a result.
- CPA binary/config discovery, readiness, process error/exit, and deterministic cleanup are observable and tested. `stop()` waits for and verifies child/listener release.
- Native pairings remain sidecar-free and retain existing runtime behavior.
- Resolver, recipe, CraftPlan, Supervisor, and UI agree on one route/capability decision and fail closed for every unverified dependency.
- Model identity is authoritative and multi-colon-safe; unknown identity never falls back to Harness vendor.
- The selected account is demonstrably the credential namespace used by the bridge, remains sticky through resume, and rejects identity mismatch.
- Session snapshots persist route/account/protocol/endpoint reference without secrets and lifecycle operations release Compatibility resources.
- At least OpenCode’s official runtime projection is verified end to end; all other statuses are honest and never presented as executable without evidence.
- Focused tests, relevant regression tests, typecheck, build, `oxlint --deny-warnings`, `oxfmt --check`, and `git diff --check` pass, with unrelated environment failures documented separately.

## Fix execution order

1. CPA contract, bridge lifecycle, readiness, and cleanup.
2. Distinct Compatibility adapter and bridge-shaped integration test; Native no-sidecar regression.
3. Authoritative model identity and unified capability/readiness contract.
4. Recipe/CraftPlan runtime binding and verified OpenCode projection.
5. Account/session lifecycle and persistence.
6. UI gating and diagnostics.
7. Static checks and final full evidence collection.

## Governance

- Requires Manager Re-plan: **No**
- Requires Ideate Revision: **No**
- Fix owner: `Coder-1.1-Compatibility Bridge` (`01a066ae-2dff-7b91-a227-9622b02a0dde`)
- This is the Coder's second and final fix round before the Debugger Takeover rule applies if the next re-review remains FAIL.

## Final status

**Verdict: FAIL**
