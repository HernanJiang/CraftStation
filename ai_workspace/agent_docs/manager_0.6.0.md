# CraftStation Manager Plan — v0.6.0

## Feature

**v0.6.0 — Native Provider Authentication & Ark Token Plan Surface**

Lifecycle: `PLAN READY / EXECUTION BLOCKED BY v0.5.7`

Allowed development worktree (when execution is explicitly authorized): `D:\Work\CraftStation\craftstation-dev`, branch `dev`.

This document is a planning artifact only. It does not authorize source changes, commits, pushes, tags, or `dev -> main` promotion. The active v0.5.7 Fix Cycle remains the only executable feature until the user accepts it and explicitly authorizes switching features.

## Part I — Ideate Brief

### Why this is a new Feature

The delegated request changes provider authentication behaviour, the usage catalog, and introduces a new provider credential/usage model. It is materially wider than the v0.5.7 F33 Grok billing fix and must not be appended to that Fix Plan. v0.5.7 and the older v0.4 F04 remain `FAIL / BLOCKED`.

### User outcome

1. Antigravity login uses the operating system's default browser for Google OAuth, returns through a loopback callback, exchanges the code in the main process, stores credentials safely, and can refresh quota. CraftStation's embedded terminal and embedded web login are not used for this flow.
2. The standalone Gemini usage provider, collector, login entry, and quota card disappear from the usage surface. Gemini CLI agent/runtime, models, MCP/Skills and session behaviour remain available. Antigravity's internal Gemini quota group remains visible and functional.
3. Volcengine Ark is represented by a native Token Plan supporting API Key and AK/SK V4 credentials, Coding Plan and Agent Plan, five-hour/daily/weekly/monthly windows, stable error mapping, and tests grounded in official Ark documentation or SDK behaviour.

### Non-goals and hard boundaries

- No CLIProxyAPI in the Ark or Antigravity path.
- No rewrite of Gemini CLI agent/runtime or Antigravity native agent runtime.
- No change to CraftStation's Item/Recipe/Crafter ontology; Account, Quota and Usage remain provider/control-plane concerns.
- No fabricated Ark endpoint, response field, quota number, or real E2E PASS when official access is unavailable.
- No changes to v0.5.7 F33, no release tag, and no `dev -> main` promotion as part of this plan.

## Part II — Manager Plan

### Plan Gate Check

| Check                    | Result                   | Evidence / action                                                                                                                                                     |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feasibility              | OK                       | Existing Antigravity adapter/collector and main-process usage IPC exist; `McpOAuthService` demonstrates loopback/state handling; secure usage storage already exists. |
| Practicality             | OK with staged execution | OAuth, catalog removal and Ark are separated into narrow tickets; Ark official API/SDK facts are a T01 gate before implementation.                                    |
| Alignment                | OK                       | Provider/auth and usage remain outside CraftStation core composition; native harness/runtime-first rule is preserved.                                                 |
| Information completeness | Ready for Plan           | Open Ark endpoint/field questions are explicitly reserved for T01; no product-intent question is left to Coder.                                                       |

### Current repository gap matrix

| Area              | Current fact                                                                                                           | v0.6 target                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Antigravity auth  | Local language-server/process usage path; descriptor is effectively local and does not provide Google OAuth lifecycle. | Main-process OAuth broker with system browser, loopback callback, code exchange, safe storage and refresh.          |
| Antigravity quota | Internal Gemini and Claude & GPT groups already parse as Antigravity windows.                                          | Preserve both groups and connect refresh to the new credential projection.                                          |
| Gemini usage      | Independent descriptor/collector and renderer usage-provider path exists.                                              | Remove independent usage catalog/login/quota surface while preserving Gemini CLI runtime identity and capabilities. |
| Ark               | No validated native Token Plan surface.                                                                                | Officially verified API Key and AK/SK V4 modes, plan selection, normalized windows and errors.                      |
| Security          | Main-process safe storage primitives exist; renderer must not receive secrets.                                         | Explicit secret projection, redaction and per-account refresh locking tested at the seam.                           |

### Deep-module seams

1. **Antigravity OAuth Broker** — small interface for `startLogin`, `cancelLogin`, `getAuthState` and `refresh`; hides browser launch, state/PKCE/nonce, loopback listener, exchange, rotation, safe storage and error mapping. Renderer receives status only.
2. **Usage Provider Catalog** — one descriptor/collector/UI catalog seam. Removing Gemini here must not remove Gemini agent registry/runtime or Antigravity's nested Gemini group.
3. **Ark Token Plan Collector** — `inspectCapabilities` and `collect(credentials, clock)` at the external seam; hides credential resolution, official endpoint/signing, plan selection, window parsing, normalization and provider error mapping.

### Functional specification

#### Antigravity

- Login launches the OS default browser and binds a loopback callback only for the active flow.
- Authorization state is unpredictable and validated; PKCE/nonce are used when required by the official Google flow.
- Main process performs code exchange and refresh; access/refresh credentials are stored only in OS-backed safe storage or a main-process-managed profile.
- Renderer IPC exposes redacted state, account identity and quota status, never tokens, cookies, authorization codes or raw provider bodies.
- Concurrent refresh for the same account/provider is serialized; cancellation, timeout, callback mismatch and provider errors have stable codes.
- Quota refresh preserves Antigravity's `Gemini` and `Claude & GPT` internal groups.

#### Gemini removal

- Remove the standalone Gemini usage descriptor, collector registration, login entry and quota card/provider projection.
- Keep Gemini CLI agent/runtime registration, model capabilities, MCP/Skills, session and analytics identity.
- Keep Antigravity's nested Gemini quota group and its parser/tests.

#### Volcengine Ark

- Support API Key and AK/SK V4 credential modes using secure storage and provider-specific validation.
- Support Coding Plan and Agent Plan only after official documentation/SDK confirms their identity, endpoints and fields.
- Normalize five-hour, daily, weekly and monthly windows with reset timestamps and provider status.
- Map authentication, invalid/signature, rate-limit, quota-exhausted, network and unavailable responses to stable usage errors.
- Never expose raw Ark response or secret material to renderer/logs.

### Execution order and gates

The tickets are ordered for one Coder in `craftstation-dev`:

`T01 -> (T02, T05, T06) -> T03 -> T04 -> T07 -> T08 -> T09 -> T10`

T02, T05 and T06 may be developed only after T01's audit, but remain sequential in the single-Coder default flow. T03 depends on the contract in T02; T04 depends on the OAuth broker; T07 depends on Ark credentials; T08 depends on the collector; T09 integrates all surfaces; T10 is the independent acceptance gate.

### Acceptance gates

**Antigravity gate**

- System browser visibly opens for Google OAuth; no embedded terminal/browser login.
- Correct loopback state/callback, main-process exchange and refresh are demonstrated.
- Safe-storage and redaction tests prove no secret crosses renderer/IPC/logs.
- Quota refresh shows Antigravity Gemini and Claude & GPT groups with correct reset/error states.

**Gemini gate**

- No standalone Gemini usage descriptor/collector/login/quota card remains in the usage catalog.
- Gemini CLI agent/runtime, model identity, MCP/Skills and session smoke remain green.
- Antigravity Gemini nested quota parsing remains green.

**Ark gate**

- Official source evidence is recorded for endpoint, credential modes, V4 signing and Coding/Agent Plan fields.
- API Key and AK/SK fixture tests pass; real API smoke is required when credentials and service access are available.
- Five windows preserve reset times; errors map deterministically; raw payloads/secrets stay private.

**Global gate**

- No CLIProxyAPI dependency or fallback is introduced.
- Existing v0.5.7 and v0.4 status remains FAIL/BLOCKED until their own acceptance.
- Debugger independently verifies the entire Feature in `craftstation-dev`, then records `DEV PASS / USER ACCEPTANCE PENDING`; only explicit user acceptance permits Manager promotion.

### Risks and mitigations

- Google OAuth policy or redirect restrictions: T01/T02 must verify the official client flow before implementation; fail closed with actionable status.
- Ark plan APIs may differ by account/region: do not infer fields; keep provider facts in the audit artifact and gate unsupported combinations as unavailable.
- Removing Gemini usage may accidentally remove runtime support: add compile-time registry assertions and runtime smoke in T05/T09.
- Dirty shared worktree: preserve all pre-existing edits; Coder must not reset/clean or commit account/token data.

### Handoff state

- Manager plan: ready.
- Coder start: **not authorized yet**; execution is blocked by active v0.5.7 and requires explicit user authorization after v0.5.7 acceptance/closeout.
- Debugger target: independent Feature acceptance after T10.
- Promotion/tag: not authorized.
