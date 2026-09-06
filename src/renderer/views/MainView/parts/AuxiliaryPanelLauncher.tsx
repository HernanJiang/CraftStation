import {
  FileDiff,
  FolderOpen,
  Globe,
  MessageCircle,
  Plus,
  TerminalSquare,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { showFilesPanel, showGitReviewPanel } from "@/renderer/actions/panelActions";
import { openSideChatPanel } from "@/renderer/actions/sideChatActions";
import { showTerminalPanel } from "@/renderer/actions/terminalActions";
import { usePanelStore, type RightPanelTab } from "@/renderer/state/panelStore";
import { useAppStore } from "@/renderer/state/appStore";
import {
  useCurrentProjectId,
  useCurrentWorktreePath,
} from "@/renderer/hooks/uiSelectors";
import { isHomeProjectId } from "@/shared/homeScope";

type LauncherItem = {
  id: Extract<RightPanelTab, "git" | "terminal" | "browser" | "files" | "side-chat">;
  label: string;
  shortcut: string;
  icon: typeof FileDiff;
};

type ProjectScopedTool = Extract<RightPanelTab, "git" | "files">;

export function AuxiliaryPanelLauncher() {
  const { t } = useLingui();
  const projects = useAppStore((state) => state.projects);
  const realProjects = projects.filter(
    (project) => !project.disabled && !isHomeProjectId(project.id),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pendingProjectTool, setPendingProjectTool] = useState<ProjectScopedTool | null>(null);
  const currentProjectId = useCurrentProjectId();
  const currentWorktreePath = useCurrentWorktreePath();
  const selectedProject =
    realProjects.find((project) => project.id === selectedProjectId) ??
    realProjects.find((project) => project.id === currentProjectId) ??
    realProjects[0];
  const items: LauncherItem[] = [
    { id: "git", label: t`Review`, shortcut: "Ctrl+Shift+G", icon: FileDiff },
    { id: "terminal", label: t`Terminal`, shortcut: "Ctrl+`", icon: TerminalSquare },
    { id: "browser", label: t`Browser`, shortcut: "Ctrl+T", icon: Globe },
    { id: "files", label: t`Files`, shortcut: "Ctrl+P", icon: FolderOpen },
    { id: "side-chat", label: t`Side Chat`, shortcut: "", icon: MessageCircle },
  ];

  const selectTool = useCallback(
    (tab: LauncherItem["id"]) => {
      const panel = usePanelStore.getState();
      const projectId = selectedProject?.id;
      if (tab === "git") {
        // Review is a real CraftStation GitReviewPanel, so it needs a repository
        // scope. From Home there may be no scope yet; send the user to the
        // existing project creation flow instead of leaving a dead disabled row.
        if (!projectId) {
          setPendingProjectTool(tab);
          usePanelStore.getState().openCreateProjectModal();
          return;
        }
        showGitReviewPanel(
          projectId,
          projectId === currentProjectId ? currentWorktreePath : undefined,
        );
      } else if (tab === "terminal" && (currentProjectId ?? projectId)) {
        showTerminalPanel(
          currentProjectId ?? projectId!,
          currentProjectId === projectId ? currentWorktreePath : undefined,
        );
      } else if (tab === "files") {
        // Files is the native CraftStation project file tree/editor entry. It follows
        // the same scope rule as Review and can be launched from Home once a
        // project has been selected (or after creating one).
        if (!projectId) {
          setPendingProjectTool(tab);
          usePanelStore.getState().openCreateProjectModal();
          return;
        }
        showFilesPanel(projectId, projectId === currentProjectId ? currentWorktreePath : undefined);
      } else if (tab === "browser") {
        // The launcher always targets the docked auxiliary workspace. A stale
        // fullscreen/drawer flag from an earlier browser session must not cover
        // the chooser or immediately reopen above the newly selected tool.
        panel.setBrowserOverlayMaximized(false);
        panel.setBrowserOverlayOpen(false);
        panel.setBrowserPanelOpen(true);
        panel.setRightPanelTab("browser");
      } else if (tab === "side-chat") {
        openSideChatPanel();
        panel.setRightPanelTab("side-chat");
      }
      panel.setAuxiliaryPanelTab(tab);
    },
    [currentProjectId, currentWorktreePath, selectedProject?.id],
  );

  // Creating a project from the Review/Files entry should complete the
  // original intent. The launcher stays mounted behind the existing create
  // modal, so the first real project appearing is enough to continue into the
  // native CraftStation surface without asking the user to click twice.
  useEffect(() => {
    if (!pendingProjectTool || !selectedProject) return;
    const tool = pendingProjectTool;
    setPendingProjectTool(null);
    selectTool(tool);
  }, [pendingProjectTool, selectTool, selectedProject]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-background)]">
      <div className="shrink-0 border-b border-[var(--hairline)] px-6 py-3">
        {selectedProject ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="shrink-0">{t`Project scope`}</span>
            <select
              aria-label={t`Project scope`}
              value={selectedProject.id}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1.5 text-xs text-foreground outline-none transition-colors hover:bg-[var(--surface-secondary)] focus:border-accent/50"
            >
              {realProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="min-w-0 flex-1">{t`Review and Files need a project scope.`}</span>
            <button
              type="button"
              onClick={() => usePanelStore.getState().openCreateProjectModal()}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--surface-secondary)] px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-[var(--row-active)]"
            >
              <Plus className="size-3.5" />
              {t`New project`}
            </button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-[760px] space-y-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTool(item.id)}
                className="flex w-full items-center gap-3 rounded-2xl bg-[var(--surface)] px-4 py-3 text-left text-sm text-foreground/90 transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <Icon className="size-4 shrink-0 text-muted" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <kbd className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-[11px] font-normal text-muted">
                    {item.shortcut}
                  </kbd>
                ) : null}
                {(item.id === "git" || item.id === "files") && !selectedProject ? (
                  <span className="text-[11px] text-muted">{t`New project`}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
