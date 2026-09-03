# v1.1.0 Compatibility Bridge & Model × Harness Composition — Debugger Report

## Scope and verdict

Feature worktree: `D:\Work\CraftStation\.worktrees\v1.1.0-compatibility-bridge`  
Branch: `dev/v1.1.0-compatibility-bridge`  
Baseline: `f5a4bb276b22e664e7691e67b486e2b1252e5d9a`

Verdict: **FAIL / BLOCKED**

The Debugger Takeover hardened fail-closed behavior and prevented Compatibility configuration from being silently consumed by native adapters. This is a safety improvement, not Feature completion. The required real CPA and official Target Harness execution chain remains unproven.

## Evidence summary

| Area                                       | Result                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| Focused Compatibility/crafting/Codex tests | 5 files, 158 passed                                          |
| Typecheck                                  | Passed, 0 errors                                             |
| Affected lint                              | Passed with `--deny-warnings`                                |
| Affected format                            | Passed                                                       |
| Diff check                                 | Passed                                                       |
| Production build                           | Passed with existing warnings                                |
| Full Vitest                                | 918 files passed, 16 skipped; 2 existing ACP stress failures |
| Real CPA binary/config/readiness           | Not demonstrated                                             |
| Independent Compatibility adapter          | Missing; guarded as unavailable                              |
| Official target Harness consumption        | Not demonstrated                                             |
| Real Compatibility Agent Loop              | Not demonstrated                                             |
| Account namespace/session stickiness       | Not demonstrated                                             |

## Takeover result

The implementation now:

- rejects unknown compatibility readiness instead of defaulting to ready;
- requires explicit OpenCode route readiness;
- rejects unknown model identity instead of using the Harness vendor as a substitute;
- reports missing CPA binary and invalid health responses as unavailable;
- waits for Bridge child exit and avoids fake exporter credentials;
- refuses to instantiate a native adapter for a Compatibility plan;
- disables Workbench Craft/Save for unverified Compatibility state.

The code does not claim that any of these changes establish CPA or target Harness functionality.

## Open blockers

1. CPA packaging/discovery and the actual binary/config contract are not proven on this machine.
2. No separate Compatibility Runtime Adapter performs a bridge-shaped request/response exchange.
3. Exporters are static DTOs without verified official runtime consumption; OpenCode is not proven end to end.
4. Compatibility Recipe/CraftPlan does not yet carry runtime-produced endpoint, exporter verification, capability proof, and concrete session-scoped account binding.
5. Account pinning is in-memory and not mapped/proven against CPA credential namespaces; resume and cleanup isolation are unverified.
6. No real Model → Harness Agent Loop response exists for any cross pairing.

## Acceptance boundary

This Feature must remain `FAIL / BLOCKED` until at least one supported cross pairing completes a real or explicitly fixture-scoped bridge-shaped HTTP Agent Loop through an independent Compatibility adapter, with route/protocol/account diagnostics and secret-free session persistence. Native pairings must continue to bypass CPA, and unsupported/unavailable target Harnesses must remain visibly unavailable.

No user acceptance package, merge, tag, or push is authorized from this report.
