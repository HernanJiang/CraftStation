import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolateRuntimeMcpEnvironment } from "../testSupport/runtimeEnvironment";
import type { SessionRuntime } from "../sessionTypes";
import { StructuredInterruptWatchdog } from "./structuredInterruptWatchdog";
import type { SessionRef, ThreadConfig } from "@/shared/contracts";
import type { StructuredSessionHandle } from "@/supervisor/agents/base";
import {
  applyAgentSettingsMcpFlags,
  composeResolvedMcpServers,
  effectiveLaunchConfig,
  isStaleSessionRefError,
  openStructuredThreadWithRefFallback,
  resolveSupportedPresentationMode,
  SpawnPipeline,
  usesProviderSessionCrossagentRouting,
  workspaceLaunchConfig,
} from "./spawnPipeline";
import {
  CROSSAGENTS_PEER_MCP_TOKEN_ENV,
  CROSSAGENTS_PEER_MCP_URL_ENV,
} from "@/supervisor/agents/crossagentsPeerMcp";

beforeEach(isolateRuntimeMcpEnvironment);
afterEach(() => vi.unstubAllEnvs());

describe("resolveSupportedPresentationMode", () => {
  it("moves a legacy terminal thread to GUI when the provider is now GUI-only", () => {
    expect(
      resolveSupportedPresentationMode(
        {
          capabilities: {
            presentationMode: "gui",
            presentationModes: ["gui"],
          },
        },
        "terminal",
      ),
    ).toBe("gui");
  });

  it("preserves an explicit terminal surface for providers that still support both", () => {
    expect(
      resolveSupportedPresentationMode(
        {
          capabilities: {
            presentationMode: "gui",
            presentationModes: ["gui", "terminal"],
          },
        },
        "terminal",
      ),
    ).toBe("terminal");
  });
});

const baseConfig: ThreadConfig = {
  model: "test-model",
  browserMcp: true,
  crossagentMcp: true,
  computerUse: true,
  chromeMcp: true,
};

describe("effectiveLaunchConfig — single gate for built-in MCP disables", () => {
  it("returns the config unchanged when nothing is disabled", () => {
    expect(effectiveLaunchConfig(baseConfig, [])).toBe(baseConfig);
  });

  it("clears only the flags whose built-in server is disabled", () => {
    const result = effectiveLaunchConfig(baseConfig, ["browser", "computer-use"]);
    expect(result).toEqual({
      ...baseConfig,
      browserMcp: false,
      computerUse: false,
    });
  });

  it("clears every flag-mapped server when all are disabled", () => {
    const result = effectiveLaunchConfig(baseConfig, [
      "browser",
      "crossagents",
      "computer-use",
      "chrome",
      "app-controls",
    ]);
    expect(result).toEqual({
      ...baseConfig,
      browserMcp: false,
      crossagentMcp: false,
      crossagentsMcp: false,
      computerUse: false,
      chromeMcp: false,
    });
  });

  it("maps a legacy crossagents hard-disable onto both new servers", () => {
    const result = effectiveLaunchConfig({ ...baseConfig, crossagentsMcp: true }, ["crossagents"]);
    expect(result.crossagentMcp).toBe(false);
    expect(result.crossagentsMcp).toBe(false);
  });

  it("lets the new own-subagents id gate only the ephemeral channel", () => {
    const result = effectiveLaunchConfig({ ...baseConfig, crossagentsMcp: true }, [
      "own-subagents",
    ]);
    expect(result.crossagentMcp).toBe(false);
    expect(result.crossagentsMcp).toBe(true);
  });

  it("does not mutate the original config", () => {
    effectiveLaunchConfig(baseConfig, ["browser"]);
    expect(baseConfig.browserMcp).toBe(true);
  });

  it("enables MCPs bundled by installed plugins while global disables still win", () => {
    const config = {
      ...baseConfig,
      browserMcp: false,
      crossagentMcp: false,
      computerUse: false,
      chromeMcp: false,
    };

    expect(
      effectiveLaunchConfig(
        config,
        ["chrome"],
        ["browser", "crossagents", "computer-use", "chrome"],
      ),
    ).toEqual({
      ...config,
      browserMcp: true,
      crossagentMcp: true,
      computerUse: true,
      chromeMcp: false,
    });
  });
});

describe("workspaceLaunchConfig — Home permissions", () => {
  const adapter = {
    capabilities: {
      approvalPolicies: [
        { id: "default", label: "Default" },
        { id: "bypassPermissions", label: "Bypass" },
      ],
      sandboxModes: [
        { id: "workspace-write", label: "Workspace" },
        { id: "danger-full-access", label: "Full" },
      ],
      bypassPermissions: { approvalPolicy: "bypassPermissions", sandboxMode: "danger-full-access" },
    },
  };

  it("leaves a repo workspace config unchanged", () => {
    const config = { ...baseConfig, approvalPolicy: "default", sandboxMode: "workspace-write" };
    expect(
      workspaceLaunchConfig({ kind: "windows", path: "C:\\repo" }, config, adapter, []),
    ).toEqual(config);
  });

  it("preserves explicit permissions in Home", () => {
    const config = { ...baseConfig, approvalPolicy: "default", sandboxMode: "workspace-write" };
    expect(
      workspaceLaunchConfig({ kind: "windows", path: "C:\\Users\\me" }, config, adapter, []),
    ).toEqual(config);
  });

  it("keeps legacy unrestricted Home launches without a permission choice", () => {
    const config = { ...baseConfig };
    expect(
      workspaceLaunchConfig({ kind: "windows", path: "C:\\Users\\me" }, config, adapter, []),
    ).toEqual({
      ...config,
      approvalPolicy: "bypassPermissions",
      sandboxMode: "danger-full-access",
    });
  });
});

describe("applyAgentSettingsMcpFlags", () => {
  it("maps agentSettings booleans and keeps Crossagents off without provider-session routing", () => {
    const result = applyAgentSettingsMcpFlags(baseConfig, { browserMcp: true }, [], false);
    expect(result).toEqual({
      ...baseConfig,
      browserMcp: true,
      chromeMcp: false,
      computerUse: false,
      crossagentMcp: false,
    });
  });

  it("enables provider-level Crossagents when trusted provider-session routing is available", () => {
    const result = applyAgentSettingsMcpFlags(baseConfig, { crossagentMcp: true }, [], true);
    expect(result.crossagentMcp).toBe(true);
  });

  it("keeps globally disabled servers off when provider settings enable them", () => {
    const result = applyAgentSettingsMcpFlags(
      baseConfig,
      { browserMcp: true, crossagentMcp: true, chromeMcp: true, computerUse: true },
      ["browser", "crossagents", "chrome", "computer-use"],
      true,
    );
    expect(result).toEqual({
      ...baseConfig,
      browserMcp: false,
      chromeMcp: false,
      computerUse: false,
      crossagentMcp: false,
      crossagentsMcp: false,
    });
  });
});

describe("usesProviderSessionCrossagentRouting", () => {
  const adapter = {
    capabilities: {
      presentationMode: "terminal",
      crossagentMcpRouting: "provider-session",
    },
  } as const;

  it("uses provider-session routing for a GUI thread", () => {
    expect(usesProviderSessionCrossagentRouting(adapter, "gui", "thread-1")).toBe(true);
  });

  it("keeps terminal threads on direct routing", () => {
    expect(usesProviderSessionCrossagentRouting(adapter, "terminal", "thread-1")).toBe(false);
    expect(usesProviderSessionCrossagentRouting(adapter, undefined, "thread-1")).toBe(false);
  });

  it("requires a thread id and provider support", () => {
    expect(usesProviderSessionCrossagentRouting(adapter, "gui", undefined)).toBe(false);
    expect(
      usesProviderSessionCrossagentRouting(
        { capabilities: { presentationMode: "gui" } },
        "gui",
        "thread-1",
      ),
    ).toBe(false);
  });
});

describe("composeResolvedMcpServers", () => {
  it("combines custom and built-in servers before the provider boundary", () => {
    const servers = composeResolvedMcpServers(
      {
        mcpServers: [
          {
            id: "custom",
            name: "custom",
            description: "",
            enabled: true,
            timeoutMs: 15_000,
            transport: { type: "stdio", command: "custom", args: [], env: {} },
          },
        ],
        disabledBuiltInMcpServerIds: [],
      },
      { url: "http://browser/mcp", token: "b", headers: { Authorization: "Bearer b" } },
      { url: "http://agents/mcp", token: "a", headers: { Authorization: "Bearer a" } },
      undefined,
      undefined,
      undefined,
    );

    expect(servers.map((server) => server.name)).toEqual(["custom", "browser", "own_subagents"]);
    expect(servers[2]).toMatchObject({ timeoutMs: 300_000, approvalMode: "approve" });
  });

  it("advertises the persistent peer channel under the crossagents name", () => {
    const servers = composeResolvedMcpServers(
      {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { url: "http://peers/mcp", token: "p", headers: { Authorization: "Bearer p" } },
    );

    expect(servers.map((server) => server.name)).toEqual(["crossagents"]);
    expect(servers[0]).toMatchObject({
      id: "crossagents",
      timeoutMs: 120_000,
      approvalMode: "approve",
    });
  });

  it("omits either channel independently", () => {
    const servers = composeResolvedMcpServers(
      {
        mcpServers: [],
        disabledBuiltInMcpServerIds: [],
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(servers).toEqual([]);
  });
});

describe("resolveMcpServersForLaunch", () => {
  it("keeps the caller identity on app-controls for provider-level GUI MCP", async () => {
    const previousUrl = process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL;
    const previousToken = process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN;
    process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL = "http://127.0.0.1:43123";
    process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN = "test-token";
    try {
      const pipeline = new SpawnPipeline({
        options: { wslHostAccess: undefined, wslBridge: undefined } as never,
        resolveAgentSettings: () => ({ crossagentMcp: true }),
      } as never);
      const servers = await pipeline.resolveMcpServersForLaunch({
        location: { kind: "windows", path: "C:\\repo" },
        config: { model: "test-model" },
        mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
        identity: { threadId: "executor-thread", title: "Executor" },
        adapter: {
          capabilities: {
            presentationMode: "gui",
            mcpScope: { terminal: "none", gui: "always" },
            mcpConfigSource: "agentSettings",
            crossagentMcpRouting: "provider-session",
            supportedMcpTransports: ["http"],
            supportsMcpHttpHeaders: true,
          },
        } as never,
        presentationMode: "gui",
      });

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: "craftstation",
        transport: {
          url: "http://127.0.0.1:43123/mcp?thread=executor-thread&title=Executor",
        },
      });
    } finally {
      if (previousUrl === undefined) delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL;
      else process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL = previousUrl;
      if (previousToken === undefined) delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN;
      else process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN = previousToken;
    }
  });

  it("keeps the caller identity on Schedule for provider-level GUI MCP", async () => {
    const previousUrl = process.env.CRAFTSTATION_SCHEDULE_MCP_URL;
    const previousToken = process.env.CRAFTSTATION_SCHEDULE_MCP_TOKEN;
    const previousAppUrl = process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL;
    const previousAppToken = process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN;
    process.env.CRAFTSTATION_SCHEDULE_MCP_URL = "http://127.0.0.1:43124";
    process.env.CRAFTSTATION_SCHEDULE_MCP_TOKEN = "sched-token";
    delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL;
    delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN;
    try {
      const pipeline = new SpawnPipeline({
        options: { wslHostAccess: undefined, wslBridge: undefined } as never,
        resolveAgentSettings: () => ({ crossagentMcp: true }),
      } as never);
      const servers = await pipeline.resolveMcpServersForLaunch({
        location: { kind: "windows", path: "C:\\repo" },
        config: { model: "test-model" },
        mcpLaunchSnapshot: {
          mcpServers: [],
          disabledBuiltInMcpServerIds: ["app-controls"],
        },
        identity: { threadId: "executor-thread", title: "Executor" },
        adapter: {
          capabilities: {
            presentationMode: "gui",
            mcpScope: { terminal: "none", gui: "always" },
            mcpConfigSource: "agentSettings",
            crossagentMcpRouting: "provider-session",
            supportedMcpTransports: ["http"],
            supportsMcpHttpHeaders: true,
          },
        } as never,
        presentationMode: "gui",
      });

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: "Schedule",
        transport: {
          url: "http://127.0.0.1:43124/mcp?thread=executor-thread&title=Executor",
        },
      });
    } finally {
      if (previousUrl === undefined) delete process.env.CRAFTSTATION_SCHEDULE_MCP_URL;
      else process.env.CRAFTSTATION_SCHEDULE_MCP_URL = previousUrl;
      if (previousToken === undefined) delete process.env.CRAFTSTATION_SCHEDULE_MCP_TOKEN;
      else process.env.CRAFTSTATION_SCHEDULE_MCP_TOKEN = previousToken;
      if (previousAppUrl === undefined) delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL;
      else process.env.CRAFTSTATION_APP_CONTROLS_MCP_URL = previousAppUrl;
      if (previousAppToken === undefined) delete process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN;
      else process.env.CRAFTSTATION_APP_CONTROLS_MCP_TOKEN = previousAppToken;
    }
  });
});

describe("own-subagents / crossagents toggle matrix", () => {
  const PEER_URL = "http://127.0.0.1:18792";
  const PEER_TOKEN = "peer-matrix-token";

  function makePipeline(
    hooks: {
      register?: () => { url: string; token: string; headers: Record<string, string> };
    } = {},
  ) {
    return new SpawnPipeline({
      options: {
        ...(hooks.register
          ? {
              ownSubagentsMcp: {
                register: hooks.register,
                registerProviderSession: hooks.register,
                unregister: vi.fn<() => void>(),
                cancelForeground: vi.fn<() => void>(),
                cancelAll: vi.fn<() => void>(),
                resolveChildRequest: () => false,
              },
            }
          : {}),
      },
    } as never);
  }

  function snapshot(disabled: string[] = []) {
    return {
      mcpServers: [],
      disabledBuiltInMcpServerIds: disabled,
      disabledBuiltInMcpTools: {},
    } as never;
  }

  afterEach(() => {
    delete process.env[CROSSAGENTS_PEER_MCP_URL_ENV];
    delete process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV];
  });

  it("injects both servers when both are on", async () => {
    process.env[CROSSAGENTS_PEER_MCP_URL_ENV] = PEER_URL;
    process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV] = PEER_TOKEN;
    const pipeline = makePipeline({
      register: () => ({ url: "http://127.0.0.1:1/mcp", token: "t", headers: {} }),
    });
    const location = { kind: "windows", path: "C:\\repo" } as const;

    const own = await pipeline.resolveOwnSubagentsMcpForLaunch(
      "t1",
      location,
      { model: "m", crossagentMcp: true },
      snapshot(),
    );
    const peer = await pipeline.resolveCrossagentsPeerMcpForLaunch(
      "t1",
      location,
      { model: "m" },
      snapshot(),
    );

    expect(own?.url).toContain("http://127.0.0.1:1/mcp");
    expect(peer?.url).toBe(`${PEER_URL}/mcp?thread=t1`);
    expect(peer?.headers).toEqual({ Authorization: `Bearer ${PEER_TOKEN}` });
  });

  it("omits own-subagents when its flag is off but keeps the peer channel", async () => {
    process.env[CROSSAGENTS_PEER_MCP_URL_ENV] = PEER_URL;
    process.env[CROSSAGENTS_PEER_MCP_TOKEN_ENV] = PEER_TOKEN;
    const pipeline = makePipeline();
    const location = { kind: "windows", path: "C:\\repo" } as const;

    const own = await pipeline.resolveOwnSubagentsMcpForLaunch(
      "t1",
      location,
      { model: "m" },
      snapshot(),
    );
    const peer = await pipeline.resolveCrossagentsPeerMcpForLaunch(
      "t1",
      location,
      { model: "m" },
      snapshot(),
    );

    expect(own).toBeUndefined();
    expect(peer?.url).toBe(`${PEER_URL}/mcp?thread=t1`);
  });

  it("omits the peer channel on explicit opt-out but keeps own-subagents", async () => {
    const pipeline = makePipeline({
      register: () => ({ url: "http://127.0.0.1:1/mcp", token: "t", headers: {} }),
    });
    const location = { kind: "windows", path: "C:\\repo" } as const;

    const peer = await pipeline.resolveCrossagentsPeerMcpForLaunch(
      "t1",
      location,
      { model: "m", crossagentsMcp: false },
      snapshot(),
    );
    const own = await pipeline.resolveOwnSubagentsMcpForLaunch(
      "t1",
      location,
      { model: "m", crossagentMcp: true },
      snapshot(),
    );

    expect(peer).toBeUndefined();
    expect(own?.url).toContain("http://127.0.0.1:1/mcp");
  });

  it("omits both channels when the legacy crossagents id is hard-disabled", async () => {
    const pipeline = makePipeline({
      register: () => ({ url: "http://127.0.0.1:1/mcp", token: "t", headers: {} }),
    });
    const location = { kind: "windows", path: "C:\\repo" } as const;
    const config = effectiveLaunchConfig(
      { model: "m", crossagentMcp: true, crossagentsMcp: true },
      ["crossagents"],
    );

    const own = await pipeline.resolveOwnSubagentsMcpForLaunch(
      "t1",
      location,
      config,
      snapshot(["crossagents"]),
    );
    const peer = await pipeline.resolveCrossagentsPeerMcpForLaunch(
      "t1",
      location,
      config,
      snapshot(["crossagents"]),
    );

    expect(own).toBeUndefined();
    expect(peer).toBeUndefined();
  });
});

describe("isStaleSessionRefError", () => {
  it("matches lost-session shapes", () => {
    expect(isStaleSessionRefError(new Error("Path not found."))).toBe(true);
    expect(
      isStaleSessionRefError(
        new Error(
          "This conversation can't be resumed: Path not found. Start a new thread to continue.",
        ),
      ),
    ).toBe(true);
    expect(isStaleSessionRefError(new Error("session not found"))).toBe(true);
    expect(isStaleSessionRefError(new Error("unknown session abc"))).toBe(true);
    expect(isStaleSessionRefError(new Error("invalid conversation id"))).toBe(true);
    expect(isStaleSessionRefError(new Error("no rollout found for thread id 01a0761e-1234"))).toBe(
      true,
    );
  });

  it("rejects auth, model, and transport failures", () => {
    expect(isStaleSessionRefError(new Error("401 invalid access token"))).toBe(false);
    expect(isStaleSessionRefError(new Error("unknown provider for model"))).toBe(false);
    expect(isStaleSessionRefError(new Error("model_not_found"))).toBe(false);
    expect(isStaleSessionRefError(new Error("transport closed"))).toBe(false);
    expect(isStaleSessionRefError(undefined)).toBe(false);
  });
});

describe("openStructuredThreadWithRefFallback", () => {
  const config = { model: "m" } as ThreadConfig;
  const ref: SessionRef = {
    providerSessionId: "ses-old",
    discoveredAt: "2026-09-06T00:00:00.000Z",
  };

  function handle(openThread: (config: ThreadConfig, ref?: SessionRef) => unknown) {
    return {
      openThread: vi.fn<typeof openThread>(openThread),
    } as unknown as StructuredSessionHandle;
  }

  it("resumes with the ref when healthy", async () => {
    const openThread = vi.fn<() => Promise<string>>(async () => "ses-old");
    const result = await openStructuredThreadWithRefFallback(handle(openThread), config, ref, "t1");

    expect(result).toEqual({ threadId: "ses-old", fresh: false });
    expect(openThread).toHaveBeenCalledTimes(1);
    expect(openThread).toHaveBeenCalledWith(config, ref);
  });

  it("opens fresh without a ref", async () => {
    const openThread = vi.fn<() => Promise<string>>(async () => "ses-new");
    const result = await openStructuredThreadWithRefFallback(
      handle(openThread),
      config,
      undefined,
      "t1",
    );

    expect(result).toEqual({ threadId: "ses-new", fresh: true });
    expect(openThread).toHaveBeenCalledWith(config, undefined);
  });

  it("retries fresh when the ref is stale", async () => {
    const openThread = vi.fn<(c: ThreadConfig, r?: SessionRef) => Promise<string>>(async (c, r) => {
      void c;
      if (r) throw new Error("Path not found.");
      return "ses-new";
    });
    const result = await openStructuredThreadWithRefFallback(handle(openThread), config, ref, "t1");

    expect(result).toEqual({ threadId: "ses-new", fresh: true });
    expect(openThread).toHaveBeenCalledTimes(2);
    expect(openThread).toHaveBeenNthCalledWith(2, config, undefined);
  });

  it("rethrows non-stale failures without retrying", async () => {
    const openThread = vi.fn<() => Promise<string>>(async () => {
      throw new Error("401 invalid access token");
    });
    await expect(
      openStructuredThreadWithRefFallback(handle(openThread), config, ref, "t1"),
    ).rejects.toThrow("401 invalid access token");
    expect(openThread).toHaveBeenCalledTimes(1);
  });
});

describe("switchThreadProvider transactional lifecycle", () => {
  function makeHandle(options: { failOpen?: boolean; failActivate?: boolean } = {}) {
    const handle = {
      activated: false,
      disposed: false,
      launchOptions: {},
      activate: vi.fn<() => Promise<void>>(async () => {
        if (options.failActivate) throw new Error("activate failed");
        handle.activated = true;
      }),
      openThread: vi.fn<() => Promise<string>>(async () => {
        if (!handle.activated || handle.disposed) {
          throw new Error("OpencodeSdkSession is not active.");
        }
        if (options.failOpen) throw new Error("open failed");
        return "ses_new";
      }),
      startTurn: vi.fn<() => Promise<void>>(async () => undefined),
      dispose: vi.fn<() => Promise<void>>(async () => {
        handle.disposed = true;
      }),
      setListener: vi.fn<() => void>(),
    };
    return handle;
  }

  function makePipeline(handle: ReturnType<typeof makeHandle>) {
    const replayStructuredTurn = vi.fn<(session: SessionRuntime, turn: unknown) => void>();
    const oldDispose = vi.fn<() => Promise<void>>(async () => undefined);
    const oldSession = {
      threadId: "t1",
      agentKind: "grok",
      adapter: { capabilities: { presentationMode: "gui", presentationModes: ["gui"] } },
      projectLocation: { kind: "windows", path: "C:\\repo" },
      config: { model: "grok-4.6" },
      mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
      terminalSize: { cols: 80, rows: 24 },
      structuredSession: { dispose: oldDispose, setListener: vi.fn<() => void>() },
      presentationMode: "gui" as const,
      ignoreExit: false,
    };
    const sessions = new Map<string, typeof oldSession>([["t1", oldSession]]);
    const attach = vi.fn<(session: { threadId: string }) => void>((session) => {
      sessions.set(session.threadId, session as typeof oldSession);
    });
    const adapter = {
      capabilities: {
        presentationMode: "gui" as const,
        presentationModes: ["gui"],
        mcpScope: "none" as const,
      },
      createStructuredSession: vi.fn<() => Promise<typeof handle>>(async () => handle),
    };
    const resolveAccountSessionEnv = vi.fn<
      () => Promise<{ accountId: string; reason: string; env: Record<string, string> } | undefined>
    >(async () => undefined);
    const pipeline = new SpawnPipeline({
      options: {
        adapters: new Map([["opencode", adapter]]),
        emit: () => undefined,
        readDisableCliHookPlugin: () => false,
        resolveWindowsShell: () => ({ shell: "powershell.exe", kind: "powershell", args: [] }),
        resolveAccountSessionEnv,
      },
      sessions,
      isCurrentSession: (session: { threadId: string }) =>
        sessions.get(session.threadId) === session,
      resolveAgentSettings: () => ({}),
      outputPipeline: {
        clearSessionTimers: vi.fn<() => void>(),
        emitState: vi.fn<() => void>(),
      },
      runtimeEventRouter: { clearAllForThread: vi.fn<() => void>() },
      ptyLifecycle: { kill: vi.fn<() => void>() },
      sessionRuntimeLifecycle: { attach },
      pendingStartInterrupts: new Set(),
      pendingStartAborts: new Set(),
      replayStructuredTurn,
    } as never);
    return {
      pipeline,
      oldSession,
      oldDispose,
      attach,
      sessions,
      adapter,
      resolveAccountSessionEnv,
      replayStructuredTurn,
    };
  }

  it.each(["dispose", "create", "activate", "open"] as const)(
    "abandons restart and disposes its replacement when Stop occurs during %s",
    async (stage) => {
      const handle = makeHandle();
      const h = makePipeline(handle);
      const session = Object.assign(h.oldSession, {
        instanceId: "old-instance",
        agentKind: "opencode",
        adapter: h.adapter,
        status: "working",
        sessionRef: { providerSessionId: "old", discoveredAt: "now" },
      }) as unknown as SessionRuntime;
      const gate = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const wait = async () => {
        entered.resolve();
        await gate.promise;
      };
      if (stage === "dispose") h.oldDispose.mockImplementationOnce(wait);
      if (stage === "create")
        h.adapter.createStructuredSession.mockImplementationOnce(async () => {
          await wait();
          return handle;
        });
      if (stage === "activate")
        handle.activate.mockImplementationOnce(async () => {
          await wait();
          handle.activated = true;
        });
      if (stage === "open")
        handle.openThread.mockImplementationOnce(async () => {
          await wait();
          return "new";
        });
      const restarting = h.pipeline.restartThread(session, {
        prompt: "replay",
        config: session.config,
      });
      await entered.promise;
      const completeForcedInterrupt = vi.fn<(value: SessionRuntime) => void>((value) => {
        value.status = "idle";
      });
      const watchdog = new StructuredInterruptWatchdog({
        sessions: h.sessions as unknown as Map<string, SessionRuntime>,
        isDisposed: () => false,
        completeForcedInterrupt,
      });
      await watchdog.interruptStructuredTurn(session);
      gate.resolve();
      await restarting;
      expect(h.attach).not.toHaveBeenCalled();
      expect(h.replayStructuredTurn).not.toHaveBeenCalled();
      expect(completeForcedInterrupt).toHaveBeenCalledOnce();
      expect(session.structuredSession).toBeUndefined();
      expect(handle.dispose).toHaveBeenCalledTimes(stage === "dispose" ? 0 : 1);
      // 与 sendThreadInput 的恢复条件相同：取消后下一条输入必须能重建并进入统一队列。
      expect(session.status).toBe("idle");
      const replacement = makeHandle();
      h.adapter.createStructuredSession.mockResolvedValueOnce(replacement);
      await h.pipeline.restartThread(session, { prompt: "next input", config: session.config });
      expect(h.attach).toHaveBeenCalledOnce();
      expect(h.replayStructuredTurn).toHaveBeenCalledWith(
        expect.objectContaining({ structuredSession: replacement }),
        expect.objectContaining({ prompt: "next input" }),
      );
    },
  );

  it("activates the new OpenCode session before openThread", async () => {
    const handle = makeHandle();
    const { pipeline, oldSession, adapter } = makePipeline(handle);

    await pipeline.switchThreadProvider(oldSession as never, "opencode", adapter as never, {
      model: "opencode-go/muse-spark-1.3-contributor",
    });

    expect(handle.activate.mock.invocationCallOrder[0]!).toBeLessThan(
      handle.openThread.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps the original session when the new runtime fails to activate", async () => {
    const handle = makeHandle({ failActivate: true });
    const { pipeline, oldSession, oldDispose, sessions, adapter } = makePipeline(handle);

    await expect(
      pipeline.switchThreadProvider(oldSession as never, "opencode", adapter as never, {
        model: "opencode-go/muse-spark-1.3-contributor",
      }),
    ).rejects.toThrow("activate failed");

    expect(oldDispose).not.toHaveBeenCalled();
    expect(handle.disposed).toBe(true);
    expect(sessions.get("t1")).toBe(oldSession);
    expect(oldSession.ignoreExit).toBe(false);
  });

  it("does not throw OpencodeSdkSession is not active because openThread runs after activate", async () => {
    const handle = makeHandle();
    const { pipeline, oldSession, adapter } = makePipeline(handle);
    await expect(
      pipeline.switchThreadProvider(oldSession as never, "opencode", adapter as never, {
        model: "muse",
      }),
    ).resolves.toMatchObject({ sessionRef: { providerSessionId: "ses_new" } });
  });

  it("disposes the old session only after the new runtime is committed", async () => {
    const handle = makeHandle();
    const { pipeline, oldSession, oldDispose, attach, adapter } = makePipeline(handle);

    await pipeline.switchThreadProvider(oldSession as never, "opencode", adapter as never, {
      model: "muse",
    });

    expect(attach).toHaveBeenCalled();
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(oldDispose.mock.invocationCallOrder[0]!).toBeGreaterThan(
      attach.mock.invocationCallOrder[0]!,
    );
    expect(handle.disposed).toBe(false);
  });

  it("carries the third-party account binding across a provider switch", async () => {
    const handle = makeHandle();
    const { pipeline, oldSession, adapter, resolveAccountSessionEnv } = makePipeline(handle);

    await pipeline.switchThreadProvider(
      oldSession as never,
      "opencode",
      adapter as never,
      { model: "glm-5.3-flash" },
      { thirdPartyAccountId: "acc-9" },
    );

    expect(resolveAccountSessionEnv).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "opencode", thirdPartyAccountId: "acc-9" }),
    );
  });

  it("does not reuse the source native session ref across harnesses", async () => {
    const handle = makeHandle();
    const { pipeline, oldSession, adapter } = makePipeline(handle);
    (oldSession as { sessionRef?: SessionRef }).sessionRef = {
      providerSessionId: "grok-old",
      discoveredAt: new Date(0).toISOString(),
    };

    const result = await pipeline.switchThreadProvider(
      oldSession as never,
      "opencode",
      adapter as never,
      { model: "muse" },
    );

    expect(result.sessionRef?.providerSessionId).toBe("ses_new");
    expect(result.sessionRef?.providerSessionId).not.toBe("grok-old");
  });
});
