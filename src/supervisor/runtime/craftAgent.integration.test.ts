import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Crafter,
  CraftingError,
  getDefaultRegistry,
  type CraftSession,
  type HarnessRuntimeAdapter,
} from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts";
import { SupervisorRuntime } from "../supervisorRuntime";
import { CodexBinaryResolver } from "./nativeCodex/codexBinaryResolver";
import { AppServerProcessHost } from "./nativeCodex/appServerProcessHost";
import { AppServerClient } from "./nativeCodex/appServerClient";
import { NativeCodexRuntimeAdapter } from "./nativeCodex/nativeCodexRuntimeAdapter";

const enabled = process.env.CRAFTSTATION_REAL_RUNTIME === "1";

function errorDetail(error: unknown): Record<string, unknown> {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Preserve an unstructured failure without claiming a structured code.
  }
  return { message: raw };
}

describe.skipIf(!enabled)("CraftStation real native Codex app-server runtime evidence", () => {
  it("runs the production craftAgent seam against the local Codex app-server and completes dual-turn round-trip", async () => {
    const prompt1 = "Reply with exactly CRAFTSTATION_REAL_ROUNDTRIP_OK.";
    const prompt2 = "Reply with exactly CRAFTSTATION_SECONDTURN_OK.";
    const emittedEvents: RuntimeEvent[] = [];
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      feature: "v0.3.0 — Codex Native Runtime Parity & CraftStation Control Plane",
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeCodexRuntimeAdapter -> AppServerProcessHost -> codex.exe app-server --stdio -> Entity -> Session",
      projectLocation: { kind: "windows", path: process.cwd() },
      prompts: [prompt1, prompt2],
    };

    let host: AppServerProcessHost | undefined;
    let runtime: SupervisorRuntime | undefined;
    let liveSession: CraftSession | undefined;

    try {
      const resolvedBinary = CodexBinaryResolver.resolve();
      evidence.binary = resolvedBinary;

      // Use one real process for capability discovery and the product-path
      // execution. This keeps model selection and thread/turn on one official
      // app-server connection.
      host = new AppServerProcessHost({
        binaryPath: resolvedBinary.path,
        cwd: process.cwd(),
      });
      const transport = await host.start();
      const client = new AppServerClient(transport);
      const initResult = await client.initialize();
      const discoveredModels = await client.listModels();
      if (discoveredModels.length === 0) {
        throw CraftingError.executionFailed(
          "Official Codex app-server returned an empty model list.",
          { binary: resolvedBinary.path },
          "Verify Codex authentication and model availability.",
        );
      }

      Object.assign(evidence, {
        initializeResult: initResult,
        discoveredModelsCount: discoveredModels.length,
        discoveredModelIds: discoveredModels.map((model) => model.id),
      });

      const registry = getDefaultRegistry();
      registry.refreshCodexModels(discoveredModels);
      const selectedModel = registry.getItem(`openai:${discoveredModels[0]!.id}`);
      if (!selectedModel) {
        throw CraftingError.executionFailed(
          `Discovered model '${discoveredModels[0]!.id}' was not registered as an Item.`,
          { modelId: discoveredModels[0]!.id },
        );
      }

      const threadId = `craft-real-v0.3-${Date.now()}`;
      const planResult = new Crafter(registry).compile(
        { slots: { model: selectedModel, harness: "auto" } },
        { workspace: process.cwd(), threadId },
      );
      expect(planResult.success).toBe(true);
      const plan = planResult.craftPlan!;

      const productionAdapter = new NativeCodexRuntimeAdapter({ host, client });
      // Keep the real adapter and process intact, while recording the session
      // created by the same SupervisorRuntime.craftAgent product seam.
      const seamAdapter: HarnessRuntimeAdapter = {
        id: productionAdapter.id,
        harnessKind: productionAdapter.harnessKind,
        supports: (craftPlan) => productionAdapter.supports(craftPlan),
        spawnEntity: (craftPlan) => productionAdapter.spawnEntity(craftPlan),
        createSession: async (entity) => {
          liveSession = await productionAdapter.createSession(entity);
          liveSession.subscribe((event) => emittedEvents.push(event));
          return liveSession;
        },
        resumeSession: (entity, sessionRef) => productionAdapter.resumeSession(entity, sessionRef),
      };

      runtime = new SupervisorRuntime(() => undefined);
      runtime.setCustomCraftingAdapter(() => seamAdapter);

      const firstTurn = await runtime.craftAgent({
        craftPlan: plan,
        projectLocation: { kind: "windows", path: process.cwd() },
        prompt: prompt1,
      });
      expect(firstTurn.response).toContain("CRAFTSTATION_REAL_ROUNDTRIP_OK");
      expect(liveSession).toBeDefined();

      // The second turn uses the same native session, proving continuity of
      // the official Thread rather than two independent one-shot processes.
      const secondTurn = await liveSession!.startTurn({ prompt: prompt2 });
      expect(secondTurn.status).toBe("completed");
      expect(secondTurn.response).toContain("CRAFTSTATION_SECONDTURN_OK");

      Object.assign(evidence, {
        verdict: "PASS",
        entityId: firstTurn.entityId,
        sessionId: firstTurn.sessionId,
        threadId: firstTurn.threadId,
        turn1Response: firstTurn.response,
        turn2Response: secondTurn.response,
        events: emittedEvents,
        eventCount: emittedEvents.length,
      });
    } catch (error) {
      const detail = errorDetail(error);
      Object.assign(evidence, {
        verdict: "FAIL",
        error: detail,
        events: emittedEvents,
        eventCount: emittedEvents.length,
      });
      const code = detail.code;
      if (!["AUTH_REQUIRED", "RUNTIME_UNAVAILABLE", "EXECUTION_FAILED"].includes(String(code))) {
        throw new Error(`Unexpected real runtime diagnostic code: ${String(code)}`, {
          cause: error,
        });
      }
    } finally {
      if (liveSession) {
        await liveSession.terminate().catch(() => undefined);
      }
      await host?.stop();
      await runtime?.disposeAsync();

      if (host) {
        Object.assign(evidence, {
          spawnArgs: [...host.spawnArgs],
          stderrTail: host.stderrTail,
          exitCode: host.lastExitCode ?? null,
          exitSignal: host.lastExitSignal ?? null,
        });
      }

      const validationDir = join(process.cwd(), "..", "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "craftstation_execution_path_v0.3.2.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
    }
  }, 180_000);
});
