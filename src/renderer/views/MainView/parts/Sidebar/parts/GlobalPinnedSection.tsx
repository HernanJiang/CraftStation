import { Pin } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { Trans } from "@lingui/react/macro";
import type { Thread } from "@/shared/contracts";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { SidebarThreadRow } from "./SidebarThreadRow";
import type { SidebarRow } from "./sidebarProjectRows";

function threadPinTimeMs(thread: Thread): number {
  if (typeof thread.pinnedAt === "number" && Number.isFinite(thread.pinnedAt)) return thread.pinnedAt;
  // Legacy mirror: starred without a timestamp still counts as pinned.
  if (thread.starred) return 0;
  return NaN;
}

/** Non-archived globally pinned threads, oldest pin first (stable by id). */
export function useGloballyPinnedThreads(): Thread[] {
  return useAppStore(
    useShallow((state) =>
      state.threads
        .filter((thread) => !thread.archived && !thread.done && Number.isFinite(threadPinTimeMs(thread)))
        .sort((a, b) => {
          const diff = threadPinTimeMs(a) - threadPinTimeMs(b);
          return diff !== 0 ? diff : a.id.localeCompare(b.id);
        }),
    ),
  );
}

/**
 * Global pinned items at the very top of the sidebar.
 *
 * Rows reuse `SidebarThreadRow` (the same component as the project lists),
 * so pinned threads keep their full affordances: hover unpin / more /
 * archive actions, right-click menu, inline rename and the project tag.
 * Pinning is presentation-only — each thread keeps its
 * `projectId`/workspace identity; unpin returns it to its home section.
 */
export function GlobalPinnedSection() {
  const pinnedThreads = useGloballyPinnedThreads();
  const projectsById = useAppStore(
    useShallow((state) => new Map(state.projects.map((project) => [project.id, project]))),
  );
  const editingThreadId = useSidebarUiStore((s) => s.editingThreadId);
  const setEditingThreadId = useSidebarUiStore((s) => s.setEditingThreadId);
  if (pinnedThreads.length === 0) return null;
  return (
    <section className="space-y-0.5" aria-label="Pinned">
      <p className="flex items-center gap-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted/65">
        <Pin className="size-2.5" aria-hidden />
        <Trans>Pinned</Trans>
      </p>
      {pinnedThreads.map((thread, index) => {
        const project = projectsById.get(thread.projectId);
        if (!project) return null;
        const row: Extract<SidebarRow, { kind: "thread" }> = {
          kind: "thread",
          key: `pinned:${thread.id}`,
          thread,
          threadIndex: index,
          group: "global-pinned",
          showWorktreeBadge: true,
          showWorktreeFilesButton: !!thread.worktreePath,
          // Pin order is pin-time, not manual DnD.
          sortDisabled: true,
        };
        // NOTE: no projectTag — like grouped rows, the owning project shows
        // in the hover tooltip (📁 …); the tag prop only toggles density and
        // project-level menu entries, which pinned rows must not gain.
        return (
          <SidebarThreadRow
            key={row.key}
            row={row}
            project={project}
            editingThreadId={editingThreadId}
            setEditingThreadId={setEditingThreadId}
          />
        );
      })}
    </section>
  );
}
