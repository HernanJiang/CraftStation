import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentKind } from "@/shared/contracts";
import type { QueuedStructuredTurn, SessionRuntime } from "./sessionTypes";
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

function createManager(extraOptions: Record<string, unknown> = {}): ThreadSessionManager {
  const tempDir = mkdtempSync(join(tmpdir(), "craftstation-pool-failover-"));
  tempDirs.push(tempDir);
  writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ locale: "en" }));
  const manager = new ThreadSessionManager({
    emit: () => undefined,
    isDev: false,
    logsDir: join(tempDir, "logs"),
    settingsPath: join(tempDir, "settings.json"),
    readDisableCliHookPlugin: () => false,
    adapters: new Map(),
    resolveWindowsShell: () => ({ shell: "powershell.exe", kind: "powershell", args: ["-NoLogo"] }),
    ...extraOptions,
  });
  managersToDispose.push(manager);
  return manager;
}

function quotaError(): Error {
  return Object.assign(new Error("Internal error"), {
    code: -32603,
    data: {
      message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
      http_status: 402,
    },
  });
}

function seedSession(
  manager: ThreadSessionManager,
  overrides: Partial<SessionRuntime> = {},
): SessionRuntime {
  const session = {
    instanceId: "instance-1",
    threadId: "thread-1",
    agentKind: "grok",
    adapter: {},
    projectLocation: { kind: "windows", path: "C:\\repo" },
    config: { model: "grok-4.6" },
    mcpLaunchSnapshot: { mcpServers: [], disabledBuiltInMcpServerIds: [] },
    status: "working",
    attention: "none",
    canResumeWithConfig: false,
    terminalSize: { cols: 120, rows: 30 },
    launchPrompt: "",
    prevChunk: "",
    lastStrippedPtyChunk: "",
    ptyOscCarry: "",
    poolAccountId: "grok:dead",
    poolProvider: "grok",
    ...overrides,
  } as unknown as SessionRuntime;
  manager.sessions.set(session.threadId, session);
  return session;
}

function stubRestart(
  manager: ThreadSessionManager,
  impl?: (session: SessionRuntime, turn: QueuedStructuredTurn) => Promise<void>,
) {
  const restartThread = vi.fn<
    (session: SessionRuntime, turn: QueuedStructuredTurn) => Promise<void>
  >(
    impl ??
      (async (session) => {
        // Simulate pool re-resolution landing on a fresh account.
        const current = manager.sessions.get(session.threadId);
        if (current) current.poolAccountId = "grok:next";
      }),
  );
  (manager as unknown as { spawnPipeline: { restartThread: typeof restartThread } }).spawnPipeline =
    {
      restartThread,
    };
  return restartThread;
}

function failover(
  manager: ThreadSessionManager,
  session: SessionRuntime,
  candidate: QueuedStructuredTurn,
  error: unknown,
): Promise<boolean> {
  return (
    manager as unknown as {
      tryPoolFailover: (
        session: SessionRuntime,
        turn: QueuedStructuredTurn,
        error: unknown,
      ) => Promise<boolean>;
    }
  ).tryPoolFailover(session, candidate, error);
}

function turn(): QueuedStructuredTurn {
  return { prompt: "hi", config: { model: "grok-4.6" } };
}

describe("ThreadSessionManager pool failover", () => {
  it("declines providers without a subscription pool", async () => {
    const manager = createManager();
    const session = seedSession(manager, { agentKind: "claude" as AgentKind });
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("declines sticky third-party sessions", async () => {
    const manager = createManager();
    const session = seedSession(manager, { poolProvider: "openai-compatible" });
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("rescues sessions bound before pool adoption when the pool has usable rows", async () => {
    const manager = createManager({ hasUsablePoolAccount: () => true });
    const session = seedSession(manager);
    delete session.poolAccountId;
    delete session.poolProvider;
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(true);
    expect(restartThread).toHaveBeenCalledTimes(1);
  });

  it("stays fail-closed for unbound sessions when the provider has no pool", async () => {
    for (const extraOptions of [{}, { hasUsablePoolAccount: () => false }]) {
      const manager = createManager(extraOptions);
      const session = seedSession(manager);
      delete session.poolAccountId;
      delete session.poolProvider;
      const restartThread = stubRestart(manager);

      await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
      expect(restartThread).not.toHaveBeenCalled();
    }
  });

  it("fails over Kimi on a 402 prompt error, never on 429 or auth", async () => {
    const kimiDead = {
      code: -32603,
      message: "Internal error",
      data: { http_status: 402, message: "payment required" },
    };
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "kimi" as AgentKind,
        poolAccountId: "kimi:dead",
        poolProvider: "kimi",
      });
      const restartThread = stubRestart(manager);
      await expect(failover(manager, session, turn(), kimiDead)).resolves.toBe(true);
      expect(restartThread).toHaveBeenCalledTimes(1);
    }
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "kimi" as AgentKind,
        poolAccountId: "kimi:dead",
        poolProvider: "kimi",
      });
      const restartThread = stubRestart(manager);
      await expect(
        failover(manager, session, turn(), new Error("Kimi 额度已耗尽")),
      ).resolves.toBe(true);
      expect(restartThread).toHaveBeenCalledTimes(1);
    }
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "kimi" as AgentKind,
        poolAccountId: "kimi:dead",
        poolProvider: "kimi",
      });
      const restartThread = stubRestart(manager);
      await expect(
        failover(manager, session, turn(), { data: { http_status: 429 } }),
      ).resolves.toBe(false);
      await expect(
        failover(manager, session, turn(), { data: { http_status: 401 } }),
      ).resolves.toBe(false);
      expect(restartThread).not.toHaveBeenCalled();
    }
  });

  it("fails over Codex on the usage-limit shape, never on retryable shapes", async () => {
    const quota = new Error(
      "Error running remote compact task You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
    );
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "codex" as AgentKind,
        poolAccountId: "codex:dead",
        poolProvider: "codex",
      });
      const restartThread = stubRestart(manager);
      await expect(failover(manager, session, turn(), quota)).resolves.toBe(true);
      expect(restartThread).toHaveBeenCalledTimes(1);
    }
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "codex" as AgentKind,
        poolAccountId: "codex:dead",
        poolProvider: "codex",
      });
      const restartThread = stubRestart(manager);
      await expect(
        failover(manager, session, turn(), new Error("rate limit exceeded willRetry")),
      ).resolves.toBe(false);
      expect(restartThread).not.toHaveBeenCalled();
    }
  });

  it("fails over Antigravity on quota shapes, never on model errors", async () => {
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "antigravity" as AgentKind,
        poolAccountId: "antigravity:dead",
        poolProvider: "antigravity",
      });
      const restartThread = stubRestart(manager);
      await expect(
        failover(
          manager,
          session,
          turn(),
          new Error("RESOURCE_EXHAUSTED: Individual quota reached"),
        ),
      ).resolves.toBe(true);
      expect(restartThread).toHaveBeenCalledTimes(1);
    }
    {
      const manager = createManager();
      const session = seedSession(manager, {
        agentKind: "antigravity" as AgentKind,
        poolAccountId: "antigravity:dead",
        poolProvider: "antigravity",
      });
      const restartThread = stubRestart(manager);
      await expect(
        failover(manager, session, turn(), new Error('invalid model selection "gemini-x"')),
      ).resolves.toBe(false);
      expect(restartThread).not.toHaveBeenCalled();
    }
  });

  it("declines non-quota errors", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), new Error("boom"))).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("declines ambient sessions without a pool binding", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    delete session.poolAccountId;
    delete session.poolProvider;
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("declines stale sessions", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    manager.sessions.set(session.threadId, {
      ...session,
      instanceId: "instance-2",
    } as SessionRuntime);
    const restartThread = stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("restarts the turn on the next pool account and tracks the chain", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    const restartThread = stubRestart(manager);
    const next = turn();

    await expect(failover(manager, session, next, quotaError())).resolves.toBe(true);
    expect(restartThread).toHaveBeenCalledWith(session, next);
    expect(next.poolFailoverAttempt).toBe(1);
    expect(next.poolTriedAccountIds).toEqual(["grok:dead"]);
    expect(manager.sessions.get(session.threadId)?.poolAccountId).toBe("grok:next");
  });

  it("attaches the thread transcript as preface so the new account keeps context", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    const transcripts = (
      manager as unknown as {
        transcripts: { observe(threadId: string, event: unknown): void };
      }
    ).transcripts;
    transcripts.observe("thread-1", {
      type: "item.started",
      threadId: "thread-1",
      itemId: "u1",
      itemType: "user_message",
      payload: { content: [{ kind: "text", text: "earlier question" }] },
    });
    transcripts.observe("thread-1", {
      type: "content.delta",
      threadId: "thread-1",
      itemId: "a1",
      stream: "assistant_text",
      delta: "earlier answer",
    });
    transcripts.observe("thread-1", { type: "item.completed", threadId: "thread-1", itemId: "a1" });
    stubRestart(manager);
    const next = turn();

    await expect(failover(manager, session, next, quotaError())).resolves.toBe(true);
    expect(next.historyPreface).toContain("用户：earlier question");
    expect(next.historyPreface).toContain("助手：earlier answer");
  });

  it("leaves the replayed turn preface-free when the thread has no transcript", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    stubRestart(manager);
    const next = turn();

    await expect(failover(manager, session, next, quotaError())).resolves.toBe(true);
    expect(next.historyPreface).toBeUndefined();
  });

  it("emits a failover notice with account identities on success", async () => {
    const manager = createManager();
    const emitted: unknown[] = [];
    (manager as unknown as { options: { emit: (event: unknown) => void } }).options.emit = (
      event: unknown,
    ) => {
      emitted.push(event);
    };
    (
      manager as unknown as {
        options: { describePoolAccount?: (provider: string, accountId: string) => string };
      }
    ).options.describePoolAccount = (_provider, accountId) =>
      accountId === "grok:dead" ? "dead@example.com" : "next@example.com";
    const session = seedSession(manager);
    stubRestart(manager);

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(true);
    expect(emitted).toContainEqual({
      type: "thread-pool-failover",
      threadId: "thread-1",
      provider: "grok",
      fromAccount: "dead@example.com",
      toAccount: "next@example.com",
    });
  });

  it("emits no failover notice when the restart fails", async () => {
    const manager = createManager();
    const emitted: unknown[] = [];
    (manager as unknown as { options: { emit: (event: unknown) => void } }).options.emit = (
      event: unknown,
    ) => {
      emitted.push(event);
    };
    const session = seedSession(manager);
    stubRestart(manager, async () => {
      throw new Error("No usable grok account in the provider pool.");
    });

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(
      emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover"),
    ).toEqual([]);
  });

  it("returns false when the restart itself fails", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    const restartThread = stubRestart(manager, async () => {
      throw new Error("No usable grok account in the provider pool.");
    });

    await expect(failover(manager, session, turn(), quotaError())).resolves.toBe(false);
    expect(restartThread).toHaveBeenCalledTimes(1);
  });

  it("stops after the per-turn attempt budget is spent", async () => {
    const manager = createManager();
    const session = seedSession(manager);
    const restartThread = stubRestart(manager);
    const exhausted = { ...turn(), poolFailoverAttempt: 6, poolTriedAccountIds: ["grok:a"] };

    await expect(failover(manager, session, exhausted, quotaError())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });
});

describe("ThreadSessionManager dead pool binding", () => {
  function redeploy(
    manager: ThreadSessionManager,
    session: SessionRuntime,
    candidate: QueuedStructuredTurn,
  ): Promise<boolean> {
    return (
      manager as unknown as {
        restartForDeadPoolBinding: (
          session: SessionRuntime,
          turn: QueuedStructuredTurn,
        ) => Promise<boolean>;
      }
    ).restartForDeadPoolBinding(session, candidate);
  }

  function setUsable(
    manager: ThreadSessionManager,
    usable: (provider: string, accountId: string) => boolean,
  ): void {
    (
      manager as unknown as { options: { isPoolAccountUsable?: unknown } }
    ).options.isPoolAccountUsable = usable;
  }

  function boundSession(manager: ThreadSessionManager): SessionRuntime {
    return seedSession(manager, {
      poolAccountId: "grok:dead",
      poolProvider: "grok",
      sessionRef: { providerSessionId: "ses-1", discoveredAt: new Date(0).toISOString() },
    });
  }

  it("restarts when the bound account is no longer usable", async () => {
    const manager = createManager();
    const session = boundSession(manager);
    setUsable(manager, () => false);
    const restartThread = stubRestart(manager);

    await expect(redeploy(manager, session, turn())).resolves.toBe(true);
    expect(restartThread).toHaveBeenCalledTimes(1);
  });

  it("sends on the bound session while its account stays usable", async () => {
    const manager = createManager();
    const session = boundSession(manager);
    setUsable(manager, () => true);
    const restartThread = stubRestart(manager);

    await expect(redeploy(manager, session, turn())).resolves.toBe(false);
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("leaves ambient and third-party sessions alone", async () => {
    const manager = createManager();
    setUsable(manager, () => false);
    const restartThread = stubRestart(manager);

    const ambient = boundSession(manager);
    delete ambient.poolAccountId;
    await expect(redeploy(manager, ambient, turn())).resolves.toBe(false);

    const thirdParty = boundSession(manager);
    thirdParty.poolProvider = "openai-compatible";
    await expect(redeploy(manager, thirdParty, turn())).resolves.toBe(false);

    const noRef = boundSession(manager);
    delete (noRef as { sessionRef?: unknown }).sessionRef;
    await expect(redeploy(manager, noRef, turn())).resolves.toBe(false);

    expect(restartThread).not.toHaveBeenCalled();
  });

  it("falls through to the bound session when the restart fails", async () => {
    const manager = createManager();
    const session = boundSession(manager);
    setUsable(manager, () => false);
    const restartThread = stubRestart(manager, async () => {
      throw new Error("No usable grok account in the provider pool.");
    });

    await expect(redeploy(manager, session, turn())).resolves.toBe(false);
    expect(restartThread).toHaveBeenCalledTimes(1);
  });
});

describe("ThreadSessionManager switchThreadProvider", () => {
  it("rejects unknown threads without touching the pipeline", async () => {
    const manager = createManager();
    const restartThread = stubRestart(manager);

    await expect(
      (
        manager as unknown as {
          switchThreadProvider: (payload: {
            threadId: string;
            agentKind: string;
            config: { model: string };
          }) => Promise<unknown>;
        }
      ).switchThreadProvider({ threadId: "missing", agentKind: "kimi", config: { model: "k2" } }),
    ).rejects.toThrow("Unknown thread session");
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("updates config in place for same-harness model changes", async () => {
    const manager = createManager();
    const session = seedSession(manager, {
      poolAccountId: "grok:a",
      poolProvider: "grok",
      sessionRef: { providerSessionId: "ses-1", discoveredAt: new Date(0).toISOString() },
    });
    const restartThread = stubRestart(manager);

    const result = await (
      manager as unknown as {
        switchThreadProvider: (payload: {
          threadId: string;
          agentKind: string;
          config: { model: string };
        }) => Promise<{
          threadId: string;
          agentKind: string;
          poolAccountId?: string;
          canResumeWithConfig: boolean;
        }>;
      }
    ).switchThreadProvider({
      threadId: "thread-1",
      agentKind: "grok",
      config: { model: "grok-5" },
    });

    expect(result.agentKind).toBe("grok");
    expect(result.poolAccountId).toBe("grok:a");
    expect(session.config).toMatchObject({ model: "grok-5" });
    expect(restartThread).not.toHaveBeenCalled();
  });

  it("leaves the original session in place when the replacement runtime fails", async () => {
    const dispose = vi.fn<() => Promise<void>>(async () => undefined);
    const manager = createManager({
      adapters: new Map([["opencode", { capabilities: { presentationMode: "gui" } }]]),
    });
    const session = seedSession(manager, {
      presentationMode: "gui",
      structuredSession: { dispose, launchOptions: {}, setListener: () => undefined } as never,
    });
    (
      manager as unknown as {
        spawnPipeline: { switchThreadProvider: () => Promise<never> };
      }
    ).spawnPipeline = {
      switchThreadProvider: async () => {
        throw new Error("OpencodeSdkSession is not active.");
      },
    };

    await expect(
      (
        manager as unknown as {
          switchThreadProvider: (payload: {
            threadId: string;
            agentKind: string;
            config: { model: string };
          }) => Promise<unknown>;
        }
      ).switchThreadProvider({
        threadId: "thread-1",
        agentKind: "opencode",
        config: { model: "opencode-go/muse-spark-1.3-contributor" },
      }),
    ).rejects.toThrow("OpencodeSdkSession is not active.");

    expect(manager.sessions.get("thread-1")).toBe(session);
    expect(dispose).not.toHaveBeenCalled();
    expect(session.agentKind).toBe("grok");
    expect(session.config.model).toBe("grok-4.6");
  });

  it("rejects harnesses without a registered adapter", async () => {
    const manager = createManager();
    seedSession(manager);
    await expect(
      (
        manager as unknown as {
          switchThreadProvider: (payload: {
            threadId: string;
            agentKind: string;
            config: { model: string };
          }) => Promise<unknown>;
        }
      ).switchThreadProvider({
        threadId: "thread-1",
        agentKind: "nope" as AgentKind,
        config: { model: "m" },
      }),
    ).rejects.toThrow("Unsupported agent adapter");
  });

  it("force-settles a working GUI thread whose session cannot take interrupts", async () => {
    const manager = createManager();
    const session = seedSession(manager, { presentationMode: "gui", status: "working" });
    // No structuredSession on the seed: a previous force-stop may have
    // disposed it without settling, leaving the stop button dead.
    await manager.interruptThread({ threadId: "thread-1" });
    expect(session.status).toBe("idle");
  });
});
