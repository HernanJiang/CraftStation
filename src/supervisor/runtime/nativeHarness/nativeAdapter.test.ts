import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CraftPlan } from "@/shared/crafting";
import type { ProjectLocation } from "@/shared/contracts";
import {
  DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
  ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
} from "./descriptors";
import { NativeProcessHarnessRuntimeAdapter } from "./nativeAdapter";
import {
  buildAntigravityStreamArgs,
  buildDeepSeekJsonRpcArgs,
  nativeProcessDiagnostic,
  redactNativePayload,
  resolveNativeSpawnTarget,
} from "./nativeTransport";
import { createNativeHarnessRuntimeAdapter, UnavailableNativeHarnessRuntimeAdapter } from "./index";

const location: ProjectLocation = { kind: "windows", path: "C:\\repo" };

async function withoutDshCordisConfig<T>(operation: () => Promise<T>): Promise<T> {
  const previous = process.env.DSH_CORDIS_CONFIG;
  delete process.env.DSH_CORDIS_CONFIG;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.DSH_CORDIS_CONFIG;
    else process.env.DSH_CORDIS_CONFIG = previous;
  }
}

function plan(configPath = "C:\\repo\\cordis.yml"): CraftPlan {
  return {
    id: "plan:deepseek:test",
    recipeId: "recipe:deepseek-native",
    resultItemId: "result:deepseek",
    ingredients: {
      model: {
        slot: "model",
        itemId: "deepseek:deepseek-chat",
        itemVersion: "1",
        vendor: "deepseek",
        kind: "model",
      },
      harness: {
        slot: "harness",
        itemId: "harness:deepseek",
        itemVersion: "1",
        vendor: "deepseek",
        kind: "harness",
      },
    },
    runtimeBinding: {
      harnessKind: "deepseek",
      modelId: "deepseek-v4.1-flash",
      vendor: "deepseek",
      runtimeAdapterId: "native-harness:deepseek",
      ...(configPath ? { options: { configPath } } : { options: {} }),
    },
    workspace: "C:\\repo",
    threadId: "thread:deepseek:test",
    createdAt: new Date(0).toISOString(),
  };
}

class JsonRpcFixture extends EventEmitter {
  readonly methods: string[] = [];
  readonly requests: Array<Record<string, unknown>> = [];
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      const request = JSON.parse(String(chunk)) as {
        id: string;
        method: string;
        params?: { sessionId?: string };
      };
      this.methods.push(request.method);
      this.requests.push(request as unknown as Record<string, unknown>);
      if (request.method === "initialize") {
        this.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { serverInfo: { name: "fixture" } },
          }) + "\n",
        );
      } else if (request.method === "session/prompt") {
        const respond = () => {
          const sessionId = request.params?.sessionId ?? "main";
          const emit = (event: Record<string, unknown>) =>
            this.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                method: "session.event",
                params: { sessionId, event },
              }) + "\n",
            );
          emit({ type: "turn/start", data: { turn: 1 } });
          emit({
            type: "assistant/chunk",
            data: {
              turn: 1,
              step: 1,
              chunk: { type: "reasoning-delta", index: 0, text: "thinking" },
            },
          });
          emit({
            type: "assistant/chunk",
            data: {
              turn: 1,
              step: 1,
              chunk: { type: "text-delta", index: 1, text: "hello" },
            },
          });
          emit({
            type: "assistant/chunk",
            data: {
              turn: 1,
              step: 1,
              chunk: { type: "usage", usage: { inputTokens: 3, outputTokens: 2 } },
            },
          });
          const reason = this.terminalReasons?.[this.promptCount] ?? this.terminalReason;
          this.promptCount += 1;
          emit({
            type: "turn/end",
            data: {
              turn: 1,
              reason,
            },
          });
          this.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: { messageId: "message-1" },
            }) + "\n",
          );
        };
        if (this.promptDelayMs > 0) setTimeout(respond, this.promptDelayMs);
        else respond();
      } else if (request.method === "shutdown") {
        this.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: {} }) + "\n");
      }
      callback();
    },
  });
  private promptCount = 0;
  constructor(
    private readonly promptDelayMs = 0,
    private readonly terminalReason: Record<string, unknown> = { kind: "completed" },
    private readonly terminalReasons?: readonly Record<string, unknown>[],
  ) {
    super();
  }
  killed = false;
  kill = vi.fn<() => boolean>(() => {
    this.killed = true;
    return true;
  });
}

function fixtureProcess(fixture: JsonRpcFixture): ChildProcessWithoutNullStreams {
  return fixture as unknown as ChildProcessWithoutNullStreams;
}

describe("Native process harness adapter", () => {
  it("uses only Antigravity official stream-json machine flags", () => {
    const args = buildAntigravityStreamArgs(["--model", "default"]);
    expect(args).toEqual([
      "--print=",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--model",
      "default",
    ]);
    expect(args.join(" ")).not.toMatch(/pty|tui|acp|json-rpc/iu);
  });

  it("builds official dsh JSON-RPC args with default or custom profile", () => {
    expect(buildDeepSeekJsonRpcArgs()).toEqual(["--profile", "sdk"]);
    expect(buildDeepSeekJsonRpcArgs("sdk-minimal", ["--verbose"])).toEqual([
      "--profile",
      "sdk-minimal",
      "--verbose",
    ]);
  });

  it("resolves native spawn target directly on POSIX and preserves non-cmd commands", () => {
    const target = resolveNativeSpawnTarget("agy", ["--print="]);
    expect(target).toEqual({ command: "agy", args: ["--print="] });
  });

  it("fails closed at spawnEntity before Entity creation when DSH JSON-RPC runtime is unconfigured", async () => {
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh-jsonrpc-agent",
    });
    const unconfiguredPlan = plan("");
    await withoutDshCordisConfig(() =>
      expect(adapter.spawnEntity(unconfiguredPlan)).rejects.toThrow(
        "Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created)",
      ),
    );
    expect(adapter.getDiagnostics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "RUNTIME_UNAVAILABLE",
          message:
            "Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created).",
        }),
      ]),
    );
    expect(adapter.getActiveSessions()).toHaveLength(0);
  });

  describe("DeepSeek production factory behavior matrix", () => {
    it("returns UnavailableNativeHarnessRuntimeAdapter when carrier is absent", async () => {
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => undefined,
      }) as UnavailableNativeHarnessRuntimeAdapter;
      expect(adapter).toBeInstanceOf(UnavailableNativeHarnessRuntimeAdapter);
      expect(adapter.descriptor.harnessKind).toBe("deepseek");
      expect(adapter.descriptor.transport).toBe("deepseek-json-rpc-stdio");
      expect(adapter.getDiagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RUNTIME_UNAVAILABLE",
            message: expect.stringContaining("not installed"),
          }),
        ]),
      );
      await expect(adapter.spawnEntity(plan())).rejects.toThrow(/unavailable/i);
    });

    it("returns NativeProcess adapter but fails closed at spawnEntity when unconfigured", async () => {
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: (cmd) =>
          cmd === "dsh-jsonrpc-agent" ? "C:\\bin\\dsh-jsonrpc-agent.exe" : undefined,
      }) as NativeProcessHarnessRuntimeAdapter;
      expect(adapter).toBeInstanceOf(NativeProcessHarnessRuntimeAdapter);
      expect(adapter.descriptor.harnessKind).toBe("deepseek");
      await withoutDshCordisConfig(() =>
        expect(adapter.spawnEntity(plan(""))).rejects.toThrow(
          "Official DSH runtime requires an explicit Cordis config path (no synthetic Entity created)",
        ),
      );
      expect(adapter.getDiagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RUNTIME_UNAVAILABLE",
            message: expect.stringContaining("requires an explicit Cordis config path"),
          }),
        ]),
      );
      expect(adapter.getActiveSessions()).toHaveLength(0);
    });

    it("rejects createSession with diagnostic on invalid/non-serving exit without session residue", async () => {
      const errorFixture = new EventEmitter() as EventEmitter & {
        readonly stdout: PassThrough;
        readonly stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn<() => boolean>>;
      } & { stdin: Writable };
      Object.assign(errorFixture, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn<() => boolean>(() => {
          errorFixture.killed = true;
          return true;
        }),
      });
      (errorFixture as { stdin: Writable }).stdin = new Writable({
        write: (_chunk, _encoding, callback) => {
          // Immediately simulate non-zero process crash upon startup
          process.nextTick(() => {
            errorFixture.emit("exit", 1, null);
          });
          callback();
        },
      });
      const spawnProcess = vi.fn<() => typeof errorFixture>(
        () => errorFixture,
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;

      const entity = await adapter.spawnEntity(plan("C:\\repo\\invalid.cordis.yml"));
      await expect(adapter.createSession(entity)).rejects.toMatchObject({
        code: "RUNTIME_UNAVAILABLE",
      });
      expect(adapter.getActiveSessions()).toHaveLength(0);
    });

    it("handles protocol mismatch cleanly without session residue", async () => {
      const malformedFixture = new EventEmitter() as EventEmitter & {
        readonly stdout: PassThrough;
        readonly stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn<() => boolean>>;
      } & { stdin: Writable };
      Object.assign(malformedFixture, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn<() => boolean>(() => {
          malformedFixture.killed = true;
          return true;
        }),
      });
      (malformedFixture as { stdin: Writable }).stdin = new Writable({
        write: (_chunk, _encoding, callback) => {
          malformedFixture.stdout.write("MALFORMED NON-JSON OUTPUT\n");
          process.nextTick(() => {
            malformedFixture.emit("exit", 0, null);
          });
          callback();
        },
      });
      const spawnProcess = vi.fn<() => typeof malformedFixture>(
        () => malformedFixture,
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;

      const entity = await adapter.spawnEntity(plan());
      await expect(adapter.createSession(entity)).rejects.toMatchObject({
        code: "PROTOCOL_MISMATCH",
      });
      expect(adapter.getDiagnostics()).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "PROTOCOL_MISMATCH" })]),
      );
      expect(adapter.getActiveSessions()).toHaveLength(0);
    });

    it("terminates child process and clears pending requests on long-lived non-serving timeout", async () => {
      const longLivedFixture = new EventEmitter() as EventEmitter & {
        readonly stdout: PassThrough;
        readonly stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn<() => boolean>>;
      } & { stdin: Writable };
      Object.assign(longLivedFixture, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn<() => boolean>(() => {
          longLivedFixture.killed = true;
          return true;
        }),
      });
      (longLivedFixture as { stdin: Writable }).stdin = new Writable({
        write: (_chunk, _encoding, callback) => {
          // Keep process alive indefinitely without replying to initialize frame
          callback();
        },
      });
      const spawnProcess = vi.fn<() => typeof longLivedFixture>(
        () => longLivedFixture,
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;

      const timeoutPlan = {
        ...plan("C:\\repo\\cordis.yml"),
        runtimeBinding: {
          ...plan("C:\\repo\\cordis.yml").runtimeBinding,
          options: {
            configPath: "C:\\repo\\cordis.yml",
            readinessTimeoutMs: 50,
          },
        },
      };

      const entity = await adapter.spawnEntity(timeoutPlan);
      const createSession = adapter.createSession(entity);
      expect(adapter.getLifecycleSnapshot()).toEqual({
        activeSessions: 0,
        activeTransports: 1,
        runningProcesses: 1,
        pendingRequests: 1,
      });
      await expect(createSession).rejects.toThrow(/timed out/i);
      expect(longLivedFixture.killed).toBe(true);
      expect(adapter.getDiagnostics()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "RUNTIME_UNAVAILABLE",
            message: expect.stringContaining("timed out"),
          }),
        ]),
      );
      expect(adapter.getActiveSessions()).toHaveLength(0);
      expect(adapter.getLifecycleSnapshot()).toEqual({
        activeSessions: 0,
        activeTransports: 0,
        runningProcesses: 0,
        pendingRequests: 0,
      });
    });

    it("manages complete ready lifecycle when valid carrier and config are provided (fixture only)", async () => {
      const fixture = new JsonRpcFixture();
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;

      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);
      expect(adapter.getActiveSessions()).toHaveLength(1);
      const turnResult = await session.startTurn({ prompt: "hello deepseek" });
      expect(turnResult.status).toBe("completed");
      expect(turnResult.response).toBe("hello");
      await session.terminate();
      expect(adapter.getActiveSessions()).toHaveLength(0);
    });

    it("allows a normal prompt to outlive the initialize readiness deadline", async () => {
      const fixture = new JsonRpcFixture(60);
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const shortReadinessPlan = {
        ...plan(),
        runtimeBinding: {
          ...plan().runtimeBinding,
          options: { configPath: "C:\\repo\\cordis.yml", readinessTimeoutMs: 20 },
        },
      };

      const entity = await adapter.spawnEntity(shortReadinessPlan);
      const session = await adapter.createSession(entity);
      await expect(session.startTurn({ prompt: "long but healthy" })).resolves.toMatchObject({
        status: "completed",
        response: "hello",
      });
      await session.terminate();
    });

    it("does not impose the former 15-second transport deadline on a normal turn", async () => {
      vi.useFakeTimers();
      try {
        const fixture = new JsonRpcFixture(20_000);
        const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
          fixtureProcess(fixture),
        ) as unknown as typeof import("node:child_process").spawn;
        const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
          projectLocation: location,
          resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
          spawnProcess,
        }) as NativeProcessHarnessRuntimeAdapter;

        const entity = await adapter.spawnEntity(plan());
        const session = await adapter.createSession(entity);
        let settled = false;
        const turn = session.startTurn({ prompt: "long-running official turn" }).finally(() => {
          settled = true;
        });
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(1);

        await vi.advanceTimersByTimeAsync(15_001);
        expect(settled).toBe(false);
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(1);

        await vi.advanceTimersByTimeAsync(4_999);
        await expect(turn).resolves.toMatchObject({ status: "completed", response: "hello" });
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(0);
        await session.terminate();
      } finally {
        vi.useRealTimers();
      }
    });

    it("binds StartTurnCommand.signal to the pending request and interrupts without failure", async () => {
      vi.useFakeTimers();
      try {
        const fixture = new JsonRpcFixture(60_000);
        const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
          fixtureProcess(fixture),
        ) as unknown as typeof import("node:child_process").spawn;
        const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
          projectLocation: location,
          resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
          spawnProcess,
        }) as NativeProcessHarnessRuntimeAdapter;
        const entity = await adapter.spawnEntity(plan());
        const session = await adapter.createSession(entity);
        const controller = new AbortController();
        const turn = session.startTurn({
          prompt: "cancel this official turn",
          signal: controller.signal,
        });
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(1);

        controller.abort();

        await expect(turn).resolves.toMatchObject({ status: "interrupted" });
        expect(fixture.killed).toBe(process.platform === "win32");
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(0);
        expect(session.getDiagnostics?.() ?? []).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ code: "NATIVE_EXECUTION_FAILED" })]),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not send session/prompt when StartTurnCommand.signal is already aborted", async () => {
      const fixture = new JsonRpcFixture();
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);
      const controller = new AbortController();
      controller.abort();

      await expect(
        session.startTurn({ prompt: "must not reach the provider", signal: controller.signal }),
      ).resolves.toMatchObject({ status: "interrupted" });
      expect(fixture.methods).not.toContain("session/prompt");
      expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(0);
      expect(session.getDiagnostics?.() ?? []).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "NATIVE_EXECUTION_FAILED" })]),
      );
    });

    it("maps an official DSH authentication turn failure to AUTH_REQUIRED", async () => {
      const fixture = new JsonRpcFixture(0, {
        kind: "error",
        error: {
          message: "Authentication Fails, Your api key is invalid",
          code: "AUTH",
          status: 401,
        },
      });
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);

      const rejection = session.startTurn({ prompt: "real provider auth failure" });
      await expect(rejection).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      await expect(rejection).rejects.not.toThrow(/api key is invalid/i);
      expect(session.getSnapshot().events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "error" }),
          expect.objectContaining({ type: "turn.completed", state: "failed" }),
        ]),
      );
      await session.terminate();
    });

    it("maps DSH reason.failure authentication details to AUTH_REQUIRED without leaking provider text", async () => {
      const fixture = new JsonRpcFixture(0, {
        kind: "blocked",
        failure: {
          message: "Authorization: Bearer fake-secret+/token was rejected",
          code: "AUTH",
          status: 401,
        },
      });
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);

      const rejection = session.startTurn({ prompt: "provider auth failure" });
      await expect(rejection).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
      await expect(rejection).rejects.not.toThrow(/fake-secret|Bearer/iu);
      expect(session.getSnapshot().events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "error" }),
          expect.objectContaining({ type: "turn.completed", state: "failed" }),
        ]),
      );
      await session.terminate();
    });

    it.each([
      ["aborted", "interrupted"],
      ["blocked", "failed"],
    ] as const)("maps DSH %s terminal reason to %s", async (kind, expectedState) => {
      const fixture = new JsonRpcFixture(0, { kind });
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);

      const turnOutcome = await session
        .startTurn({ prompt: "terminal state" })
        .then((result) => ({ status: "resolved" as const, result }))
        .catch((error: unknown) => ({ status: "rejected" as const, error }));
      expect(turnOutcome).toMatchObject(
        expectedState === "failed"
          ? { status: "rejected", error: { code: "EXECUTION_FAILED" } }
          : { status: "resolved", result: { status: expectedState } },
      );
      expect(session.getSnapshot().events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "turn.completed", state: expectedState }),
        ]),
      );
      await session.terminate();
    });

    it("continues a DeepSeek turn after max-tokens instead of closing it as completed", async () => {
      const fixture = new JsonRpcFixture(0, { kind: "completed" }, [
        { kind: "max-tokens" },
        { kind: "completed" },
      ]);
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity(plan());
      const session = await adapter.createSession(entity);

      await expect(session.startTurn({ prompt: "finish the long task" })).resolves.toMatchObject({
        status: "completed",
        response: "hellohello",
      });
      expect(fixture.methods.filter((method) => method === "session/prompt")).toHaveLength(2);
      expect(session.getDiagnostics?.() ?? []).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: "auto-continue-max-tokens" }),
        ]),
      );
      expect(
        session.getSnapshot().events.filter((event) => event.type === "turn.completed"),
      ).toHaveLength(1);
      await session.terminate();
    });

    it("respects maxTokenContinuations=0 and reports the provider limit", async () => {
      const fixture = new JsonRpcFixture(0, { kind: "max-tokens" });
      const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
        fixtureProcess(fixture),
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
        projectLocation: location,
        resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
        spawnProcess,
      }) as NativeProcessHarnessRuntimeAdapter;
      const entity = await adapter.spawnEntity({
        ...plan(),
        runtimeBinding: {
          ...plan().runtimeBinding,
          options: { configPath: "C:\\repo\\cordis.yml", maxTokenContinuations: 0 },
        },
      });
      const session = await adapter.createSession(entity);

      await expect(session.startTurn({ prompt: "bounded task" })).rejects.toMatchObject({
        code: "EXECUTION_FAILED",
      });
      expect(fixture.methods.filter((method) => method === "session/prompt")).toHaveLength(1);
      await session.terminate();
    });

    it("uses an independent cleanup deadline when shutdown never responds", async () => {
      vi.useFakeTimers();
      try {
        const fixture = new JsonRpcFixture();
        const originalWrite = fixture.stdin.write.bind(fixture.stdin);
        vi.spyOn(fixture.stdin, "write").mockImplementation((chunk, encoding, callback) => {
          const request = JSON.parse(String(chunk)) as { method: string };
          if (request.method === "shutdown") {
            const done = typeof encoding === "function" ? encoding : callback;
            done?.(null);
            return true;
          }
          return originalWrite(chunk, encoding as never, callback as never);
        });
        const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
          fixtureProcess(fixture),
        ) as unknown as typeof import("node:child_process").spawn;
        const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
          projectLocation: location,
          resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
          spawnProcess,
        }) as NativeProcessHarnessRuntimeAdapter;
        const cleanupPlan = {
          ...plan(),
          runtimeBinding: {
            ...plan().runtimeBinding,
            options: {
              configPath: "C:\\repo\\cordis.yml",
              readinessTimeoutMs: 5,
              cleanupTimeoutMs: 40,
            },
          },
        };
        const entity = await adapter.spawnEntity(cleanupPlan);
        const session = await adapter.createSession(entity);
        let settled = false;
        const termination = session.terminate().finally(() => {
          settled = true;
        });
        expect(adapter.getLifecycleSnapshot().pendingRequests).toBe(1);

        await vi.advanceTimersByTimeAsync(39);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await termination;

        expect(fixture.killed).toBe(true);
        expect(adapter.getLifecycleSnapshot()).toEqual({
          activeSessions: 0,
          activeTransports: 0,
          runningProcesses: 0,
          pendingRequests: 0,
        });
        expect(adapter.getDiagnostics()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "RUNTIME_UNAVAILABLE",
              phase: "dispose",
              operation: "shutdown",
            }),
          ]),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("launches official dsh CLI with --profile sdk and patch config when command is dsh", async () => {
    const fixture = new JsonRpcFixture();
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
      fixtureProcess(fixture),
    ) as unknown as typeof import("node:child_process").spawn;
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "C:\\Users\\Haona\\AppData\\Roaming\\npm\\dsh.cmd",
      spawnProcess,
    });
    const entity = await adapter.spawnEntity(plan());
    const session = await adapter.createSession(entity);
    expect(adapter.getActiveSessions()).toHaveLength(1);
    await session.terminate();
    expect(adapter.getActiveSessions()).toHaveLength(0);
    const spawnCommand = vi.mocked(spawnProcess).mock.calls[0]?.[0];
    // Windows shim 转到 node；其他平台保留显式命令，两种平台都必须断言。
    const expectedCommand =
      process.platform === "win32"
        ? /node(\.exe)?$/i
        : /^C:\\Users\\Haona\\AppData\\Roaming\\npm\\dsh\.cmd$/;
    expect(spawnCommand).toMatch(expectedCommand);
    expect(spawnProcess).toHaveBeenCalledWith(
      spawnCommand,
      expect.arrayContaining(["--profile", "sdk", "--patch", "C:\\repo\\cordis.yml"]),
      expect.objectContaining({
        cwd: "C:\\repo",
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });

  it("maps the official nested DSH session.event stream through a complete turn", async () => {
    const fixture = new JsonRpcFixture();
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
      fixtureProcess(fixture),
    ) as unknown as typeof import("node:child_process").spawn;
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh-jsonrpc-agent-fixture",
      spawnProcess,
    });
    const entity = await adapter.spawnEntity(plan());
    const session = await adapter.createSession(entity);
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    const result = await session.startTurn({ prompt: "private prompt" });
    expect(spawnProcess).toHaveBeenCalledWith(
      "dsh-jsonrpc-agent-fixture",
      ["C:\\repo\\cordis.yml"],
      expect.objectContaining({
        cwd: "C:\\repo",
        stdio: ["pipe", "pipe", "pipe"],
        env: expect.objectContaining({ DSH_CORDIS_CONFIG: "C:\\repo\\cordis.yml" }),
      }),
    );
    expect(result).toMatchObject({ status: "completed", response: "hello" });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "content.delta",
          stream: "reasoning_text",
          delta: "thinking",
        }),
        expect.objectContaining({
          type: "content.delta",
          stream: "assistant_text",
          delta: "hello",
        }),
        expect.objectContaining({ type: "turn.completed", state: "completed" }),
      ]),
    );
    expect(
      events.filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: string }).type === "turn.started",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(session.getSnapshot())).not.toContain("private prompt");
    await session.terminate();
    expect(fixture.methods).toEqual(["initialize", "session/prompt", "shutdown"]);
    expect(fixture.requests[0]?.params).toEqual({
      cwd: "C:\\repo",
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
  });

  it("fails closed before Entity creation on an unknown DSH model id", async () => {
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>();
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh-jsonrpc-agent-fixture",
      spawnProcess: spawnProcess as unknown as typeof import("node:child_process").spawn,
    });
    const unknownPlan: CraftPlan = {
      ...plan(),
      runtimeBinding: { ...plan().runtimeBinding, modelId: "deepseek-chat" },
    };
    await expect(adapter.spawnEntity(unknownPlan)).rejects.toMatchObject({
      code: "EXECUTION_FAILED",
      details: { code: "UNKNOWN_DSH_MODEL_ID", modelId: "deepseek-chat" },
    });
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(adapter.getActiveSessions()).toHaveLength(0);
  });

  it("sends the official dsh model id verbatim when already canonical", async () => {
    const fixture = new JsonRpcFixture();
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
      fixtureProcess(fixture),
    ) as unknown as typeof import("node:child_process").spawn;
    const adapter = new NativeProcessHarnessRuntimeAdapter({
      descriptor: DEEPSEEK_NATIVE_HARNESS_DESCRIPTOR,
      projectLocation: location,
      mode: "deepseek",
      runtimeCommand: "dsh-jsonrpc-agent-fixture",
      spawnProcess,
    });
    const officialPlan: CraftPlan = {
      ...plan(),
      runtimeBinding: { ...plan().runtimeBinding, modelId: "deepseek-v4-pro" },
    };
    const entity = await adapter.spawnEntity(officialPlan);
    const session = await adapter.createSession(entity);
    expect(fixture.requests[0]?.params).toMatchObject({ model: "deepseek-v4-pro" });
    await session.terminate();
  });

  it.each([{ chunks: ["hello"] }, { chunks: ["hello", "hello"] }, { chunks: ["hello", "lo"] }])(
    "waits for Antigravity result and preserves repeated deltas: $chunks",
    async ({ chunks }) => {
      const fixture = new EventEmitter() as EventEmitter & {
        readonly stdout: PassThrough;
        readonly stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn<() => boolean>>;
      } & { stdin: Writable };
      Object.assign(fixture, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn<() => boolean>(() => {
          fixture.killed = true;
          return true;
        }),
      });
      (fixture as { stdin: Writable }).stdin = new Writable({
        write: (chunk, _encoding, callback) => {
          const request = JSON.parse(String(chunk)) as Record<string, unknown>;
          const emit = (event: Record<string, unknown>) => {
            fixture.stdout.write(`${JSON.stringify(event)}\n`);
          };
          emit({ event: "init", conversation_id: "agy-session" });
          emit({ event: "step_update", step_update: { step_type: "user_input", state: "DONE" } });
          emit({
            event: "step_update",
            step_update: {
              conversation_id: "agy-session",
              step_index: 2,
              step_type: "tool",
              tool_name: "view_file",
              state: "ACTIVE",
            },
          });
          emit({
            event: "step_update",
            step_update: {
              conversation_id: "agy-session",
              step_index: 2,
              step_type: "tool",
              tool_name: "view_file",
              state: "DONE",
            },
          });
          emit({
            event: "step_update",
            step_update: {
              conversation_id: "agy-session",
              step_index: 3,
              step_type: "subagent",
              tool_name: "invoke_subagent",
              state: "ACTIVE",
            },
          });
          emit({
            event: "step_update",
            step_update: {
              conversation_id: "agy-session",
              step_index: 3,
              step_type: "subagent",
              tool_name: "invoke_subagent",
              state: "DONE",
            },
          });
          for (const text of chunks)
            emit({
              event: "step_update",
              step_update: { step_type: "agent_response", state: "ACTIVE", text_delta: text },
            });
          emit({
            event: "step_update",
            step_update: { step_type: "agent_response", state: "DONE" },
          });
          emit({ event: "result", result: { status: "SUCCESS", response: chunks.join("") } });
          void request;
          callback();
        },
      });
      const spawnProcess = vi.fn<() => typeof fixture>(
        () => fixture,
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = new NativeProcessHarnessRuntimeAdapter({
        descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: location,
        mode: "antigravity",
        runtimeCommand: "agy-fixture",
        spawnProcess,
      });
      const antigravityPlan = {
        ...plan(),
        id: "plan:antigravity:test",
        recipeId: "recipe:google-antigravity-native",
        resultItemId: "result:antigravity",
        ingredients: {
          model: {
            ...plan().ingredients.model!,
            itemId: "google:antigravity-default",
            vendor: "google",
          },
          harness: {
            ...plan().ingredients.harness!,
            itemId: "harness:antigravity",
            vendor: "google",
          },
        },
        runtimeBinding: {
          ...plan().runtimeBinding,
          harnessKind: "antigravity",
          modelId: "Gemini 3.5 Flash",
          vendor: "google",
          runtimeAdapterId: "native-harness:antigravity",
        },
      };
      const entity = await adapter.spawnEntity(antigravityPlan);
      const session = await adapter.createSession(entity);
      const result = await session.startTurn({ prompt: "hello" });
      expect(result).toMatchObject({ status: "completed", response: chunks.join("") });
      expect(session.sessionRef).toBe("agy-session");
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "item.started", itemId: "tool:agy-session:2" }),
          expect.objectContaining({ type: "item.completed", itemId: "tool:agy-session:2" }),
          expect.objectContaining({
            type: "item.started",
            itemId: "subagent:agy-session:3",
            payload: expect.objectContaining({ isSubAgent: true }),
          }),
          expect.objectContaining({
            type: "item.completed",
            itemId: "subagent:agy-session:3",
            payload: expect.objectContaining({ isSubAgent: true }),
          }),
        ]),
      );
    },
  );

  it.runIf(process.platform === "win32")(
    "marks session terminated on Windows interrupt with unique canonical events and auto adapter release",
    async () => {
      const fixture = new EventEmitter() as EventEmitter & {
        readonly stdout: PassThrough;
        readonly stderr: PassThrough;
        killed: boolean;
        kill: ReturnType<typeof vi.fn<() => boolean>>;
      } & { stdin: Writable };
      Object.assign(fixture, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        killed: false,
        kill: vi.fn<() => boolean>(() => {
          fixture.killed = true;
          return true;
        }),
      });
      (fixture as { stdin: Writable }).stdin = new Writable({
        write: (_chunk, _encoding, callback) => {
          callback();
        },
      });
      const spawnProcess = vi.fn<() => typeof fixture>(
        () => fixture,
      ) as unknown as typeof import("node:child_process").spawn;
      const adapter = new NativeProcessHarnessRuntimeAdapter({
        descriptor: ANTIGRAVITY_NATIVE_HARNESS_DESCRIPTOR,
        projectLocation: location,
        mode: "antigravity",
        runtimeCommand: "agy-fixture",
        spawnProcess,
      });
      const entity = await adapter.spawnEntity({
        ...plan(),
        runtimeBinding: {
          ...plan().runtimeBinding,
          harnessKind: "antigravity",
          runtimeAdapterId: "native-harness:antigravity",
        },
      });
      const session = await adapter.createSession(entity);
      expect(adapter.getActiveSessions()).toHaveLength(1);
      const observedEvents: Array<{ type: string; state?: string; reason?: string }> = [];
      session.subscribe((event) => {
        observedEvents.push(event as { type: string; state?: string; reason?: string });
      });
      const turnPromise = session.startTurn({ prompt: "long running prompt" });
      await session.interrupt();
      const turnResult = await turnPromise;
      expect(turnResult.status).toBe("interrupted");
      expect(session.status).toBe("terminated");

      // Direct contract assertions for F44:
      const completedEvents = observedEvents.filter((e) => e.type === "turn.completed");
      const exitedEvents = observedEvents.filter((e) => e.type === "session.exited");
      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]?.state).toBe("interrupted");
      expect(exitedEvents).toHaveLength(1);
      expect(exitedEvents[0]?.reason).toBe("interrupted");

      // Auto adapter-level release:
      expect(adapter.getActiveSessions()).toHaveLength(0);

      await expect(session.startTurn({ prompt: "next prompt" })).rejects.toThrow(
        "Cannot use a disposed or terminated native session",
      );
    },
  );

  it("releases the session exactly once when a ready native carrier exits on its own", async () => {
    const fixture = new JsonRpcFixture(60_000);
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
      fixtureProcess(fixture),
    ) as unknown as typeof import("node:child_process").spawn;
    const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
      projectLocation: location,
      resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
      spawnProcess,
    }) as NativeProcessHarnessRuntimeAdapter;
    const entity = await adapter.spawnEntity(plan());
    const session = await adapter.createSession(entity);
    const observedEvents: Array<{ type: string; state?: string; reason?: string }> = [];
    session.subscribe((event) => {
      observedEvents.push(event as { type: string; state?: string; reason?: string });
    });

    const turn = session.startTurn({ prompt: "carrier exits during active turn" });
    fixture.emit("exit", 9, null);

    await expect(turn).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(observedEvents.filter((event) => event.type === "turn.completed")).toEqual([
      expect.objectContaining({ state: "failed" }),
    ]);
    expect(observedEvents.filter((event) => event.type === "session.exited")).toEqual([
      expect.objectContaining({ reason: "process-crashed" }),
    ]);
    expect(adapter.getLifecycleSnapshot()).toEqual({
      activeSessions: 0,
      activeTransports: 0,
      runningProcesses: 0,
      pendingRequests: 0,
    });
    fixture.emit("exit", 9, null);
    expect(observedEvents.filter((event) => event.type === "session.exited")).toHaveLength(1);
  });

  it("does not fail a healthy turn merely because the carrier writes a stderr warning", async () => {
    const fixture = new JsonRpcFixture();
    const originalWrite = fixture.stdin.write.bind(fixture.stdin);
    vi.spyOn(fixture.stdin, "write").mockImplementation((chunk, encoding, callback) => {
      const request = JSON.parse(String(chunk)) as { method: string };
      if (request.method === "session/prompt") fixture.stderr.write("provider warning only\n");
      return originalWrite(chunk, encoding as never, callback as never);
    });
    const spawnProcess = vi.fn<() => ChildProcessWithoutNullStreams>(() =>
      fixtureProcess(fixture),
    ) as unknown as typeof import("node:child_process").spawn;
    const adapter = createNativeHarnessRuntimeAdapter("deepseek", {
      projectLocation: location,
      resolveExecutable: () => "C:\\bin\\dsh-jsonrpc-agent.exe",
      spawnProcess,
    }) as NativeProcessHarnessRuntimeAdapter;
    const entity = await adapter.spawnEntity(plan());
    const session = await adapter.createSession(entity);

    await expect(session.startTurn({ prompt: "healthy despite warning" })).resolves.toMatchObject({
      status: "completed",
      response: "hello",
    });
    await session.terminate();
  });

  it("never serializes prompt, assistant content, delta streams, or credentials into the native envelope", () => {
    const payload = redactNativePayload({
      prompt: "private user prompt",
      content: [{ type: "text", text: "private assistant content" }],
      text_delta: "streamed private chunk",
      reasoning_delta: "streamed reasoning private chunk",
      output_text: "complete private answer",
      delta: { text: "inner delta text" },
      query: "private search query",
      authorization: "Bearer private-token",
      cookie: "session=private-cookie",
      usage: { inputTokens: 3 },
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("private user prompt");
    expect(serialized).not.toContain("private assistant content");
    expect(serialized).not.toContain("streamed private chunk");
    expect(serialized).not.toContain("streamed reasoning private chunk");
    expect(serialized).not.toContain("complete private answer");
    expect(serialized).not.toContain("inner delta text");
    expect(serialized).not.toContain("private search query");
    expect(serialized).not.toContain("private-token");
    expect(serialized).not.toContain("private-cookie");
    expect(payload).toMatchObject({
      prompt: { redacted: true, chars: 19 },
      content: { redacted: true, blockCount: 1 },
      text_delta: { redacted: true, chars: 22 },
      reasoning_delta: { redacted: true, chars: 32 },
      output_text: { redacted: true, chars: 23 },
      authorization: "[REDACTED]",
    });
  });

  it("redacts inline credential values while preserving the diagnostic field name", () => {
    const diagnostic = nativeProcessDiagnostic(
      "deepseek",
      "Provider rejected api_key=private-value+/token and Authorization: Bearer private.value-_/+token and authorization=Bearer second.secret+/token",
    );

    expect(diagnostic.message).toContain("api_key=[REDACTED]");
    expect(diagnostic.message).toContain("authorization=[REDACTED]");
    expect(diagnostic.message).not.toMatch(
      /private-value|private\.value|second\.secret|Bearer\s+[^[]/iu,
    );
  });
});
