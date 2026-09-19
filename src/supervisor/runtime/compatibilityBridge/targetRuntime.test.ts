import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AgentAdapter, StructuredSessionHandle } from "@/supervisor/agents/base";
import type { CraftPlan } from "@/shared/crafting";
import { NATIVE_HARNESS_DESCRIPTORS } from "../nativeHarness/descriptors";
import { createCompatibilityTargetRuntime } from "./targetRuntime";
import { exportCompatibilityForHarness } from "./exporters";

describe("CPA target Harness session contract", () => {
  it.each(["kimi", "grok", "deepseek", "antigravity", "opencode", "muse"] as const)(
    "keeps %s protocol, permissions, tools, Stop and resume on the chosen Harness",
    async (kind) => {
      const directory = mkdtempSync(join(tmpdir(), "cs-cpa-target-"));
      const openThread = vi
        .fn<NonNullable<StructuredSessionHandle["openThread"]>>()
        .mockResolvedValue("native-session");
      const startTurn = vi
        .fn<NonNullable<StructuredSessionHandle["startTurn"]>>()
        .mockResolvedValue(undefined);
      const interruptTurn = vi
        .fn<NonNullable<StructuredSessionHandle["interruptTurn"]>>()
        .mockResolvedValue(undefined);
      const resolveServerRequest = vi
        .fn<NonNullable<StructuredSessionHandle["resolveServerRequest"]>>()
        .mockResolvedValue(undefined);
      const dispose = vi.fn<StructuredSessionHandle["dispose"]>().mockResolvedValue(undefined);
      const handle = {
        launchOptions: {},
        openThread,
        startTurn,
        interruptTurn,
        resolveServerRequest,
        dispose,
        setListener: vi.fn<StructuredSessionHandle["setListener"]>(),
      } as StructuredSessionHandle;
      const createStructuredSession = vi
        .fn<NonNullable<AgentAdapter["createStructuredSession"]>>()
        .mockResolvedValue(handle);
      const agent = {
        kind,
        capabilities: { defaultApprovalPolicy: "yolo" },
        createStructuredSession,
      } as unknown as AgentAdapter;
      const plan = {
        id: "plan:test",
        threadId: "thread:test",
        resultItemId: "result:test",
        recipeId: "recipe:test",
        ingredients: {},
        createdAt: "test",
        runtimeBinding: {
          harnessKind: kind,
          modelId: "test-model",
          vendor: "openai",
          routeType: "compatibility",
        },
        overrides: { permissionConfig: { approvalPolicy: "default" } },
      } as CraftPlan;
      try {
        const target = createCompatibilityTargetRuntime({
          config: exportCompatibilityForHarness(
            kind,
            {
              running: true,
              endpoint: "http://127.0.0.1:18317",
              host: "127.0.0.1",
              port: 18317,
              apiKey: "fixture-key",
            },
            "test-model",
          ),
          plan,
          directory,
          projectLocation: { kind: "windows", path: directory },
          agent,
          descriptor: NATIVE_HARNESS_DESCRIPTORS[kind],
          mcpServers: [],
          skillSegments: [],
        });
        const entity = await target.spawnEntity(plan);
        expect(entity.craftPlan.runtimeBinding.harnessKind).toBe(kind);
        const session = await target.createSession(entity);
        expect(createStructuredSession).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({ approvalPolicy: "default" }),
            mcpServers: [],
            baseSpawnEnv: expect.any(Object),
          }),
        );
        await session.startTurn({
          prompt: "next",
          overrides: { permissionConfig: { approvalPolicy: "yolo" } },
        });
        expect(startTurn).toHaveBeenCalledWith(
          "next",
          expect.objectContaining({ approvalPolicy: "yolo" }),
          undefined,
          expect.objectContaining({ turnId: expect.any(String) }),
        );
        await session.respondToRequest?.("approval", {
          kind: "permission",
          response: "reject",
          optionId: "reject-once",
        });
        expect(resolveServerRequest).toHaveBeenCalledWith("approval", { optionId: "reject-once" });
        await session.interrupt();
        expect(interruptTurn).toHaveBeenCalled();
        await session.terminate();
        expect(dispose).toHaveBeenCalled();
        const resumed = await target.resumeSession(entity, "native-session");
        expect(openThread).toHaveBeenLastCalledWith(
          expect.any(Object),
          expect.objectContaining({ providerSessionId: "native-session" }),
        );
        await resumed.terminate();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
