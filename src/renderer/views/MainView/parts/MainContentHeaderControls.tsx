import { Folder, PanelRight } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { MAIN_THREAD_HEADER_PORTAL_ID } from "@/renderer/components/layout/layoutHeaderPortals";
import { useCurrentProjectId, useFocusedThreadId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { isHomeProjectId } from "@/shared/homeScope";
import { usePanelStore } from "@/renderer/state/panelStore";

/**
 * Codex-style project identity at left and workspace layout controls at right.
 *
 * The thread header (title + project/Git status capsule, portaled in by
 * ThreadView) and the auxiliary-panel toggle sit in ONE flex row, vertically
 * centered at the same h-7 visual height with a tight gap:
 * `[ status capsule ] [ sidebar button ]`.
 *
 * Only one sidebar entry is ever visible: when the side panel is hidden this
 * shows the "open" button next to the status capsule; once the panel is open
 * the button hides and the panel's own top-right close button takes over, so
 * the two never appear at the same time.
 */
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
    <div data-main-content-header="" className="relative flex min-w-0 flex-1 items-center gap-2">
      <div
        id={MAIN_THREAD_HEADER_PORTAL_ID}
        className="relative flex h-full min-w-0 flex-1 items-center overflow-visible"
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

      {isAuxiliaryPanelOpen ? null : (
        <ControlTooltip
          label={t`Show side panel`}
          shortcut="Ctrl+Alt+B"
          triggerClassName="craftstation-overlay-header__controls pointer-events-auto shrink-0"
        >
          <button
            type="button"
            aria-label={t`Show side panel`}
            aria-pressed={false}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              usePanelStore.getState().toggleAuxiliaryPanel("right");
            }}
            className="craftstation-overlay-header__controls pointer-events-auto flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
          >
            <PanelRight className="size-4" />
          </button>
        </ControlTooltip>
      )}
      <span className="sr-only">{t`Agent workspace`}</span>
    </div>
  );
}
