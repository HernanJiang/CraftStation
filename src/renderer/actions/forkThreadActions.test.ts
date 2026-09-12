import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { forkThreadFromTurn } from "./forkThreadActions";

const { bridge, toast } = vi.hoisted(() => ({
  bridge: {
    dbSetState: vi.fn<(key: string, value: string) => Promise<void>>().mockResolvedValue(undefined),
    dbReplaceThreadRuntimeSnapshot: vi
      .fn<(payload: unknown) => Promise<void>>()
      .mockResolvedValue(undefined),
  },
  toast: {
    success: vi.fn<(message: string) => void>(),
    danger: vi.fn<(message: string) => void>(),
  },
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

vi.mock("@heroui/react", () => ({
  toast,
}));

function userItem(id: string, text: string): RuntimeChatItem {
  return {
    id,
    type: "user_message",
    state: "completed",
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  } as unknown as RuntimeChatItem;
}

function assistantItem(id: string, text: string): RuntimeChatItem {
  return {
    id,
    type: "assistant_message",
    state: "completed",
    payload: { content: [{ kind: "text", text }] },
    streams: {},
  } as unknown as RuntimeChatItem;
}

function seedSource(): Thread {
  const store = useAppStore.getState();
  const source = store.createThread({
    projectId: "project-1",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    prompt: "first question",
    presentationMode: "gui",
  });
  store.updateThreadRuntime(source.id, {
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
    sessionRef: { providerSessionId: "sess-1", discoveredAt: new Date().toISOString() },
  });
  const items = [
    userItem("user-1", "first question"),
    assistantItem("asst-1", "first answer"),
    userItem("user-2", "second question"),
    assistantItem("asst-2", "second answer"),
  ];
  useAppStore.setState({
    runtimeItemIdsByThread: { [source.id]: items.map((item) => item.id) },
    runtimeItemsByIdByThread: { [source.id]: Object.fromEntries(items.map((i) => [i.id, i])) },
  } as never);
  useAppStore.getState().hydrateThreadCompletedTurns(source.id, [
    {
      startedAt: new Date("2026-05-01T12:00:00.000Z").getTime(),
      endedAt: new Date("2026-05-01T12:01:00.000Z").getTime(),
      anchorItemId: "asst-1",
    },
    {
      startedAt: new Date("2026-05-01T12:02:00.000Z").getTime(),
      endedAt: new Date("2026-05-01T12:03:00.000Z").getTime(),
      anchorItemId: "asst-2",
    },
  ]);
  return useAppStore.getState().threads.find((t) => t.id === source.id)!;
}

describe("forkThreadFromTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({
      threads: [],
      view: { kind: "thread", panes: [] } as never,
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeCompletedTurnsByThread: {},
      runtimeContextByThread: {},
      connectingThreadIds: {},
    } as never);
    useExperimentStore.setState({ experiments: {} } as never);
  });

  it("branches the transcript prefix into a grouped idle thread and persists it", async () => {
    const source = seedSource();

    await forkThreadFromTurn(source.id, "asst-1");

    const state = useAppStore.getState();
    expect(state.threads).toHaveLength(2);
    const fork = state.threads.find((t) => t.id !== source.id)!;
    expect(fork.projectId).toBe(source.projectId);
    expect(fork.agentKind).toBe(source.agentKind);
    expect(fork.status).toBe("idle");
    expect(fork.title).toContain("（分叉）");
    expect(fork.parentThreadId).toBe(source.id);
    // Grouped with the source so the sidebar renders them as one branch.
    expect(fork.groupId).toBeTruthy();
    expect(state.threads.find((t) => t.id === source.id)?.groupId).toBe(fork.groupId);

    // Only the forked turn's prefix is carried — later turns stay behind.
    expect(state.runtimeItemIdsByThread[fork.id]).toEqual(["user-1", "asst-1"]);
    expect(state.runtimeCompletedTurnsByThread[fork.id]).toHaveLength(1);
    expect(state.runtimeCompletedTurnsByThread[fork.id]![0]?.anchorItemId).toBe("asst-1");

    // Persisted through the snapshot seam for reloads.
    expect(bridge.dbReplaceThreadRuntimeSnapshot).toHaveBeenCalledOnce();
    const payload = bridge.dbReplaceThreadRuntimeSnapshot.mock.calls[0]![0] as {
      threadId: string;
      items: Array<{ id: string; observedLive?: boolean }>;
      turns: Array<{ anchorItemId: string | null }>;
    };
    expect(payload.threadId).toBe(fork.id);
    expect(payload.items.map((item) => item.id)).toEqual(["user-1", "asst-1"]);
    expect(payload.items.every((item) => item.observedLive === undefined)).toBe(true);
    expect(payload.turns.map((turn) => turn.anchorItemId)).toEqual(["asst-1"]);

    // Opened next to the source, never launched.
    expect(state.view.kind).toBe("thread");
    const panes = state.view.kind === "thread" ? state.view.panes : [];
    expect(panes).toContain(source.id);
    expect(panes).toContain(fork.id);
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it("does nothing for unknown threads, bad anchors, or experiment threads", async () => {
    await forkThreadFromTurn("missing", "asst-1");
    const source = seedSource();
    await forkThreadFromTurn(source.id, "missing-item");
    useExperimentStore.setState({
      experiments: {
        "exp-1": {
          id: "exp-1",
          candidates: [{ threadId: source.id }],
        },
      },
    } as never);
    await forkThreadFromTurn(source.id, "asst-1");

    expect(useAppStore.getState().threads).toHaveLength(1);
    expect(bridge.dbReplaceThreadRuntimeSnapshot).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
