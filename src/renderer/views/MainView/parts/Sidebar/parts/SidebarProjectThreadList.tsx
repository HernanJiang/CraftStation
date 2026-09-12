import type { Project } from "@/shared/contracts";
import { isThreadGloballyPinned } from "@/shared/sidebarOrdering";
import { useLiveBackgroundThreadIds, useProjectThreads } from "@/renderer/hooks/uiSelectors";
import { useSidebarUiStore, useThreadListLimit } from "@/renderer/state/sidebarUiStore";
import { useExperimentCandidateOrder } from "@/renderer/state/experimentStore";
import { buildSidebarProjectRows } from "./sidebarProjectRows";
import type { ThreadSortMode } from "./sortMode";
import { SeeMoreThreadsButton, SidebarThreadRow } from "./SidebarThreadRow";

export function SidebarProjectThreadList(props: { project: Project; sortMode: ThreadSortMode }) {
  const { project, sortMode } = props;
  const allProjectThreads = useProjectThreads(project.id);
  // Global pins move to the top Pinned section (presentation only — the
  // thread keeps its projectId; unpin returns it here).
  const projectThreads = allProjectThreads.filter((thread) => !isThreadGloballyPinned(thread));
  const experimentCandidateOrder = useExperimentCandidateOrder(project.id);
  const collapsedWorktrees = useSidebarUiStore((s) => s.collapsedWorktrees);
  const editingThreadId = useSidebarUiStore((s) => s.editingThreadId);
  const setEditingThreadId = useSidebarUiStore((s) => s.setEditingThreadId);
  const revealMoreThreads = useSidebarUiStore((s) => s.revealMoreThreads);
  const visibleLimit = useThreadListLimit(project.id);
  const liveBackgroundThreadIds = useLiveBackgroundThreadIds(projectThreads);
  const rows = buildSidebarProjectRows({
    projectId: project.id,
    projectThreads,
    sortMode,
    collapsedWorktrees,
    visibleLimit,
    liveBackgroundThreadIds,
    ...(experimentCandidateOrder.size > 0 ? { experimentCandidateOrder } : {}),
  });

  return (
    <div className="space-y-0.5">
      <div>
        {rows.map((row) =>
          row.kind === "see-more" ? (
            <SeeMoreThreadsButton key={row.key} onPress={() => revealMoreThreads(project.id)} />
          ) : (
            <SidebarThreadRow
              key={row.key}
              row={row}
              project={project}
              editingThreadId={editingThreadId}
              setEditingThreadId={setEditingThreadId}
            />
          ),
        )}
      </div>
    </div>
  );
}
