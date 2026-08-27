import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry, type CraftPlan } from "@/shared/crafting";
import type { AccountView } from "@/shared/contracts";
import { SupervisorRuntime } from "../supervisorRuntime";

const enabled = process.env.CRAFTSTATION_REAL_GROK_E2E === "1";
const evidencePath = join(
  process.cwd(),
  "ai_workspace",
  "validation",
  "v0.5.2-grok-product-path.json",
);

// These are the two managed profiles explicitly cleared for this fix cycle.
// Keep the known exhausted profiles out of all real traffic, even if their
// persisted order would otherwise make them the next candidate.
const REAL_ACCOUNT_A = "grok:852862f8-473d-4ef7-b1bf-605c0b52ed32";
const REAL_ACCOUNT_B = "grok:071e94ac-5fda-4611-a0c8-b529d4707c9b";
const KNOWN_EXHAUSTED_ACCOUNTS = new Set([
  "grok:9802c0ca-9dde-4f23-8650-81721890b433",
  "grok:0025b7ae-9947-4034-b52a-ce308eaff924",
]);

const runtimes: SupervisorRuntime[] = [];

function redactError(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: /explicitly requested account is unavailable|account.*unavailable/i.test(message)
      ? "ACCOUNT_UNAVAILABLE"
      : /402|usage balance exhausted|quota/i.test(message)
        ? "QUOTA_EXHAUSTED"
        : /auth|login|credential/i.test(message)
          ? "AUTH_REQUIRED"
          : "NATIVE_EXECUTION_FAILED",
  };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function accountProfileEvidence(account: AccountView, runtime: SupervisorRuntime) {
  const root = runtime.accountStore.credentialRoot(account.accountId);
  const sessionsRoot = join(root, "sessions");
  return {
    accountId: account.accountId,
    provider: account.provider,
    credentialScopeRef: account.credentialScopeRef,
    managedProfile: true,
    managedSessionDirectoryObserved:
      existsSync(sessionsRoot) && readdirSync(sessionsRoot, { withFileTypes: true }).length > 0,
  };
}

function grokPlan(threadId: string): CraftPlan {
  const registry = getDefaultRegistry();
  const model = registry.getItem("xai:grok-4.6");
  const harness = registry.getItem("harness:grok");
  if (!model || !harness) throw new Error("The native Grok recipe items are not registered.");
  const result = new Crafter(registry).compile(
    { slots: { model, harness } },
    { workspace: process.cwd(), threadId },
  );
  if (!result.success || !result.craftPlan) {
    throw new Error("The native Grok recipe could not be compiled.");
  }
  return result.craftPlan;
}

async function runRealSession(
  runtime: SupervisorRuntime,
  plan: CraftPlan,
  prompt: string,
  accountId?: string,
  accountMode?: "explicit" | "auto",
): Promise<{
  ok: boolean;
  responseLength: number;
  responseHashHint: string | null;
  accountBinding?: { accountId: string; reason: string; credentialScopeRef: string };
  sessionId?: string;
  error?: Record<string, unknown>;
}> {
  try {
    const result = await runtime.craftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: process.cwd() },
      prompt,
      ...(accountId ? { accountId } : {}),
      ...(accountMode ? { accountMode } : {}),
    });
    const response = result.response ?? "";
    return {
      ok: true,
      responseLength: response.length,
      responseHashHint: response ? shortHash(response) : null,
      sessionId: result.sessionId,
      ...(result.accountBinding
        ? {
            accountBinding: {
              accountId: result.accountBinding.accountId,
              reason: result.accountBinding.reason,
              credentialScopeRef: result.accountBinding.credentialScopeRef,
            },
          }
        : {}),
    };
  } catch (error) {
    return { ok: false, responseLength: 0, responseHashHint: null, error: redactError(error) };
  }
}

async function runRealResume(
  runtime: SupervisorRuntime,
  plan: CraftPlan,
  prompt: string,
  sessionRef: string,
  accountId: string,
): Promise<Awaited<ReturnType<typeof runRealSession>>> {
  try {
    const result = await runtime.resumeCraftAgent({
      craftPlan: plan,
      projectLocation: { kind: "windows", path: process.cwd() },
      sessionRef,
      accountId,
      prompt,
    });
    const response = result.response ?? "";
    return {
      ok: true,
      responseLength: response.length,
      responseHashHint: response ? shortHash(response) : null,
      sessionId: result.sessionId,
      ...(result.accountBinding
        ? {
            accountBinding: {
              accountId: result.accountBinding.accountId,
              reason: result.accountBinding.reason,
              credentialScopeRef: result.accountBinding.credentialScopeRef,
            },
          }
        : {}),
    };
  } catch (error) {
    return { ok: false, responseLength: 0, responseHashHint: null, error: redactError(error) };
  }
}

describe.skipIf(!enabled)("CraftStation real Grok account-pool product path", () => {
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.disposeAsync()));
  });

  it("probes two managed accounts through craftAgent without using host ~/.grok", async () => {
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.5.0 — Account Pool + Quota + Token Usage Stabilization",
      executionPath:
        "SupervisorRuntime.craftAgent -> AccountResolver -> native Grok adapter -> official grok agent stdio (ACP)",
      hostHomeUsed: false,
      verdict: "BLOCKED",
      scenarios: [],
    };
    let runtime: SupervisorRuntime | undefined;
    let originalOrder: string[] | undefined;
    let originalPool: ReturnType<SupervisorRuntime["getAccountPoolScheduling"]> | undefined;
    try {
      runtime = new SupervisorRuntime(() => undefined);
      runtimes.push(runtime);
      const allAccounts = runtime.accountStore.list("grok");
      originalOrder = [...allAccounts]
        .sort((left, right) => left.order - right.order)
        .map((account) => account.accountId);
      originalPool = runtime.getAccountPoolScheduling({ provider: "grok" });
      const accountA = allAccounts.find((account) => account.accountId === REAL_ACCOUNT_A);
      const accountB = allAccounts.find((account) => account.accountId === REAL_ACCOUNT_B);
      if (!accountA || !accountB) {
        evidence.blockedReason =
          "The two fix-cycle managed Grok profiles are not present in the live store.";
        return;
      }
      if (
        KNOWN_EXHAUSTED_ACCOUNTS.has(accountA.accountId) ||
        KNOWN_EXHAUSTED_ACCOUNTS.has(accountB.accountId)
      ) {
        evidence.blockedReason = "The selected real probe pair overlaps a known exhausted account.";
        return;
      }
      const usable = (account: AccountView) =>
        account.enabled && ["available", "quota-low"].includes(account.status);
      if (!usable(accountA) || !usable(accountB)) {
        evidence.blockedReason =
          "One of the explicitly selected managed Grok profiles is not currently usable.";
        evidence.accounts = [
          accountProfileEvidence(accountA, runtime),
          accountProfileEvidence(accountB, runtime),
        ];
        return;
      }
      evidence.accounts = [
        accountProfileEvidence(accountA, runtime),
        accountProfileEvidence(accountB, runtime),
      ];

      const priority = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-priority-${Date.now()}`),
        "Reply with exactly CRAFTSTATION_V051_PRIORITY_OK.",
      );
      (evidence.scenarios as unknown[]).push({
        name: "priority-auto",
        ok: priority.ok,
        accountBinding: priority.accountBinding,
        responseLength: priority.responseLength,
        responseHash: priority.responseHashHint,
        error: priority.error,
      });
      if (
        !priority.ok ||
        priority.responseLength === 0 ||
        priority.accountBinding?.accountId !== accountA.accountId
      ) {
        evidence.blockedReason =
          "Priority auto session did not produce a real assistant response on the first usable managed account.";
        return;
      }

      const explicitB = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-explicit-${Date.now()}`),
        "Reply with exactly CRAFTSTATION_V051_EXPLICIT_OK.",
        accountB.accountId,
        "explicit",
      );
      (evidence.scenarios as unknown[]).push({
        name: "explicit-b",
        ok: explicitB.ok,
        accountBinding: explicitB.accountBinding,
        responseLength: explicitB.responseLength,
        responseHash: explicitB.responseHashHint,
        error: explicitB.error,
      });
      if (
        !explicitB.ok ||
        explicitB.responseLength === 0 ||
        explicitB.accountBinding?.accountId !== accountB.accountId
      ) {
        evidence.blockedReason =
          "Explicit managed account B did not produce a real assistant response through the product path.";
        return;
      }

      const explicitUnavailable = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-explicit-unavailable-${Date.now()}`),
        "This prompt must not reach an unavailable account.",
        "grok:9802c0ca-9dde-4f23-8650-81721890b433",
        "explicit",
      );
      (evidence.scenarios as unknown[]).push({
        name: "explicit-known-exhausted-no-fallback",
        ok: !explicitUnavailable.ok,
        responseLength: explicitUnavailable.responseLength,
        responseHash: explicitUnavailable.responseHashHint,
        error: explicitUnavailable.error,
      });
      if (explicitUnavailable.ok) {
        evidence.blockedReason =
          "An explicitly exhausted managed account unexpectedly accepted a product session.";
        return;
      }

      // Put a known exhausted profile ahead of A for one real Auto launch.
      // The resolver must skip it and still enter the official runtime with A.
      const exhaustedAccount = allAccounts.find((account) =>
        KNOWN_EXHAUSTED_ACCOUNTS.has(account.accountId),
      );
      if (!exhaustedAccount) {
        evidence.blockedReason =
          "The known exhausted managed profile is missing from the live store.";
        return;
      }
      runtime.accountStore.reorder("grok", [
        exhaustedAccount.accountId,
        ...originalOrder.filter((accountId) => accountId !== exhaustedAccount.accountId),
      ]);
      const autoFallback = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-auto-skip-exhausted-${Date.now()}`),
        "Reply with exactly CRAFTSTATION_V052_AUTO_SKIP_OK.",
        undefined,
        "auto",
      );
      runtime.accountStore.reorder("grok", originalOrder);
      (evidence.scenarios as unknown[]).push({
        name: "auto-skips-known-exhausted",
        ok: autoFallback.ok,
        accountBinding: autoFallback.accountBinding,
        responseLength: autoFallback.responseLength,
        responseHash: autoFallback.responseHashHint,
        error: autoFallback.error,
      });
      if (
        !autoFallback.ok ||
        autoFallback.responseLength === 0 ||
        autoFallback.accountBinding?.accountId !== accountA.accountId
      ) {
        evidence.blockedReason =
          "Auto did not skip the known exhausted profile and produce a real response on managed account A.";
        return;
      }

      const stickyPlan = grokPlan(`craft-real-grok-sticky-${Date.now()}`);
      const stickyStart = await runRealSession(
        runtime,
        stickyPlan,
        "Reply with exactly CRAFTSTATION_V052_STICKY_START_OK.",
        accountA.accountId,
        "explicit",
      );
      (evidence.scenarios as unknown[]).push({
        name: "sticky-a-start",
        ok: stickyStart.ok,
        accountBinding: stickyStart.accountBinding,
        responseLength: stickyStart.responseLength,
        responseHash: stickyStart.responseHashHint,
        error: stickyStart.error,
      });
      if (
        !stickyStart.ok ||
        stickyStart.responseLength === 0 ||
        stickyStart.accountBinding?.accountId !== accountA.accountId
      ) {
        evidence.blockedReason =
          "Managed account A did not produce a real assistant response for the sticky start.";
        return;
      }

      // Renderer resume carries the immutable account binding. Change pool
      // order before resuming and verify the same account remains attached.
      const providerSessionId = stickyStart.sessionId?.startsWith("sess:grok:")
        ? stickyStart.sessionId.slice("sess:grok:".length)
        : undefined;
      if (!providerSessionId) {
        evidence.blockedReason =
          "The product result did not expose a resumable native Grok session reference.";
        return;
      }
      runtime.accountStore.reorder("grok", [
        accountB.accountId,
        ...originalOrder.filter((accountId) => accountId !== accountB.accountId),
      ]);
      const stickyResume = await runRealResume(
        runtime,
        stickyPlan,
        "Reply with exactly CRAFTSTATION_V052_STICKY_RESUME_OK.",
        providerSessionId,
        accountA.accountId,
      );
      runtime.accountStore.reorder("grok", originalOrder);
      (evidence.scenarios as unknown[]).push({
        name: "sticky-a-after-pool-change",
        ok: stickyResume.ok,
        accountBinding: stickyResume.accountBinding,
        responseLength: stickyResume.responseLength,
        responseHash: stickyResume.responseHashHint,
        error: stickyResume.error,
      });
      if (
        !stickyResume.ok ||
        stickyResume.responseLength === 0 ||
        stickyResume.accountBinding?.accountId !== accountA.accountId
      ) {
        evidence.blockedReason =
          "A resumed Session did not remain bound to managed account A after the pool order changed.";
        return;
      }

      // With both profiles already proven non-empty, spend the optional
      // Round-Robin validation budget on two new product sessions.
      runtime.setAccountPoolScheduling({ provider: "grok", scheduling: "round-robin" });
      const roundRobinA = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-round-robin-a-${Date.now()}`),
        "Reply with exactly CRAFTSTATION_V052_RR_A_OK.",
        undefined,
        "auto",
      );
      const roundRobinB = await runRealSession(
        runtime,
        grokPlan(`craft-real-grok-round-robin-b-${Date.now()}`),
        "Reply with exactly CRAFTSTATION_V052_RR_B_OK.",
        undefined,
        "auto",
      );
      runtime.setAccountPoolScheduling({ provider: "grok", scheduling: "priority" });
      for (const [name, roundRobin] of [
        ["round-robin-a", roundRobinA],
        ["round-robin-b", roundRobinB],
      ] as const) {
        (evidence.scenarios as unknown[]).push({
          name,
          ok: roundRobin.ok,
          accountBinding: roundRobin.accountBinding,
          responseLength: roundRobin.responseLength,
          responseHash: roundRobin.responseHashHint,
          error: roundRobin.error,
        });
      }
      if (
        !roundRobinA.ok ||
        roundRobinA.responseLength === 0 ||
        !roundRobinB.ok ||
        roundRobinB.responseLength === 0 ||
        roundRobinA.accountBinding?.accountId !== accountA.accountId ||
        roundRobinB.accountBinding?.accountId !== accountB.accountId
      ) {
        evidence.blockedReason =
          "Round-Robin did not produce non-empty responses on two distinct managed accounts.";
        return;
      }

      evidence.verdict = "REAL_PRODUCT_PATH_VALIDATED";
      evidence.completedScenarios = [
        "priority-auto",
        "explicit-b",
        "explicit-known-exhausted-no-fallback",
        "auto-skips-known-exhausted",
        "sticky-a-after-pool-change",
        "round-robin-a",
        "round-robin-b",
      ];
      evidence.note =
        "Two managed accounts completed independent product sessions through the official native runtime. This evidence does not close the Feature gate or assert a five-Harness PASS.";
    } catch (error) {
      evidence.blockedReason = redactError(error);
    } finally {
      if (runtime && originalOrder) {
        // The probe may temporarily reorder rows or change the pool mode to
        // exercise fallback/RR. Restore the user's live control-plane state
        // even when a native process fails halfway through the evidence run.
        runtime.accountStore.reorder("grok", originalOrder);
        if (originalPool) {
          runtime.setAccountPoolScheduling({
            provider: "grok",
            scheduling: originalPool.scheduling,
          });
          if (originalPool.roundRobinCursor) {
            runtime.accountStore.advanceRoundRobinCursor("grok", originalPool.roundRobinCursor);
          } else {
            runtime.accountStore.resetRoundRobinCursor("grok");
          }
        }
      }
      mkdirSync(join(process.cwd(), "ai_workspace", "validation"), { recursive: true });
      writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
    }
    expect(evidence.synthetic).toBe(false);
  }, 300_000);
});
