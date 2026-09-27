import type { Thread } from "@/shared/contracts";

/**
 * Threads the sidebar Workspace section also lists. This is another entry
 * to the same thread — `projectId` is never rewritten, and the row stays in
 * its project. Dismiss only hides that extra entry for the current episode.
 *
 * Working (including launch and mid-turn waits), error, unread completion
 * (`finished` is the durable unread-done badge), or live background work.
 */
export function isWorkspaceInboxThread(
  thread: Pick<Thread, "status" | "attention" | "archived" | "done" | "isEphemeral">,
  options?: { hasBackgroundActivity?: boolean },
): boolean {
  if (thread.archived || thread.isEphemeral || thread.done) return false;
  if (
    thread.status === "launching" ||
    thread.status === "working" ||
    thread.status === "needs_approval" ||
    thread.status === "needs_reply" ||
    thread.status === "error" ||
    thread.attention === "error"
  ) {
    return true;
  }
  if (thread.status === "finished") return true;
  return options?.hasBackgroundActivity === true && thread.status !== "inactive";
}

export interface WorkspaceInboxPartition<TThread extends Thread> {
  visible: TThread[];
  /** Dismissals whose thread no longer qualifies, so the next episode can re-enter. */
  staleDismissalIds: string[];
}

/** Recently-used first. Dismissed threads stay out only while they still qualify. */
export function partitionWorkspaceInbox<TThread extends Thread>(
  threads: readonly TThread[],
  options: {
    allowedProjectIds: ReadonlySet<string>;
    dismissedIds?: readonly string[] | undefined;
    liveThreadIds?: ReadonlySet<string> | undefined;
  },
): WorkspaceInboxPartition<TThread> {
  const dismissed = new Set(options.dismissedIds ?? []);
  const live = options.liveThreadIds;
  const visible: TThread[] = [];
  const stillQualifyingDismissed = new Set<string>();
  for (const thread of threads) {
    if (!options.allowedProjectIds.has(thread.projectId)) continue;
    const qualifies = isWorkspaceInboxThread(thread, {
      hasBackgroundActivity: live?.has(thread.id) === true,
    });
    if (!qualifies) continue;
    if (dismissed.has(thread.id)) {
      stillQualifyingDismissed.add(thread.id);
      continue;
    }
    visible.push(thread);
  }
  visible.sort((a, b) => {
    const diff = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (Number.isFinite(diff) && diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
  const staleDismissalIds = [...dismissed].filter((id) => !stillQualifyingDismissed.has(id));
  return { visible, staleDismissalIds };
}
