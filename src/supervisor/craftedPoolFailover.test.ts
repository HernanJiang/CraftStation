import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCraftStationPaths } from "@/shared/craftstationPaths";
import { setUsageSecret } from "@/shared/usageSecretStore";
import {
  BUILTIN_MODEL_ITEMS,
  Crafter,
  type CraftSession,
  type HarnessRuntimeAdapter,
  type TurnResult,
} from "@/shared/crafting";
import { SupervisorRuntime } from "./supervisorRuntime";

const taskkillSpawnSyncMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const ptySpawnMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
const nativeHarnessFactoryOverrides = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => unknown>(),
);

vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: ((command, args, options) => {
      if (command === "taskkill") {
        return taskkillSpawnSyncMock(command, args, options);
      }
      return actual.spawnSync(command, args, options);
    }) as typeof actual.spawnSync,
  };
});

vi.mock("node-pty", () => ({
  spawn: ptySpawnMock,
}));

vi.mock("./runtime/nativeHarness", async (importActual) => {
  const actual = await importActual<typeof import("./runtime/nativeHarness")>();
  return {
    ...actual,
    createNativeHarnessRuntimeAdapter: (harnessKind: string, options: unknown) => {
      const override = nativeHarnessFactoryOverrides.get(harnessKind);
      return override
        ? (override(harnessKind, options) as HarnessRuntimeAdapter | undefined)
        : actual.createNativeHarnessRuntimeAdapter(harnessKind, options as never);
    },
  };
});

// Suppress supervisor console output during tests so vitest's onUserConsoleLog
// RPC does not remain pending at worker teardown.
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "log").mockImplementation(() => {});

const tempDirs: string[] = [];
const runtimesToDispose: SupervisorRuntime[] = [];
const craftstationDataDirBeforeTests = process.env.CRAFTSTATION_DATA_DIR;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-crafted-failover-"));
  tempDirs.push(dir);
  return dir;
}

function makeRuntime(emit: ConstructorParameters<typeof SupervisorRuntime>[0]): SupervisorRuntime {
  const runtime = new SupervisorRuntime(emit);
  vi.spyOn(runtime.skillsService, "prepareForLaunch").mockResolvedValue(undefined);
  vi.spyOn(runtime.skillsService, "scan").mockResolvedValue({
    skills: [],
    effectiveSkillIds: [],
    invocation: "slash",
    issues: [],
    canLinkToGlobal: true,
  });
  runtimesToDispose.push(runtime);
  return runtime;
}

beforeEach(() => {
  const baseDir = makeTempDir();
  vi.stubEnv("CRAFTSTATION_DATA_DIR", baseDir);
  writeFileSync(
    join(baseDir, "settings.json"),
    JSON.stringify({ locale: "en", customGlobalPrompt: "" }),
  );
});

afterEach(async () => {
  await Promise.allSettled(runtimesToDispose.splice(0).map((runtime) => runtime.disposeAsync()));
  vi.unstubAllEnvs();
  if (craftstationDataDirBeforeTests === undefined) {
    delete process.env.CRAFTSTATION_DATA_DIR;
  } else {
    process.env.CRAFTSTATION_DATA_DIR = craftstationDataDirBeforeTests;
  }
  taskkillSpawnSyncMock.mockReset();
  taskkillSpawnSyncMock.mockReturnValue({ error: undefined, status: 0 });
  ptySpawnMock.mockReset();
  nativeHarnessFactoryOverrides.clear();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function craftPlan(threadId = "craft-failover-thread") {
  const result = new Crafter().compile(
    { slots: { model: BUILTIN_MODEL_ITEMS[0], harness: "auto" } },
    { workspace: "C:\\repo", threadId },
  );
  expect(result.success).toBe(true);
  return result.craftPlan!;
}

function nativeCraftPlan(threadId: string) {
  const base = craftPlan(threadId);
  return {
    ...base,
    ingredients: {
      model: { ...base.ingredients.model!, vendor: "xai", itemId: "xai:model" },
      harness: { ...base.ingredients.harness!, vendor: "xai", itemId: "harness:grok" },
    },
    runtimeBinding: {
      ...base.runtimeBinding,
      harnessKind: "grok",
      vendor: "xai",
      modelId: "grok-4.6",
      runtimeAdapterId: "native-harness:grok",
    },
  };
}

function grokQuotaError(): Error {
  return Object.assign(new Error("Internal error"), {
    code: -32603,
    data: {
      message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
      http_status: 402,
    },
  });
}

function grokQuotaRequestError(): Error {
  return new RequestError(-32603, "Internal error", {
    message: "API error (status 402 Payment Required): Grok Build usage balance exhausted",
    http_status: 402,
  });
}

function addGrokAccount(
  runtime: SupervisorRuntime,
  label: string,
  status: "available" | "quota-exhausted" = "available",
) {
  const account = runtime.addAccount({
    provider: "grok",
    label,
    maskedIdentity: `${label}@example.com`,
  });
  writeFileSync(
    join(runtime.accountStore.credentialRoot(account.accountId), "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::test-client": {
        key: "test-access-token",
        email: `${label}@example.com`,
      },
    }),
    "utf8",
  );
  runtime.accountStore.updateStatus(account.accountId, status);
  return account;
}

interface PoolSessionRecord {
  accountId: string | undefined;
  startTurnCalls: number;
  terminated: boolean;
}

interface PoolBehaviour {
  /** Accounts whose turns reject with the Grok 402 quota shape. */
  deadIds: Set<string>;
  /** Accounts whose turns reject with the official RequestError shape. */
  requestErrorIds?: Set<string>;
  /** Accounts whose turns throw a non-quota error. */
  boomIds?: Set<string>;
  /** Accounts whose turns resolve a failed TurnResult carrying quota text. */
  failedResultIds?: Set<string>;
  /** Accounts whose turns hang until the test releases them. */
  hangIds?: Set<string>;
  /** Receives one {resolve,reject} controller per hung turn, in call order. */
  hungControllers?: Array<{
    resolve: (value: TurnResult) => void;
    reject: (error: unknown) => void;
  }>;
}

/**
 * Stub native adapter whose sessions fail per `behaviour` and answer
 * otherwise. Each factory call captures its own account binding, so every
 * failover rebuild lands on a fresh, independently observable session.
 */
function installGrokPoolAdapter(behaviour: PoolBehaviour, records: PoolSessionRecord[]) {
  let sessionCounter = 0;
  const factory = (_harnessKind: unknown, options: unknown) => {
    const accountBinding = (options as { accountBinding?: { accountId: string; provider: string } })
      .accountBinding;
    const record: PoolSessionRecord = {
      accountId: accountBinding?.accountId,
      startTurnCalls: 0,
      terminated: false,
    };
    records.push(record);
    sessionCounter += 1;
    const sessionId = `session:test:${record.accountId ?? "ambient"}:${sessionCounter}`;
    const session: CraftSession = {
      id: sessionId,
      entityId: `entity:test:grok:${sessionCounter}`,
      status: "idle",
      sessionRef: `ses-${sessionCounter}`,
      startTurn: (async (): Promise<TurnResult> => {
        record.startTurnCalls += 1;
        if (record.accountId && behaviour.hangIds?.has(record.accountId)) {
          return new Promise<TurnResult>((resolve, reject) => {
            behaviour.hungControllers?.push({ resolve, reject });
          });
        }
        if (record.accountId && behaviour.boomIds?.has(record.accountId)) {
          throw new Error("boom");
        }
        if (record.accountId && behaviour.requestErrorIds?.has(record.accountId)) {
          throw grokQuotaRequestError();
        }
        if (record.accountId && behaviour.failedResultIds?.has(record.accountId)) {
          return {
            turnId: "turn:test",
            status: "failed",
            events: [],
            error: "Grok 额度已耗尽",
          };
        }
        if (record.accountId && behaviour.deadIds.has(record.accountId)) {
          throw grokQuotaError();
        }
        return { turnId: "turn:test", status: "completed", events: [], response: "ok" };
      }) as CraftSession["startTurn"],
      interrupt: async () => undefined,
      terminate: async () => {
        record.terminated = true;
      },
      getSnapshot: () => ({
        sessionId,
        entityId: `entity:test:grok`,
        status: "idle" as const,
        events: [],
      }),
      subscribe: () => () => undefined,
      sendPrompt: (async (prompt: string) => ({
        response: `ok:${prompt}`,
        events: [],
      })) as CraftSession["sendPrompt"],
    };
    const adapter: HarnessRuntimeAdapter = {
      id: `test-native:grok:${record.accountId ?? "ambient"}`,
      harnessKind: "grok",
      supports: (plan) => plan.runtimeBinding.harnessKind === "grok",
      spawnEntity: async (plan) => ({
        id: `entity:test:grok:${sessionCounter}`,
        resultItemId: plan.resultItemId,
        craftPlan: plan,
        status: "spawned" as const,
        createdAt: new Date(0).toISOString(),
      }),
      createSession: async () => session,
      resumeSession: async () => session,
    };
    return adapter;
  };
  nativeHarnessFactoryOverrides.set("grok", factory as (...args: unknown[]) => unknown);
}

function failoverEvents(emitted: unknown[]) {
  return emitted.filter((event) => (event as { type?: string }).type === "thread-pool-failover");
}

function craftedInternals(runtime: SupervisorRuntime) {
  return runtime as unknown as {
    craftedSessionsByThread: Map<string, CraftSession>;
    craftedSessionBindings: Map<string, { accountId: string; provider: string }>;
    craftedFailoverTriedByThread: Map<string, Set<string>>;
    craftedPlansByThread: Map<string, never>;
  };
}

const windowsProject = { kind: "windows", path: "C:\\repo" } as const;
const grokConfig = { model: "grok-4.6" } as const;

describe("SupervisorRuntime crafted pool failover", () => {
  beforeEach(() => {
    process.env.CRAFTSTATION_DATA_DIR = makeTempDir();
  });

  it("skips an already-dead binding and answers on the next usable row", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    addGrokAccount(runtime, "row-dead", "quota-exhausted");
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter({ deadIds: new Set() }, records);

    // Launch on row-a, then the row dies mid-thread (the production shape:
    // a long-lived thread whose binding went 100% weekly).
    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-skip-dead"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: rowA.accountId,
      accountMode: "preferred",
    });
    runtime.accountStore.updateStatus(rowA.accountId, "quota-exhausted");

    await runtime.sendThreadInput({
      threadId: "failover-skip-dead",
      prompt: "MER-R1?",
      config: { ...grokConfig },
    });

    // The dead row is never burned: no turn runs on it, rotation lands on B.
    expect(records.map((record) => record.accountId)).toEqual([rowA.accountId, rowB.accountId]);
    expect(records[0]!.startTurnCalls).toBe(0);
    expect(records[1]!.startTurnCalls).toBe(1);
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(failoverEvents(emitted)[0]).toMatchObject({
      threadId: "failover-skip-dead",
      provider: "grok",
    });
    expect(
      craftedInternals(runtime).craftedSessionBindings.get("failover-skip-dead"),
    ).toMatchObject({ accountId: rowB.accountId });
    // The dead session handle is retired; the live one stays.
    expect(records[0]!.terminated).toBe(true);
    expect(records[1]!.terminated).toBe(false);
  });

  it("reactively rotates a usable-bound session whose request-time balance is dead", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    // row-a looks weekly-healthy but its Build balance dies at request time.
    installGrokPoolAdapter({ deadIds: new Set([rowA.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-reactive"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });
    expect(craftedInternals(runtime).craftedSessionBindings.get("failover-reactive")).toMatchObject(
      { accountId: rowA.accountId },
    );

    await runtime.sendThreadInput({
      threadId: "failover-reactive",
      prompt: "hello?",
      config: { ...grokConfig },
    });

    expect(records.map((record) => record.accountId)).toEqual([rowA.accountId, rowB.accountId]);
    expect(records[0]!.startTurnCalls).toBe(1);
    expect(records[1]!.startTurnCalls).toBe(1);
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(failoverEvents(emitted)[0]).toMatchObject({
      fromAccount: expect.stringContaining("row-a@"),
      toAccount: expect.stringContaining("row-b@"),
    });
    expect(craftedInternals(runtime).craftedSessionBindings.get("failover-reactive")).toMatchObject(
      { accountId: rowB.accountId },
    );
    // The request-dead row is marked so later submits never burn on it.
    expect(runtime.accountStore.get(rowA.accountId)?.status).toBe("quota-exhausted");
    expect(runtime.accountStore.get(rowB.accountId)?.status).toBe("available");
    expect(craftedInternals(runtime).craftedFailoverTriedByThread.get("failover-reactive")).toEqual(
      new Set([rowA.accountId]),
    );
    expect(records[0]!.terminated).toBe(true);
  });

  it("matches the official ACP RequestError quota shape for rotation", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter(
      { deadIds: new Set(), requestErrorIds: new Set([rowA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-rpc-shape"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await runtime.sendThreadInput({
      threadId: "failover-rpc-shape",
      prompt: "hi?",
      config: { ...grokConfig },
    });

    expect(records.map((record) => record.accountId)).toEqual([rowA.accountId, rowB.accountId]);
    expect(failoverEvents(emitted)).toHaveLength(1);
  });

  it("rotates on a resolved failed TurnResult carrying quota text", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter(
      { deadIds: new Set(), failedResultIds: new Set([rowA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-failed-result"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await runtime.sendThreadInput({
      threadId: "failover-failed-result",
      prompt: "hi?",
      config: { ...grokConfig },
    });

    expect(records.map((record) => record.accountId)).toEqual([rowA.accountId, rowB.accountId]);
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(
      craftedInternals(runtime).craftedSessionBindings.get("failover-failed-result"),
    ).toMatchObject({ accountId: rowB.accountId });
  });

  it("walks every usable row before surfacing the quota banner", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    // Both usable rows are Build-empty at request time.
    installGrokPoolAdapter({ deadIds: new Set([rowA.accountId, rowB.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-all-dead"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await expect(
      runtime.sendThreadInput({
        threadId: "failover-all-dead",
        prompt: "hello?",
        config: { ...grokConfig },
      }),
    ).rejects.toThrow(/额度已耗尽/);

    // Both rows were actually tried — nothing usable was skipped.
    expect(records.map((record) => record.accountId)).toEqual([rowA.accountId, rowB.accountId]);
    expect(records[0]!.startTurnCalls).toBe(1);
    expect(records[1]!.startTurnCalls).toBe(1);
    // One hop emitted (A→B); the second hop declines on the empty pool.
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(runtime.accountStore.get(rowA.accountId)?.status).toBe("quota-exhausted");
    expect(runtime.accountStore.get(rowB.accountId)?.status).toBe("quota-exhausted");
  });

  it("stays fail-closed on non-quota errors without touching the pool", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter({ deadIds: new Set(), boomIds: new Set([rowA.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-fail-closed"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    await expect(
      runtime.sendThreadInput({
        threadId: "failover-fail-closed",
        prompt: "hi?",
        config: { ...grokConfig },
      }),
    ).rejects.toThrow("boom");

    expect(records).toHaveLength(1);
    expect(failoverEvents(emitted)).toHaveLength(0);
    expect(runtime.accountStore.get(rowA.accountId)?.status).toBe("available");
  });

  it("falls back to the pool on resume when the stored binding died", async () => {
    const runtime = makeRuntime(() => undefined);
    const rowA = addGrokAccount(runtime, "row-a", "quota-exhausted");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter({ deadIds: new Set() }, records);
    let resumeCalls = 0;
    let createCalls = 0;
    const factory = nativeHarnessFactoryOverrides.get("grok")!;
    nativeHarnessFactoryOverrides.set("grok", (...args: unknown[]) => {
      const adapter = factory(...args) as HarnessRuntimeAdapter;
      const innerResume = adapter.resumeSession.bind(adapter);
      const innerCreate = adapter.createSession.bind(adapter);
      return {
        ...adapter,
        resumeSession: async (
          ...resumeArgs: Parameters<HarnessRuntimeAdapter["resumeSession"]>
        ) => {
          resumeCalls += 1;
          return innerResume(...resumeArgs);
        },
        createSession: async (
          ...createArgs: Parameters<HarnessRuntimeAdapter["createSession"]>
        ) => {
          createCalls += 1;
          return innerCreate(...createArgs);
        },
      };
    });

    const plan = nativeCraftPlan("failover-resume-fallback");
    const result = await runtime.resumeCraftAgent({
      craftPlan: plan,
      projectLocation: { ...windowsProject },
      sessionRef: "ses-old",
      prompt: "hi again",
      accountId: rowA.accountId,
    });

    // The dead stored row is skipped; a fresh session opens on row-b and the
    // result carries the live binding so the renderer persists it.
    expect(resumeCalls).toBe(0);
    expect(createCalls).toBe(1);
    expect(result.accountBinding?.accountId).toBe(rowB.accountId);
    expect(result.response).toBe("ok:hi again");
    expect(records.map((record) => record.accountId)).toEqual([rowB.accountId]);
  });

  it("tolerates the stale stored binding after a failover moved the thread", async () => {
    const runtime = makeRuntime(() => undefined);
    const rowA = addGrokAccount(runtime, "row-a");
    const rowB = addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    installGrokPoolAdapter({ deadIds: new Set([rowA.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-drift"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });
    await runtime.sendThreadInput({
      threadId: "failover-drift",
      prompt: "first",
      config: { ...grokConfig },
    });
    expect(craftedInternals(runtime).craftedSessionBindings.get("failover-drift")).toMatchObject({
      accountId: rowB.accountId,
    });

    // The renderer row still names row-a until a craft result persists the
    // move; the resume must not mistake that healed drift for a plan change.
    const storedPlan = craftedInternals(runtime).craftedPlansByThread.get("failover-drift");
    const liveSession = craftedInternals(runtime).craftedSessionsByThread.get("failover-drift")!;
    const result = await runtime.resumeCraftAgent({
      craftPlan: storedPlan as never,
      projectLocation: { ...windowsProject },
      sessionRef: liveSession.sessionRef ?? "ses-stub",
      prompt: "second",
      accountId: rowA.accountId,
    });
    expect(result.accountBinding?.accountId).toBe(rowB.accountId);
    expect(result.response).toBe("ok");
  });

  it("drops a raced turn silently when an explicit Stop lands mid-failover", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const rowA = addGrokAccount(runtime, "row-a");
    addGrokAccount(runtime, "row-b");
    const records: PoolSessionRecord[] = [];
    const hungControllers: PoolBehaviour["hungControllers"] = [];
    installGrokPoolAdapter(
      { deadIds: new Set(), hangIds: new Set([rowA.accountId]), hungControllers },
      records,
    );

    await runtime.craftAgent({
      craftPlan: nativeCraftPlan("failover-stop-race"),
      projectLocation: { ...windowsProject },
      prompt: "",
    });

    // The turn hangs in flight; the user hits Stop; only then does the
    // provider surface the quota death. The Stop owns the outcome: no
    // rebuild, no replay, no banner — mirroring the legacy generation guard.
    const send = runtime.sendThreadInput({
      threadId: "failover-stop-race",
      prompt: "hi?",
      config: { ...grokConfig },
    });
    await vi.waitFor(() => {
      expect(hungControllers).toHaveLength(1);
    });
    await runtime.interruptThread({ threadId: "failover-stop-race" });
    hungControllers[0]!.reject(grokQuotaError());
    await expect(send).resolves.toBeUndefined();

    expect(records).toHaveLength(1);
    expect(records[0]!.startTurnCalls).toBe(1);
    expect(failoverEvents(emitted)).toHaveLength(0);
    // The quota death itself is still real, so the write-back marks the row
    // (same as the legacy lane); only the rotation is dropped.
    expect(runtime.accountStore.get(rowA.accountId)?.status).toBe("quota-exhausted");
  });
});

describe("SupervisorRuntime crafted third-party channel failover", () => {
  function kimiChannelPlan(threadId: string) {
    const base = craftPlan(threadId);
    return {
      ...base,
      ingredients: {
        model: { ...base.ingredients.model!, vendor: "moonshot", itemId: "moonshot:model" },
        harness: { ...base.ingredients.harness!, vendor: "moonshot", itemId: "harness:kimi" },
      },
      runtimeBinding: {
        ...base.runtimeBinding,
        harnessKind: "kimi",
        vendor: "moonshot",
        modelId: "k3-256k",
        runtimeAdapterId: "native-harness:kimi",
      },
    };
  }

  function channelQuotaError(): Error {
    return Object.assign(new Error("request failed"), {
      data: { http_status: 402, message: "insufficient_quota: you ran out of credits" },
    });
  }

  function channelWireError(): Error {
    // Verbatim shape from Kimi CLI against Volcengine Ark coding over Responses.
    return Object.assign(new Error("request failed"), {
      data: {
        http_status: 400,
        message: "400 A parameter specified in the request is not valid",
      },
    });
  }

  function seedChannel(
    runtime: SupervisorRuntime,
    label: string,
    modelIds: string[],
    protocol = "responses",
  ) {
    const baseDir = process.env.CRAFTSTATION_DATA_DIR!;
    const cacheDir = resolveCraftStationPaths(baseDir).cacheDir;
    setUsageSecret(
      cacheDir,
      "openai-compatible:pending",
      "baseUrl",
      "https://relay.example.com/v1",
    );
    setUsageSecret(cacheDir, "openai-compatible:pending", "apiKey", `sk-test-${label}`);
    setUsageSecret(cacheDir, "openai-compatible:pending", "providerName", label);
    setUsageSecret(cacheDir, "openai-compatible:pending", "model", modelIds[0] ?? "k3-256k");
    setUsageSecret(cacheDir, "openai-compatible:pending", "validatedProtocol", protocol);
    setUsageSecret(cacheDir, "openai-compatible:pending", "validatedAt", "1700000000000");
    const account = runtime.importOpenAiCompatibleProfile({});
    const settingsPath = join(baseDir, "settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      customModels?: unknown[];
    };
    settings.customModels = [
      ...(settings.customModels ?? []),
      ...modelIds.map((modelId) => ({
        id: `custom:kimi:${account.accountId}:${modelId}`,
        provider: "kimi",
        accountId: account.accountId,
        modelId,
        displayName: modelId,
        contextSize: "",
      })),
    ];
    writeFileSync(settingsPath, JSON.stringify(settings));
    return account;
  }

  interface ChannelRecord {
    accountId: string | undefined;
    startTurnCalls: number;
    terminated: boolean;
  }

  interface ChannelBehaviour {
    quotaDeadIds: Set<string>;
    rateLimitedIds?: Set<string>;
    authDeadIds?: Set<string>;
    /** Channels whose turns reject once with a 400 wire-type failure. */
    fail400OnceIds?: Set<string>;
    /** Channels whose turns always reject with a 400 wire-type failure. */
    fail400AlwaysIds?: Set<string>;
  }

  function installKimiChannelAdapter(behaviour: ChannelBehaviour, records: ChannelRecord[]) {
    let sessionCounter = 0;
    const factory = (_harnessKind: unknown, options: unknown) => {
      const accountBinding = (
        options as { accountBinding?: { accountId: string; provider: string } }
      ).accountBinding;
      const record: ChannelRecord = {
        accountId: accountBinding?.accountId,
        startTurnCalls: 0,
        terminated: false,
      };
      records.push(record);
      sessionCounter += 1;
      const sessionId = `session:test:${record.accountId ?? "ambient"}:${sessionCounter}`;
      const session: CraftSession = {
        id: sessionId,
        entityId: `entity:test:kimi:${sessionCounter}`,
        status: "idle",
        sessionRef: `ses-${sessionCounter}`,
        startTurn: (async (): Promise<TurnResult> => {
          record.startTurnCalls += 1;
          if (record.accountId && behaviour.fail400AlwaysIds?.has(record.accountId)) {
            throw channelWireError();
          }
          if (record.accountId && behaviour.fail400OnceIds?.has(record.accountId)) {
            behaviour.fail400OnceIds!.delete(record.accountId);
            throw channelWireError();
          }
          if (record.accountId && behaviour.authDeadIds?.has(record.accountId)) {
            throw Object.assign(new Error("request failed"), {
              data: { http_status: 401, message: "invalid_api_key" },
            });
          }
          if (record.accountId && behaviour.rateLimitedIds?.has(record.accountId)) {
            throw Object.assign(new Error("request failed"), {
              data: { http_status: 429, message: "rate limit reached, retry later" },
            });
          }
          if (record.accountId && behaviour.quotaDeadIds.has(record.accountId)) {
            throw channelQuotaError();
          }
          return { turnId: "turn:test", status: "completed", events: [], response: "ok" };
        }) as CraftSession["startTurn"],
        interrupt: async () => undefined,
        terminate: async () => {
          record.terminated = true;
        },
        getSnapshot: () => ({
          sessionId,
          entityId: `entity:test:kimi`,
          status: "idle" as const,
          events: [],
        }),
        subscribe: () => () => undefined,
        sendPrompt: (async (prompt: string) => ({
          response: `ok:${prompt}`,
          events: [],
        })) as CraftSession["sendPrompt"],
      };
      const adapter: HarnessRuntimeAdapter = {
        id: `test-native:kimi:${record.accountId ?? "ambient"}`,
        harnessKind: "kimi",
        supports: (plan) => plan.runtimeBinding.harnessKind === "kimi",
        spawnEntity: async (plan) => ({
          id: `entity:test:kimi:${sessionCounter}`,
          resultItemId: plan.resultItemId,
          craftPlan: plan,
          status: "spawned" as const,
          createdAt: new Date(0).toISOString(),
        }),
        createSession: async () => session,
        resumeSession: async () => session,
      };
      return adapter;
    };
    nativeHarnessFactoryOverrides.set("kimi", factory as (...args: unknown[]) => unknown);
  }

  function craftedChannelInternals(runtime: SupervisorRuntime) {
    return runtime as unknown as {
      craftedSessionBindings: Map<string, { accountId: string; provider: string }>;
      craftedFailoverTriedByThread: Map<string, Set<string>>;
      thirdPartyChannelCooldownUntil: Map<string, number>;
    };
  }

  function recordsHomeForChannel(
    runtime: SupervisorRuntime,
    accountId: string,
    modelId: string,
  ): string {
    const baseDir = process.env.CRAFTSTATION_DATA_DIR!;
    const cacheDir = resolveCraftStationPaths(baseDir).cacheDir;
    void runtime;
    const safeAccount = accountId.replace(/[^A-Za-z0-9._-]/g, "_");
    const scoped = Buffer.from(modelId, "utf8").toString("base64url");
    return join(cacheDir, "openai-compatible-kimi", safeAccount, scoped);
  }

  const kimiConfig = { model: "k3-256k" } as const;

  it("rotates a quota-dead channel onto the next validated one", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const channelB = seedChannel(runtime, "Relay B", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter({ quotaDeadIds: new Set([channelA.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-quota"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    await runtime.sendThreadInput({
      threadId: "channel-quota",
      prompt: "hi?",
      config: { ...kimiConfig },
    });

    expect(records.map((record) => record.accountId)).toEqual([
      channelA.accountId,
      channelB.accountId,
    ]);
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(failoverEvents(emitted)[0]).toMatchObject({
      threadId: "channel-quota",
      provider: "openai-compatible",
    });
    expect(
      craftedChannelInternals(runtime).craftedSessionBindings.get("channel-quota"),
    ).toMatchObject({ accountId: channelB.accountId, provider: "openai-compatible" });
    // Channels cool down instead of store-marking (the relay quota poller
    // would wipe a store mark on its next pass).
    expect(runtime.accountStore.get(channelA.accountId)?.status).toBe("available");
    expect(
      craftedChannelInternals(runtime).thirdPartyChannelCooldownUntil.has(channelA.accountId),
    ).toBe(true);
    expect(records[0]!.terminated).toBe(true);
  });

  it("rotates on transient throttling without cooling the row down", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const channelB = seedChannel(runtime, "Relay B", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter(
      { quotaDeadIds: new Set(), rateLimitedIds: new Set([channelA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-429"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    await runtime.sendThreadInput({
      threadId: "channel-429",
      prompt: "hi?",
      config: { ...kimiConfig },
    });

    expect(records.map((record) => record.accountId)).toEqual([
      channelA.accountId,
      channelB.accountId,
    ]);
    expect(failoverEvents(emitted)).toHaveLength(1);
    expect(
      craftedChannelInternals(runtime).thirdPartyChannelCooldownUntil.has(channelA.accountId),
    ).toBe(false);
  });

  it("walks every serving channel before surfacing, single row included", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    // A single-row pool is still a pool: the lone row is tried once, then
    // the original channel error surfaces — never a silent ambient fallback.
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter({ quotaDeadIds: new Set([channelA.accountId]) }, records);

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-single"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    // A single-row pool is still a pool: the lone row is tried once, then
    // the original channel error surfaces — never a silent ambient fallback.
    const failure = await runtime
      .sendThreadInput({
        threadId: "channel-single",
        prompt: "hi?",
        config: { ...kimiConfig },
      })
      .then(
        () => {
          throw new Error("expected the turn to fail");
        },
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({ data: { http_status: 402 } });

    expect(records).toHaveLength(1);
    expect(records[0]!.startTurnCalls).toBe(1);
    expect(failoverEvents(emitted)).toHaveLength(0);
    expect(
      craftedChannelInternals(runtime).craftedFailoverTriedByThread.get("channel-single"),
    ).toEqual(undefined);
  });

  it("stays fail-closed on auth denials without touching the catalog", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    seedChannel(runtime, "Relay B", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter(
      { quotaDeadIds: new Set(), authDeadIds: new Set([channelA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-401"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    const failure = await runtime
      .sendThreadInput({
        threadId: "channel-401",
        prompt: "hi?",
        config: { ...kimiConfig },
      })
      .then(
        () => {
          throw new Error("expected the turn to fail");
        },
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({ data: { http_status: 401 } });

    expect(records).toHaveLength(1);
    expect(failoverEvents(emitted)).toHaveLength(0);
    expect(
      craftedChannelInternals(runtime).thirdPartyChannelCooldownUntil.has(channelA.accountId),
    ).toBe(false);
  });

  it("falls back to the next channel on resume when the stored row was deleted", async () => {
    const runtime = makeRuntime(() => undefined);
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const channelB = seedChannel(runtime, "Relay B", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter({ quotaDeadIds: new Set() }, records);
    runtime.accountStore.remove(channelA.accountId);

    const plan = kimiChannelPlan("channel-resume-fallback");
    const result = await runtime.resumeCraftAgent({
      craftPlan: plan,
      projectLocation: { ...windowsProject },
      sessionRef: "ses-old",
      prompt: "hi again",
      accountId: channelA.accountId,
    });

    expect(result.accountBinding?.accountId).toBe(channelB.accountId);
    expect(result.accountBinding?.provider).toBe("openai-compatible");
    expect(records.map((record) => record.accountId)).toEqual([channelB.accountId]);
  });

  it("flips a 400ing responses channel to chat on the same row", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter(
      { quotaDeadIds: new Set(), fail400OnceIds: new Set([channelA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-flip"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    await runtime.sendThreadInput({
      threadId: "channel-flip",
      prompt: "hi?",
      config: { ...kimiConfig },
    });

    // Same channel twice (no walk): the replay runs on the flipped wire type.
    expect(records.map((record) => record.accountId)).toEqual([
      channelA.accountId,
      channelA.accountId,
    ]);
    expect(records[0]!.startTurnCalls).toBe(1);
    expect(records[1]!.startTurnCalls).toBe(1);
    expect(failoverEvents(emitted)).toHaveLength(0);
    expect(
      craftedChannelInternals(runtime).craftedSessionBindings.get("channel-flip"),
    ).toMatchObject({ accountId: channelA.accountId, provider: "openai-compatible" });
    // The flipped home must actually project the chat provider table, and the
    // row must not land in the tried set (it isn't dead — only its wire type
    // was).
    const home = recordsHomeForChannel(runtime, channelA.accountId, "k3-256k");
    expect(readFileSync(join(home, "config.toml"), "utf8")).toContain('type = "openai"');
    expect(
      craftedChannelInternals(runtime).craftedFailoverTriedByThread.get("channel-flip"),
    ).toEqual(undefined);
  });

  it("surfaces the second 400 instead of flipping twice", async () => {
    const emitted: unknown[] = [];
    const runtime = makeRuntime((event) => {
      emitted.push(event);
    });
    const channelA = seedChannel(runtime, "Relay A", ["k3-256k"]);
    const records: ChannelRecord[] = [];
    installKimiChannelAdapter(
      { quotaDeadIds: new Set(), fail400AlwaysIds: new Set([channelA.accountId]) },
      records,
    );

    await runtime.craftAgent({
      craftPlan: kimiChannelPlan("channel-flip-twice"),
      projectLocation: { ...windowsProject },
      prompt: "",
      accountId: channelA.accountId,
    });

    const failure = await runtime
      .sendThreadInput({
        threadId: "channel-flip-twice",
        prompt: "hi?",
        config: { ...kimiConfig },
      })
      .then(
        () => {
          throw new Error("expected the turn to fail");
        },
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({ data: { http_status: 400 } });
    expect(records).toHaveLength(2);
    expect(failoverEvents(emitted)).toHaveLength(0);
  });
});
