import { Archive, ChevronRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import type { ThreadSortMode } from "./sortMode";
import { SidebarProjectSection } from "./SidebarProjectSection";

/**
 * Archived projects leave the main list (they used to stay as dimmed cards).
 * This folder stays collapsed so they are out of the way; expand it to
 * right-click a project and enable it again.
 */
export function SidebarArchivedProjects(props: {
  projectIds: readonly string[];
  sortMode: ThreadSortMode;
}) {
  const { t } = useLingui();
  const collapsed = useSidebarUiStore((state) => state.archivedProjectsCollapsed);
  if (props.projectIds.length === 0) return null;

  return (
    <section className="space-y-0.5" aria-label={t`Archive`}>
      <SidebarButton
        icon={
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        }
        label={
          <span className="flex items-center gap-1.5">
            <Archive className="size-3.5 shrink-0 text-muted" />
            <span className="truncate text-xs font-semibold text-foreground">{t`Archive`}</span>
            <span className="text-[10px] font-normal text-muted/70">{props.projectIds.length}</span>
          </span>
        }
        className="craftstation-sidebar-project-nudge !pl-1"
        onPress={() => useSidebarUiStore.getState().toggleArchivedProjectsCollapsed()}
      />
      {collapsed
        ? null
        : props.projectIds.map((projectId, projectIndex) => (
            <SidebarProjectSection
              key={projectId}
              projectId={projectId}
              projectIndex={projectIndex}
              sortMode={props.sortMode}
            />
          ))}
    </section>
  );
}
