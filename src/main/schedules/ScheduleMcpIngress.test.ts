import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTask, ScheduledTaskInput, Thread } from "@/shared/contracts";
import type { ScheduleCapability } from "./ScheduleCapability";
import { ScheduleMcpIngress } from "./ScheduleMcpIngress";

let ingress: ScheduleMcpIngress | null = null;

const thread = {
  id: "cf26d9bf-8170-430a-ac4d-018ee67a3a1d",
  projectId: "project-1",
  agentKind: "codex",
  config: { model: "gpt-5.6", effort: "high" },
} as Thread;

/** The executor 正本 thread — the REAL caller behind the injected session id. */
const executorThread = {
  id: "d48b6841-b29c-476c-ab2d-85fe3145c7d8",
  projectId: "project-1",
  agentKind: "opencode",
  config: { model: "opencode-go/muse-spark-1.3-contributor" },
} as Thread;

/** A drifted endpoint identity: the ghost thread the shared sidecar last wrote. */
const ghostThread = {
  id: "47dda834-aa35-4a34-9670-86e5df2b3b0e",
  projectId: "project-1",
  agentKind: "opencode",
  config: { model: "opencode-go/muse-spark-1.3-contributor" },
} as Thread;

function service(): ScheduleCapability {
  return {
    create: vi.fn<(input: ScheduledTaskInput) => ScheduledTask>(
      (input) => ({ id: "created", ...input }) as ScheduledTask,
    ),
  } as unknown as ScheduleCapability;
}

async function callTool(
  info: { url: string; token: string },
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; payload?: Record<string, unknown> }> {
  const response = await fetch(`${info.url}/mcp?thread=${encodeURIComponent(thread.id)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${info.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = body.result?.content?.[0]?.text;
  return {
    isError: body.result?.isError === true,
    ...(text ? { payload: JSON.parse(text) as Record<string, unknown> } : {}),
  };
}

afterEach(() => {
  ingress?.dispose();
  ingress = null;
});

describe("ScheduleMcpIngress", () => {
  it("advertises Schedule instructions and tools on initialize", async () => {
    ingress = new ScheduleMcpIngress({
      scheduleService: service(),
      getThread: (id) => (id === thread.id ? thread : null),
    });
    const info = await ingress.start();

    const response = await fetch(`${info.url}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${info.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });

    const body = (await response.json()) as {
      result: {
        serverInfo: { name: string };
        instructions: string;
      };
    };

    expect(body.result.serverInfo.name).toBe("Schedule");
    expect(body.result.instructions).toContain("计划 / 监控 / 日常 / 定时任务");
    expect(body.result.instructions).toContain("Do not poll");
    expect(body.result.instructions).toContain("create");
  });

  it("creates a schedule with calling-thread defaults over Streamable HTTP", async () => {
    const scheduleService = service();
    ingress = new ScheduleMcpIngress({
      scheduleService,
      getThread: (id) => (id === thread.id ? thread : null),
    });
    const info = await ingress.start();

    const { isError } = await callTool(info, "create", {
      name: "Daily brief",
      prompt: "Summarize priorities",
      recurrence: { kind: "hourly", minute: 15 },
    });

    expect(isError).toBe(false);
    expect(scheduleService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Daily brief",
        prompt: "Summarize priorities",
        recurrence: { kind: "hourly", minute: 15 },
        enabled: true,
        agentKind: "codex",
        projectId: "project-1",
        sourceThreadId: thread.id,
        threadTarget: { kind: "existing", threadId: thread.id },
        config: { model: "gpt-5.6", effort: "high" },
      }),
    );
  });

  it("plugin-injected session id overrides a drifted URL thread (P0-2)", async () => {
    const scheduleService = service();
    ingress = new ScheduleMcpIngress({
      scheduleService,
      getThread: (id) =>
        [thread, executorThread, ghostThread].find((entry) => entry.id === id) ?? null,
      resolveThreadIdBySessionId: (sessionId) =>
        sessionId === "ses_f664b46cdffeCOeWvUONmTdrjp" ? executorThread.id : null,
    });
    const info = await ingress.start();

    // The shared OpenCode sidecar's endpoint URL encodes the GHOST thread
    // (last writer wins). The plugin injects the real calling session; the
    // ingress must bind the executor thread, not the URL's ghost.
    const response = await fetch(`${info.url}/mcp?thread=${encodeURIComponent(ghostThread.id)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${info.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create",
          arguments: {
            name: "Executor self check 30min",
            prompt: "Run the self check and report in this thread.",
            recurrence: { kind: "interval", everyMinutes: 30 },
            continueInCurrentThread: true,
            __craftstation_provider_session_id: "ses_f664b46cdffeCOeWvUONmTdrjp",
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).not.toBe(true);

    expect(scheduleService.create).toHaveBeenCalledTimes(1);
    const input = (scheduleService.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(input).toEqual(
      expect.objectContaining({
        sourceThreadId: executorThread.id,
        targetThreadId: executorThread.id,
        threadTarget: { kind: "existing", threadId: executorThread.id },
        // The private session arg never reaches the tool layer.
      }),
    );
    expect(input).not.toHaveProperty("__craftstation_provider_session_id");
  });

  it("an unresolvable injected session fails closed instead of binding the URL thread", async () => {
    const scheduleService = service();
    ingress = new ScheduleMcpIngress({
      scheduleService,
      getThread: (id) =>
        [thread, executorThread, ghostThread].find((entry) => entry.id === id) ?? null,
      resolveThreadIdBySessionId: () => null,
    });
    const info = await ingress.start();

    const response = await fetch(`${info.url}/mcp?thread=${encodeURIComponent(ghostThread.id)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${info.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "create",
          arguments: {
            name: "Executor self check 30min",
            prompt: "Run the self check.",
            recurrence: { kind: "interval", everyMinutes: 30 },
            __craftstation_provider_session_id: "ses_unknown",
          },
        },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain("Refusing to bind");
    expect(scheduleService.create).not.toHaveBeenCalled();
  });
});
