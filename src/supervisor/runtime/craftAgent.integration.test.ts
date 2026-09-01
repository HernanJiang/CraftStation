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
const allModelsEnabled = process.env.CRAFTSTATION_REAL_ALL_CODEX_MODELS === "1";
const craftingModelInventoryEnabled =
  process.env.CRAFTSTATION_REAL_CRAFTING_MODEL_INVENTORY === "1";

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

      const validationDir = join(process.cwd(), "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "craftstation_execution_path_v0.3.2.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
    }
  }, 180_000);
});

describe.skipIf(!craftingModelInventoryEnabled)(
  "CraftStation real production Crafting model inventory",
  () => {
    it("projects the official Codex app-server model list through SupervisorRuntime", async () => {
      const runtime = new SupervisorRuntime(() => undefined);
      const inventory = await runtime.getCraftingModelInventory({
        projectLocation: { kind: "windows", path: process.cwd() },
      });
      const evidence = {
        timestamp: new Date().toISOString(),
        synthetic: false,
        executionPath:
          "SupervisorRuntime.getCraftingModelInventory -> official Codex app-server model/list",
        status: inventory.status,
        source: inventory.source,
        modelCount: inventory.models.length,
        modelIds: inventory.models.map((model) => model.id),
        diagnosticCode: inventory.diagnostic?.code,
      };
      const validationDir = join(process.cwd(), "ai_workspace", "validation");
      mkdirSync(validationDir, { recursive: true });
      writeFileSync(
        join(validationDir, "v0.7.10-crafting-model-inventory-product-path.json"),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );

      expect(inventory.status).toBe("ready");
      expect(inventory.source).toBe("codex-app-server-model-list");
      expect(inventory.models.length).toBeGreaterThan(0);
      expect(inventory.models.map((model) => model.id)).not.toEqual(
        expect.arrayContaining(["gpt-4o", "gpt-5-hybrid", "gpt-5.3-codex", "o3-mini"]),
      );
    }, 60_000);
  },
);

describe.skipIf(!allModelsEnabled)("CraftStation real Codex model traffic matrix", () => {
  it("attempts every discovered and built-in OpenAI model through the production craftAgent seam", async () => {
    const marker = "CRAFTSTATION_MODEL_TRAFFIC_OK";
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      executionPath:
        "SupervisorRuntime.craftAgent -> NativeCodexRuntimeAdapter -> official codex app-server -> model",
      marker,
      attempts: [],
    };

    let host: AppServerProcessHost | undefined;
    let runtime: SupervisorRuntime | undefined;
    try {
      const resolvedBinary = CodexBinaryResolver.resolve();
      host = new AppServerProcessHost({ binaryPath: resolvedBinary.path, cwd: process.cwd() });
      const client = new AppServerClient(await host.start());
      await client.initialize();
      const discoveredModels = await client.listModels();
      const registry = getDefaultRegistry();
      registry.refreshCodexModels(discoveredModels);
      const discoveredIds = new Set(discoveredModels.map((model) => model.id));
      const modelFilter = new Set(
        (process.env.CRAFTSTATION_REAL_CODEX_MODEL_FILTER ?? "")
          .split(",")
          .map((modelId) => modelId.trim())
          .filter(Boolean),
      );
      const modelItems = registry
        .listItems("model")
        .filter((item) => item.metadata.vendor === "openai")
        .filter((item) => {
          if (modelFilter.size === 0) return true;
          const modelId = item.components.find(
            (component) => component.kind === "model_capability",
          )?.modelId;
          return modelFilter.has(String(modelId));
        })
        .sort((left, right) => left.id.localeCompare(right.id));
      const productionAdapter = new NativeCodexRuntimeAdapter({
        host,
        client,
        turnTimeoutMs: 180_000,
      });
      runtime = new SupervisorRuntime(() => undefined);
      runtime.setCustomCraftingAdapter(() => productionAdapter);
      const attempts: Array<Record<string, unknown>> = [];

      for (const [index, model] of modelItems.entries()) {
        const modelId = model.components.find(
          (component) => component.kind === "model_capability",
        )?.modelId;
        const attempt: Record<string, unknown> = {
          itemId: model.id,
          modelId,
          source: discoveredIds.has(String(modelId)) ? "app-server-discovered" : "builtin",
          attempted: true,
        };
        try {
          const planResult = new Crafter(registry).compile(
            { slots: { model, harness: "auto" } },
            { workspace: process.cwd(), threadId: `craft-real-model-${index}-${Date.now()}` },
          );
          if (!planResult.success || !planResult.craftPlan) {
            throw CraftingError.executionFailed("Model CraftPlan compilation failed.", {
              itemId: model.id,
            });
          }
          const result = await runtime.craftAgent({
            craftPlan: planResult.craftPlan,
            projectLocation: { kind: "windows", path: process.cwd() },
            prompt: `Reply with exactly ${marker}. Do not use tools.`,
          });
          const response = result.response ?? "";
          Object.assign(attempt, {
            verdict: response.includes(marker) ? "PASS" : "UNEXPECTED_RESPONSE",
            responseMarkerObserved: response.includes(marker),
            responseLength: response.length,
          });
          await runtime.closeThread({ threadId: result.threadId });
        } catch (error) {
          const detail = errorDetail(error);
          const message = String(detail.message ?? "");
          Object.assign(attempt, {
            verdict: "FAILED",
            errorCode: detail.code ?? "UNSTRUCTURED_ERROR",
            errorCategory: /404|no route for model/iu.test(message)
              ? "ROUTE_NOT_FOUND"
              : /timed out/iu.test(message)
                ? "TIMEOUT"
                : "PROVIDER_FAILURE",
          });
        }
        attempts.push(attempt);
      }

      Object.assign(evidence, {
        codexBinaryVersion: resolvedBinary.version,
        discoveredModelIds: discoveredModels.map((model) => model.id),
        attemptedModelCount: attempts.length,
        responsePassCount: attempts.filter((attempt) => attempt.verdict === "PASS").length,
        attempts,
      });
      expect(attempts).toHaveLength(modelItems.length);
      expect(attempts.every((attempt) => attempt.attempted === true)).toBe(true);
    } finally {
      await runtime?.disposeAsync().catch(() => undefined);
      await host?.stop();
      writeFileSync(
        join(
          validationDir,
          process.env.CRAFTSTATION_REAL_CODEX_MODEL_ARTIFACT?.trim() ||
            "v0.7.9-codex-all-model-real-traffic.json",
        ),
        JSON.stringify(evidence, null, 2),
        "utf8",
      );
    }
  }, 1_500_000);
});
