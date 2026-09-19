import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { isEphemeralSideChatThread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useExperimentStore } from "@/renderer/state/experimentStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSideChatStore } from "@/renderer/state/sideChatStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { setThreadRuntimeReopenEnabled } from "@/renderer/actions/threadActions";
import {
  SIDE_CHAT_BRANCH_TITLE_SUFFIX,
  closeSideChat,
  openSideChatBranch,
  openSideChatExisting,
  saveSideChatAsFormal,
} from "./sideChatActions";

const { bridge, toast } = vi.hoisted(() => ({
  bridge: {
    closeThread: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dismissTaskbarAttention: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    appendUsageEvents: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    dbReplaceThreadRuntimeSnapshot: vi.fn<(payload: unknown) => Promise<void>>(),
  },
  toast: {
    success: vi.fn<(message: string) => void>(),
    danger: vi.fn<(message: string) => void>(),
  },
}));

const { hasHydratedThreadRuntimeItems, hydrateThreadRuntimeItems } = vi.hoisted(() => ({
  hasHydratedThreadRuntimeItems: vi.fn<(threadId: string) => boolean>().mockReturnValue(false),
  hydrateThreadRuntimeItems: vi.fn<(threadId: string) => Promise<void>>().mockResolvedValue(),
}));

vi.mock("@heroui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@heroui/react")>();
  return { ...actual, toast };
});

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

vi.mock("@/renderer/state/chatRuntimePersister", () => ({
  hasHydratedThreadRuntimeItems,
  hydrateThreadRuntimeItems,
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

function seedSource(): string {
  const store = useAppStore.getState();
  const source = store.createThread({
    projectId: "project-1",
    agentKind: "codex",
    config: { model: "gpt-5.4" },
    prompt: "first question",
  });
  store.updateThreadRuntime(source.id, {
    status: "idle",
    attention: "none",
    canResumeWithConfig: true,
  });
  const items = [userItem("user-1", "first question"), assistantItem("asst-1", "first answer")];
  useAppStore.setState({
    runtimeItemIdsByThread: { [source.id]: items.map((item) => item.id) },
    runtimeItemsByIdByThread: { [source.id]: Object.fromEntries(items.map((i) => [i.id, i])) },
  } as never);
  // createThread focuses by default; Side Chat tests start from Home.
  useAppStore.setState({ view: { kind: "home" } } as never);
  return source.id;
}

describe("side chat actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setThreadRuntimeReopenEnabled(false);
    useAppStore.setState({
      threads: [],
      view: { kind: "home" },
      pendingActiveThreadId: null,
      pendingComposerFocusThreadId: null,
      runtimeItemIdsByThread: {},
      runtimeItemsByIdByThread: {},
      runtimeCompletedTurnsByThread: {},
      runtimeContextByThread: {},
      connectingThreadIds: {},
    } as never);
    useExperimentStore.setState({ experiments: {} } as never);
    useSideChatStore.setState({ panelOpen: false, selection: null });
    usePanelStore.setState({ auxiliaryPanelTab: null, auxiliaryPanelTabs: [] } as never);
  });

  it("branches the full transcript into a memory-only ephemeral thread", () => {
    const sourceId = seedSource();

    expect(openSideChatBranch(sourceId)).toBe(true);

    const state = useAppStore.getState();
    expect(state.threads).toHaveLength(2);
    const branch = state.threads.find((thread) => thread.id !== sourceId)!;
    expect(isEphemeralSideChatThread(branch)).toBe(true);
    expect(branch.parentThreadId).toBe(sourceId);
    expect(branch.title.endsWith(SIDE_CHAT_BRANCH_TITLE_SUFFIX)).toBe(true);
    expect(branch.status).toBe("idle");
    // Full transcript copied with stable ids; the main view is untouched.
    expect(state.runtimeItemIdsByThread[branch.id]).toEqual(["user-1", "asst-1"]);
    expect(state.view).toEqual({ kind: "home" });
    // Memory-only: never persisted through the runtime snapshot seam.
    expect(bridge.dbReplaceThreadRuntimeSnapshot).not.toHaveBeenCalled();
    expect(useSideChatStore.getState().selection).toEqual({
      kind: "branch",
      threadId: branch.id,
      sourceThreadId: sourceId,
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("inherits the goal snapshot at branch time and stays independent after", () => {
    const sourceId = seedSource();
    const now = new Date().toISOString();
    useAppStore
      .getState()
      .setThreadGoal(sourceId, { prompt: "source goal", createdAt: now, updatedAt: now });

    expect(openSideChatBranch(sourceId)).toBe(true);

    const state = useAppStore.getState();
    const branch = state.threads.find((thread) => thread.id !== sourceId)!;
    // Snapshot value copied, not shared by reference.
    expect(branch.goal).toEqual({ prompt: "source goal", createdAt: now, updatedAt: now });
    expect(branch.goal).not.toBe(state.threads.find((thread) => thread.id === sourceId)?.goal);

    // Later changes on either side do not leak across.
    useAppStore.getState().setThreadGoal(branch.id, {
      prompt: "branch goal",
      createdAt: now,
      updatedAt: now,
    });
    expect(
      useAppStore.getState().threads.find((thread) => thread.id === sourceId)?.goal?.prompt,
    ).toBe("source goal");
  });

  it("refuses to branch a thread without branchable context", () => {
    const store = useAppStore.getState();
    const source = store.createThread({
      projectId: "project-1",
      agentKind: "codex",
      config: { model: "gpt-5.4" },
      prompt: "empty",
    });

    expect(openSideChatBranch(source.id)).toBe(false);
    expect(useAppStore.getState().threads).toHaveLength(1);
    expect(useSideChatStore.getState().selection).toBeNull();
    expect(toast.danger).toHaveBeenCalledTimes(1);
  });

  it("opens an existing formal thread in parallel without copying it", () => {
    const sourceId = seedSource();

    expect(openSideChatExisting(sourceId)).toBe(true);

    expect(useAppStore.getState().threads).toHaveLength(1);
    expect(useSideChatStore.getState().selection).toEqual({
      kind: "existing",
      threadId: sourceId,
    });
    expect(useAppStore.getState().view).toEqual({ kind: "home" });
  });

  it("refuses to open an ephemeral branch as an existing thread", () => {
    const sourceId = seedSource();
    expect(openSideChatBranch(sourceId)).toBe(true);
    const branchId = useSideChatStore.getState().selection!.threadId;

    expect(openSideChatExisting(branchId)).toBe(false);
  });

  it("discards the previous unsaved branch when opening another one", () => {
    const sourceId = seedSource();
    expect(openSideChatBranch(sourceId)).toBe(true);
    const firstBranchId = useSideChatStore.getState().selection!.threadId;

    expect(openSideChatBranch(sourceId)).toBe(true);
    const secondBranchId = useSideChatStore.getState().selection!.threadId;

    expect(secondBranchId).not.toBe(firstBranchId);
    const state = useAppStore.getState();
    expect(state.threads.some((thread) => thread.id === firstBranchId)).toBe(false);
    expect(state.threads.some((thread) => thread.id === secondBranchId)).toBe(true);
    expect(bridge.closeThread).toHaveBeenCalledWith({ threadId: firstBranchId });
  });

  it("saves a branch as a formal thread grouped with its parent", async () => {
    const sourceId = seedSource();
    expect(openSideChatBranch(sourceId)).toBe(true);
    const branchId = useSideChatStore.getState().selection!.threadId;

    expect(saveSideChatAsFormal()).toBe(true);

    const state = useAppStore.getState();
    const saved = state.threads.find((thread) => thread.id === branchId)!;
    expect(isEphemeralSideChatThread(saved)).toBe(false);
    expect(saved.title.endsWith(SIDE_CHAT_BRANCH_TITLE_SUFFIX)).toBe(false);
    expect(saved.groupId).toBeDefined();
    const parent = state.threads.find((thread) => thread.id === sourceId)!;
    expect(parent.groupId).toBe(saved.groupId);
    // Saved threads join the main view (grouped with the parent, like a fork);
    // Side Chat closes behind them.
    await waitFor(() => {
      const view = useAppStore.getState().view;
      expect(view.kind).toBe("thread");
      expect(view.kind === "thread" ? view.panes : []).toContain(branchId);
    });
    expect(useSideChatStore.getState().selection).toBeNull();
    expect(toast.success).toHaveBeenCalledTimes(2);
  });

  it("discards an unsaved branch (row + runtime session) on close", () => {
    const sourceId = seedSource();
    expect(openSideChatBranch(sourceId)).toBe(true);
    const branchId = useSideChatStore.getState().selection!.threadId;
    usePanelStore.setState({
      auxiliaryPanelTab: "side-chat",
      auxiliaryPanelTabs: ["side-chat"],
    } as never);

    closeSideChat();

    const state = useAppStore.getState();
    expect(state.threads.some((thread) => thread.id === branchId)).toBe(false);
    expect(state.threads.some((thread) => thread.id === sourceId)).toBe(true);
    expect(bridge.closeThread).toHaveBeenCalledTimes(1);
    expect(useSideChatStore.getState().panelOpen).toBe(false);
    expect(useSideChatStore.getState().selection).toBeNull();
    expect(usePanelStore.getState().auxiliaryPanelTabs).not.toContain("side-chat");
  });

  it("leaves a formal thread untouched when its side view closes", () => {
    const sourceId = seedSource();
    expect(openSideChatExisting(sourceId)).toBe(true);

    closeSideChat();

    expect(useAppStore.getState().threads).toHaveLength(1);
    expect(bridge.closeThread).not.toHaveBeenCalled();
    expect(useSideChatStore.getState().selection).toBeNull();
  });
});
