import { Archive, ChevronRight, Ellipsis, Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import type { Project } from "@/shared/contracts";
import { TuxIcon } from "@/renderer/components/common/TuxIcon";
import { useRemoteServerStatusLabel } from "@/renderer/components/common/RemoteServerStatusDot";
import {
  ProjectRemoteServerIcon,
  useProjectRemoteServer,
} from "@/renderer/components/common/ProjectRemoteServer";
import { ContextMenu } from "@/renderer/components/common/ContextMenu";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { openGitReview } from "@/renderer/actions/panelActions";
import {
  deleteProject,
  renameProject,
  setProjectDisabled,
} from "@/renderer/actions/projectActions";
import { openNewThread } from "@/renderer/actions/threadActions";
import { useIsProjectGitPanelActive } from "@/renderer/hooks/uiSelectors";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { formatProjectLocation } from "./formatProjectLocation";
import { useProjectMenu } from "./useProjectMenu";
import { InlineRenameInput } from "./InlineRenameInput";
import { GitBadge } from "./GitBadge";

export function SidebarProjectHeader(props: {
  project: Project;
  isCollapsed: boolean;
  isDragging: boolean;
  isUnreachable: boolean;
}) {
  const { project, isCollapsed, isDragging, isUnreachable } = props;
  const { t } = useLingui();
  const toggleProjectCollapsed = useSidebarUiStore((s) => s.toggleProjectCollapsed);
  const projectLocation = formatProjectLocation(project);
  const isDisabled = !!project.disabled;
  const remote = useProjectRemoteServer(project);
  const remoteStatusLabel = useRemoteServerStatusLabel(remote.status ?? "offline");
  // Git and removal execute on the project's host, so they are
  // unavailable while a mirrored project's server is unreachable. The row
  // tooltip carries the status, so the greyed-out items read as explained.
  const isUnavailable = isDisabled || isUnreachable;
  const showBody = !isCollapsed && !isUnavailable;
  const projectMenu = useProjectMenu(project, { isUnreachable });
  const isActiveGitPanel = useIsProjectGitPanelActive(project.id);
  const editingProjectId = useSidebarUiStore((s) => s.editingProjectId);
  const setEditingProjectId = useSidebarUiStore((s) => s.setEditingProjectId);
  const isPinned = useSidebarUiStore((s) => s.pinnedProjectIds.includes(project.id));
  const quickButtonClass =
    "flex size-6 items-center justify-center rounded-lg text-muted opacity-0 transition-all hover:bg-[var(--row-active)] hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100";

  return (
    <ContextMenu items={projectMenu.items} onAction={projectMenu.onAction}>
      <SidebarButton
        icon={
          <ChevronRight
            className={`size-3.5 shrink-0 text-muted transition-transform ${
              showBody ? "rotate-90" : ""
            }`}
          />
        }
        label={
          <span className="flex items-center gap-1.5">
            {editingProjectId === project.id ? (
              <InlineRenameInput
                initialValue={project.name}
                ariaLabel={t`Rename project`}
                onCommit={(name) => {
                  renameProject(project.id, name);
                  setEditingProjectId(null);
                }}
                onCancel={() => setEditingProjectId(null)}
              />
            ) : (
              <span className="truncate text-xs font-semibold text-foreground">{project.name}</span>
            )}
            {isPinned ? (
              <Pin className="size-3 shrink-0 fill-current text-muted" aria-label={t`Pinned`} />
            ) : null}
            <ProjectRemoteServerIcon info={remote} />
            {/* Keep the host marker; the removed controls are the project-level
                Files and CLI actions, not the location/status metadata. */}
            {remote.serverName ? (
              <span className="max-w-24 truncate text-[10px] font-normal text-muted/60">
                {remote.serverName}
              </span>
            ) : null}
            {project.location.kind === "wsl" && (
              <TuxIcon className="h-3 w-auto shrink-0 text-muted/60" />
            )}
          </span>
        }
        tooltip={
          isDisabled
            ? t`${projectLocation} (disabled)`
            : remote.serverName
              ? `${projectLocation} · ${remote.serverName} · ${remoteStatusLabel}`
              : projectLocation
        }
        className={`craftstation-sidebar-project-nudge !pl-1${isDragging ? " opacity-60" : ""}${
          isUnavailable ? " opacity-50" : ""
        }`}
        onPress={() => {
          if (isUnavailable) return;
          toggleProjectCollapsed(project.id);
        }}
        isDragging={isDragging}
        suffix={
          isUnavailable ? null : (
            <>
              <button
                type="button"
                className={quickButtonClass}
                aria-label={t`New chat in ${project.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  useSidebarUiStore.getState().setProjectCollapsed(project.id, false);
                  openNewThread(project.id);
                }}
              >
                <Plus className="size-3.5" />
              </button>
              <Dropdown>
                <Dropdown.Trigger
                  aria-label={t`More project actions`}
                  className={quickButtonClass}
                  onClick={(event) => event.stopPropagation()}
                >
                  <Ellipsis className="size-3.5" />
                </Dropdown.Trigger>
                <Dropdown.Popover placement="bottom end" className="min-w-[190px] rounded-[14px]">
                  <Dropdown.Menu
                    aria-label={t`Project actions`}
                    onAction={(key) => {
                      if (key === "rename") setEditingProjectId(project.id);
                      if (key === "archive") setProjectDisabled(project.id, true);
                      if (key === "delete") deleteProject(project.id);
                    }}
                  >
                    <Dropdown.Item id="rename" textValue={t`Rename`}>
                      <Pencil className="size-4 text-muted" />
                      <Label>{t`Rename`}</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="archive" textValue={t`Archive`}>
                      <Archive className="size-4 text-muted" />
                      <Label>{t`Archive`}</Label>
                    </Dropdown.Item>
                    <Dropdown.Item id="delete" textValue={t`Delete`} variant="danger">
                      <Trash2 className="size-4" />
                      <Label>{t`Delete`}</Label>
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
              <GitBadge
                projectId={project.id}
                projectName={project.name}
                onPress={() => openGitReview(project.id)}
                isActive={isActiveGitPanel}
                alwaysVisible
              />
            </>
          )
        }
      />
    </ContextMenu>
  );
}
