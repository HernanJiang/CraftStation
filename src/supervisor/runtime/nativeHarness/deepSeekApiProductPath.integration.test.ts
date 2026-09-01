import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Crafter, getDefaultRegistry, NATIVE_HARNESS_RECIPES, type Item } from "@/shared/crafting";
import type { RuntimeEvent } from "@/shared/contracts/runtimeEvent";
import { SupervisorRuntime } from "@/supervisor/supervisorRuntime";

const officialKeyEnv = "CRAFTSTATION_DEEPSEEK_OFFICIAL_API_KEY";
const arkKeyEnv = "CRAFTSTATION_DEEPSEEK_ARK_API_KEY";
const enabled = Boolean(process.env[officialKeyEnv]?.trim() || process.env[arkKeyEnv]?.trim());

function structuredCraftingError(error: unknown): Record<string, unknown> | undefined {
  const rawMessage = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(rawMessage) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (typeof record.code === "string") return record;
    const detail = record.detail;
    return detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

const cases = [
  {
    name: "deepseek-official-api",
    keyEnv: officialKeyEnv,
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-chat",
    itemId: "deepseek:deepseek-chat-api",
    marker: "CRAFTSTATION_DEEPSEEK_OFFICIAL_API_PRODUCT_OK",
  },
  {
    name: "deepseek-official-reasoner-api",
    keyEnv: officialKeyEnv,
    baseUrl: "https://api.deepseek.com/v1",
    modelId: "deepseek-reasoner",
    itemId: "deepseek:deepseek-reasoner-api",
    marker: "CRAFTSTATION_DEEPSEEK_OFFICIAL_REASONER_API_PRODUCT_OK",
  },
  {
    name: "deepseek-ark-coding-api",
    keyEnv: arkKeyEnv,
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelId: "deepseek-v4-flash",
    itemId: "deepseek:deepseek-v4-flash-api",
    marker: "CRAFTSTATION_DEEPSEEK_ARK_API_PRODUCT_OK",
  },
  {
    name: "deepseek-ark-coding-pro-api",
    keyEnv: arkKeyEnv,
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelId: "deepseek-v4-pro",
    itemId: "deepseek:deepseek-v4-pro-api",
    marker: "CRAFTSTATION_DEEPSEEK_ARK_PRO_API_PRODUCT_OK",
  },
] as const;

describe.skipIf(!enabled)("CraftStation DeepSeek API product path", () => {
  it("runs every configured official and Ark DeepSeek API model through SupervisorRuntime.craftAgent", async () => {
    const registry = getDefaultRegistry();
    const recipe = NATIVE_HARNESS_RECIPES.find(
      (candidate) => candidate.harnessKind === "deepseek-api",
    );
    const harness = registry.getItem("harness:deepseek-api");
    if (!recipe || !harness) throw new Error("DeepSeek API Recipe or Harness is not registered.");

    const evidence: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      synthetic: false,
      scope: "DeepSeek API provider paths; separate from official DSH JSON-RPC Harness",
      executionPath:
        "SupervisorRuntime.craftAgent -> DeepSeekApiRuntimeAdapter -> OpenAI-compatible HTTPS -> Entity -> Session",
      cases: [],
    };
    const attempts: Array<Record<string, unknown>> = [];

    for (const [index, candidate] of cases.entries()) {
      if (!process.env[candidate.keyEnv]?.trim()) {
        attempts.push({
          provider: candidate.name,
          model: candidate.modelId,
          endpoint: candidate.baseUrl,
          synthetic: false,
          attempted: false,
          verdict: "KEY_NOT_CONFIGURED",
        });
        continue;
      }
      const model = registry.getItem(candidate.itemId) as Item | undefined;
      if (!model) throw new Error(`Missing DeepSeek API model item '${candidate.itemId}'.`);
      const planResult = new Crafter(registry).compile(
        { slots: { model, harness } },
        {
          workspace: process.cwd(),
          threadId: `craft-deepseek-api-${index}-${Date.now()}`,
          clientProperties: { apiBaseUrl: candidate.baseUrl, apiKeyEnv: candidate.keyEnv },
        },
      );
      if (!planResult.success || !planResult.craftPlan) {
        throw new Error(`DeepSeek API plan compilation failed for ${candidate.name}.`);
      }

      const runtime = new SupervisorRuntime(() => undefined);
      const events: RuntimeEvent[] = [];
      const unsubscribe = runtime.subscribeRuntimeEvents((_threadId, event) => events.push(event));
      const attempt: Record<string, unknown> = {
        provider: candidate.name,
        model: candidate.modelId,
        endpoint: candidate.baseUrl,
        synthetic: false,
        attempted: true,
      };
      try {
        const result = await runtime.craftAgent({
          craftPlan: planResult.craftPlan,
          projectLocation: { kind: "windows", path: process.cwd() },
          prompt: `Reply with exactly ${candidate.marker}. Do not use tools.`,
        });
        const response = result.response ?? "";
        Object.assign(attempt, {
          verdict: response.includes(candidate.marker) ? "PASS" : "UNEXPECTED_RESPONSE",
          responseLength: response.length,
          responseMarkerObserved: response.includes(candidate.marker),
          entityIdCommitted: Boolean(result.entityId),
          sessionIdCommitted: Boolean(result.sessionId),
        });
        await runtime.closeThread({ threadId: result.threadId });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        const detail = structuredCraftingError(error);
        Object.assign(attempt, {
          verdict: "FAILED",
          errorCode: typeof detail?.code === "string" ? detail.code : "EXECUTION_FAILED",
          errorMessage:
            typeof detail?.message === "string"
              ? detail.message.slice(0, 240)
              : rawMessage.slice(0, 240),
          ...(typeof detail?.details === "object" &&
          detail.details &&
          !Array.isArray(detail.details)
            ? { errorDetails: detail.details }
            : {}),
        });
      } finally {
        unsubscribe();
        Object.assign(attempt, {
          eventTypes: events.map((event) => event.type),
          cleanup: {
            observedSessionExited: events.some((event) => event.type === "session.exited"),
          },
        });
        await runtime.disposeAsync().catch(() => undefined);
      }
      attempts.push(attempt);
    }

    evidence.cases = attempts;
    evidence.summary = {
      configured: attempts.filter((attempt) => attempt.attempted === true).length,
      attempted: attempts.filter((attempt) => attempt.attempted === true).length,
      passed: attempts.filter((attempt) => attempt.verdict === "PASS").length,
      skipped: attempts.filter((attempt) => attempt.verdict === "KEY_NOT_CONFIGURED").length,
      failed: attempts.filter((attempt) => attempt.attempted === true && attempt.verdict !== "PASS")
        .length,
      cleanupPassed: attempts.filter(
        (attempt) =>
          (attempt.cleanup as { observedSessionExited?: boolean })?.observedSessionExited,
      ).length,
    };
    const validationDir = join(process.cwd(), "ai_workspace", "validation");
    mkdirSync(validationDir, { recursive: true });
    writeFileSync(
      join(validationDir, "v0.7.12-deepseek-api-product-path.json"),
      JSON.stringify(evidence, null, 2),
      "utf8",
    );
    const configuredAttempts = attempts.filter((attempt) => attempt.attempted === true);
    expect(configuredAttempts.length).toBeGreaterThan(0);
    expect(configuredAttempts.every((attempt) => attempt.verdict === "PASS")).toBe(true);
  }, 240_000);
});
