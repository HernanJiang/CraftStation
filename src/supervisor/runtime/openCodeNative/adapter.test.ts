import { describe, expect, it, vi } from "vitest";
import type { AccountBinding } from "@/shared/contracts";
import type { CraftPlan } from "@/shared/crafting";
import { OPENCODE_NATIVE_HARNESS_DESCRIPTOR } from "@/supervisor/runtime/nativeHarness/descriptors";
import { OpenCodeNativeRuntimeAdapter } from "./adapter";
import { OpenCodeNativeServerPool } from "./serverPool";
import type { OpenCodeNativeClient, OpenCodeNativeConnection } from "./transport";
import type {
  OpenCodeRuntimeBindingRequest,
  ResolvedOpenCodeRuntimeBinding,
} from "./runtimeBinding";

function emptyStream(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
}

const routes = [
  ["openai", "gpt-4o"],
  ["xai", "grok-4"],
  ["google", "gemini-2.5-pro"],
  ["deepseek", "deepseek-v4-flash"],
  ["moonshotai", "kimi-k2.5"],
  ["moonshot-openai-compatible", "kimi-k2.5"],
] as const;

function plan(providerID: string, modelId: string): CraftPlan {
  return {
    id: `plan:${providerID}:${modelId}`,
    recipeId: `recipe:${providerID}:opencode`,
    resultItemId: `result:${providerID}:${modelId}`,
    ingredients: {
      model: {
        slot: "model",
        itemId: `${providerID}:${modelId}`,
        itemVersion: "test",
        vendor: providerID,
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: "harness:opencode",
        itemVersion: "test",
        vendor: "opencode",
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind: "opencode",
      providerID,
      modelId,
      vendor: providerID,
      runtimeAdapterId: "native-harness:opencode",
      authRef: `auth:${providerID}`,
    },
    workspace: "C:/workspace",
    createdAt: new Date(0).toISOString(),
  };
}

describe("OpenCode native route-specific runtime gate", () => {
  it.each(routes)(
    "rejects unverified route %s:%s before Entity spawn",
    async (providerID, modelID) => {
      const adapter = new OpenCodeNativeRuntimeAdapter({
        projectLocation: { kind: "windows", path: "C:/workspace" },
        descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
        readinessProvider: () => ({
          status: "unverified",
          reason: "No provider assistant response evidence.",
        }),
      });

      await expect(adapter.spawnEntity(plan(providerID, modelID))).rejects.toThrow(
        new RegExp(`${providerID}:${modelID}.*unverified`, "i"),
      );
    },
  );

  it.each(routes)("allows verified route %s:%s to spawn an Entity", async (providerID, modelID) => {
    const adapter = new OpenCodeNativeRuntimeAdapter({
      projectLocation: { kind: "windows", path: "C:/workspace" },
      descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
      readinessProvider: (query) =>
        query.providerID === providerID && query.modelID === modelID
          ? { status: "ready", reason: "Verified route fixture." }
          : { status: "unavailable", reason: "Wrong route." },
    });

    const entity = await adapter.spawnEntity(plan(providerID, modelID));
    expect(entity.craftPlan.runtimeBinding).toMatchObject({ providerID, modelId: modelID });
    expect(entity.status).toBe("spawned");
  });

  it("injects account/profile binding into the Supervisor resolver and isolated server pool", async () => {
    const call = vi
      .fn<(parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>>()
      .mockResolvedValue({ data: {} });
    const client: OpenCodeNativeClient = {
      session: {
        create: vi
          .fn<(parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>>()
          .mockResolvedValue({ data: { id: "ses_bound" } }),
        get: call,
        promptAsync: call,
        abort: call,
        messages: call,
        summarize: call,
        delete: call,
      },
      permission: { reply: call },
      question: { reply: call, reject: call },
      provider: { list: call, auth: call },
      global: {
        event: vi
          .fn<(options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>>()
          .mockResolvedValue({ stream: emptyStream() }),
      },
    };
    const transportOptions: Record<string, unknown>[] = [];
    const pool = new OpenCodeNativeServerPool({
      transportFactory: ((options: Record<string, unknown>) => {
        transportOptions.push(options);
        return {
          correlationId: "corr:bound",
          connect: async (): Promise<OpenCodeNativeConnection> => ({
            client,
            baseUrl: "http://127.0.0.1:4096",
            correlationId: "corr:bound",
            subscribe: () => () => undefined,
            dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          }),
          dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
      }) as never,
    });
    const accountBinding: AccountBinding = {
      accountId: "openai:work",
      provider: "openai",
      credentialScopeRef: "managed:openai:work",
      reason: "explicit",
      boundAt: 1,
    };
    const resolve = vi
      .fn<(request: OpenCodeRuntimeBindingRequest) => Promise<ResolvedOpenCodeRuntimeBinding>>()
      .mockResolvedValue({
        isolationKey: "windows:managed:openai:work:auth:profile",
        transportOptions: { serverEnvironment: { OPENAI_API_KEY: "supervisor-private" } },
      });
    const adapter = new OpenCodeNativeRuntimeAdapter({
      projectLocation: { kind: "windows", path: "C:/workspace" },
      descriptor: OPENCODE_NATIVE_HARNESS_DESCRIPTOR,
      accountBinding,
      profileRef: "profile:work",
      readinessProvider: () => ({ status: "ready", reason: "Verified route fixture." }),
      runtimeBindingResolver: { resolve },
      serverPool: pool,
    });
    const boundPlan = plan("openai", "gpt-4o");
    boundPlan.runtimeBinding.profileRef = "profile:work";
    const entity = await adapter.spawnEntity(boundPlan);
    const session = await adapter.createSession(entity);

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        accountBinding,
        profileRef: "profile:work",
        plan: boundPlan,
      }),
    );
    expect(transportOptions).toEqual([
      expect.objectContaining({
        serverEnvironment: { OPENAI_API_KEY: "supervisor-private" },
      }),
    ]);
    expect(JSON.stringify(entity)).not.toContain("supervisor-private");
    await session.terminate();
    await pool.dispose();
  });
});
