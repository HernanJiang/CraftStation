import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import type { OpenCodeNativeClient, OpenCodeNativeConnection } from "./transport";
import { OpenCodeNativeServerPool } from "./serverPool";

const location: ProjectLocation = { kind: "windows", path: "C:/workspace" };

function emptyStream(): AsyncIterable<unknown> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true as const, value: undefined }),
      };
    },
  };
}

function fakeClient(): OpenCodeNativeClient {
  const call = vi
    .fn<(parameters?: Record<string, unknown>) => Promise<{ data?: unknown }>>()
    .mockResolvedValue({ data: {} });
  return {
    session: {
      create: call,
      get: call,
      promptAsync: call,
      abort: call,
      messages: call,
      summarize: call,
      delete: call,
    },
    permission: { reply: call },
    question: { reply: call, reject: call },
    provider: { list: call, auth: call },
    global: {
      event: vi
        .fn<(options?: Record<string, unknown>) => Promise<{ stream: AsyncIterable<unknown> }>>()
        .mockResolvedValue({ stream: emptyStream() }),
    },
  };
}

describe("OpenCode native Supervisor server pool", () => {
  it("isolates different bindings and reuses one server for concurrent same-binding sessions", async () => {
    const created: Array<{ options: Record<string, unknown>; child: EventEmitter }> = [];
    const pool = new OpenCodeNativeServerPool({
      transportFactory: ((options: Record<string, unknown>) => {
        const child = new EventEmitter();
        const index = created.length;
        created.push({ options, child });
        return {
          correlationId: `corr:${index}`,
          connect: vi.fn<() => Promise<OpenCodeNativeConnection>>(async () => ({
            client: fakeClient(),
            baseUrl: `http://127.0.0.1:${4000 + index}`,
            correlationId: `corr:${index}`,
            child: child as never,
            subscribe: () => () => undefined,
            dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          })),
          dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
      }) as never,
    });

    const first = pool.acquire({
      isolationKey: "scope:a",
      transportOptions: { projectLocation: location, serverEnvironment: { OPENAI_API_KEY: "a" } },
    });
    const sibling = pool.acquire({
      isolationKey: "scope:a",
      transportOptions: { projectLocation: location, serverEnvironment: { OPENAI_API_KEY: "a" } },
    });
    const isolated = pool.acquire({
      isolationKey: "scope:b",
      transportOptions: { projectLocation: location, serverEnvironment: { OPENAI_API_KEY: "b" } },
    });
    const [firstConnection, siblingConnection, isolatedConnection] = await Promise.all([
      first.connect(),
      sibling.connect(),
      isolated.connect(),
    ]);

    expect(created).toHaveLength(2);
    expect(firstConnection.baseUrl).toBe(siblingConnection.baseUrl);
    expect(isolatedConnection.baseUrl).not.toBe(firstConnection.baseUrl);
    expect(created[0]?.options).toMatchObject({ serverEnvironment: { OPENAI_API_KEY: "a" } });
    expect(created[1]?.options).toMatchObject({ serverEnvironment: { OPENAI_API_KEY: "b" } });

    await firstConnection.dispose();
    await siblingConnection.dispose();
    await isolatedConnection.dispose();
    await pool.dispose();
  });

  it("evicts a dead child so the next acquire restarts instead of reusing a poisoned server", async () => {
    const children: EventEmitter[] = [];
    const pool = new OpenCodeNativeServerPool({
      transportFactory: (() => {
        const child = new EventEmitter();
        children.push(child);
        const index = children.length;
        return {
          correlationId: `corr:${index}`,
          connect: async (): Promise<OpenCodeNativeConnection> => ({
            client: fakeClient(),
            baseUrl: `http://127.0.0.1:${4100 + index}`,
            correlationId: `corr:${index}`,
            child: child as never,
            subscribe: () => () => undefined,
            dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
          }),
          dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
      }) as never,
    });

    const first = await pool
      .acquire({ isolationKey: "scope:a", transportOptions: { projectLocation: location } })
      .connect();
    children[0]?.emit("exit", 1, null);
    await vi.waitFor(() => expect(pool.entryCountForTests()).toBe(0));
    const restarted = await pool
      .acquire({ isolationKey: "scope:a", transportOptions: { projectLocation: location } })
      .connect();

    expect(children).toHaveLength(2);
    expect(restarted.baseUrl).not.toBe(first.baseUrl);
    await pool.dispose();
  });

  it("evicts a rejected connection so a later acquire creates a fresh transport", async () => {
    let attempts = 0;
    const pool = new OpenCodeNativeServerPool({
      transportFactory: (() => {
        attempts += 1;
        const attempt = attempts;
        return {
          correlationId: `corr:${attempt}`,
          connect: async (): Promise<OpenCodeNativeConnection> => {
            if (attempt === 1) throw new Error("server failed before readiness");
            return {
              client: fakeClient(),
              baseUrl: "http://127.0.0.1:4202",
              correlationId: `corr:${attempt}`,
              subscribe: () => () => undefined,
              dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            };
          },
          dispose: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
      }) as never,
    });

    await expect(
      pool
        .acquire({ isolationKey: "scope:retry", transportOptions: { projectLocation: location } })
        .connect(),
    ).rejects.toThrow("server failed before readiness");
    await vi.waitFor(() => expect(pool.entryCountForTests()).toBe(0));
    await expect(
      pool
        .acquire({ isolationKey: "scope:retry", transportOptions: { projectLocation: location } })
        .connect(),
    ).resolves.toMatchObject({ baseUrl: "http://127.0.0.1:4202" });
    expect(attempts).toBe(2);
    await pool.dispose();
  });
});
