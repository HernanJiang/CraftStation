import { describe, expect, it } from "vitest";
import type { Thread } from "@/shared/contracts";
import { BoundedThreadContextProjection, resolveThreadRuntimeProvenance } from "./provenance";

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: "source-thread",
    projectId: "project-1",
    title: "Source thread",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    archived: false,
    done: false,
    starred: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveThreadRuntimeProvenance", () => {
  it("uses durable composition and native-session identity without exposing secrets", () => {
    const result = resolveThreadRuntimeProvenance(
      thread({
        compositionProvenance: {
          recipeId: "recipe-codex",
          recipeVersion: "1",
          craftedAt: "2026-08-31T00:00:00.000Z",
          ingredients: {},
          runtimeBinding: {
            harnessKind: "codex",
            modelId: "gpt-5.4",
            vendor: "openai",
            runtimeAdapterId: "codex-native",
          },
        },
        sessionRef: { providerSessionId: "session-1", discoveredAt: "2026-08-31T00:00:00.000Z" },
      }),
      {
        resolve: () => ({
          craftPlanId: "plan-1",
          entityId: "entity-1",
          segmentId: "seg-2",
          runtimeEpoch: 3,
          agentMcpSupported: true,
        }),
      },
    );

    expect(result).toMatchObject({
      recipeId: "recipe-codex",
      craftPlanId: "plan-1",
      entityId: "entity-1",
      nativeSessionId: "session-1",
      segmentId: "seg-2",
      runtimeEpoch: 3,
      agentMcpSupported: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|key/i);
  });

  it("fails closed for agent-facing MCP capability without a runtime resolver", () => {
    expect(resolveThreadRuntimeProvenance(thread()).agentMcpSupported).toBe(false);
  });
});

describe("BoundedThreadContextProjection", () => {
  it("keeps the default capsule empty", () => {
    expect(new BoundedThreadContextProjection().project(undefined)).toBeNull();
  });

  it("redacts secrets and hidden reasoning before applying the character budget", () => {
    const result = new BoundedThreadContextProjection().project({
      summary: "api_key=top-secret <hidden_reasoning>private chain</hidden_reasoning>",
      selectedMessages: ["Bearer abc.def.ghi"],
    });

    expect(result).not.toBeNull();
    expect(result?.text).toContain("[REDACTED]");
    expect(result?.text).toContain("[REDACTED_TOKEN]");
    expect(result?.text).not.toContain("top-secret");
    expect(result?.text).not.toContain("private chain");
    expect(result?.redacted).toBe(true);
  });

  it("caps a selected capsule while retaining source-kind metadata", () => {
    const result = new BoundedThreadContextProjection().project({
      selectedMessages: ["x".repeat(20_000)],
      recentCompletedTurns: ["recent"],
    });

    expect(result?.text.length).toBeLessThanOrEqual(12_000);
    expect(result?.sourceKinds).toEqual(["selected-message", "recent-turn"]);
    expect(result?.originalChars).toBeGreaterThan(result?.text.length ?? 0);
  });
});
