import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKind } from "@/shared/contracts";
import type { SessionRuntime } from "./sessionTypes";
import { ThreadSessionManager } from "./threadSessionManager";

vi.mock("node-pty", () => ({
  spawn: vi.fn<
    () => {
      pid: number;
      kill: () => void;
      onData: () => void;
      onExit: () => void;
      write: () => void;
    }
  >(() => ({
    pid: 123,
    kill: vi.fn<() => void>(),
    onData: vi.fn<() => void>(),
    onExit: vi.fn<() => void>(),
    write: vi.fn<() => void>(),
  })),
}));

const tempDirs: string[] = [];
const managersToDispose: ThreadSessionManager[] = [];

afterEach(async () => {
  await Promise.allSettled(managersToDispose.splice(0).map((manager) => manager.dispose()));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function channelQuotaError(): Error {
  return Object.assign(new Error("request failed"), {
    data: { http_status: 402, message: "insufficient_quota: you ran out of credits" },
  });
}

function channelWireError(): Error {
  return Object.assign(new Error("request failed"), {
    data: {
      http_status: 400,
      message: "400 A parameter specified in the request is not valid",
    },
  });
}

interface ChannelHarness {
  manager: ThreadSessionManager;
  emitted: unknown[];
  /** Channels whose handles reject startTurn with the relay 402 shape. */
  deadChannels: Set<string>;
  /** Channels whose handles reject with a non-rotatable 401. */
  authDeadChannels: Set<string>;
  handlesByAccount: Map<string, { startTurn: ReturnType<typeof vi.fn> }>;
  /** Every created handle in order (flips create two handles per channel). */
  createdHandles: Array<{ accountId: string | undefined; startTurn: ReturnType<typeof vi.fn> }>;
  resolveEnvCalls: Array<{
    provider: string;
    thirdPartyAccountId: string | undefined;
    thirdPartyProtocol: string | undefined;
  }>;
  resolveNextCalls: Array<{
    model: string | undefined;
    excludedAccountIds: readonly string[] | undefined;
  }>;
  nextChannel: string | undefined;
  nextThrows: boolean;
  adapter: Record<string, unknown>;
  /** Account id from the most recent resolveAccountSessionEnv call. */
  lastEnvAccount: string | undefined;
  /** Verified wire type per channel (flip source of truth). */
  channelProtocols: Map<string, "responses" | "chat_completions">;
  /** Channels whose handles always reject with a 400 wire-type failure. */
  wireDeadChannels: Set<string>;
}

function createHarness(): ChannelHarness {
  const tempDir = mkdtempSync(join(tmpdir(), "craftstation-channel-failover-"));
  tempDirs.push(tempDir);
  writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ locale: "en" }));
  const emitted: unknown[] = [];
  const h: ChannelHarness = {
    manager: undefined as never,
    emitted,
    deadChannels: new Set(),
    authDeadChannels: new Set(),
    handlesByAccount: new Map(),
    createdHandles: [],
    resolveEnvCalls: [],
    resolveNextCalls: [],
    nextChannel: undefined,
    nextThrows: false,
    adapter: undefined as never,
    lastEnvAccount: undefined,
    channelProtocols: new Map(),
    wireDeadChannels: new Set(),
  };
  const makeHandle = (accountId: string | undefined) => {
    const handle = {
      startTurn: vi.fn<() => Promise<void>>(async () => {
        if (accountId && h.wireDeadChannels.has(accountId)) throw channelWireError();
        if (accountId && h.authDeadChannels.has(accountId)) {
          throw Object.assign(new Error("request failed"), {
            data: { http_status: 401, message: "invalid_api_key" },
          });
        }
        if (accountId && h.deadChannels.has(accountId)) throw channelQuotaError();
      }),
      dispose: vi.fn<() => Promise<void>>(async () => undefined),
      setListener: vi.fn<() => void>(),
    };
    if (accountId) h.handlesByAccount.set(accountId, handle);
    h.createdHandles.push({ accountId, startTurn: handle.startTurn });
    return handle;
  };
  h.adapter = {
    kind: "codex",
    capabilities: {
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
      mcpScope: "none",
    },
    // Mirrors SpawnPipeline.createStructuredSession: the credential source
    // comes from resolveAccountSessionEnv, honoring the failover override.
    createStructuredSession: vi.fn<() => Promise<unknown>>(async () =>
      makeHandle(h.lastEnvAccount),
    ),
  } as never;
  h.manager = new ThreadSessionManager({
    emit: (event: unknown) => {
      emitted.push(event);
    },
    isDev: false,
    logsDir: join(tempDir, "logs"),
    settingsPath: join(tempDir, "settings.json"),
    readDisableCliHookPlugin: () => false,
    readTurnRetryPolicy: () => ({ maxAttempts: 0, intervalMs: 1000 }),
    adapters: new Map(),
    resolveWindowsShell: () => ({ shell: "powershell.exe", kind: "powershell", args: ["-NoLogo"] }),
    resolveAccountSessionEnv: (async (input: {
      provider: string;
      threadId: string;
      thirdPartyAccountId?: string | undefined;
      thirdPartyProtocol?: string | undefined;
    }) => {
      h.resolveEnvCalls.push({
        provider: input.provider,
        thirdPartyAccountId: input.thirdPartyAccountId,
        thirdPartyProtocol: input.thirdPartyProtocol,
      });
      const accountId = input.thirdPartyAccountId ?? "openai-compatible:ambient";
      h.lastEnvAccount = accountId;
      return { accountId, reason: "third-party", env: {} };
    }) as never,
    resolveNextThirdPartyAccount: (async (input: {
      threadId: string;
      model?: string | undefined;
      excludedAccountIds?: readonly string[] | undefined;
    }) => {
      h.resolveNextCalls.push({ model: input.model, excludedAccountIds: input.excludedAccountIds });
      if (h.nextThrows || !h.nextChannel) {
        throw Object.assign(new Error("No usable OpenAI-compatible channel"), {
          code: "ACCOUNT_POOL_EXHAUSTED",
        });
      }
      return { accountId: h.nextChannel, reason: "priority" };
    }) as never,
    getThirdPartyChannelProtocol: ((accountId: string) => h.channelProtocols.get(accountId)) as (
      accountId: string,
    ) => "responses" | "chat_completions" | undefined,
  } as never);
  managersToDispose.push(h.manager);
  return h;
}

function seedChannelSession(
  h: ChannelHarness,
  opts: {
    boundAccountId: string;
    boundFailsQuota: boolean;
    boundFailsAuth?: boolean;
    boundFailsWire?: boolean;
    model?: string;
  },
): SessionRuntime {
  if (opts.boundFailsQuota) h.deadChannels.add(opts.boundAccountId);
  else h.deadChannels.delete(opts.boundAccountId);
  const seedHandle = {
    startTurn: vi.fn<() => Promise<void>>(async () => {
      if (opts.boundFailsWire) throw channelWireError();
      if (opts.boundFailsAuth) {
        throw Object.assign(new Error("request failed"), {
          data: { http_status: 401, message: "invalid_api_key" },
        });
      }
      if (opts.boundFailsQuota) throw channelQuotaError();
    }),
    dispose: vi.fn<() => Promise<void>>(async () => undefined),
    setListener: vi.fn<() => void>(),
  };
  const session = {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "codex",
    adapter: h.adapter,
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: opts.model ?? "gpt-5.6-sol" },
    mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    terminalSize: { cols: 120, rows: 30 },
    launchPrompt: "",
    prevChunk: "",
    lastStrippedPtyChunk: "",
    ptyOscCarry: "",
    poolAccountId: opts.boundAccountId,
    poolProvider: "openai-compatible",
    sessionRef: { providerSessionId: "ses-old", discoveredAt: new Date(0).toISOString() },
    structuredSession: seedHandle,
    presentationMode: "gui",
  } as unknown as SessionRuntime;
  h.manager.sessions.set(session.threadId, session);
  return session;
}

function errorEvents(h: ChannelHarness): unknown[] {
  return h.emitted.filter((event) => {
    const e = event as { type?: string; status?: string };
    return e.type === "thread-state" && e.status === "error";
  });
}

describe("ThreadSessionManager third-party channel failover (ChatGPT-shaped)", () => {
  it("rotates a quota-dead ChatGPT channel onto the next usable one", async () => {
    const h = createHarness();
    h.nextChannel = "openai-compatible:relay-b";
    seedChannelSession(h, { boundAccountId: "openai-compatible:relay-a", boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hello?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    // The real restart pipeline primes a shell + rebuilds the session; allow
    // well beyond the default 1s polling budget.
    await vi.waitFor(
      () => {
        expect(
          h.handlesByAccount.get("openai-compatible:relay-b")?.startTurn,
        ).toHaveBeenCalledTimes(1);
      },
      { timeout: 15000 },
    );

    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe("openai-compatible:relay-b");
    // The restart resolved the override channel, not the sticky dead one.
    expect(h.resolveEnvCalls.at(-1)).toMatchObject({
      thirdPartyAccountId: "openai-compatible:relay-b",
    });
    expect(h.resolveNextCalls[0]).toMatchObject({
      model: "gpt-5.6-sol",
      excludedAccountIds: ["openai-compatible:relay-a"],
    });
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(1);
    expect(errorEvents(h)).toEqual([]);
  });

  it("stays fail-closed on auth denials without touching the catalog", async () => {
    const h = createHarness();
    h.nextChannel = "openai-compatible:relay-b";
    seedChannelSession(h, {
      boundAccountId: "openai-compatible:relay-a",
      boundFailsQuota: false,
      boundFailsAuth: true,
    });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    // The 401 surfaces through the normal failure path (async); no rotation.
    await vi.waitFor(() => {
      expect(errorEvents(h).length).toBeGreaterThan(0);
    });
    expect(h.resolveNextCalls).toHaveLength(0);
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(0);
    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe("openai-compatible:relay-a");
  });

  it("surfaces the channel error when the catalog is empty", async () => {
    const h = createHarness();
    h.nextThrows = true;
    seedChannelSession(h, { boundAccountId: "openai-compatible:relay-a", boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    await vi.waitFor(() => {
      expect(errorEvents(h).length).toBeGreaterThan(0);
    });
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(0);
  });

  it("pre-resolves the next channel when the bound row is already unusable", async () => {
    const h = createHarness();
    h.nextChannel = "openai-compatible:relay-b";
    seedChannelSession(h, { boundAccountId: "openai-compatible:relay-a", boundFailsQuota: false });
    h.manager = Object.assign(h.manager, {
      options: {
        ...(h.manager as unknown as { options: Record<string, unknown> }).options,
        isPoolAccountUsable: () => false,
      },
    });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    await vi.waitFor(() => {
      expect(h.handlesByAccount.get("openai-compatible:relay-b")?.startTurn).toHaveBeenCalledTimes(
        1,
      );
    });

    // Proactive: the dead row is never burned, the turn runs on relay-b.
    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe("openai-compatible:relay-b");
    expect(errorEvents(h)).toEqual([]);
  });

  it("keeps sticky behavior when no channel scheduler is wired", async () => {
    const h = createHarness();
    (
      h.manager as unknown as { options: { resolveNextThirdPartyAccount?: unknown } }
    ).options.resolveNextThirdPartyAccount = undefined;
    (
      h.manager as unknown as { options: { isPoolAccountUsable?: unknown } }
    ).options.isPoolAccountUsable = () => false;
    seedChannelSession(h, { boundAccountId: "openai-compatible:relay-a", boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    await vi.waitFor(() => {
      expect(errorEvents(h).length).toBeGreaterThan(0);
    });
    // No scheduler seam: no proactive restart, no reactive walk — the quota
    // error surfaces and the binding never moves.
    expect(h.resolveEnvCalls).toHaveLength(0);
    expect(h.resolveNextCalls).toHaveLength(0);
    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe("openai-compatible:relay-a");
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(0);
  });

  it("declines agent kinds without any pool for quota-shaped errors", async () => {
    const h = createHarness();
    h.nextChannel = "openai-compatible:relay-b";
    const session = seedChannelSession(h, {
      boundAccountId: "openai-compatible:relay-a",
      boundFailsQuota: true,
    });
    session.agentKind = "claude" as AgentKind;
    (session as { poolProvider?: unknown }).poolProvider = undefined;

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "claude-x" },
    } as never);
    await vi.waitFor(() => {
      expect(errorEvents(h).length).toBeGreaterThan(0);
    });
    expect(h.resolveNextCalls).toHaveLength(0);
  });

  it("flips a 400ing responses channel to chat on the same row", async () => {
    const h = createHarness();
    h.channelProtocols.set("openai-compatible:relay-a", "responses");
    seedChannelSession(h, {
      boundAccountId: "openai-compatible:relay-a",
      boundFailsQuota: false,
      boundFailsWire: true,
    });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    await vi.waitFor(
      () => {
        // One rebuilt handle on the same row (the seed handle is not tracked
        // here); its replayed turn succeeds on the flipped wire type.
        expect(h.createdHandles).toHaveLength(1);
        expect(h.createdHandles[0]!.startTurn).toHaveBeenCalledTimes(1);
      },
      { timeout: 15000 },
    );

    // Same channel twice (no walk), second attempt on the flipped wire type.
    expect(h.createdHandles[0]!.accountId).toBe("openai-compatible:relay-a");
    expect(h.resolveEnvCalls.at(-1)).toMatchObject({
      thirdPartyAccountId: "openai-compatible:relay-a",
      thirdPartyProtocol: "chat_completions",
    });
    expect(h.resolveNextCalls).toHaveLength(0);
    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe("openai-compatible:relay-a");
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(0);
    expect(errorEvents(h)).toEqual([]);
  });

  it("surfaces the second 400 instead of flipping twice", async () => {
    const h = createHarness();
    h.channelProtocols.set("openai-compatible:relay-a", "responses");
    h.wireDeadChannels.add("openai-compatible:relay-a");
    seedChannelSession(h, {
      boundAccountId: "openai-compatible:relay-a",
      boundFailsQuota: false,
      boundFailsWire: true,
    });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hi?",
      config: { model: "gpt-5.6-sol" },
    } as never);
    await vi.waitFor(
      () => {
        expect(errorEvents(h).length).toBeGreaterThan(0);
      },
      { timeout: 15000 },
    );

    // One flip (responses→chat), then the second 400 surfaces honestly.
    expect(h.createdHandles).toHaveLength(1);
    expect(h.resolveEnvCalls.at(-1)).toMatchObject({
      thirdPartyAccountId: "openai-compatible:relay-a",
      thirdPartyProtocol: "chat_completions",
    });
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(0);
  });
});
