import { describe, expect, it, vi } from "vitest";
import type {
  AgentStatusesResponse,
  Project,
  RemoteThreadCommand,
  ScheduledTask,
  ScheduledTaskRun,
  Thread,
  ThreadStatus,
} from "@/shared/contracts";
import { agentStatusesResponseSchema } from "@/shared/contracts";
import type { SupervisorEvent } from "@/shared/ipc";
import { defaultSharedSettings } from "@/shared/settings";
import { ScheduleRunCoordinator, type ScheduleRunCoordinatorDeps } from "./ScheduleRunCoordinator";

const HOME_PROJECT: Project = {
  id: "__craftstation_home__",
  name: "Home",
  location: { kind: "posix", path: "/home/user" },
  disabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WORK_PROJECT: Project = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Work",
  location: { kind: "windows", path: "C:/repos/work" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const task: ScheduledTask = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Nightly brief",
  prompt: "Summarize the day.",
  agentKind: "claude:home",
  config: { model: "claude-fable-5", effort: "high" },
  recurrence: { kind: "hourly", minute: 0 },
  enabled: true,
  nextRunAt: null,
  lastRunAt: "2026-07-10T00:00:00.000Z",
  lastCompletedAt: null,
  lastStatus: "running",
  lastResult: null,
  lastError: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
};

/** Codex-like posture: bypass options advertised for both approval and sandbox. */
function agentStatuses(
  capabilities: Record<string, unknown> = {
    approvalPolicies: [
      { id: "on-request", label: "On Request" },
      { id: "never", label: "Full Access" },
    ],
    sandboxModes: [
      { id: "workspace-write", label: "Workspace Write" },
      { id: "danger-full-access", label: "Full Access" },
    ],
  },
): AgentStatusesResponse {
  return agentStatusesResponseSchema.parse({
    fromCache: true,
    windows: [
      {
        kind: task.agentKind,
        label: "Claude",
        installed: true,
        authState: "authenticated",
        capabilities,
      },
    ],
    wsl: [],
  });
}

interface Harness {
  coordinator: ScheduleRunCoordinator;
  threads: Map<string, Thread>;
  runs: Map<string, ScheduledTaskRun>;
  sent: RemoteThreadCommand[];
  startThread: ReturnType<typeof vi.fn>;
}

function makeHarness(overrides: Partial<ScheduleRunCoordinatorDeps> = {}): Harness {
  const threads = new Map<string, Thread>();
  const runs = new Map<string, ScheduledTaskRun>();
  const sent: RemoteThreadCommand[] = [];
  const ids = ["thread-1", "run-1"];
  let idx = 0;
  const startThread = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);

  const deps: ScheduleRunCoordinatorDeps = {
    startThread,
    getAgentStatuses: async () => agentStatuses(),
    sendThreadCommand: (command) => {
      sent.push(command);
      return true;
    },
    ensureHomeProject: () => HOME_PROJECT,
    getProject: (projectId) => (projectId === WORK_PROJECT.id ? WORK_PROJECT : null),
    upsertThread: (thread) => {
      threads.set(thread.id, thread);
    },
    deleteThread: (threadId) => {
      threads.delete(threadId);
    },
    threadExists: (threadId) => threads.has(threadId),
    insertRun: (run) => {
      runs.set(run.id, run);
    },
    updateRun: (id, patch) => {
      const current = runs.get(id);
      if (!current) return;
      runs.set(id, {
        ...current,
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
      });
    },
    newId: () => ids[idx++] ?? `id-${idx}`,
    getSharedSettings: () => defaultSharedSettings,
    ...overrides,
  };

  return { coordinator: new ScheduleRunCoordinator(deps), threads, runs, sent, startThread };
}

function threadState(
  threadId: string,
  status: ThreadStatus,
  errorMessage?: string,
): SupervisorEvent {
  return {
    type: "thread-state",
    threadId,
    status,
    attention: "none",
    canResumeWithConfig: false,
    ...(errorMessage ? { errorMessage } : {}),
  };
}

/**
 * Drain pending microtasks: `runScheduleAsThread` awaits the capability lookup
 * before persisting the thread row and calling `startThread`.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ScheduleRunCoordinator", () => {
  it("creates a real GUI thread, records a running run, then settles succeeded", async () => {
    const { coordinator, threads, runs, sent, startThread } = makeHarness();

    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    // Persisted before the supervisor start resolves.
    const thread = threads.get("thread-1");
    expect(thread).toMatchObject({
      id: "thread-1",
      projectId: HOME_PROJECT.id,
      title: "Nightly brief",
      presentationMode: "gui",
      status: "launching",
    });
    expect(sent[0]).toMatchObject({
      kind: "start",
      threadId: "thread-1",
      title: "Nightly brief",
      launchRuntime: false,
      focus: false,
      presentationMode: "gui",
    });
    expect(runs.get("run-1")).toMatchObject({
      scheduleId: task.id,
      threadId: "thread-1",
      status: "running",
      completedAt: null,
    });
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        presentationMode: "gui",
        prompt: expect.stringContaining(task.prompt),
      }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));

    await expect(settled).resolves.toBeNull();
    expect(runs.get("run-1")).toMatchObject({ status: "succeeded", summary: null });
    expect(runs.get("run-1")?.completedAt).not.toBeNull();
    expect(startThread.mock.calls[0]?.[0]?.prompt).toContain("CRAFTSTATION_SCHEDULE: pause");
  });

  it("pauses the schedule when the run's last line asks, without Schedule MCP", async () => {
    const applyScheduleSelfStop = vi.fn<(scheduleId: string, action: "pause" | "delete") => void>();
    const { coordinator, runs } = makeHarness({
      applyScheduleSelfStop,
      getThreadTerminalResult: () => "本 harness 无 Schedule MCP。\nCRAFTSTATION_SCHEDULE: pause",
    });

    const settled = coordinator.runScheduleAsThread(task);
    await flush();
    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toContain("CRAFTSTATION_SCHEDULE: pause");

    expect(applyScheduleSelfStop).toHaveBeenCalledOnce();
    expect(applyScheduleSelfStop).toHaveBeenCalledWith(task.id, "pause");
    expect(runs.get("run-1")).toMatchObject({ status: "succeeded" });
  });

  it("settles failed and rejects when the thread errors", async () => {
    const { coordinator, runs } = makeHarness();
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "error", "model exploded"));

    await expect(settled).rejects.toThrow("model exploded");
    expect(runs.get("run-1")).toMatchObject({ status: "failed", error: "model exploded" });
  });

  it("proceeds when no window is present (sendThreadCommand returns false)", async () => {
    const { coordinator, threads, runs } = makeHarness({ sendThreadCommand: () => false });

    const settled = coordinator.runScheduleAsThread(task);
    await flush();
    expect(threads.get("thread-1")).toBeDefined();
    expect(runs.get("run-1")?.status).toBe("running");

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "finished"));

    await expect(settled).resolves.toBeNull();
    expect(runs.get("run-1")?.status).toBe("succeeded");
  });

  it("rolls back the fresh thread row and fails the run when startThread throws", async () => {
    const { coordinator, threads, runs, sent } = makeHarness({
      startThread: vi.fn<() => Promise<unknown>>().mockRejectedValue(new Error("supervisor down")),
    });

    await expect(coordinator.runScheduleAsThread(task)).rejects.toThrow("supervisor down");
    expect(threads.has("thread-1")).toBe(false);
    expect(sent.some((command) => command.kind === "delete")).toBe(true);
    expect(runs.get("run-1")).toMatchObject({ status: "failed", error: "supervisor down" });
  });

  it("ignores a stale pre-launch inactive echo and waits for a real terminal state", async () => {
    const { coordinator, runs } = makeHarness();
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    // Arrives before the run ever went active — must not settle.
    coordinator.observeSupervisorEvent(threadState("thread-1", "inactive"));
    expect(runs.get("run-1")?.status).toBe("running");

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
    expect(runs.get("run-1")?.status).toBe("succeeded");
  });

  it("creates the thread in the task's project and uses its location to start", async () => {
    const { coordinator, threads, startThread } = makeHarness();

    const settled = coordinator.runScheduleAsThread({ ...task, projectId: WORK_PROJECT.id });
    await flush();

    expect(threads.get("thread-1")?.projectId).toBe(WORK_PROJECT.id);
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ projectLocation: WORK_PROJECT.location }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("resolves global and project MCP settings for scheduled launches", async () => {
    const globalServer = {
      id: "global-memory",
      name: "memory",
      description: "global",
      enabled: true,
      timeoutMs: 30_000,
      transport: { type: "stdio" as const, command: "global-memory", args: [], env: {} },
    };
    const projectServer = {
      ...globalServer,
      id: "project-memory",
      name: "MEMORY",
      description: "project override",
      transport: { ...globalServer.transport, command: "project-memory" },
    };
    const project = { ...WORK_PROJECT, mcpServers: [projectServer] };
    const { coordinator, startThread } = makeHarness({
      getProject: (projectId) => (projectId === project.id ? project : null),
      getSharedSettings: () => ({
        ...defaultSharedSettings,
        mcpServers: [globalServer],
        disabledBuiltInMcpServers: { browser: true },
      }),
    });

    const settled = coordinator.runScheduleAsThread({ ...task, projectId: project.id });
    await flush();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: [projectServer],
        disabledBuiltInMcpServerIds: ["browser"],
      }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("launches scheduled runs with the provider's most-permissive policy", async () => {
    const { coordinator, threads, sent, startThread } = makeHarness();
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    const expectedConfig = {
      model: "claude-fable-5",
      effort: "high",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
    };
    expect(startThread).toHaveBeenCalledWith(expect.objectContaining({ config: expectedConfig }));
    // The unrestricted config is also what gets persisted and mirrored.
    expect(threads.get("thread-1")?.config).toEqual(expectedConfig);
    expect(sent[0]).toMatchObject({ kind: "start", config: expectedConfig });

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("honors a Settings → General ask default instead of forcing full access", async () => {
    const { coordinator, startThread } = makeHarness({
      getSharedSettings: () => ({
        ...defaultSharedSettings,
        defaultPermissionMode: "ask",
      }),
    });
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        config: {
          model: "claude-fable-5",
          effort: "high",
          approvalPolicy: "on-request",
          sandboxMode: "workspace-write",
        },
      }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("falls back to the declared bypass posture when no options are advertised", async () => {
    const { coordinator, startThread } = makeHarness({
      getAgentStatuses: async () =>
        agentStatuses({
          approvalPolicies: [],
          sandboxModes: [],
          bypassPermissions: { approvalPolicy: "bypassPermissions" },
        }),
    });
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        config: { model: "claude-fable-5", effort: "high", approvalPolicy: "bypassPermissions" },
      }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("keeps provider defaults when the capability lookup fails", async () => {
    const { coordinator, startThread } = makeHarness({
      getAgentStatuses: async () => {
        throw new Error("supervisor busy");
      },
    });
    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ config: { model: "claude-fable-5", effort: "high" } }),
    );

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("fails the run when the task's project no longer exists", async () => {
    const { coordinator, threads, runs } = makeHarness();

    await expect(
      coordinator.runScheduleAsThread({ ...task, projectId: "deleted-project-id" }),
    ).rejects.toThrow("Project no longer exists.");
    // No thread row or run row is created when the project can't be resolved.
    expect(threads.size).toBe(0);
    expect(runs.size).toBe(0);
  });

  it("inherits context text but mints a fresh thread and native session", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Old discussion",
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: false,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const { coordinator, threads, startThread } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : null),
      getThreadContextText: (id) =>
        id === sourceId ? "User: remember BANANA42\n\nAssistant: noted BANANA42" : null,
    });

    // Detached schedule (kind:"new") seeded from the creating thread's context:
    // fresh thread per run, no native-session reuse, inherited text only.
    const settled = coordinator.runScheduleAsThread({
      ...task,
      threadTarget: { kind: "new" },
      sourceThreadId: sourceId,
    });
    await flush();

    // Fresh thread id: never reuses the source thread row or its native session.
    expect(threads.has(sourceId)).toBe(false);
    expect(threads.has("thread-1")).toBe(true);
    expect(threads.get("thread-1")?.scheduleOrigin).toEqual({
      scheduleId: task.id,
      runId: "run-1",
    });
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        agentKind: task.agentKind,
        prompt: expect.stringContaining("BANANA42"),
      }),
    );
    expect(startThread.mock.calls[0]?.[0]).not.toMatchObject({ threadId: sourceId });
    expect(startThread.mock.calls[0]?.[0]).not.toHaveProperty("sessionRef");

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("reuses the bound idle thread as a follow-up instead of minting a new one", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Baseline monitoring",
      agentKind: task.agentKind,
      config: { model: "claude-fable-5", effort: "high" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const sendFollowUp = vi
      .fn<(input: { threadId: string; prompt: string }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const { coordinator, threads, runs, sent, startThread } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : null),
      threadExists: (id) => id === sourceId || threads.has(id),
      sendFollowUp,
    });

    const settled = coordinator.runScheduleAsThread({
      ...task,
      targetThreadId: sourceId,
      threadTarget: { kind: "existing", threadId: sourceId },
    });
    await flush();

    // Same thread reused: no new thread row, no start command, one follow-up.
    expect(threads.has("thread-1")).toBe(false);
    expect(threads.get(sourceId)?.title).toBe("Baseline monitoring");
    expect(startThread).not.toHaveBeenCalled();
    expect(sent.some((command) => command.kind === "start")).toBe(false);
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(sendFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: sourceId,
        prompt: expect.stringContaining(task.prompt),
      }),
    );
    expect([...runs.values()]).toHaveLength(1);
    expect([...runs.values()][0]).toMatchObject({
      scheduleId: task.id,
      threadId: sourceId,
      status: "running",
    });

    coordinator.observeSupervisorEvent(threadState(sourceId, "working"));
    coordinator.observeSupervisorEvent(threadState(sourceId, "idle"));
    await expect(settled).resolves.toBeNull();
    expect([...runs.values()][0]).toMatchObject({ status: "succeeded" });
  });

  it("fails the occurrence when the bound thread is busy — never mints a replacement", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Busy thread",
      agentKind: task.agentKind,
      config: { model: "claude-fable-5" },
      status: "working",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: "2026-07-10T00:00:00.000Z",
    } as unknown as Thread;
    const sendFollowUp = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const { coordinator, threads, runs, startThread } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : null),
      sendFollowUp,
    });

    await expect(
      coordinator.runScheduleAsThread({
        ...task,
        targetThreadId: sourceId,
        threadTarget: { kind: "existing", threadId: sourceId },
      }),
    ).rejects.toThrow(/busy/);

    // No ghost thread, no follow-up, and the failure is recorded on the run.
    expect(sendFollowUp).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    expect(threads.has("thread-1")).toBe(false);
    expect([...runs.values()]).toHaveLength(1);
    expect([...runs.values()][0]).toMatchObject({
      scheduleId: task.id,
      threadId: sourceId,
      status: "failed",
    });
  });

  it("fails the occurrence when follow-up delivery fails — never mints a replacement", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Stale session thread",
      agentKind: task.agentKind,
      config: { model: "claude-fable-5" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const sendFollowUp = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("unknown thread session"))
      .mockResolvedValue(undefined);
    const { coordinator, threads, startThread, runs } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : (threads.get(id) ?? null)),
      threadExists: (id) => id === sourceId || threads.has(id),
      sendFollowUp,
    });

    await expect(
      coordinator.runScheduleAsThread({
        ...task,
        targetThreadId: sourceId,
        threadTarget: { kind: "existing", threadId: sourceId },
      }),
    ).rejects.toThrow(/refusing to create a replacement thread/);

    // One interrupted attempt, NO fresh-thread diversion.
    expect(sendFollowUp).toHaveBeenCalledTimes(1);
    expect(startThread).not.toHaveBeenCalled();
    expect(threads.has("thread-1")).toBe(false);
    const statuses = [...runs.values()].map((run) => run.status).sort();
    expect(statuses).toEqual(["interrupted"]);
  });

  it("fails the occurrence when the bound thread is archived — never mints a replacement", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Archived thread",
      agentKind: task.agentKind,
      config: { model: "claude-fable-5" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: true,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const { coordinator, threads, runs, startThread } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : null),
    });

    await expect(
      coordinator.runScheduleAsThread({
        ...task,
        threadTarget: { kind: "existing", threadId: sourceId },
      }),
    ).rejects.toThrow(/archived/);

    expect(startThread).not.toHaveBeenCalled();
    expect(threads.has("thread-1")).toBe(false);
    expect([...runs.values()][0]).toMatchObject({ status: "failed", threadId: sourceId });
  });

  it("fails clearly when the continuation thread is gone", async () => {
    const { coordinator, threads, runs } = makeHarness({
      getThread: () => null,
    });

    await expect(
      coordinator.runScheduleAsThread({
        ...task,
        targetThreadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      }),
    ).rejects.toThrow(/Schedule target thread .* no longer exists/);
    // No replacement thread is minted; the failed occurrence is recorded.
    expect(threads.size).toBe(0);
    expect([...runs.values()]).toHaveLength(1);
    expect([...runs.values()][0]).toMatchObject({
      status: "failed",
      threadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
  });

  it("uses the schedule harness, not the source thread native session, across harnesses", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Codex thread",
      agentKind: "codex",
      config: { model: "gpt-5.6" },
      sessionRef: { providerSessionId: "ses_old", discoveredAt: "2026-01-01T00:00:00.000Z" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const { coordinator, threads, startThread } = makeHarness({
      getThread: (id) => (id === sourceId ? sourceThread : null),
      getThreadContextText: () => "User: keep going",
    });

    const settled = coordinator.runScheduleAsThread({
      ...task,
      agentKind: "opencode",
      threadTarget: { kind: "new" },
      sourceThreadId: sourceId,
    });
    await flush();

    expect(threads.get("thread-1")?.agentKind).toBe("opencode");
    expect(threads.get("thread-1")?.sessionRef).toBeUndefined();
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        agentKind: "opencode",
        prompt: expect.stringContaining("keep going"),
      }),
    );
    expect(startThread.mock.calls[0]?.[0]).not.toHaveProperty("sessionRef");

    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("captures the persisted assistant summary when the turn settles", async () => {
    const { coordinator } = makeHarness({
      getThreadTerminalResult: () => "Reviewed the week.",
    });
    const settled = coordinator.runScheduleAsThread(task);
    await flush();
    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBe("Reviewed the week.");
  });

  it("launches a native CraftPlan through craftAgent without startThread", async () => {
    const craftAgent = vi
      .fn<
        () => Promise<{
          threadId: string;
          entityId: string;
          sessionId: string;
          response: string;
        }>
      >()
      .mockResolvedValue({
        threadId: "thread-1",
        entityId: "entity-1",
        sessionId: "session-1",
        response: "Native summary",
      });
    const { coordinator, startThread, runs } = makeHarness({
      craftAgent,
      resolveExecution: () => ({
        kind: "native",
        prompt: task.prompt,
        craftPlan: {
          id: "plan-1",
          recipeId: "recipe:codex",
          resultItemId: "result-1",
          ingredients: {},
          runtimeBinding: {
            harnessKind: "codex",
            modelId: "gpt-5.6",
            vendor: "openai",
            runtimeAdapterId: "codex",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          threadId: "thread-1",
        },
        snapshot: {
          recipeId: "recipe:codex",
          model: "gpt-5.6",
          harnessItemId: "harness:codex",
          agentKind: task.agentKind,
          threadTarget: { kind: "new" },
          sourceThreadId: null,
        },
        contextSnapshot: null,
      }),
    });

    await expect(coordinator.runScheduleAsThread(task)).resolves.toBe("Native summary");
    expect(craftAgent).toHaveBeenCalledTimes(1);
    expect(startThread).not.toHaveBeenCalled();
    expect(runs.get("run-1")).toMatchObject({ status: "succeeded", summary: "Native summary" });
    expect(craftAgent).toHaveBeenCalledWith(
      expect.not.objectContaining({
        craftPlan: expect.objectContaining({ sessionRef: expect.anything() }),
      }),
    );
  });

  it("binds the fired detached thread's peer address (Crossagents parity)", async () => {
    const bindRunThreadAddress = vi
      .fn<(threadId: string) => Promise<string | null>>()
      .mockResolvedValue("claude:native-thread-1");
    const { coordinator } = makeHarness({ bindRunThreadAddress });

    const settled = coordinator.runScheduleAsThread(task);
    await flush();

    expect(bindRunThreadAddress).toHaveBeenCalledWith("thread-1");
    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
  });

  it("binds the peer address on the native craftAgent path too", async () => {
    const bindRunThreadAddress = vi
      .fn<(threadId: string) => Promise<string | null>>()
      .mockResolvedValue("devin:devin-session-1");
    const craftAgent = vi
      .fn<
        () => Promise<{ threadId: string; entityId: string; sessionId: string; response: string }>
      >()
      .mockResolvedValue({
        threadId: "thread-1",
        entityId: "entity-1",
        sessionId: "session-1",
        response: "ok",
      });
    const { coordinator } = makeHarness({
      bindRunThreadAddress,
      craftAgent,
      resolveExecution: () => ({
        kind: "native",
        prompt: task.prompt,
        craftPlan: {
          id: "plan-1",
          recipeId: "recipe:cognition-devin-native",
          resultItemId: "result-1",
          ingredients: {},
          runtimeBinding: {
            harnessKind: "devin",
            modelId: "swe-2-max",
            vendor: "cognition",
            runtimeAdapterId: "devin",
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          threadId: "thread-1",
        },
        snapshot: {
          recipeId: "recipe:cognition-devin-native",
          model: "swe-2-max",
          harnessItemId: "harness:devin",
          agentKind: "devin",
          threadTarget: { kind: "new" },
          sourceThreadId: null,
        },
        contextSnapshot: null,
      }),
    });

    await expect(coordinator.runScheduleAsThread({ ...task, agentKind: "devin" })).resolves.toBe(
      "ok",
    );
    expect(bindRunThreadAddress).toHaveBeenCalledWith("thread-1");
  });

  it("never binds a peer address for thread-bound follow-up runs", async () => {
    const sourceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const sourceThread = {
      id: sourceId,
      projectId: HOME_PROJECT.id,
      title: "Baseline monitoring",
      agentKind: task.agentKind,
      config: { model: "claude-fable-5", effort: "high" },
      status: "idle",
      attention: "none",
      canResumeWithConfig: true,
      archived: false,
      done: false,
      starred: false,
      presentationMode: "gui",
      threadStatusSource: "server",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeTurnStartedAt: null,
    } as unknown as Thread;
    const bindRunThreadAddress = vi
      .fn<(threadId: string) => Promise<string | null>>()
      .mockResolvedValue(null);
    const sendFollowUp = vi
      .fn<(input: { threadId: string; prompt: string }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const { coordinator, threads } = makeHarness({
      bindRunThreadAddress,
      getThread: (id) => (id === sourceId ? sourceThread : null),
      threadExists: (id) => id === sourceId || threads.has(id),
      sendFollowUp,
    });

    const settled = coordinator.runScheduleAsThread({
      ...task,
      targetThreadId: sourceId,
      threadTarget: { kind: "existing", threadId: sourceId },
    });
    await flush();
    coordinator.observeSupervisorEvent(threadState(sourceId, "working"));
    coordinator.observeSupervisorEvent(threadState(sourceId, "idle"));
    await expect(settled).resolves.toBeNull();
    // The bound thread already owns its address lifecycle; a follow-up run
    // must not rebind (or worse, re-key) it.
    expect(bindRunThreadAddress).not.toHaveBeenCalled();
  });

  it("a binding failure never fails the run itself", async () => {
    const bindRunThreadAddress = vi
      .fn<(threadId: string) => Promise<string | null>>()
      .mockRejectedValue(new Error("binding store gone"));
    const { coordinator, runs } = makeHarness({ bindRunThreadAddress });

    const settled = coordinator.runScheduleAsThread(task);
    await flush();
    coordinator.observeSupervisorEvent(threadState("thread-1", "working"));
    coordinator.observeSupervisorEvent(threadState("thread-1", "idle"));
    await expect(settled).resolves.toBeNull();
    expect(runs.get("run-1")).toMatchObject({ status: "succeeded" });
  });
});
