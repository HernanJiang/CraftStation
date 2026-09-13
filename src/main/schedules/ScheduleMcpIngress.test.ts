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
});
