import { Folder, FolderPlus } from "lucide-react";
import { Button, Modal } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { openNewThread } from "@/renderer/actions/threadActions";
import { formatProjectLocation } from "@/renderer/views/MainView/parts/Sidebar/parts/formatProjectLocation";
import { isHomeProject } from "@/shared/homeScope";
import {
  ProjectSelectorIcon,
  useProjectRemoteServer,
} from "@/renderer/components/common/ProjectRemoteServer";

export function SelectProjectForThreadModal() {
  const open = usePanelStore((s) => s.selectProjectModalOpen);

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) usePanelStore.getState().closeSelectProjectModal();
      }}
    >
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[480px]">
          {open ? <SelectProjectForThreadForm /> : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function SelectProjectForThreadForm() {
  const allProjects = useAppStore((state) => state.projects);
  const projects = allProjects.filter((p) => !p.disabled && !isHomeProject(p));

  function handleSelect(projectId: string) {
    usePanelStore.getState().closeSelectProjectModal();
    openNewThread(projectId);
  }

  function handleOpenCreateProject() {
    usePanelStore.getState().closeSelectProjectModal();
    usePanelStore.getState().openCreateProjectModal();
  }

  return (
    <>
      <Modal.CloseTrigger />
      <Modal.Header>
        <Modal.Heading>
          <Trans>New chat in project</Trans>
        </Modal.Heading>
        <p className="mt-1 text-xs text-muted">
          <Trans>Choose a project to start your conversation.</Trans>
        </p>
      </Modal.Header>
      <Modal.Body className="flex flex-col gap-2 p-4 max-h-[380px] overflow-y-auto [scrollbar-gutter:stable]">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
            <Folder className="size-8 text-muted/60" />
            <p className="text-sm text-muted">
              <Trans>No projects found.</Trans>
            </p>
            <Button variant="tertiary" className="gap-2 text-xs" onPress={handleOpenCreateProject}>
              <FolderPlus className="size-4" />
              <Trans>Create project</Trans>
            </Button>
          </div>
        ) : (
          projects.map((project) => (
            <ProjectItemRow
              key={project.id}
              project={project}
              onSelect={() => handleSelect(project.id)}
            />
          ))
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button slot="close" variant="ghost" className="text-muted">
          <Trans>Cancel</Trans>
        </Button>
      </Modal.Footer>
    </>
  );
}

function ProjectItemRow(props: {
  project: ReturnType<typeof useAppStore.getState>["projects"][number];
  onSelect: () => void;
}) {
  const { project, onSelect } = props;
  const remote = useProjectRemoteServer(project);
  const locationLabel = formatProjectLocation(project);

  return (
    <button
      type="button"
      className="flex items-center gap-3 w-full rounded-xl p-2.5 text-left transition-colors hover:bg-[var(--row-hover)] focus-visible:focus-ring outline-none border border-white/[0.04]"
      onClick={onSelect}
    >
      <div className="size-8 shrink-0 rounded-lg bg-white/[0.06] flex items-center justify-center">
        <ProjectSelectorIcon project={project} remote={remote} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">{project.name}</div>
        <div className="text-xs text-muted truncate">{locationLabel}</div>
      </div>
    </button>
  );
}
