import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Thread } from "@/shared/contracts";
import type { RuntimeChatItem } from "./slices/runtimeEventSlice";
import { useAppStore } from "./appStore";
import { useGitStore } from "./gitStore";
import { SIDE_CHAT_TTL_MS, useSideChatStore } from "./sideChatStore";

const project: Project = {
  id: "project-side-chat",
  name: "Side Chat Project",
  location: { kind: "windows", path: "D:\\Work\\SideChatProject" },
  createdAt: "2026-08-03T00:00:00.000Z",
};

const thread: Thread = {
  id: "thread-side-chat",
  projectId: project.id,
  worktreePath: "D:\\Work\\SideChatProject-worktree",
  title: "Side chat source",
  agentKind: "codex",
  config: { model: "gpt-5.4" },
  status: "idle",
  attention: "none",
  canResumeWithConfig: false,
  archived: false,
  done: false,
  starred: false,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

function messageItem(
  id: string,
  type: "user_message" | "assistant_message",
  text: string,
  filePath?: string,
): RuntimeChatItem {
  return {
    id,
    type,
    state: "completed",
    payload: {
      content: [
        { kind: "text", text },
        ...(filePath ? [{ kind: "file" as const, path: filePath }] : []),
      ],
    },
    streams: {},
  };
}

const initialAppState = useAppStore.getState();
const initialGitState = useGitStore.getState();

function resetStores() {
  useSideChatStore.getState().close();
  useAppStore.setState({
    ...initialAppState,
    projects: [project],
    threads: [thread],
    runtimeItemIdsByThread: {},
    runtimeItemsByIdByThread: {},
    runtimeStructuralVersionByThread: {},
  });
  useGitStore.setState({
    ...initialGitState,
    statuses: {},
    worktreeStatuses: {},
  });
}

describe("side chat context snapshots", () => {
  beforeEach(resetStores);
  afterEach(() => {
    useSideChatStore.getState().close();
    vi.useRealTimers();
  });

  it("deep-copies the source transcript and collects file references", () => {
    const first = messageItem("user-1", "user_message", "Inspect this file", "src/index.ts");
    const second = messageItem("assistant-1", "assistant_message", "The file is ready");
    useAppStore.setState({
      runtimeItemIdsByThread: { [thread.id]: [first.id, second.id] },
      runtimeItemsByIdByThread: { [thread.id]: { [first.id]: first, [second.id]: second } },
    });

    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);
    const snapshot = useSideChatStore.getState().snapshot!;
    expect(snapshot.messages.map((message) => message.text)).toEqual([
      "Inspect this filesrc/index.ts",
      "The file is ready",
    ]);
    expect(snapshot.referencedFiles).toEqual(["src/index.ts"]);

    first.payload = { content: [{ kind: "text", text: "mutated source" }] };
    expect(useSideChatStore.getState().snapshot!.messages[0]?.text).toBe(
      "Inspect this filesrc/index.ts",
    );
  });

  it("uses streamed assistant text when the final payload is not available yet", () => {
    const streamed: RuntimeChatItem = {
      id: "assistant-stream",
      type: "assistant_message",
      state: "updated",
      streams: { assistant_text: "A streamed answer" },
    };
    useAppStore.setState({
      runtimeItemIdsByThread: { [thread.id]: [streamed.id] },
      runtimeItemsByIdByThread: { [thread.id]: { [streamed.id]: streamed } },
    });

    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);
    expect(useSideChatStore.getState().snapshot!.messages).toMatchObject([
      { role: "assistant", text: "A streamed answer" },
    ]);
  });

  it("keeps side messages independent and blocks input after stale", () => {
    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);
    useSideChatStore.getState().appendMessage("A side question");
    expect(useSideChatStore.getState().snapshot!.messages.at(-1)).toMatchObject({
      role: "user",
      text: "A side question",
    });

    useSideChatStore.getState().markStale();
    const staleSnapshot = useSideChatStore.getState().snapshot!;
    expect(staleSnapshot).toMatchObject({ stale: true, readOnly: true });
    useSideChatStore.getState().appendMessage("must not be appended");
    expect(useSideChatStore.getState().snapshot!.messages).toHaveLength(1);
  });

  it("refreshes a stale snapshot from the latest source transcript", () => {
    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);
    useSideChatStore.getState().markStale();
    useAppStore.setState({
      runtimeItemIdsByThread: { [thread.id]: ["assistant-2"] },
      runtimeItemsByIdByThread: {
        [thread.id]: {
          "assistant-2": messageItem("assistant-2", "assistant_message", "Fresh context"),
        },
      },
    });

    expect(useSideChatStore.getState().refreshFromThread()).toBe(true);
    expect(useSideChatStore.getState().snapshot).toMatchObject({
      stale: false,
      readOnly: false,
      messages: [{ text: "Fresh context" }],
    });
  });

  it("expires an idle snapshot after the configured TTL", () => {
    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);
    const createdAt = useSideChatStore.getState().snapshot!.lastInteractedAt;
    useSideChatStore.getState().expireIfIdle(createdAt + SIDE_CHAT_TTL_MS - 1);
    expect(useSideChatStore.getState().snapshot).not.toBeNull();
    useSideChatStore.getState().expireIfIdle(createdAt + SIDE_CHAT_TTL_MS);
    expect(useSideChatStore.getState().snapshot).toBeNull();
  });

  it("expires while the Side Chat panel is not mounted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
    expect(useSideChatStore.getState().openFromThread(thread.id)).toBe(true);

    vi.advanceTimersByTime(SIDE_CHAT_TTL_MS);

    expect(useSideChatStore.getState().snapshot).toBeNull();
  });
});
