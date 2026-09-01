/* eslint-disable vitest/require-mock-type-parameters -- fixture mocks are intentionally structural. */
import { describe, expect, it, vi } from "vitest";
import type {
  AgentAdapter,
  CreateStructuredSessionInput,
  StructuredSessionHandle,
  StructuredSessionListener,
} from "@/supervisor/agents/base";
import type { ProjectLocation, RuntimeEvent } from "@/shared/contracts";
import type { AccountBinding } from "@/shared/contracts/accountBinding";
import type { CraftPlan } from "@/shared/crafting";
import { GROK_NATIVE_HARNESS_DESCRIPTOR, KIMI_NATIVE_HARNESS_DESCRIPTOR } from "./descriptors";
import { StructuredNativeHarnessRuntimeAdapter } from "./structuredAdapter";

const windowsProject: ProjectLocation = { kind: "windows", path: "C:\\repo" };

function makePlan(harnessKind: "grok" | "kimi", vendor: "xai" | "moonshot"): CraftPlan {
  return {
    id: `plan:${harnessKind}:fixture`,
    recipeId: `recipe:${harnessKind}`,
    resultItemId: `result:${harnessKind}`,
    ingredients: {
      model: {
        slot: "model",
        itemId: `${vendor}:model`,
        itemVersion: "1.0.0",
        vendor,
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: `harness:${harnessKind}`,
        itemVersion: "1.0.0",
        vendor,
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind,
      modelId: `${harnessKind}-model`,
      vendor,
      runtimeAdapterId: `native-harness:${harnessKind}`,
      profileRef: `profile:${harnessKind}`,
      environment: { kind: "windows" },
    },
    workspace: "C:\\repo",
    threadId: `thread:${harnessKind}:fixture`,
    createdAt: new Date(0).toISOString(),
  };
}

function makeHandle(providerSessionId: string): StructuredSessionHandle {
  let listener: StructuredSessionListener | undefined;
  const handle: StructuredSessionHandle = {
    launchOptions: {},
    activate: vi.fn(async () => undefined),
    openThread: vi.fn(
      async (_config, sessionRef) => sessionRef?.providerSessionId ?? providerSessionId,
    ),
    startTurn: vi.fn(async (prompt) => {
      const turnId = `turn:${providerSessionId}`;
      const events: RuntimeEvent[] = [
        { type: "turn.started", threadId: `thread:${providerSessionId}`, turnId },
        {
          type: "content.delta",
          threadId: `thread:${providerSessionId}`,
          itemId: `item:${turnId}`,
          stream: "assistant_text",
          delta: `${providerSessionId}: ${prompt}`,
        },
        {
          type: "turn.completed",
          threadId: `thread:${providerSessionId}`,
          turnId,
          state: "completed",
        },
      ];
      for (const event of events) listener?.onRuntimeEvent?.(event);
    }),
    interruptTurn: vi.fn(async () => undefined),
    setListener: vi.fn((next) => {
      listener = next;
    }),
    dispose: vi.fn(async () => undefined),
  };
  return handle;
}

function makeStructuredAgent(
  kind: "grok" | "kimi",
  inputs: CreateStructuredSessionInput[],
  providerSessionId: string,
): AgentAdapter {
  const createStructuredSession: NonNullable<AgentAdapter["createStructuredSession"]> = async (
    input,
  ) => {
    inputs.push(input);
    return makeHandle(providerSessionId);
  };
  const buildResumeArgv: AgentAdapter["buildResumeArgv"] = () => ({
    binary: kind,
    args: [],
  });

  return {
    kind,
    label: `${kind} fixture`,
    capabilities: {},
    buildLaunchArgv: () => ({ binary: kind, args: [] }),
    buildResumeArgv,
    createStructuredSession,
  } as unknown as AgentAdapter;
}

const accountBinding: AccountBinding = {
  accountId: "account:fixture",
  provider: "fixture",
  credentialScopeRef: "managed:fixture",
  reason: "selected",
  boundAt: 1,
};

describe("Grok Build native ACP fixture", () => {
  it("keeps ACP session identity and profile/environment binding behind the shared seam", async () => {
    const inputs: CreateStructuredSessionInput[] = [];
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent("grok", inputs, "grok-acp-session"),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      accountBinding,
      profileRef: "profile:grok",
    });

    const entity = await adapter.spawnEntity(makePlan("grok", "xai"));
    expect(entity.metadata).toMatchObject({
      profileRef: "profile:grok",
      accountBinding,
    });

    const session = await adapter.createSession(entity);
    expect(session.nativeSessionRef).toBe("grok-acp-session");
    expect(inputs[0]).toMatchObject({
      projectLocation: windowsProject,
      agentSettings: { profileRef: "profile:grok" },
    });
    await expect(session.startTurn({ prompt: "hello Grok" })).resolves.toMatchObject({
      status: "completed",
      response: "grok-acp-session: hello Grok",
    });
    await session.terminate();
  });

  it("passes Supervisor-resolved MCP descriptors into the provider ACP session", async () => {
    const inputs: CreateStructuredSessionInput[] = [];
    const server = {
      id: "craft-probe",
      name: "craft-probe",
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "node", args: ["probe.mjs"], env: {} },
    };
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent("grok", inputs, "grok-mcp-session"),
      descriptor: GROK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      mcpServers: [server],
    });

    await adapter.createSession(await adapter.spawnEntity(makePlan("grok", "xai")));

    expect(inputs[0]?.mcpServers).toEqual([server]);
  });
});

describe("Kimi Code native ACP fixture", () => {
  it("resumes the provider session without expanding the shared seam with Kimi protocol details", async () => {
    const inputs: CreateStructuredSessionInput[] = [];
    const adapter = new StructuredNativeHarnessRuntimeAdapter({
      adapter: makeStructuredAgent("kimi", inputs, "kimi-acp-session"),
      descriptor: KIMI_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: windowsProject,
      profileRef: "profile:kimi",
    });

    expect(KIMI_NATIVE_HARNESS_DESCRIPTOR.capabilities.mcp).toBe("supported+integrated");
    const entity = await adapter.spawnEntity(makePlan("kimi", "moonshot"));
    const session = await adapter.resumeSession(entity, "kimi-saved-session");

    expect(session.nativeSessionRef).toBe("kimi-saved-session");
    expect(inputs[0]).toMatchObject({
      projectLocation: windowsProject,
      agentSettings: { profileRef: "profile:kimi" },
    });
    await expect(session.sendPrompt("resume Kimi")).resolves.toMatchObject({
      response: "kimi-acp-session: resume Kimi",
    });
    await session.terminate();
  });
});
