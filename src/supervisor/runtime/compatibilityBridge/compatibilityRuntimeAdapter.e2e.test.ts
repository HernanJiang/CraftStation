import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CompatibilityBridgeService } from "./bridge";
import { CompatibilityRuntimeAdapter } from "./compatibilityRuntimeAdapter";
import type { CraftPlan } from "@/shared/crafting/types";

// Real-traffic tracer E2E (re-plan manager_1.1.0-replan.md §3):
// CraftPlan → CompatibilityRuntimeAdapter → real CLIProxyAPI sidecar
// (.tools/cpa, uncommitted release binary) → fixture credential namespace →
// official OpenCode CLI → real upstream model response.
//
// Runs only when the sidecar binary and the fixture credential namespace exist
// locally; everywhere else the test reports skipped instead of failing.
const repoRoot = resolve(__dirname, "../../../..");
const binaryPath = join(
  repoRoot,
  ".tools",
  "cpa",
  process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api",
);
const fixtureAuthDir = join(repoRoot, ".tools", "cpa", "fixture", "auths");
const e2eReady =
  existsSync(binaryPath) &&
  existsSync(fixtureAuthDir) &&
  (process.env.CLIPROXY_E2E === "1" || process.env.CLIPROXY_E2E === undefined);

describe.skipIf(!e2eReady)("CompatibilityRuntimeAdapter real tracer E2E", () => {
  it("completes a real OpenCode Agent Loop through the bridge", { timeout: 300_000 }, async () => {
    const bridge = new CompatibilityBridgeService({
      binaryPath,
      authDir: fixtureAuthDir,
      apiKey: "cs-e2e-key-1",
      // Fixture upstream credentials reach the provider through the local
      // system proxy; without it the upstream dial times out.
      proxyUrl: process.env.CLIPROXY_PROXY_URL ?? "http://127.0.0.1:7897",
      port: 18417,
      probeTimeoutMs: 20_000,
    });
    const adapter = new CompatibilityRuntimeAdapter("opencode", {
      bridge,
      accountPin: {
        accountId: "fixture:xai",
        credentialNamespace: "cli-proxy-api-auth",
        authDir: fixtureAuthDir,
      },
    });

    const plan = {
      id: "recipe:compat-tracer-e2e",
      threadId: `compat-e2e-${Date.now()}`,
      resultItemId: "result:compat-e2e",
      createdAt: new Date().toISOString(),
      runtimeBinding: {
        harnessKind: "opencode",
        vendor: "xai",
        modelId: "grok-3-mini",
        routeType: "compatibility",
      },
    } as unknown as CraftPlan;

    try {
      const entity = await adapter.spawnEntity(plan);
      expect(entity.metadata).toMatchObject({ routeType: "compatibility" });

      const session = await adapter.createSession(entity);
      const turn = await session.startTurn({
        prompt: "Reply with exactly: CRAFTSTATION_E2E_OK",
      });

      expect(turn.status).toBe("completed");
      expect(turn.response ?? "").toContain("CRAFTSTATION_E2E_OK");
      expect(session.nativeSessionRef?.startsWith("ses_")).toBe(true);
      expect(session.getSnapshot().compatibilityBridgeEndpoint).toBe("http://127.0.0.1:18417");
    } finally {
      await adapter.dispose?.();
    }
  });
});
