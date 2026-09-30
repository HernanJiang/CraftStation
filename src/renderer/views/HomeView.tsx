import { useMemo } from "react";
import { ArrowRight, FolderOpen, House, Plus } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { Trans } from "@lingui/react/macro";
import { isHomeProject, isHomeProjectId } from "@/shared/homeScope";
import { isEphemeralSideChatThread } from "@/shared/contracts";
import type { Project, Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { openThread } from "@/renderer/actions/threadActions";
import { ThreadProviderIcon } from "@/renderer/components/providers/ThreadProviderIcon";
import { RelativeTime } from "@/renderer/components/common/RelativeTime";

const RECENT_THREAD_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

interface BrowseGroup {
  project: Project;
  home: boolean;
  threads: Thread[];
}

/**
 * Two-column browse map shared by the merged draft home and the standalone
 * HomeView fallback: project rows on top, each project's recent threads in a
 * two-column grid indented beneath it. Only threads updated within the last
 * 3 days are listed.
 */
export function HomeBrowseSections() {
  const homeScopeEnabled = useSharedSettings((state) => state.homeScopeEnabled);
  const homeProject = useAppStore((state) => state.projects.find(isHomeProject));
  const projects = useAppStore(
    useShallow((state) =>
      state.projects.filter((project) => !project.disabled && !isHomeProject(project)),
    ),
  );
  const recentThreads = useAppStore(
    useShallow((state) =>
      state.threads
        .filter(
          (t) =>
            !t.done &&
            !t.archived &&
            !isEphemeralSideChatThread(t) &&
            (homeScopeEnabled || !isHomeProjectId(t.projectId)) &&
            Date.parse(t.updatedAt) >= Date.now() - RECENT_THREAD_WINDOW_MS,
        )
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    ),
  );
  const openDraft = useAppStore((state) => state.openDraft);

  const groups = useMemo<BrowseGroup[]>(() => {
    const byProject = new Map<string, Thread[]>();
    for (const thread of recentThreads) {
      const list = byProject.get(thread.projectId) ?? [];
      list.push(thread);
      byProject.set(thread.projectId, list);
    }
    const rows: BrowseGroup[] = projects.map((project) => ({
      project,
      home: false,
      threads: byProject.get(project.id) ?? [],
    }));
    if (homeScopeEnabled && homeProject) {
      const homeThreads = byProject.get(homeProject.id) ?? [];
      if (homeThreads.length > 0) {
        rows.unshift({ project: homeProject, home: true, threads: homeThreads });
      }
    }
    // Projects with recent activity first (latest thread wins), then the rest
    // in store order.
    return rows.toSorted((a, b) => {
      const aAt = a.threads[0]?.updatedAt ?? "";
      const bAt = b.threads[0]?.updatedAt ?? "";
      if (aAt === bAt) return 0;
      if (!aAt) return 1;
      if (!bAt) return -1;
      return bAt.localeCompare(aAt);
    });
  }, [projects, homeProject, homeScopeEnabled, recentThreads]);

  if (groups.length === 0) return null;

  return (
    <div className="w-full">
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1.4fr)]">
        <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <Trans>Projects</Trans>
        </p>
        <div />
        <p className="px-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted">
          <Trans>Recent threads</Trans>
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div
            key={group.project.id}
            className="grid grid-cols-[minmax(0,1fr)_48px_minmax(0,1.4fr)] items-center"
          >
            <button
              className="group col-start-1 row-start-1 flex items-center gap-3 self-center rounded-2xl px-3 py-2 text-left transition-colors hover:bg-[var(--row-hover)]"
              onClick={() => openDraft(group.project.id)}
              type="button"
            >
              {group.home ? (
                <House className="size-4 shrink-0 text-muted" />
              ) : (
                <FolderOpen className="size-4 shrink-0 text-muted" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {group.project.name}
              </p>
              <Plus className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            {group.threads.length > 0 ? (
              <div className="col-span-3 row-start-2 grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 pl-7">
                {group.threads.map((thread) => (
                  <button
                    key={thread.id}
                    className="group flex items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-[var(--row-hover)]"
                    onClick={() => openThread(thread.id)}
                    type="button"
                  >
                    <span className="inline-flex size-4 shrink-0 items-center justify-center">
                      <ThreadProviderIcon thread={thread} className="size-4 shrink-0" />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {thread.title}
                    </p>
                    <RelativeTime
                      iso={thread.updatedAt}
                      className="ml-3 w-[3ch] shrink-0 text-right font-mono text-xs tabular-nums text-muted"
                    />
                    <ArrowRight className="size-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Fallback when the merged draft home can't render (no Home project yet, or a
 * draft view lost its project). Shows the browse map without a composer.
 */
export function HomeView() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-full min-h-0 flex-col px-8 py-8">
        <div className="mx-auto flex h-full w-full max-w-[680px] flex-col">
          <div className="flex flex-1 flex-col justify-center">
            <HomeBrowseSections />
          </div>
        </div>
      </div>
    </div>
  );
}
