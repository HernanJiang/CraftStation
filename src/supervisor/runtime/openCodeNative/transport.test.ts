import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import type { OpenCodeNativeClient } from "./transport";
import { OpenCodeNativeTransport } from "./transport";

const location: ProjectLocation = { kind: "windows", path: "C:/workspace" };
type ApiCall = (parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>;
type EventCall = (options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>;

function clientWithStream(stream: AsyncIterable<unknown>): OpenCodeNativeClient {
  return {
    session: {
      create: vi.fn<ApiCall>(),
      get: vi.fn<ApiCall>(),
      promptAsync: vi.fn<ApiCall>(),
      abort: vi.fn<ApiCall>(),
      messages: vi.fn<ApiCall>(),
      summarize: vi.fn<ApiCall>(),
      delete: vi.fn<ApiCall>(),
    },
    permission: { reply: vi.fn<ApiCall>() },
    question: { reply: vi.fn<ApiCall>(), reject: vi.fn<ApiCall>() },
    provider: { list: vi.fn<ApiCall>(), auth: vi.fn<ApiCall>() },
    global: { event: vi.fn<EventCall>().mockResolvedValue({ stream }) },
  };
}

async function* oneEvent(event: unknown): AsyncIterable<unknown> {
  yield event;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenCodeNativeTransport", () => {
  it("connects to an existing official server and forwards global SSE events", async () => {
    const client = clientWithStream(
      oneEvent({ type: "session.idle", properties: { sessionID: "ses_1" } }),
    );
    const factory = vi.fn<() => OpenCodeNativeClient>(() => client);
    const transport = new OpenCodeNativeTransport({
      projectLocation: location,
      baseUrl: "http://127.0.0.1:4096",
      authorization: "Basic supervisor-only",
      clientFactory: (baseUrl, authorization) => {
        expect(baseUrl).toBe("http://127.0.0.1:4096");
        expect(authorization).toBe("Basic supervisor-only");
        return factory();
      },
    });
    const connection = await transport.connect();
    const received: unknown[] = [];
    const unsubscribe = connection.subscribe((event) => received.push(event));
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ type: "session.idle" });
    unsubscribe();
    await connection.dispose();
  });

  it("reports an unavailable server startup without exposing credentials", async () => {
    const diagnostics: unknown[] = [];
    const transport = new OpenCodeNativeTransport({
      projectLocation: location,
      onDiagnostic: (record) => diagnostics.push(record),
      readyTimeoutMs: 10,
    });
    await expect(transport.connect()).rejects.toThrow("RUNTIME_UNAVAILABLE");
    expect(JSON.stringify(diagnostics)).not.toMatch(/api[_ -]?key|token|cookie|password/iu);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        phase: "start",
        operation: "server.start",
        code: "RUNTIME_UNAVAILABLE",
        correlationId: expect.any(String),
      }),
    ]);
  });

  it("reports SSE reconnect through the unified readiness diagnostic", async () => {
    async function* failingStream(): AsyncIterable<unknown> {
      yield await Promise.reject(new Error("Bearer private-token connection lost"));
    }
    const diagnostics: unknown[] = [];
    const transport = new OpenCodeNativeTransport({
      projectLocation: location,
      baseUrl: "http://127.0.0.1:4096",
      clientFactory: () => clientWithStream(failingStream()),
      onDiagnostic: (record) => diagnostics.push(record),
    });
    const connection = await transport.connect();
    const unsubscribe = connection.subscribe(() => undefined);
    await vi.waitFor(() => expect(diagnostics).toHaveLength(1));
    expect(diagnostics[0]).toMatchObject({
      phase: "readiness",
      operation: "sse.reconnect",
      code: "NATIVE_EXECUTION_FAILED",
      correlationId: connection.correlationId,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("private-token");
    unsubscribe();
    await connection.dispose();
  });

  it("spawns with an allowlist-first environment scoped to the selected account", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "unrelated-provider-secret");
    vi.stubEnv("GROK_HOME", "C:/unrelated-account");
    vi.stubEnv("CRAFTSTATION_UNRELATED_ACCOUNT_MARKER", "must-not-inherit");
    const captured: Array<Record<string, unknown>> = [];
    const spawnProcess = vi.fn<
      (command: string, args: readonly string[], options: unknown) => unknown
    >((command, args, options) => {
      captured.push({ command, args, options: options as Record<string, unknown> });
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        exitCode: number | null;
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.exitCode = null;
      child.killed = false;
      child.kill = vi.fn<() => void>();
      queueMicrotask(() => {
        child.stdout.write("opencode server listening on http://127.0.0.1:43123\n");
      });
      return child;
    });
    const transport = new OpenCodeNativeTransport({
      projectLocation: location,
      executablePath: "C:/tools/opencode.exe",
      serverEnvironment: {
        OPENAI_API_KEY: "selected-account-secret",
        HOME: "C:/host-home",
        USERPROFILE: "C:/other-profile",
        APPDATA: "C:/other-appdata",
        LOCALAPPDATA: "C:/other-local-appdata",
        XDG_CONFIG_HOME: "C:/other-xdg-config",
        XDG_DATA_HOME: "C:/other-xdg-data",
        XDG_CACHE_HOME: "C:/other-xdg-cache",
        OPENCODE_CONFIG_DIR: "C:/other-opencode-config",
      },
      spawnProcess: spawnProcess as never,
      clientFactory: () => clientWithStream(oneEvent({ type: "session.idle" })),
    });

    await transport.connect();
    const env = (captured[0]?.options as { env?: Record<string, string> } | undefined)?.env ?? {};
    expect(env.OPENAI_API_KEY).toBe("selected-account-secret");
    expect(env.HOME).toBe(env.USERPROFILE);
    expect(env.APPDATA).toBe(join(env.HOME!, "appdata"));
    expect(env.LOCALAPPDATA).toBe(join(env.HOME!, "local-appdata"));
    expect(env.XDG_CONFIG_HOME).toBe(join(env.HOME!, "config"));
    expect(env.XDG_DATA_HOME).toBe(join(env.HOME!, "data"));
    expect(env.XDG_CACHE_HOME).toBe(join(env.HOME!, "cache"));
    expect(env.OPENCODE_CONFIG_DIR).toBe(join(env.HOME!, "config", "opencode"));
    for (const projectedPath of [
      "C:/host-home",
      "C:/other-profile",
      "C:/other-appdata",
      "C:/other-local-appdata",
      "C:/other-xdg-config",
      "C:/other-xdg-data",
      "C:/other-xdg-cache",
      "C:/other-opencode-config",
    ]) {
      expect(Object.values(env)).not.toContain(projectedPath);
    }
    expect(env.OPENCODE_SERVER_USERNAME).toBe("craftstation");
    expect(env.OPENCODE_SERVER_PASSWORD).toEqual(expect.any(String));
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.GROK_HOME).toBeUndefined();
    expect(env.CRAFTSTATION_UNRELATED_ACCOUNT_MARKER).toBeUndefined();
    expect(Object.keys(env)).not.toContain("NODE_OPTIONS");
    await transport.dispose();
  });
});
