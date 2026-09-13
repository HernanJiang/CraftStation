import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { CompatibilityBridgeService } from "./bridge";
import { CompatibilityRuntimeAdapter } from "./compatibilityRuntimeAdapter";
import { writeOpenCodeConfigFile } from "./exporters";
import type { FetchFunction, SpawnFunction } from "./types";
import type { CraftPlan } from "@/shared/crafting/types";

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
}

type SpawnCall = { command: string; args: string[]; options: SpawnOptions };

function makeSpawnFn(script: Array<() => void>): { spawnFn: SpawnFunction; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnFn: SpawnFunction = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChildProcess() as unknown as ChildProcess;
    queueMicrotask(() => {
      for (const step of script) step.call(child);
    });
    return child;
  };
  return { spawnFn, calls };
}

let plan: CraftPlan;

describe("CompatibilityRuntimeAdapter", () => {
  beforeEach(() => {
    plan = {
      id: "recipe:compat-tracer",
      threadId: "compat-thread-1",
      resultItemId: "result:compat-1",
      createdAt: new Date().toISOString(),
      runtimeBinding: {
        harnessKind: "opencode",
        vendor: "grok",
        modelId: "grok-3-mini",
        routeType: "compatibility",
      },
    } as unknown as CraftPlan;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeBridge(overrides?: {
    fetchFn?: (url: string | URL, init?: RequestInit) => Promise<Response>;
  }): { bridge: CompatibilityBridgeService; fetchFn: FetchFunction } {
    const fetchFn: FetchFunction =
      overrides?.fetchFn ??
      (async (url: string | URL) => {
        const target = String(url);
        if (target.endsWith("/healthz")) {
          return new Response("ok", { status: 200 });
        }
        throw new Error(`unexpected fetch ${target}`);
      });
    // A fake sidecar process that stays alive so the readiness probe succeeds
    // without launching a real binary.
    const spawnFn: SpawnFunction = () => {
      const child = new FakeChildProcess() as unknown as ChildProcess;
      return child;
    };
    const bridge = new CompatibilityBridgeService({
      binaryPath: "C:/tools/cli-proxy-api.exe",
      apiKey: "test-key",
      port: 18399,
      fetchFn,
      spawnFn,
    });
    return { bridge, fetchFn };
  }

  it("refuses native plans and only accepts compatibility plans for its harness", () => {
    const adapter = new CompatibilityRuntimeAdapter("opencode", {
      bridge: makeBridge().bridge,
    });
    expect(adapter.supports(plan)).toBe(true);
    const nativePlan = {
      ...plan,
      runtimeBinding: { ...plan.runtimeBinding, routeType: "native" },
    } as unknown as CraftPlan;
    expect(adapter.supports(nativePlan)).toBe(false);
  });

  it("starts the bridge, verifies the model contract and exposes compatibility metadata", async () => {
    const fetchFn = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        const target = String(url);
        if (target.endsWith("/healthz")) return new Response("ok", { status: 200 });
        if (target.endsWith("/v1/models")) {
          return new Response(
            JSON.stringify({ data: [{ id: "grok-3-mini" }, { id: "grok-4.3" }] }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const { bridge } = makeBridge({ fetchFn: fetchFn as unknown as FetchFunction });
    const adapter = new CompatibilityRuntimeAdapter("opencode", {
      bridge,
      fetchFn: fetchFn as unknown as FetchFunction,
    });

    const entity = await adapter.spawnEntity(plan);

    expect(entity.metadata).toMatchObject({
      routeType: "compatibility",
      compatibilityProtocol: "openai-compatible",
      accountId: undefined,
      modelId: "grok-3-mini",
    });
    const modelsCall = fetchFn.mock.calls.find(([target]) => String(target).endsWith("/v1/models"));
    expect(modelsCall).toBeDefined();
    await adapter.dispose?.();
  });

  it("fails closed when the bridge does not serve the planned model", async () => {
    const fetchFn = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        const target = String(url);
        if (target.endsWith("/healthz")) return new Response("ok", { status: 200 });
        if (target.endsWith("/v1/models")) {
          return new Response(JSON.stringify({ data: [{ id: "unrelated-model" }] }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const { bridge } = makeBridge({ fetchFn: fetchFn as unknown as FetchFunction });
    const adapter = new CompatibilityRuntimeAdapter("opencode", {
      bridge,
      fetchFn: fetchFn as unknown as FetchFunction,
      modelVerifyTimeoutMs: 1500,
    });

    await expect(adapter.spawnEntity(plan)).rejects.toMatchObject({
      code: "RUNTIME_UNAVAILABLE",
    });
    await adapter.dispose?.();
  });

  it("runs a bridge-shaped turn: isolated opencode config, JSON events, session ref", async () => {
    const fetchFn = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        const target = String(url);
        if (target.endsWith("/healthz")) return new Response("ok", { status: 200 });
        if (target.endsWith("/v1/models")) {
          return new Response(JSON.stringify({ data: [{ id: "grok-3-mini" }] }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const sessionId = "ses_unit_test_1";
    const { spawnFn, calls } = makeSpawnFn([
      function (this: FakeChildProcess) {
        this.stdout?.emit(
          "data",
          `${JSON.stringify({ type: "step_start", sessionID: sessionId, part: { type: "step-start" } })}\n`,
        );
        this.stdout?.emit(
          "data",
          `${JSON.stringify({
            type: "text",
            sessionID: sessionId,
            part: { id: "prt_1", type: "text", text: "BRIDGE_TURN_OK" },
          })}\n`,
        );
        this.stdout?.emit(
          "data",
          `${JSON.stringify({ type: "step_finish", sessionID: sessionId, part: { type: "step-finish" } })}\n`,
        );
        this.exitCode = 0;
        this.emit("exit", 0, null);
      },
    ]);
    const { bridge } = makeBridge({ fetchFn: fetchFn as unknown as FetchFunction });
    const adapter = new CompatibilityRuntimeAdapter("opencode", {
      bridge,
      fetchFn: fetchFn as unknown as FetchFunction,
      spawnFn,
    });

    const entity = await adapter.spawnEntity(plan);
    const session = await adapter.createSession(entity);
    const turn = await session.startTurn({ prompt: "say hi" });

    expect(turn.status).toBe("completed");
    expect(turn.response).toBe("BRIDGE_TURN_OK");
    expect(session.nativeSessionRef).toBe(sessionId);
    const snapshot = session.getSnapshot();
    expect(snapshot.routeType).toBe("compatibility");
    expect(snapshot.compatibilityBridgeEndpoint).toBe("http://127.0.0.1:18399");
    // The official Target Harness CLI was launched with the bridge config.
    expect(calls[0]?.command).toContain("opencode");
    expect(calls[0]?.args).toContain("--format");
    expect(calls[0]?.args).toContain("craftstation-compat/grok-3-mini");
    expect(calls[0]?.options.env?.OPENCODE_CONFIG).toBeTruthy();
    expect(calls[0]?.options.windowsHide).toBe(true);
    await adapter.dispose?.();
  });

  it("launches official Muse Code against the CPA gateway, not OpenCode", async () => {
    const fetchFn = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        const target = String(url);
        if (target.endsWith("/healthz")) return new Response("ok", { status: 200 });
        if (target.endsWith("/v1/models")) {
          return new Response(JSON.stringify({ data: [{ id: "grok-4.3" }] }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const { spawnFn, calls } = makeSpawnFn([
      function (this: FakeChildProcess) {
        this.stdout?.emit("data", "PONG\n");
        this.exitCode = 0;
        this.emit("exit", 0, null);
      },
    ]);
    const { bridge } = makeBridge({ fetchFn: fetchFn as unknown as FetchFunction });
    const adapter = new CompatibilityRuntimeAdapter("muse", {
      bridge,
      fetchFn: fetchFn as unknown as FetchFunction,
      spawnFn,
      resolveBinaryFn: (command) => (command === "muse" ? "muse" : undefined),
    });
    const musePlan = {
      ...plan,
      runtimeBinding: { ...plan.runtimeBinding, harnessKind: "muse", modelId: "grok-4.3" },
    } as unknown as CraftPlan;

    const entity = await adapter.spawnEntity(musePlan);
    const session = await adapter.createSession(entity);
    const turn = await session.startTurn({ prompt: "reply with PONG" });

    expect(turn.status).toBe("completed");
    expect(turn.response).toContain("PONG");
    expect(calls[0]?.command).toBe("muse");
    expect(calls[0]?.args).toContain("exec");
    expect(calls[0]?.args).toContain("--provider");
    expect(calls[0]?.options.env?.META_API_KEY).toBeTruthy();
    expect(String(calls[0]?.options.env?.CRAFTSTATION_MUSE_BASE_URL ?? "")).toMatch(/^http:\/\//);
    await session.terminate();
    await adapter.dispose?.();
  });

  it("launches official DeepSeek Harness with CPA as DEEPSEEK_BASE_URL", async () => {
    const fetchFn = vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(
      async (url) => {
        const target = String(url);
        if (target.endsWith("/healthz")) return new Response("ok", { status: 200 });
        if (target.endsWith("/v1/models")) {
          return new Response(JSON.stringify({ data: [{ id: "grok-4.3" }] }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${target}`);
      },
    );
    const { spawnFn, calls } = makeSpawnFn([
      function (this: FakeChildProcess) {
        this.stdout?.emit("data", "DSH_OK\n");
        this.exitCode = 0;
        this.emit("exit", 0, null);
      },
    ]);
    const { bridge } = makeBridge({ fetchFn: fetchFn as unknown as FetchFunction });
    const adapter = new CompatibilityRuntimeAdapter("deepseek", {
      bridge,
      fetchFn: fetchFn as unknown as FetchFunction,
      spawnFn,
      resolveBinaryFn: (command) => (command === "dsh" ? "dsh" : undefined),
    });
    const dshPlan = {
      ...plan,
      runtimeBinding: { ...plan.runtimeBinding, harnessKind: "deepseek", modelId: "grok-4.3" },
    } as unknown as CraftPlan;

    const entity = await adapter.spawnEntity(dshPlan);
    const session = await adapter.createSession(entity);
    const turn = await session.startTurn({ prompt: "say hi" });

    expect(turn.status).toBe("completed");
    expect(calls[0]?.command).toBe("dsh");
    expect(calls[0]?.args).toEqual(["--profile", "acp"]);
    expect(calls[0]?.options.env?.DEEPSEEK_BASE_URL).toBe("http://127.0.0.1:18399/v1");
    expect(calls[0]?.options.env?.DEEPSEEK_API_KEY).toBeTruthy();
    await session.terminate();
    await adapter.dispose?.();
  });
});

describe("writeOpenCodeConfigFile", () => {
  it("writes an isolated provider config with the bridge credentials", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "cs-compat-"));
    try {
      const path = writeOpenCodeConfigFile(
        {
          harnessKind: "opencode",
          baseUrl: "http://127.0.0.1:18317/v1",
          apiKey: "secret-bridge-key",
          model: "grok-3-mini",
          protocol: "openai-compatible",
          customEnv: {},
        },
        dir,
      );
      const doc = JSON.parse(await readFile(path, "utf8")) as {
        provider: Record<
          string,
          | { options: { baseURL: string; apiKey: string }; models: Record<string, unknown> }
          | undefined
        >;
      };
      const provider = doc.provider["craftstation-compat"];
      expect(provider?.options.baseURL).toBe("http://127.0.0.1:18317/v1");
      expect(provider?.options.apiKey).toBe("secret-bridge-key");
      expect(Object.keys(provider?.models ?? {})).toEqual(["grok-3-mini"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
