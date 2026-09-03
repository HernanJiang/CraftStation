# Debugger — v1.2.0.1 Unified MCP + Skills Capability Foundation

## Review Scope

- Feature worktree: `D:\Work\CraftStation\.worktrees\v1.2.0-mcp-skills-capability`
- Branch: `dev/v1.2.0-mcp-skills-capability`
- Fixed point: `main@f5a4bb2` plus the current Coder working-tree changes
- Surfaces: MCP contracts/import UI, Skills import/runtime, capability resolver/profiles, Crafting launch IPC, Supervisor runtime, version/changelog, and related tests
- Method: independent source inspection, focused tests, TypeScript, oxlint, tsdown, full Vitest, and attempted interactive smoke

## Evidence

### Passing engineering checks

- `git diff --check`: passed.
- Focused Feature suite: 4 test files, 123 tests passed.
- `tsc --noEmit -p tsconfig.json`: passed.
- Targeted oxlint with warnings denied: passed.
- `tsdown`: passed for main/Supervisor/preload/worker build targets.
- Resolver unit tests cover basic Auto filtering, Efficient profile filtering, explicit IDs, and disabled entries.

### Full-suite and runtime evidence

- Full Vitest: 913 test files passed, 5 failed, 16 skipped; 19 tests failed and 2 unhandled errors were reported.
- Residual failures include Codex structured-session tests, RemoteAccessServer tests, and Cursor native SDK integration/client tests. The changed `website/public/changelog.json` also fails the existing unique-version integrity test because it contains two `1.2.0` releases.
- Interactive smoke (`run-craftstation-smoke.mjs --scope changed --mode mock`) could not reach CDP. The environment has a native ABI mismatch: `better_sqlite3.node` was built for `NODE_MODULE_VERSION 137`, while the active Node runtime requires 148. This is runtime-unavailable evidence, not a UI behavior PASS or FAIL.

## Findings

### F1 — Blocking: Craft launch does not pass Auto candidates to the Resolver

Evidence:

- `src/renderer/actions/threadLaunchActions.ts` function `selectedCraftingMcpServers()` returns an empty array whenever `mcpServerIds` is absent or empty.
- `startThreadFromCraft()` and `resumeCraftedThread()` include `mcpServers` in the Crafting IPC payload only when explicit MCP IDs are present.
- `SupervisorRuntime.resolveCraftingMcpServers()` defaults an absent explicit ID list to `capabilityMode: "auto"`, but receives `candidates === undefined` on the ordinary no-ID Crafting path. The resolver therefore has no candidates and returns no MCP servers.
- Supervisor tests pass `mcpServers` directly and therefore do not cover the broken renderer handoff.

Impact: The central v1.2 acceptance scenario — an empty CraftPlan MCP selection causing Auto to inject enabled, compatible, available MCP servers — does not hold for the normal Crafting Workbench launch path.

Required fix:

- At the renderer launch boundary, pass the complete resolved custom-MCP candidate snapshot for Auto/Efficient launches, including when the CraftPlan has no explicit IDs. Preserve Creative/legacy explicit-ID validation and account behavior.
- Add an action/IPC regression test for a no-ID Auto launch and recheck resume/recovery.

### F2 — Blocking: Codex dollar Skill invocation lost its `$` prefix

Evidence: `src/supervisor/supervisorRuntime.ts` maps `scan.invocation === "dollar"` to `` `${name}` ``. Existing Skills semantics and `SkillsService.test.ts` use `$skill-name`.

Impact: Codex native skill segments are emitted as a bare name instead of `$skill-name`, which can prevent Codex from recognizing/loading the Skill.

Required fix: Restore `` `$${name}` `` and add a Supervisor runtime-level regression assertion.

### F3 — Blocking: Resolver ignores WSL/project-location availability

Evidence:

- `CapabilityResolutionInput` accepts `projectLocation` and `environment`, but `resolveCapabilities()` does not consume either for MCP resolution.
- The repository already provides `supportsMcpAtProjectLocation(runtimeSupport, projectLocation)`.
- Antigravity declares `supportsMcpInWsl: false`, yet the resolver can retain an otherwise compatible MCP for a WSL project.

Impact: The resolver can claim a capability is resolved when the selected runtime cannot receive MCP at the current project location.

Required fix: Apply `supportsMcpAtProjectLocation()` during MCP resolution, emit a non-secret skipped diagnostic, define/use `environment` consistently, and add a focused WSL test.

### F4 — Blocking: MCP origin schema cannot represent the specified `imported` origin

Evidence:

- `mcpServerOriginSchema` enumerates only `managed`, `external`, `built-in`, and `plugin`.
- The Manager Feature Spec and T02/T07 acceptance require `managed | built-in | plugin | imported | external`.
- `McpExternalImportModal` writes imported servers with `origin: "managed"`, so imported state cannot be represented canonically.

Required fix: Add `imported` and use it consistently for imported MCP metadata, or obtain a Manager re-plan before intentionally accepting `managed` as the import semantic. Preserve old entries with missing origin.

### F5 — Blocking: Managed Skill import still exposes and executes external links

Evidence:

- `SkillImportModal` still offers `Link to source` for global-to-global imports.
- `SkillsService.prepareImport()` and `stageImport()` still accept and create directory links.
- The Manager plan requires the new Managed import path to be a CraftStation-owned copy/projection and says link must be closed or reduced to legacy compatibility.

Required fix: Keep any legacy link API only if required for existing data/tests, but remove it from the v1.2 Managed import flow and force new imports to copy/project. Add UI/ownership tests. Request Manager re-plan if link remains an intentional normal product option.

### F6 — Blocking: Changelog contains duplicate `1.2.0` versions

Evidence: `website/public/changelog.json` contains two releases with `version: "1.2.0"`; `src/shared/changelog.test.ts` requires unique versions and fails.

Required fix: Keep exactly one v1.2.0 entry and retain the historical release sequence; rerun changelog integrity.

### F7 — Major: Capability mode UI is not connected to Crafting launch policy

Evidence:

- `CraftModeSwitch` is rendered from `ThreadDraftView` and updates local `craftMode`.
- `handleCraftModeChange()` opens the Crafting Table for non-Auto selections, but the ordinary composer config and `startThreadFromCraft()` payload do not carry this state as `runtimeOverrides.capabilityMode`.
- The UI labels also describe Model × Harness Crafting Workbench concepts, while the Manager plan explicitly distinguishes that UX from v1.2 capability policy.

Impact: No auditable user path proves that a selected capability mode reaches the Resolver.

Required fix: Wire the mode through the intended Crafting Plan/runtime override seam with explicit semantics, or remove/reposition the control so it does not imply a policy the launch ignores. Add a renderer-to-IPC test and keep Workbench semantics separate.

### F8 — Review hygiene: binary diff in MCP import modal

Evidence: `McpExternalImportModal.tsx` is reported as a binary diff because it contains a NUL character in the candidate-key separator.

Required fix: Replace it with a readable, collision-safe encoding such as JSON encoding of `[providerId, candidateId]` and update the selection test.

## Fix Plan

1. Fix the renderer candidate snapshot handoff for Auto/Efficient, including resume/recovery, then add the no-ID IPC regression test.
2. Restore Codex `$skill` invocation and add the Supervisor runtime regression test.
3. Make Resolver project/WSL availability-aware and add the WSL diagnostic test.
4. Decide and implement canonical `imported` MCP origin with metadata/UI/schema tests; request Manager re-plan if choosing `managed` instead.
5. Remove link from the new Managed Skill import path while preserving only explicitly justified legacy compatibility.
6. Repair changelog uniqueness and rerun the changelog test.
7. Connect or reposition the mode UI and add a launch-payload assertion.
8. Remove the NUL separator, rerun focused tests, typecheck, lint, build, and available smoke; report the native ABI blocker separately if it remains.

## Fix Acceptance Criteria

- No-ID Crafting Auto and Efficient launches pass a complete candidate MCP snapshot through IPC and Supervisor resolution.
- Resolver excludes disabled, runtime-incompatible, secret-ineligible, and WSL-unavailable MCPs with safe diagnostics.
- Codex receives `$skill-name` for dollar-invocation Skills.
- Imported MCP origin is representable and consistently shown/persisted; old missing-origin entries remain compatible.
- New Managed Skill imports are copied/projected into CraftStation storage and do not expose external links.
- Exactly one `1.2.0` changelog release exists.
- Selected capability mode is observable in the Crafting launch payload and changes Resolver behavior without conflating Workbench semantics.
- Focused tests, typecheck, lint, and build pass; full-suite residual failures are classified with exact evidence.
- No secrets appear in diagnostics/logs; no changes are made to `main`, other worktrees, tags, or remotes.

## Fix Execution Order

1. F1 candidate handoff.
2. F2 invocation regression.
3. F3 WSL/environment availability.
4. F4 origin contract and F5 Managed ownership.
5. F6 changelog integrity.
6. F7 mode-policy seam.
7. F8 review hygiene.
8. Re-run independent review from `f5a4bb2` and reassess runtime availability/product acceptance.

## Requires Manager Re-plan

No for the proposed fixes. A re-plan is required before accepting either treating imported MCP as `managed` rather than representing `imported`, or continuing to expose link as a normal v1.2 Managed Skill import option.

## Requires Ideate Revision

No, unless the product decision about imported-origin semantics or legacy link behavior cannot be resolved from the existing Manager plan.

## Verdict

**FAIL — v1.2.0 is not a releasable candidate.**

The green focused engineering checks show that parts of the foundation compile and unit-test, but the normal Auto launch handoff is broken and multiple acceptance contracts remain violated. Do not mark DEV PASS, merge `main`, tag, or push until a Coder Fix Cycle addresses the findings and an independent re-review closes them.
