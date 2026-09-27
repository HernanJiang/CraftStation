import { Briefcase, ChevronRight, Pin } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { useAppStore } from "@/renderer/state/appStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { useWorkspaceInboxThreads } from "./useWorkspaceInboxThreads";
import { SidebarThreadRow } from "./SidebarThreadRow";
import type { SidebarRow } from "./sidebarProjectRows";

const quickButtonClass =
  "flex size-6 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-[var(--row-active)] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100";

/**
 * Resident section, like Home. Working, errored, and unread-finished threads
 * get an extra entry here; they stay under their own project. Pin (default)
 * keeps the section above projects; unpin parks it next to Home. Unpinning a
 * row hides only this entry until the episode ends.
 */
export function SidebarWorkspaceInbox() {
  const { t } = useLingui();
  const threads = useWorkspaceInboxThreads();
  const projectsById = useAppStore((state) => state.projects);
  const pinned = useSidebarUiStore((state) => state.workspaceInboxPinned);
  const collapsed = useSidebarUiStore((state) => state.workspaceInboxCollapsed);
  const editingThreadId = useSidebarUiStore((state) => state.editingThreadId);
  const setEditingThreadId = useSidebarUiStore((state) => state.setEditingThreadId);
  const projectById = new Map(projectsById.map((project) => [project.id, project]));

  return (
    <section className="space-y-0.5" aria-label={t`Workspace`}>
      <SidebarButton
        icon={
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        }
        label={
          <span className="flex items-center gap-1.5">
            <Briefcase className="size-3.5 shrink-0 text-muted" />
            <span className="truncate text-xs font-semibold text-foreground">{t`Workspace`}</span>
            {pinned ? (
              <Pin className="size-3 shrink-0 fill-current text-muted" aria-label={t`Pinned`} />
            ) : null}
          </span>
        }
        className="craftstation-sidebar-project-nudge !pl-1"
        onPress={() => useSidebarUiStore.getState().toggleWorkspaceInboxCollapsed()}
        suffix={
          <button
            type="button"
            className={`${quickButtonClass}${pinned ? " text-foreground" : ""}`}
            aria-label={pinned ? t`Unpin` : t`Pin to top`}
            onClick={(event) => {
              event.stopPropagation();
              useSidebarUiStore.getState().toggleWorkspaceInboxPinned();
            }}
          >
            <Pin className={`size-3.5${pinned ? " fill-current" : ""}`} />
          </button>
        }
      />
      {collapsed
        ? null
        : threads.map((thread, index) => {
            const project = projectById.get(thread.projectId);
            if (!project) return null;
            const row: Extract<SidebarRow, { kind: "thread" }> = {
              kind: "thread",
              key: `workspace:${thread.id}`,
              thread,
              threadIndex: index,
              group: "workspace-inbox",
              showWorktreeBadge: true,
              showWorktreeFilesButton: !!thread.worktreePath,
              sortDisabled: true,
            };
            return (
              <SidebarThreadRow
                key={row.key}
                row={row}
                project={project}
                editingThreadId={editingThreadId}
                setEditingThreadId={setEditingThreadId}
                projectTag={
                  <span className="min-w-0 flex-1 truncate text-[10px] leading-4 text-muted/70">
                    {project.name}
                  </span>
                }
                sortableId={`workspace-inbox:${thread.id}`}
                dragDisabled
                pinState={{
                  pinned: true,
                  onToggle: () =>
                    useSidebarUiStore.getState().dismissWorkspaceInboxThread(thread.id),
                }}
              />
            );
          })}
    </section>
  );
}
