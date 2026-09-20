import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isGrokPoolQuotaError } from "../agents/acp/sessionErrors";
import { AccountResolver } from "./accountResolver";
import { AccountStore } from "./accountStore";
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

function quotaError(): Error {
  return Object.assign(new Error("Internal error"), {
    code: -32603,
    data: {
      message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
      http_status: 402,
    },
  });
}

interface PoolSeeds {
  store: AccountStore;
  /** Account ids in production row order: [live0, live1, dead x6]. */
  orderedIds: string[];
  liveIds: string[];
}

/** Mirror the user's production Grok pool: 2 usable rows + 6 exhausted rows. */
function seedProductionPool(): PoolSeeds {
  const root = mkdtempSync(join(tmpdir(), "craftstation-pool-repro-store-"));
  tempDirs.push(root);
  const store = new AccountStore(root);
  const orderedIds: string[] = [];
  const labels = ["live0", "live1", "dead2", "dead3", "dead4", "dead5", "dead6", "dead7"];
  for (const label of labels) {
    orderedIds.push(store.add({ provider: "grok", label }).accountId);
  }
  store.updateStatus(orderedIds[0]!, "available");
  store.updateStatus(orderedIds[1]!, "available");
  for (const id of orderedIds.slice(2)) store.updateStatus(id, "quota-exhausted");
  return { store, orderedIds, liveIds: orderedIds.slice(0, 2) };
}

interface ReproHarness {
  manager: ThreadSessionManager;
  emitted: unknown[];
  /** Accounts whose handles reject startTurn with the Grok 402 quota shape. */
  deadAtRequest: Set<string>;
  /** accountId resolved by the most recent resolveAccountSessionEnv call. */
  lastResolved: { accountId: string } | null;
  handlesByAccount: Map<string, { startTurn: ReturnType<typeof vi.fn> }>;
  adapter: {
    capabilities: Record<string, unknown>;
    createStructuredSession: ReturnType<typeof vi.fn>;
  };
  store: AccountStore;
  orderedIds: string[];
  liveIds: string[];
}

function createHarness(pool: PoolSeeds): ReproHarness {
  const tempDir = mkdtempSync(join(tmpdir(), "craftstation-pool-repro-"));
  tempDirs.push(tempDir);
  writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ locale: "en" }));
  const emitted: unknown[] = [];
  const resolver = new AccountResolver(pool.store, () => true);
  const h: ReproHarness = {
    manager: undefined as never,
    emitted,
    deadAtRequest: new Set(pool.orderedIds.slice(2)),
    lastResolved: null,
    handlesByAccount: new Map(),
    adapter: undefined as never,
    store: pool.store,
    orderedIds: pool.orderedIds,
    liveIds: pool.liveIds,
  };
  const makeHandle = (accountId: string) => {
    // Mirror the real ACP session: a quota rejection also runs the
    // supervisor write-back (onPromptError) before the turn promise rejects,
    // so the pool scheduler skips the dead row on re-resolution.
    const handle = {
      startTurn: vi.fn<() => Promise<void>>(async () => {
        if (h.deadAtRequest.has(accountId)) {
          const failure = quotaError();
          (
            h.manager as unknown as {
              options: { handleAccountPromptError: (input: unknown) => void };
            }
          ).options.handleAccountPromptError({
            provider: "grok",
            accountId,
            error: failure,
          });
          throw failure;
        }
      }),
      dispose: vi.fn<() => Promise<void>>(async () => undefined),
      setListener: vi.fn<() => void>(),
    };
    h.handlesByAccount.set(accountId, handle);
    return handle;
  };
  h.adapter = {
    kind: "grok",
    capabilities: {
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
      mcpScope: "none",
    },
    createStructuredSession: vi.fn<() => Promise<unknown>>(async () =>
      makeHandle(h.lastResolved!.accountId),
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
      excludedAccountIds?: readonly string[];
    }) => {
      const resolution = resolver.resolve({
        provider: "grok",
        mode: "auto",
        ...(input.excludedAccountIds?.length
          ? { excludedAccountIds: [...input.excludedAccountIds] }
          : {}),
      });
      h.lastResolved = { accountId: resolution.account.accountId };
      return { accountId: resolution.account.accountId, reason: resolution.reason, env: {} };
    }) as never,
    isPoolAccountUsable: (provider: string, accountId: string) => {
      const record = pool.store.getRecord(accountId);
      return (
        !!record &&
        record.provider === provider &&
        record.enabled &&
        (record.status === "available" || record.status === "quota-low")
      );
    },
    hasUsablePoolAccount: (provider: string) =>
      pool.store
        .records(provider)
        .some(
          (account) =>
            account.enabled && (account.status === "available" || account.status === "quota-low"),
        ),
    describePoolAccount: (_provider: string, accountId: string) => accountId,
    handleAccountPromptError: (input: { provider: string; accountId: string; error: unknown }) => {
      if (input.provider !== "grok" || !isGrokPoolQuotaError(input.error)) return;
      pool.store.updateStatus(input.accountId, "quota-exhausted", {
        lastError: "Grok 额度已耗尽",
        lastQuotaAt: Date.now(),
      });
    },
  } as never);
  managersToDispose.push(h.manager);
  return h;
}

function seedSession(
  h: ReproHarness,
  opts: { boundAccountId: string; boundFailsQuota: boolean; status?: string },
): SessionRuntime {
  if (opts.boundFailsQuota) h.deadAtRequest.add(opts.boundAccountId);
  else h.deadAtRequest.delete(opts.boundAccountId);
  const seedHandle = {
    startTurn: vi.fn<() => Promise<void>>(async () => {
      if (opts.boundFailsQuota) {
        const failure = quotaError();
        (
          h.manager as unknown as {
            options: { handleAccountPromptError: (input: unknown) => void };
          }
        ).options.handleAccountPromptError({
          provider: "grok",
          accountId: opts.boundAccountId,
          error: failure,
        });
        throw failure;
      }
    }),
    dispose: vi.fn<() => Promise<void>>(async () => undefined),
    setListener: vi.fn<() => void>(),
  };
  const session = {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "grok",
    adapter: h.adapter,
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: "grok-4.6" },
    mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
    status: opts.status ?? "idle",
    attention: "none",
    canResumeWithConfig: true,
    terminalSize: { cols: 120, rows: 30 },
    launchPrompt: "",
    prevChunk: "",
    lastStrippedPtyChunk: "",
    ptyOscCarry: "",
    poolAccountId: opts.boundAccountId,
    poolProvider: "grok",
    sessionRef: { providerSessionId: "ses-old", discoveredAt: new Date(0).toISOString() },
    structuredSession: seedHandle,
    presentationMode: "gui",
  } as unknown as SessionRuntime;
  h.manager.sessions.set(session.threadId, session);
  return session;
}

function errorEvents(h: ReproHarness): unknown[] {
  return h.emitted.filter((event) => {
    const e = event as {
      type?: string;
      event?: { type?: string; message?: string };
      errorMessage?: string;
    };
    if (e.type === "thread-state" && (e as { status?: string }).status === "error") return true;
    if (e.type === "thread-runtime-event" && e.event?.type === "error") return true;
    return false;
  });
}

describe("pool rotation reproduction (production pool shape)", () => {
  it("proactive restart moves a dead-bound idle thread onto the first live row", async () => {
    const h = createHarness(seedProductionPool());
    const deadBound = h.orderedIds[3]!;
    seedSession(h, { boundAccountId: deadBound, boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "MER-R1的强化学习是如何设计的?",
      config: { model: "grok-4.6" },
    } as never);
    await vi.waitFor(() => {
      expect(h.handlesByAccount.get(h.liveIds[0]!)?.startTurn).toHaveBeenCalledTimes(1);
    });

    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe(h.liveIds[0]);
    expect(errorEvents(h)).toEqual([]);
  });

  it("reactive same-turn failover rescues a usable-bound session whose request-time balance is dead", async () => {
    const h = createHarness(seedProductionPool());
    // Bound row looks usable to the scheduler (weekly ok) but its Build balance dies at request time.
    seedSession(h, { boundAccountId: h.liveIds[0]!, boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "MER-R1的强化学习是如何设计的?",
      config: { model: "grok-4.6" },
    } as never);
    await vi.waitFor(() => {
      expect(h.handlesByAccount.get(h.liveIds[1]!)?.startTurn).toHaveBeenCalledTimes(1);
    });

    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe(h.liveIds[1]);
    expect(
      h.emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toHaveLength(1);
    expect(errorEvents(h)).toEqual([]);
    // The request-dead row must be marked so the next submit never burns on it again.
    expect(h.store.getRecord(h.liveIds[0]!)?.status).toBe("quota-exhausted");
  });

  it("walks every live row before surfacing the quota banner when the whole pool is request-dead", async () => {
    const h = createHarness(seedProductionPool());
    for (const id of h.liveIds) h.deadAtRequest.add(id);
    seedSession(h, { boundAccountId: h.orderedIds[3]!, boundFailsQuota: true });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "MER-R1的强化学习是如何设计的?",
      config: { model: "grok-4.6" },
    } as never);
    await vi.waitFor(() => {
      expect(h.handlesByAccount.get(h.liveIds[1]!)?.startTurn).toHaveBeenCalled();
    });
    // Give the final failure a beat to land through the async catch chain.
    await vi.waitFor(() => {
      expect(errorEvents(h).length).toBeGreaterThan(0);
    });

    // Both live rows were actually tried — nothing usable was skipped.
    expect(h.handlesByAccount.get(h.liveIds[0]!)?.startTurn).toHaveBeenCalledTimes(1);
    expect(h.handlesByAccount.get(h.liveIds[1]!)?.startTurn).toHaveBeenCalledTimes(1);
  });

  it("keeps turns working (no-op sanity: live-bound live-request session sends directly)", async () => {
    const h = createHarness(seedProductionPool());
    seedSession(h, { boundAccountId: h.liveIds[0]!, boundFailsQuota: false });

    await h.manager.sendThreadInput({
      threadId: "thread-1",
      prompt: "hello",
      config: { model: "grok-4.6" },
    } as never);
    await vi.waitFor(() => {
      const session = h.manager.sessions.get("thread-1");
      expect(session?.structuredSession).toBeDefined();
    });
    expect(h.manager.sessions.get("thread-1")?.poolAccountId).toBe(h.liveIds[0]);
    expect(errorEvents(h)).toEqual([]);
  });
});
