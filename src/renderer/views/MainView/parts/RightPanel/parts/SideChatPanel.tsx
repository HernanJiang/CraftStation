import { useMemo } from "react";
import { GitFork, History, Save } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";
import { useAppStore } from "@/renderer/state/appStore";
import { useSideChatStore } from "@/renderer/state/sideChatStore";
import { useFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import {
  closeSideChat,
  openSideChatBranch,
  openSideChatExisting,
  saveSideChatAsFormal,
} from "@/renderer/actions/sideChatActions";
import { isEphemeralSideChatThread } from "@/shared/contracts";
import { ThreadPane } from "@/renderer/views/MainView/parts/AppContent/parts/ThreadPane";

const PICKER_LIMIT = 20;

/**
 * Right-panel Side Chat: either a chooser (branch from the current thread, or
 * open an existing formal thread in parallel) or a full live thread rendered
 * through the same `ThreadPane` as the main view — complete transcript,
 * composer, model/harness controls, and stop/cancel, all scoped to the side
 * thread id so the left thread is never disturbed.
 */
export function SideChatPanel() {
  const { t } = useLingui();
  const selection = useSideChatStore((state) => state.selection);
  const threads = useAppStore((state) => state.threads);
  const currentThreadId = useFocusedThreadId();
  const currentThread = currentThreadId
    ? threads.find((thread) => thread.id === currentThreadId)
    : undefined;

  const sideThread = selection
    ? threads.find((thread) => thread.id === selection.threadId)
    : undefined;

  const pickerThreads = useMemo(() => {
    const scopeProjectId = currentThread?.projectId;
    return threads
      .filter(
        (thread) =>
          !thread.archived &&
          !isEphemeralSideChatThread(thread) &&
          (!scopeProjectId || thread.projectId === scopeProjectId),
      )
      .slice()
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, PICKER_LIMIT);
  }, [threads, currentThread?.projectId]);

  if (!selection || !sideThread) {
    const canBranch =
      currentThread !== undefined && !isEphemeralSideChatThread(currentThread);
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[var(--content-background)]">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          <button
            type="button"
            disabled={!canBranch}
            aria-label={t`从当前线程分支`}
            onClick={() => {
              if (currentThreadId) openSideChatBranch(currentThreadId);
            }}
            className="flex w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:bg-[var(--surface-secondary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitFork className="size-4 shrink-0 text-muted" strokeWidth={1.8} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t`从当前线程分支`}</span>
              <span className="block truncate text-[11px] text-muted">
                {canBranch
                  ? t`创建临时分支，不会出现在左侧列表`
                  : t`没有可分支的正式会话`}
              </span>
            </span>
          </button>
          <div className="flex items-center gap-2 px-1 pt-2 text-[11px] text-muted">
            <History className="size-3.5" strokeWidth={1.8} />
            <span>{t`选择已有线程（右侧并行打开，原线程不受影响）`}</span>
          </div>
          {pickerThreads.length === 0 ? (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2 text-[11px] text-muted">
              {t`暂无正式线程。`}
            </div>
          ) : (
            pickerThreads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                aria-label={thread.title}
                onClick={() => openSideChatExisting(thread.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{thread.title}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {thread.agentKind} · <RelativeTime iso={thread.updatedAt} />
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  const isUnsavedBranch = selection.kind === "branch" && isEphemeralSideChatThread(sideThread);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--content-background)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--hairline)] px-3 py-1.5 text-[11px]">
        {selection.kind === "branch" ? (
          <>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent-foreground">
              {t`临时分支`}
            </span>
            {isUnsavedBranch ? (
              <button
                type="button"
                onClick={() => saveSideChatAsFormal()}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-foreground/90 transition-colors hover:bg-white/5"
              >
                <Save className="size-3" />
                {t`保存为正式线程`}
              </button>
            ) : null}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted">
            {t`正在右侧查看正式线程，关闭不影响原线程`}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ThreadPane
          threadId={sideThread.id}
          paneCount={1}
          paneAlign="center"
          portalThreadHeader={false}
          onClose={() => closeSideChat()}
        />
      </div>
    </div>
  );
}
