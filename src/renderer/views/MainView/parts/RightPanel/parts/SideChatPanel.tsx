import { useEffect, useState } from "react";
import { RefreshCw, Send } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useAppStore } from "@/renderer/state/appStore";
import { useGitStore } from "@/renderer/state/gitStore";
import {
  SIDE_CHAT_TTL_MS,
  sideChatRevision,
  useSideChatStore,
} from "@/renderer/state/sideChatStore";

/**
 * The side chat is an isolated context snapshot, not a second view of the
 * primary transcript. It deliberately owns its input and message list so
 * typing here can never mutate the main thread's composer/runtime state.
 */
export function SideChatPanel() {
  const { t } = useLingui();
  const snapshot = useSideChatStore((state) => state.snapshot);
  const [draft, setDraft] = useState("");
  const sourceThreadId = snapshot?.sourceThreadId;
  const sourceThread = useAppStore((state) =>
    sourceThreadId ? state.threads.find((thread) => thread.id === sourceThreadId) : undefined,
  );
  const sourceRuntimeRevision = useAppStore((state) =>
    sourceThreadId ? (state.runtimeStructuralVersionByThread[sourceThreadId] ?? 0) : 0,
  );
  const sourceGitFingerprint = useGitStore((state) => {
    if (!sourceThread) return "";
    const status = sourceThread.worktreePath
      ? state.worktreeStatuses[sourceThread.worktreePath]
      : state.statuses[sourceThread.projectId];
    return JSON.stringify({
      branch: status?.branch ?? sourceThread.worktreeBranch ?? null,
      headSha: status?.headSha ?? null,
      staged: status?.staged.map((file) => file.path) ?? [],
      unstaged: status?.unstaged.map((file) => file.path) ?? [],
    });
  });
  // These selectors intentionally participate in the render dependency set:
  // sideChatRevision reads the same stores through getState(), so the values
  // below are the reactive wake-up signals for Git/runtime changes.
  void sourceGitFingerprint;
  void sourceRuntimeRevision;
  const sourceRevision = sourceThread ? sideChatRevision(sourceThread) : null;

  useEffect(() => {
    if (!snapshot) return;
    if (!sourceThread) {
      useSideChatStore.getState().markStale();
      return;
    }
    if (!sourceRevision) return;
    if (snapshot.sourceRevision !== sourceRevision) {
      useSideChatStore.getState().markStale();
    }
  }, [snapshot, sourceRevision, sourceThread]);

  useEffect(() => {
    const timer = window.setInterval(
      () => {
        useSideChatStore.getState().expireIfIdle();
      },
      Math.min(SIDE_CHAT_TTL_MS, 60_000),
    );
    return () => window.clearInterval(timer);
  }, []);

  if (!snapshot) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-xs text-muted">
        {t`Side Chat is not available without an active conversation.`}
      </div>
    );
  }

  const submit = () => {
    if (snapshot.readOnly || draft.trim().length === 0) return;
    useSideChatStore.getState().appendMessage(draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--content-background)]">
      {snapshot.stale ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <span className="min-w-0 flex-1">
            ⚠ {t`当前侧边聊天上下文已与主分支脱节，处于只读状态。`}
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/20 px-2 py-1 text-[11px] text-amber-100 transition-colors hover:bg-amber-300/10"
            onClick={() => useSideChatStore.getState().refreshFromThread()}
          >
            <RefreshCw className="size-3" />
            {t`同步最新上下文`}
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-[11px] text-muted">
          {t`这是主会话的上下文快照。侧边聊天的消息不会写入主会话。`}
        </div>
        {snapshot.messages.map((message) => (
          <div
            key={message.id}
            className={`rounded-lg px-2.5 py-2 text-xs leading-relaxed ${
              message.role === "user"
                ? "ml-4 bg-[var(--surface-secondary)] text-foreground"
                : "mr-4 bg-white/[0.04] text-foreground/90"
            }`}
          >
            {message.text}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-[var(--hairline)] p-3">
        <div className="flex items-end gap-2 rounded-xl border border-white/[0.08] bg-[var(--surface)] p-2">
          <textarea
            aria-label={t`Side Chat message`}
            value={draft}
            disabled={snapshot.readOnly}
            placeholder={t`Ask about this conversation…`}
            rows={2}
            className="min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-foreground outline-none placeholder:text-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            aria-label={t`Send side chat message`}
            disabled={snapshot.readOnly || draft.trim().length === 0}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={submit}
          >
            <Send className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
