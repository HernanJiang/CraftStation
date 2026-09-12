import { describe, expect, it, vi } from "vitest";
import type { AgentKind, AgentStatus } from "@/shared/contracts";
import type { AgentAdapter } from "@/supervisor/agents/base";
import type { SubagentRunManager } from "./SubagentRunManager";
import { listCrossagentEligibleProviders } from "./routingSnapshot";
import {
  buildSpawnableAgents,
  classifyModelTier,
  CROSSAGENT_MCP_INSTRUCTIONS_BASE,
  dispatchTool,
  nativeHarnessDirective,
  nativeSubagentToolFor,
  resolveOwnSubagentRoute,
  TOOLS,
} from "./toolRegistry";
import type { SubagentToolContext } from "./toolRegistry";
import type { SpawnableAgent } from "./types";

describe("classifyModelTier", () => {
  it.each([
    ["claude-haiku-4", "Haiku 4", "fast-cheap"],
    ["gpt-5-mini", "GPT-5 Mini", "fast-cheap"],
    ["gemini-flash", "Gemini Flash", "fast-cheap"],
    ["gpt-5-nano", "GPT-5 Nano", "fast-cheap"],
    ["codex-lite", "Codex Lite", "fast-cheap"],
    ["some-small-model", "Small Model", "fast-cheap"],
    ["codex-spark-5.3", "Spark 5.3", "fast-cheap"],
    ["model-fast", "Fast Mode", "fast-cheap"],
    ["claude-opus-4", "Opus 4.8", "max-capability"],
    ["fable-5", "Fable 5", "max-capability"],
    ["gemini-pro", "Gemini Pro", "max-capability"],
    ["gpt-5-max", "GPT-5 Max", "max-capability"],
    ["model-ultra", "Ultra", "max-capability"],
    ["big-model", "Big Model", "max-capability"],
    ["claude-sonnet-4.5", "Sonnet 4.5", "balanced"],
    ["gpt-5.5", "GPT-5.5", "balanced"],
  ])("classifies %s / %s as %s", (id, label, expected) => {
    expect(classifyModelTier(id, label)).toBe(expected);
  });

  it("matches keywords case-insensitively", () => {
    expect(classifyModelTier("HAIKU-4", "MODEL")).toBe("fast-cheap");
    expect(classifyModelTier("model", "OPUS 4.8")).toBe("max-capability");
  });
});

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    kind: "claude" as AgentKind,
    label: "Claude",
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [
        { id: "claude-haiku-4", label: "Haiku 4" },
        { id: "claude-sonnet-4.5", label: "Sonnet 4.5" },
        { id: "claude-opus-4", label: "Opus 4.8" },
      ],
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: false,
      supportsDirectInput: true,
    },
    ...overrides,
  } as unknown as AgentStatus;
}

describe("buildSpawnableAgents", () => {
  it("attaches a tier to each model", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()]);
    expect(agent?.models).toEqual([
      {
        value: "claude-haiku-4",
        label: "Haiku 4",
        tier: "fast-cheap",
        reasoning: { values: [] },
      },
      {
        value: "claude-sonnet-4.5",
        label: "Sonnet 4.5",
        tier: "balanced",
        reasoning: { values: [] },
      },
      {
        value: "claude-opus-4",
        label: "Opus 4.8",
        tier: "max-capability",
        reasoning: { values: [] },
      },
    ]);
    expect(agent?.provider).toEqual({ value: "claude", label: "Claude" });
    expect(agent?.reasoningOptions).toEqual([]);
    expect(agent?.permissions).toEqual({
      options: [{ value: "full-access", label: "Full access" }],
      default: "full-access",
    });
  });

  it("nests composer reasoning and Fast data under each model", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const status = makeStatus();
    status.capabilities.modelEfforts = { "claude-opus-4": ["low", "high", "xhigh"] };
    status.capabilities.defaultEffort = "high";
    status.capabilities.fastModels = ["claude-opus-4"];
    const [provider] = buildSpawnableAgents(adapters, [status]);
    expect(provider?.models[2]).toMatchObject({
      reasoning: {
        values: ["low", "high", "xhigh"],
        default: "high",
      },
      fast: { available: true },
    });
    expect(provider?.reasoningOptions).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra High" },
    ]);
  });

  it("marks structured-runtime agents with execution: structured", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()]);
    expect(agent?.execution).toBe("structured");
  });

  it("includes CLI-only agents via buildSubagentOneShotCommand, marked one-shot", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        {
          buildSubagentOneShotCommand: () => ({ command: "x", args: [] }),
        } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()]);
    expect(agent?.execution).toBe("one-shot");
  });

  it("excludes agents that support neither a structured session nor a one-shot child", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      ["claude" as AgentKind, {} as unknown as AgentAdapter],
    ]);
    expect(buildSpawnableAgents(adapters, [makeStatus()])).toEqual([]);
  });

  it("excludes providers disabled in settings", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    expect(
      buildSpawnableAgents(adapters, [makeStatus()], {
        disabledAgents: ["claude"],
        hiddenModels: {},
      }),
    ).toEqual([]);
  });

  it("excludes providers paused only for Own Subagents", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    expect(
      buildSpawnableAgents(adapters, [makeStatus()], {
        disabledAgents: [],
        hiddenModels: {},
        ownSubagentPausedProviders: ["claude"],
      }),
    ).toEqual([]);
  });

  it("keeps paused and fully-filtered providers listed as eligible, but not globally disabled ones", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    expect(
      listCrossagentEligibleProviders(adapters, [makeStatus()], {
        disabledAgents: [],
        hiddenModels: {},
        ownSubagentPausedProviders: ["claude"],
        ownSubagentHiddenModels: {
          claude: ["claude-haiku-4", "claude-sonnet-4.5", "claude-opus-4"],
        },
      }),
    ).toEqual([{ kind: "claude", label: "Claude", execution: "structured" }]);
    expect(
      listCrossagentEligibleProviders(adapters, [makeStatus()], {
        disabledAgents: ["claude"],
        hiddenModels: {},
      }),
    ).toEqual([]);
  });

  it("filters hidden models and recomputes the advertised default", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()], {
      disabledAgents: [],
      hiddenModels: { claude: ["claude-haiku-4", "claude-sonnet-4.5"] },
    });
    expect(agent?.models.map((model) => model.value)).toEqual(["claude-opus-4"]);
    expect(agent?.defaultModel).toBe("claude-opus-4");
  });

  it("applies Own-Subagents-only model visibility on top of global visibility", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()], {
      disabledAgents: [],
      hiddenModels: { claude: ["claude-haiku-4"] },
      ownSubagentHiddenModels: { claude: ["claude-sonnet-4.5"] },
    });
    expect(agent?.models.map((model) => model.value)).toEqual(["claude-opus-4"]);
    expect(agent?.defaultModel).toBe("claude-opus-4");
  });

  it("uses a structured provider's dedicated ACP visibility surface when configured", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const [agent] = buildSpawnableAgents(adapters, [makeStatus()], {
      disabledAgents: [],
      hiddenModels: { "claude-acp": ["claude-opus-4"] },
    });
    expect(agent?.models.map((model) => model.value)).not.toContain("claude-opus-4");
  });

  it("ranks the live spawnable roster by matching task tags", () => {
    const adapters = new Map<AgentKind, AgentAdapter>([
      [
        "claude" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
      [
        "kimi" as AgentKind,
        { createStructuredSession: async () => ({}) } as unknown as AgentAdapter,
      ],
    ]);
    const claude = makeStatus();
    const kimi = makeStatus({
      kind: "kimi" as AgentKind,
      label: "Kimi",
      capabilities: {
        ...makeStatus().capabilities,
        models: [{ id: "k3", label: "K3" }],
      },
    });
    const ranked = buildSpawnableAgents(
      adapters,
      [claude, kimi],
      {
        disabledAgents: [],
        hiddenModels: {},
        favoriteModels: [],
        agentSelectionUsage: [],
        ownSubagentSelectionUsage: [
          {
            agentKind: "claude",
            modelId: "claude-opus-4",
            fast: false,
            tags: ["frontend", "design"],
            count: 3,
            lastUsedAt: 10,
          },
          {
            agentKind: "kimi",
            modelId: "k3",
            fast: false,
            tags: ["bugfix"],
            count: 20,
            lastUsedAt: 20,
          },
        ],
      },
      ["frontend"],
    );

    expect(ranked.map((agent) => agent.provider.value)).toEqual(["claude", "kimi"]);
    expect(ranked[0]?.preference).toMatchObject({
      source: "tag-affinity",
      matchedTags: ["frontend"],
      learnedTags: [
        { tag: "design", count: 3 },
        { tag: "frontend", count: 3 },
      ],
    });
  });
});

function makeToolContext(): {
  ctx: SubagentToolContext;
} {
  const provider = (id: string, model: string): SpawnableAgent => ({
    provider: { value: id, label: id },
    models: [{ value: model, label: model, reasoning: { values: ["high"], default: "high" } }],
    reasoningOptions: [{ value: "high", label: "High" }],
    defaultModel: model,
    permissions: {
      options: [{ value: "full-access", label: "Full access" }],
      default: "full-access",
    },
    execution: "structured",
    preference: {
      rank: id === "codex" ? 1 : 2,
      source: "built-in",
      usageCount: 0,
      model,
      reasoning: "high",
      fast: false,
    },
  });
  return {
    ctx: {
      parentThreadId: "parent-1",
      runManager: {} as unknown as SubagentRunManager,
      listSpawnableAgents: async () => [provider("codex", "gpt-5.5"), provider("claude", "sonnet")],
    },
  };
}

function resultText(result: { content: Array<{ text: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("provider discovery", () => {
  const provider: SpawnableAgent = {
    provider: { value: "codex", label: "Codex" },
    models: [
      {
        value: "gpt-5.5",
        label: "GPT-5.5",
        reasoning: { values: ["high"], default: "high" },
      },
    ],
    reasoningOptions: [{ value: "high", label: "High" }],
    defaultModel: "gpt-5.5",
    permissions: {
      options: [{ value: "full-access", label: "Full access" }],
      default: "full-access",
    },
    execution: "structured",
    preference: {
      rank: 1,
      source: "built-in",
      usageCount: 0,
      model: "gpt-5.5",
      reasoning: "high",
      fast: false,
    },
  };

  it("lists compact summaries and resolves full options by id", async () => {
    const { ctx } = makeToolContext();
    ctx.listSpawnableAgents = async () => [provider];

    const listed = await dispatchTool("list_agents", {}, ctx);
    expect(JSON.parse(resultText(listed))).toEqual([
      {
        id: "codex",
        label: "Codex",
        execution: "structured",
        defaultModel: "gpt-5.5",
        modelCount: 1,
        rank: 1,
        preferenceSource: "built-in",
        usageCount: 0,
        preferredModel: "gpt-5.5",
        preferredReasoning: "high",
        preferredFast: false,
        matchedTags: [],
        learnedTags: [],
      },
    ]);

    const detail = await dispatchTool("get_agent", { id: "codex" }, ctx);
    expect(JSON.parse(resultText(detail))).toEqual(provider);
  });

  it("returns a tool error for an unknown provider id", async () => {
    const { ctx } = makeToolContext();
    ctx.listSpawnableAgents = async () => [provider];
    const result = await dispatchTool("get_agent", { id: "missing" }, ctx);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Unknown provider id");
  });
});

describe("manual routing preference tools", () => {
  it("normalizes, validates, lists, and removes user-pinned routes", async () => {
    const { ctx } = makeToolContext();
    let overrides: NonNullable<ReturnType<NonNullable<typeof ctx.listRoutingOverrides>>> = [];
    ctx.listRoutingOverrides = () => overrides;
    ctx.setRoutingOverride = (override) => {
      overrides = [override];
    };
    ctx.removeRoutingOverride = (tags) => {
      overrides = overrides.filter((override) => override.tags.join("\0") !== tags.join("\0"));
    };

    const saved = await dispatchTool(
      "set_routing_preference",
      {
        tags: ["User Interface", "FE"],
        provider: "claude",
        model: "sonnet",
        reasoning: "high",
        fast: false,
      },
      ctx,
    );
    expect(JSON.parse(resultText(saved))).toMatchObject({
      status: "saved",
      override: {
        tags: ["frontend", "ui"],
        agentKind: "claude",
        modelId: "sonnet",
        effort: "high",
        fast: false,
      },
    });

    const listed = await dispatchTool("list_routing_preferences", {}, ctx);
    expect(JSON.parse(resultText(listed))).toEqual(overrides);

    const removed = await dispatchTool(
      "remove_routing_preference",
      { tags: ["front-end", "ui"] },
      ctx,
    );
    expect(JSON.parse(resultText(removed))).toEqual({
      status: "removed",
      tags: ["frontend", "ui"],
    });
    expect(overrides).toEqual([]);
  });

  it("rejects a pinned route that is not currently available", async () => {
    const { ctx } = makeToolContext();
    const saved: unknown[] = [];
    ctx.setRoutingOverride = (override) => {
      saved.push(override);
    };

    const result = await dispatchTool(
      "set_routing_preference",
      {
        tags: ["frontend"],
        provider: "claude",
        model: "missing",
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not currently available");
    expect(saved).toEqual([]);
  });
});

describe("subagent tool registration", () => {
  it("registers the ephemeral subagent-run tools and no full-thread tools", () => {
    const names = new Set(TOOLS.map((tool) => tool.name));
    for (const name of [
      "list_agents",
      "get_agent",
      "spawn_agent",
      "list_routing_preferences",
      "set_routing_preference",
      "remove_routing_preference",
      "wait_for_agent",
      "get_status",
      "list_runs",
      "cancel",
    ]) {
      expect(names.has(name)).toBe(true);
    }
    for (const legacy of ["run_agent", "spawn_agents", "wait_for_agents"]) {
      expect(names.has(legacy)).toBe(false);
    }
    // Full-thread orchestration moved to the `craftstation` (app-controls) MCP.
    for (const name of [
      "create_thread",
      "list_threads",
      "get_thread",
      "read_thread",
      "send_to_thread",
      "wait_for_thread",
      "interrupt_thread",
      "close_thread",
    ]) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("declares required fields on the subagent tool schemas", () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("spawn_agent")!.inputSchema).toMatchObject({
      oneOf: [
        { type: "object", required: ["prompt"] },
        { type: "object", required: ["tasks"] },
      ],
    });
    expect(byName.get("get_agent")!.inputSchema).toMatchObject({ required: ["id"] });
    expect(byName.get("set_routing_preference")!.inputSchema).toMatchObject({
      required: ["tags", "provider"],
    });
    expect(byName.get("remove_routing_preference")!.inputSchema).toMatchObject({
      required: ["tags"],
    });
    expect(byName.get("wait_for_agent")!.inputSchema).toMatchObject({
      oneOf: [
        { type: "object", required: ["run_id"] },
        { type: "object", required: ["run_ids"] },
      ],
    });
    expect(byName.get("get_status")!.inputSchema).toMatchObject({ required: ["run_id"] });
    expect(byName.get("cancel")!.inputSchema).toMatchObject({ required: ["run_id"] });
    expect(byName.get("list_agents")!.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(byName.get("spawn_agent")!.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("documents background runs as an explicit join that keeps working across wait timeouts", () => {
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("never injects a new message");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain(
      "keep waiting across as many wait_for_agent calls as necessary",
    );
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain(
      "Never cancel or abandon a run solely because 180 seconds",
    );
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).not.toContain("delivered back automatically");
  });

  it("does not describe an elapsed wait as a reason to cancel an active run", () => {
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("spawn_agent")!.inputSchema).toMatchObject({
      properties: {
        timeout_s: {
          description: expect.stringContaining("leaves the subagent running"),
        },
      },
    });
    expect(byName.get("wait_for_agent")!.description).toContain(
      "wait call timed out while the child stayed active",
    );
    expect(byName.get("cancel")!.description).toContain(
      "Never cancel solely because a wait timed out",
    );
  });

  it("tells namespacing hosts to resolve bare tool names against the own_subagents server", () => {
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("own_subagents__list_agents");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain(
      "never the same bare name under another server",
    );
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).not.toContain("crossagents__list_agents");
  });

  it("documents the native-harness lane as the default route", () => {
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("route=native-harness");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("native subagent tool");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("do NOT call spawn_agent again");
  });

  it("requires an explicit user ask in the thread before delegating", () => {
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("in this thread");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("rest of the thread");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain(
      "never spawn subagents on your own initiative",
    );
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("spawn_agent")!.description).toContain("never spawn before it");
  });

  it("asks parents to give every spawned run a descriptive task label", () => {
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("Always set name");
    expect(CROSSAGENT_MCP_INSTRUCTIONS_BASE).toContain("appends those automatically");
    const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));
    expect(byName.get("spawn_agent")!.inputSchema).toMatchObject({
      properties: {
        name: {
          description: expect.stringContaining("describing what this run does"),
        },
      },
    });
  });

  it("returns an isError result (not a throw) for removed full-thread tools", async () => {
    const { ctx } = makeToolContext();
    const result = await dispatchTool("create_thread", { prompt: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("Unknown tool");
  });

  it("parses parallel tasks, background lifetime, and fallback selections", async () => {
    const { ctx } = makeToolContext();
    const received: unknown[] = [];
    ctx.runManager = {
      spawnMany: (_parentThreadId: string, requests: unknown[]) => {
        received.push(...requests);
        return requests.map((_, index) => ({ runId: `run-${index + 1}` }));
      },
    } as unknown as SubagentRunManager;

    const result = await dispatchTool(
      "spawn_agent",
      {
        background: true,
        tasks: [
          {
            provider: "codex",
            model: "gpt-5.5",
            prompt: "inspect",
            retry_on: "any-failure",
            fallbacks: [{ provider: "claude", model: "sonnet", reasoning: "high" }],
          },
          { provider: "claude", prompt: "review" },
        ],
      },
      ctx,
    );

    expect(JSON.parse(resultText(result))).toEqual({
      runs: [
        { run_id: "run-1", status: "running", output: "" },
        { run_id: "run-2", status: "running", output: "" },
      ],
    });
    expect(received).toEqual([
      {
        agent: "codex",
        model: "gpt-5.5",
        effort: "high",
        prompt: "inspect",
        background: true,
        retryMode: "any-failure",
        fallbacks: [{ agent: "claude", model: "sonnet", effort: "high" }],
      },
      {
        agent: "claude",
        model: "sonnet",
        effort: "high",
        prompt: "review",
        background: true,
      },
    ]);
  });

  it("rejects oversized task batches before resolving their providers", async () => {
    const { ctx } = makeToolContext();
    const listSpawnableAgents = vi.fn<typeof ctx.listSpawnableAgents>(ctx.listSpawnableAgents);
    ctx.listSpawnableAgents = listSpawnableAgents;

    const result = await dispatchTool(
      "spawn_agent",
      {
        tasks: Array.from({ length: 5 }, (_, index) => ({
          prompt: `task ${index}`,
        })),
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("at most 4");
    expect(listSpawnableAgents).not.toHaveBeenCalled();
  });

  it("returns immediately when spawn_agent is explicitly backgrounded", async () => {
    const { ctx } = makeToolContext();
    let waited = false;
    let spawnedRequest: unknown;
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-bg" };
      },
      waitFor: async () => {
        waited = true;
        return { status: "completed" as const, output: "too late" };
      },
    } as unknown as SubagentRunManager;

    const result = await dispatchTool(
      "spawn_agent",
      { provider: "codex", prompt: "keep working", background: true },
      ctx,
    );

    expect(JSON.parse(resultText(result))).toEqual({
      run_id: "run-bg",
      status: "running",
      output: "",
    });
    expect(waited).toBe(false);
    expect(spawnedRequest).toMatchObject({ background: true });
  });

  it("waits by default when spawn_agent is foregrounded", async () => {
    const { ctx } = makeToolContext();
    ctx.runManager = {
      spawn: () => ({ runId: "run-fg" }),
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;

    const result = await dispatchTool(
      "spawn_agent",
      { provider: "codex", prompt: "finish first" },
      ctx,
    );
    expect(JSON.parse(resultText(result))).toEqual({
      run_id: "run-fg",
      status: "completed",
      output: "done",
    });
  });

  it("uses the highest-ranked available selection when provider details are omitted", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    const recorded: unknown[] = [];
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-ranked" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);

    await dispatchTool("spawn_agent", { prompt: "choose for me" }, ctx);

    expect(spawnedRequest).toMatchObject({
      agent: "codex",
      model: "gpt-5.5",
      effort: "high",
      prompt: "choose for me",
    });
    expect(recorded).toEqual([]);
  });

  it("defaults an unspecified dispatch to the parent thread's own entity", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    const recorded: unknown[] = [];
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-parent" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);
    ctx.parentEntity = { agentKind: "claude", model: "sonnet", effort: "high" };

    await dispatchTool("spawn_agent", { prompt: "follow up" }, ctx);

    // Same harness + model + effort as the caller, not ranked-best (codex).
    expect(spawnedRequest).toMatchObject({
      agent: "claude",
      model: "sonnet",
      effort: "high",
      prompt: "follow up",
    });
    // AUTO default: must not reinforce learned affinity.
    expect(recorded).toEqual([]);
  });

  it("falls back to ranked-best when the parent entity is off-roster", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-fallback" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.parentEntity = { agentKind: "muse", model: "nope", effort: "high" };

    await dispatchTool("spawn_agent", { prompt: "choose for me" }, ctx);

    expect(spawnedRequest).toMatchObject({ agent: "codex", model: "gpt-5.5" });
  });

  it("keeps an explicit selection ahead of the parent entity", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-explicit" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.parentEntity = { agentKind: "claude", model: "sonnet", effort: "high" };

    await dispatchTool(
      "spawn_agent",
      { provider: "codex", model: "gpt-5.5", prompt: "do it" },
      ctx,
    );

    expect(spawnedRequest).toMatchObject({ agent: "codex", model: "gpt-5.5" });
  });

  it("records which selection fields were explicit without promoting filled defaults", async () => {
    const { ctx } = makeToolContext();
    const recorded: unknown[] = [];
    ctx.runManager = {
      spawn: () => ({ runId: "run-explicit" }),
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);

    await dispatchTool("spawn_agent", { provider: "claude", prompt: "use Claude" }, ctx);

    expect(recorded).toEqual([
      {
        selection: expect.objectContaining({
          agent: "claude",
          model: "sonnet",
          effort: "high",
        }),
        explicitFields: {
          provider: true,
          model: false,
          effort: false,
          fast: false,
        },
        tags: [],
      },
    ]);
  });

  it("hands back to the native lane by default instead of spawning externally", async () => {
    const { ctx } = makeToolContext();
    let spawned = false;
    ctx.parentAgentKind = "codex";
    ctx.runManager = {
      spawn: () => {
        spawned = true;
        return { runId: "run-never" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "never" }),
    } as unknown as SubagentRunManager;

    const result = await dispatchTool("spawn_agent", { prompt: "help me" }, ctx);

    expect(spawned).toBe(false);
    expect(JSON.parse(resultText(result))).toMatchObject({
      route: "native-harness",
      status: "native",
      harness: "codex",
      native_tool: "spawnAgent collaboration subagents",
    });
  });

  it("lets an explicit provider override the first-ranked native lane", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    const recorded: unknown[] = [];
    ctx.parentAgentKind = "codex";
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-override" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);

    await dispatchTool("spawn_agent", { provider: "claude", prompt: "use Claude" }, ctx);

    expect(spawnedRequest).toMatchObject({ agent: "claude" });
    expect(recorded).toEqual([
      expect.objectContaining({ explicitFields: expect.objectContaining({ provider: true }) }),
    ]);
  });

  it("falls through to external routing when the parent harness has no native lane", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    ctx.parentAgentKind = "antigravity";
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-fallback" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;

    const result = await dispatchTool("spawn_agent", { prompt: "help me" }, ctx);

    expect(spawnedRequest).toMatchObject({ agent: "codex" });
    expect(JSON.parse(resultText(result))).toMatchObject({ run_id: "run-fallback" });
  });

  it("follows a user-reordered route with kimi ahead of the native lane", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    const recorded: unknown[] = [];
    ctx.parentAgentKind = "codex";
    ctx.getRouteOrder = () => ["kimi", "native", "codex"];
    ctx.listSpawnableAgents = async () => [
      {
        provider: { value: "kimi", label: "Kimi" },
        models: [{ value: "k3", label: "K3", reasoning: { values: [] } }],
        reasoningOptions: [],
        defaultModel: "k3",
        permissions: {
          options: [{ value: "full-access", label: "Full access" }],
          default: "full-access",
        },
        execution: "structured",
      },
      {
        provider: { value: "codex", label: "Codex" },
        models: [{ value: "gpt-5.5", label: "GPT-5.5", reasoning: { values: [] } }],
        reasoningOptions: [],
        defaultModel: "gpt-5.5",
        permissions: {
          options: [{ value: "full-access", label: "Full access" }],
          default: "full-access",
        },
        execution: "structured",
      },
    ];
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-kimi" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);

    await dispatchTool("spawn_agent", { prompt: "choose for me" }, ctx);

    expect(spawnedRequest).toMatchObject({ agent: "kimi", model: "k3" });
    // Route-order choices are AUTO: they must not reinforce learned affinity.
    expect(recorded).toEqual([]);
  });

  it("mixes native directives and external runs in one parallel spawn", async () => {
    const { ctx } = makeToolContext();
    ctx.parentAgentKind = "codex";
    ctx.runManager = {
      spawnMany: () => [{ runId: "run-1" }],
      waitForMany: async () => [{ status: "completed" as const, output: "external done" }],
    } as unknown as SubagentRunManager;

    const result = await dispatchTool(
      "spawn_agent",
      {
        tasks: [{ prompt: "native subtask" }, { provider: "claude", prompt: "external subtask" }],
      },
      ctx,
    );

    expect(JSON.parse(resultText(result))).toEqual({
      runs: [
        expect.objectContaining({ route: "native-harness", status: "native" }),
        expect.objectContaining({ run_id: "run-1", status: "completed" }),
      ],
    });
  });

  it("honors an explicit model by choosing the highest-ranked provider that offers it", async () => {    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-model" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;

    await dispatchTool(
      "spawn_agent",
      { model: "sonnet", reasoning: "high", prompt: "use this model" },
      ctx,
    );

    expect(spawnedRequest).toMatchObject({
      agent: "claude",
      model: "sonnet",
      effort: "high",
    });
  });

  it("normalizes task tags for contextual discovery and learned selections", async () => {
    const { ctx } = makeToolContext();
    const rosterTags: string[][] = [];
    const recorded: unknown[] = [];
    const originalList = ctx.listSpawnableAgents;
    ctx.listSpawnableAgents = async (tags) => {
      rosterTags.push([...(tags ?? [])]);
      return originalList();
    };
    ctx.runManager = {
      spawn: () => ({ runId: "run-tags" }),
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;
    ctx.recordExplicitSelections = (selections) => recorded.push(...selections);

    await dispatchTool("list_agents", { tags: ["FE", "User Interface"] }, ctx);
    await dispatchTool(
      "spawn_agent",
      {
        provider: "claude",
        model: "sonnet",
        prompt: "fix the component",
        tags: ["User Interface", "front-end", "FE"],
      },
      ctx,
    );

    expect(rosterTags).toEqual([
      ["frontend", "ui"],
      ["frontend", "ui"],
    ]);
    expect(recorded).toEqual([
      expect.objectContaining({
        tags: ["frontend", "ui"],
      }),
    ]);
  });

  it("searches an implicitly selected provider's models for explicit constraints", async () => {
    const { ctx } = makeToolContext();
    let spawnedRequest: unknown;
    ctx.listSpawnableAgents = async () => [
      {
        provider: { value: "codex", label: "Codex" },
        models: [
          {
            value: "preferred",
            label: "Preferred",
            reasoning: { values: ["high"], default: "high" },
          },
          {
            value: "capable",
            label: "Capable",
            reasoning: { values: ["high", "max"], default: "high" },
            fast: { available: true },
          },
        ],
        reasoningOptions: [
          { value: "high", label: "High" },
          { value: "max", label: "Max" },
        ],
        defaultModel: "preferred",
        permissions: {
          options: [{ value: "full-access", label: "Full access" }],
          default: "full-access",
        },
        execution: "structured",
        preference: {
          rank: 1,
          source: "crossagent-usage",
          usageCount: 3,
          model: "preferred",
          reasoning: "high",
          fast: false,
        },
      },
    ];
    ctx.runManager = {
      spawn: (_parentThreadId: string, request: unknown) => {
        spawnedRequest = request;
        return { runId: "run-capable" };
      },
      waitFor: async () => ({ status: "completed" as const, output: "done" }),
    } as unknown as SubagentRunManager;

    await dispatchTool(
      "spawn_agent",
      { reasoning: "max", fast: true, prompt: "use a capable model" },
      ctx,
    );

    expect(spawnedRequest).toMatchObject({
      agent: "codex",
      model: "capable",
      effort: "max",
      fast: true,
    });
  });

  it("rejects an explicit provider that is not in the live spawnable roster", async () => {
    const { ctx } = makeToolContext();
    const result = await dispatchTool(
      "spawn_agent",
      { provider: "removed", prompt: "do not launch" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("not currently available");
  });

  it("waits for parallel tasks through the same spawn_agent call", async () => {
    const { ctx } = makeToolContext();
    ctx.runManager = {
      spawnMany: () => [{ runId: "run-1" }, { runId: "run-2" }],
      waitForMany: async () => [
        { run_id: "run-1", status: "completed" as const, output: "one" },
        { run_id: "run-2", status: "completed" as const, output: "two" },
      ],
    } as unknown as SubagentRunManager;

    const result = await dispatchTool(
      "spawn_agent",
      {
        tasks: [
          { provider: "codex", prompt: "one" },
          { provider: "claude", prompt: "two" },
        ],
      },
      ctx,
    );
    expect(JSON.parse(resultText(result))).toEqual({
      runs: [
        { run_id: "run-1", status: "completed", output: "one" },
        { run_id: "run-2", status: "completed", output: "two" },
      ],
    });
  });
});

describe("own-subagents route walk", () => {
  const roster = new Set(["codex", "kimi"]);

  it("defaults to the native lane first", () => {
    expect(
      resolveOwnSubagentRoute({ rosterProviders: roster, routeOrder: [], parentAgentKind: "codex" }),
    ).toEqual({
      kind: "native-harness",
      harness: "codex",
      nativeTool: "spawnAgent collaboration subagents",
    });
  });

  it("yields nothing (no blind first-roster pick) for harnesses without a native lane", () => {
    // The caller defaults to the parent thread's own entity next; only
    // ranked-best remains after that. Blind first-roster dispatch is what
    // made unspecified spawns look random.
    expect(
      resolveOwnSubagentRoute({
        rosterProviders: roster,
        routeOrder: [],
        parentAgentKind: "antigravity",
      }),
    ).toBeUndefined();
  });

  it("yields nothing when the parent harness is unknown", () => {
    expect(
      resolveOwnSubagentRoute({ rosterProviders: roster, routeOrder: [] }),
    ).toBeUndefined();
  });

  it("honors a user order with an external provider ahead of native", () => {
    expect(
      resolveOwnSubagentRoute({
        rosterProviders: roster,
        routeOrder: ["kimi", "native", "codex"],
        parentAgentKind: "codex",
      }),
    ).toEqual({ kind: "external", provider: "kimi" });
  });

  it("falls past unavailable providers to undefined (caller decides next)", () => {
    expect(
      resolveOwnSubagentRoute({
        rosterProviders: roster,
        routeOrder: ["removed", "native"],
        parentAgentKind: "antigravity",
      }),
    ).toBeUndefined();
  });

  it("returns undefined when nothing resolves", () => {
    expect(
      resolveOwnSubagentRoute({
        rosterProviders: new Set<string>(),
        routeOrder: ["native"],
        parentAgentKind: "antigravity",
      }),
    ).toBeUndefined();
  });

  it("maps native subagent tools per harness and nothing for unsupported ones", () => {
    expect(nativeSubagentToolFor("codex")).toContain("spawnAgent");
    expect(nativeSubagentToolFor("KIMI")).toContain("task");
    expect(nativeSubagentToolFor("antigravity")).toBeUndefined();
    expect(nativeSubagentToolFor(undefined)).toBeUndefined();
  });

  it("builds a native directive result without a run", () => {
    const directive = nativeHarnessDirective("kimi", "Agent (task) tool");
    expect(JSON.parse(directive.content[0]!.text)).toMatchObject({
      route: "native-harness",
      status: "native",
      harness: "kimi",
    });
    expect(directive.isError).not.toBe(true);
  });
});
