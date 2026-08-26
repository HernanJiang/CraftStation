import { Folder, PanelRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { MAIN_THREAD_HEADER_PORTAL_ID } from "@/renderer/components/layout/layoutHeaderPortals";
import { useCurrentProjectId, useFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { isHomeProjectId } from "@/shared/homeScope";
import { usePanelStore } from "@/renderer/state/panelStore";

/** Codex-style project identity at left and workspace layout controls at right. */
export function MainContentHeaderControls() {
  const { t } = useLingui();
  const projectId = useCurrentProjectId();
  const focusedThreadId = useFocusedThreadId();
  const isAuxiliaryPanelOpen = usePanelStore((state) => state.auxiliaryPanelPlacement !== "hidden");
  const project = useAppStore((state) =>
    projectId ? state.projects.find((candidate) => candidate.id === projectId) : undefined,
  );
  const focusedThreadExists = useAppStore((state) =>
    focusedThreadId ? state.threads.some((candidate) => candidate.id === focusedThreadId) : false,
  );

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      <div
        id={MAIN_THREAD_HEADER_PORTAL_ID}
        className="flex h-full min-w-0 flex-1 items-center overflow-hidden"
      >
        {!focusedThreadExists && project && !isHomeProjectId(project.id) ? (
          <div className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted">
            <Folder className="size-3.5 shrink-0" />
            <span className="max-w-[min(34vw,360px)] truncate font-medium text-foreground/90">
              {project.name}
            </span>
          </div>
        ) : null}
      </div>

      {!isAuxiliaryPanelOpen ? (
        <ControlTooltip
          label={t`Show/hide side panel`}
          shortcut="Ctrl+Alt+B"
          triggerClassName="poracode-overlay-header__controls pointer-events-auto absolute top-2 right-2.5 z-[60]"
        >
          <button
            type="button"
            aria-label={t`Toggle tools panel`}
            aria-pressed={false}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              usePanelStore.getState().toggleAuxiliaryPanel("right");
            }}
            className="poracode-overlay-header__controls pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </button>
        </ControlTooltip>
      ) : null}
      <span className="sr-only">{t`Agent workspace`}</span>
    </div>
  );
}
