import { create } from "zustand";
import type { MessageItemPayload, Thread } from "@/shared/contracts";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";

export const SIDE_CHAT_TTL_MS = 2 * 60 * 60 * 1000;

export interface SideChatMessage {
  id: string;
  role: "user" | "assistant" | "context";
  text: string;
  createdAt: number;
}

export interface SideChatSnapshot {
  id: string;
  sourceThreadId: string;
  projectId: string;
  worktreePath?: string;
  createdAt: number;
  lastInteractedAt: number;
  sourceRevision: string;
  messages: readonly SideChatMessage[];
  referencedFiles: readonly string[];
  gitStatusFingerprint: string;
  stale: boolean;
  readOnly: boolean;
}

interface SideChatState {
  snapshot: SideChatSnapshot | null;
  openFromThread: (threadId: string) => boolean;
  appendMessage: (text: string) => void;
  markStale: () => void;
  refreshFromThread: () => boolean;
  touch: () => void;
  close: () => void;
  expireIfIdle: (now?: number) => void;
}

let expiryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

function cancelExpiryTimer(): void {
  if (expiryTimer === null) return;
  globalThis.clearTimeout(expiryTimer);
  expiryTimer = null;
}

function scheduleExpiry(lastInteractedAt: number): void {
  cancelExpiryTimer();
  const remaining = Math.max(0, lastInteractedAt + SIDE_CHAT_TTL_MS - Date.now());
  expiryTimer = globalThis.setTimeout(() => {
    expiryTimer = null;
    useSideChatStore.getState().expireIfIdle();
  }, remaining);
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtimeText(item: RuntimeChatItem): string | null {
  if (item.type === "user_message" || item.type === "assistant_message") {
    const payload = item.payload as MessageItemPayload | undefined;
    const payloadText = payload?.content
      ?.map((block) => {
        if (block.kind === "text") return block.text;
        if (block.kind === "file") return block.path;
        if (block.kind === "skill") return block.invocation;
        if (block.kind === "mcp") return `@${block.name}`;
        if (block.kind === "diff_comment") return `${block.path}:${block.lineNumber} ${block.body}`;
        return "";
      })
      .join("")
      .trim();
    if (payloadText) return payloadText;
    const streamedText = item.streams.assistant_text?.trim();
    return streamedText || null;
  }
  return null;
}

function gitFingerprint(thread: Thread): string {
  const git = useGitStore.getState();
  const status = thread.worktreePath
    ? git.worktreeStatuses[thread.worktreePath]
    : git.statuses[thread.projectId];
  return JSON.stringify({
    branch: status?.branch ?? thread.worktreeBranch ?? null,
    headSha: status?.headSha ?? null,
    staged: status?.staged.map((file) => file.path) ?? [],
    unstaged: status?.unstaged.map((file) => file.path) ?? [],
  });
}

export function sideChatRevision(thread: Thread): string {
  const app = useAppStore.getState();
  return JSON.stringify([
    thread.id,
    thread.updatedAt,
    thread.worktreePath ?? null,
    thread.worktreeBranch ?? null,
    app.runtimeStructuralVersionByThread[thread.id] ?? 0,
    app.runtimeItemIdsByThread[thread.id] ?? [],
    gitFingerprint(thread),
  ]);
}

function buildSnapshot(thread: Thread): SideChatSnapshot {
  const app = useAppStore.getState();
  const itemIds = app.runtimeItemIdsByThread[thread.id] ?? [];
  const items = app.runtimeItemsByIdByThread[thread.id] ?? {};
  const messages: SideChatMessage[] = [];
  const referencedFiles = new Set<string>();

  for (const itemId of itemIds) {
    const item = items[itemId];
    if (!item) continue;
    const text = runtimeText(item);
    if (!text) continue;
    const payload = item.payload as MessageItemPayload | undefined;
    for (const block of payload?.content ?? []) {
      if (block.kind === "file") referencedFiles.add(block.path);
    }
    messages.push({
      id: `${thread.id}:${item.id}`,
      role: item.type === "user_message" ? "user" : "assistant",
      text,
      createdAt: Date.now(),
    });
  }

  const now = Date.now();
  return clone({
    id: `side-chat-${thread.id}-${now}`,
    sourceThreadId: thread.id,
    projectId: thread.projectId,
    ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
    createdAt: now,
    lastInteractedAt: now,
    sourceRevision: sideChatRevision(thread),
    messages,
    referencedFiles: [...referencedFiles],
    gitStatusFingerprint: gitFingerprint(thread),
    stale: false,
    readOnly: false,
  });
}

export const useSideChatStore = create<SideChatState>((set, get) => ({
  snapshot: null,
  openFromThread: (threadId) => {
    const thread = useAppStore.getState().threads.find((candidate) => candidate.id === threadId);
    if (!thread) return false;
    const snapshot = buildSnapshot(thread);
    set({ snapshot });
    scheduleExpiry(snapshot.lastInteractedAt);
    return true;
  },
  appendMessage: (text) => {
    const trimmed = text.trim();
    const snapshot = get().snapshot;
    if (!snapshot || snapshot.readOnly || trimmed.length === 0) return;
    const now = Date.now();
    set({
      snapshot: {
        ...snapshot,
        lastInteractedAt: now,
        messages: [
          ...snapshot.messages,
          { id: `side-message-${now}`, role: "user", text: trimmed, createdAt: now },
        ],
      },
    });
    scheduleExpiry(now);
  },
  markStale: () =>
    set((state) =>
      state.snapshot && !state.snapshot.stale
        ? { snapshot: { ...state.snapshot, stale: true, readOnly: true } }
        : state,
    ),
  refreshFromThread: () => {
    const snapshot = get().snapshot;
    if (!snapshot) return false;
    const thread = useAppStore
      .getState()
      .threads.find((candidate) => candidate.id === snapshot.sourceThreadId);
    if (!thread) return false;
    const refreshed = buildSnapshot(thread);
    set({ snapshot: refreshed });
    scheduleExpiry(refreshed.lastInteractedAt);
    return true;
  },
  touch: () => {
    const snapshot = get().snapshot;
    if (!snapshot) return;
    const now = Date.now();
    set({ snapshot: { ...snapshot, lastInteractedAt: now } });
    scheduleExpiry(now);
  },
  close: () => {
    cancelExpiryTimer();
    set({ snapshot: null });
  },
  expireIfIdle: (now = Date.now()) => {
    const snapshot = get().snapshot;
    if (!snapshot) {
      cancelExpiryTimer();
      return;
    }
    if (now - snapshot.lastInteractedAt >= SIDE_CHAT_TTL_MS) {
      cancelExpiryTimer();
      set({ snapshot: null });
      return;
    }
    scheduleExpiry(snapshot.lastInteractedAt);
  },
}));
