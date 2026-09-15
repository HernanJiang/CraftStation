import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "@heroui/react";
import { Bug } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type {
  AgentStatus,
  ProjectLocation,
  PromptSegment,
  TerminalSize,
  Thread,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import { DEFAULT_TERMINAL_SIZE as DEFAULT_HIDDEN_TERMINAL_SIZE } from "@/shared/contracts";
import { resolveAgentPresentationMode } from "@/shared/agentStatus";

import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { performInitialThreadLaunch } from "@/renderer/actions/threadLaunchActions";
import { macosTrafficLightPadClass } from "@/renderer/components/layout/sidebarChrome";
import {
  MAIN_THREAD_HEADER_PORTAL_ID,
  useLayoutHeaderPortalTarget,
} from "@/renderer/components/layout/layoutHeaderPortals";
import type { RemoteTerminalTransport, TerminalPaneHandle } from "./TerminalPane";
import type { CheckpointRevertActions } from "./ChatPane/parts/MessageList";
import type { SaveClipboardImage } from "../composer/useAttachments";
import { ContinueInProviderDialog } from "./ContinueInProviderDialog";
import { GuiThreadContent } from "./ThreadContent";
import { TerminalThreadContent } from "./TerminalThreadContent";
import { ThreadCollaborationDialog } from "./ThreadCollaborationDialog";
import { ThreadHeaderStatusButton } from "./ThreadHeaderStatus";
import { ThreadScheduleIndicator } from "./ThreadScheduleIndicator";
import { ThreadStatusCapsule } from "./ThreadStatusCapsule";

/**
 * Strip Electron's `Error invoking remote method '<channel>': Error: ` prefix
 * from IPC rejections so users see the supervisor's actual message verbatim.
 */
function stripIpcInvokeFraming(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}

function formatLaunchError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return stripIpcInvokeFraming(error.message);
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return stripIpcInvokeFraming(error);
  }
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return stripIpcInvokeFraming(error.message);
  }
  return fallbackMessage;
}

function areThreadViewPropsEqual(prev: ThreadViewProps, next: ThreadViewProps): boolean {
  const configAffectsLaunch =
    prev.pendingLaunchPrompt !== undefined || next.pendingLaunchPrompt !== undefined;
  return (
    prev.thread.id === next.thread.id &&
    prev.thread.projectId === next.thread.projectId &&
    prev.thread.title === next.thread.title &&
    prev.thread.agentKind === next.thread.agentKind &&
    prev.thread.agentInstanceId === next.thread.agentInstanceId &&
    prev.thread.worktreePath === next.thread.worktreePath &&
    prev.thread.presentationMode === next.thread.presentationMode &&
    prev.thread.done === next.thread.done &&
    prev.thread.canResumeWithConfig === next.thread.canResumeWithConfig &&
    prev.thread.sessionRef?.providerSessionId === next.thread.sessionRef?.providerSessionId &&
    (!configAffectsLaunch || prev.thread.config === next.thread.config) &&
    prev.agentStatus === next.agentStatus &&
    prev.projectLocation === next.projectLocation &&
    prev.pendingLaunchPrompt === next.pendingLaunchPrompt &&
    prev.pendingLaunchSegments === next.pendingLaunchSegments &&
    prev.pendingLaunchUserMessageItemId === next.pendingLaunchUserMessageItemId &&
    prev.isWsl === next.isWsl &&
    prev.showCloseButton === next.showCloseButton &&
    prev.paneAlign === next.paneAlign &&
    prev.hidden === next.hidden &&
    prev.portalThreadHeader === next.portalThreadHeader &&
    prev.isDragging === next.isDragging &&
    prev.dropIndicator === next.dropIndicator &&
    prev.paneCount === next.paneCount &&
    prev.headerNeedsTrafficLightPad === next.headerNeedsTrafficLightPad &&
    prev.dragHandleRef === next.dragHandleRef &&
    prev.droppableRef === next.droppableRef &&
    prev.installedAgents === next.installedAgents &&
    prev.onContinueInProvider === next.onContinueInProvider &&
    prev.onSubmitInput === next.onSubmitInput &&
    prev.onOpenProjectRelativePath === next.onOpenProjectRelativePath &&
    prev.checkpointActions === next.checkpointActions &&
    prev.remoteTerminalTransport === next.remoteTerminalTransport &&
    prev.pickFiles === next.pickFiles &&
    prev.saveClipboardImage === next.saveClipboardImage
  );
}

export type ThreadViewProps = {
  thread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  pendingLaunchPrompt?: string;
  pendingLaunchSegments?: PromptSegment[];
  pendingLaunchUserMessageItemId?: string;
  isWsl?: boolean;
  showCloseButton?: boolean;
  paneAlign?: "left" | "center" | "right";
  isDragging?: boolean;
  /** Mounted but hidden for keep-alive. */
  hidden?: boolean;
  /**
   * False when this pane is NOT the main workspace content (e.g. a Side Chat
   * pane in the right panel): its header must render locally in its own pane
   * and must never portal into the single global workspace-header target,
   * which is reserved for the focused main thread.
   */
  portalThreadHeader?: boolean;
  dropIndicator?:
    | false
    | "replace"
    | "insert-left"
    | "insert-right"
    | "insert-top"
    | "insert-bottom";
  paneIndex?: number;
  paneCount?: number;
  /**
   * True when this pane sits in the top-left and there is no group header above
   * it — i.e., the pane's own header is the topmost row in the content area and
   * needs to clear the macOS traffic lights when the sidebar is collapsed. Pure
   * layout fact: stable across sidebar collapse/expand so the memo holds.
   */
  headerNeedsTrafficLightPad?: boolean | undefined;
  dragHandleRef?: (element: Element | null) => void;
  droppableRef?: React.RefObject<HTMLDivElement | null>;
  onClose?: (() => void) | undefined;
  installedAgents?: AgentStatus[];
  onContinueInProvider?:
    | ((
        targetKind: string,
        targetConfig: ThreadConfig,
        targetPresentationMode: ThreadPresentationMode,
        prompt: string,
        segments: PromptSegment[] | undefined,
        closeOriginal: boolean,
        extractedContext: import("../../../shared/contracts").ExtractContextResult | null,
      ) => void)
    | undefined;
  onLaunchConsumed?: (() => void) | undefined;
  onLaunchFailed?: ((message: string) => void) | undefined;
  onSubmitInput?: ((prompt: string, segments?: PromptSegment[]) => Promise<void>) | undefined;
  onOpenProjectRelativePath?: ((path: string, lineNumber?: number) => void) | undefined;
  checkpointActions?: CheckpointRevertActions | undefined;
  remoteTerminalTransport?: RemoteTerminalTransport | undefined;
  pickFiles?: (() => Promise<string[] | null>) | undefined;
  saveClipboardImage?: SaveClipboardImage | undefined;
};

export const ThreadView = memo(function ThreadView(props: ThreadViewProps) {
  const {
    thread,
    agentStatus,
    projectLocation,
    pendingLaunchPrompt,
    pendingLaunchSegments,
    pendingLaunchUserMessageItemId,
    paneAlign = "center",
    isDragging,
    hidden = false,
    portalThreadHeader = true,
    dropIndicator,
    paneIndex: _paneIndex,
    paneCount = 1,
    headerNeedsTrafficLightPad = false,
    dragHandleRef,
    droppableRef,
    installedAgents,
    onContinueInProvider,
    onLaunchConsumed,
    onLaunchFailed,
    onSubmitInput,
    onOpenProjectRelativePath,
    checkpointActions,
    remoteTerminalTransport,
    pickFiles,
    saveClipboardImage,
  } = props;
  const { t } = useLingui();
  const terminalPaneRef = useRef<TerminalPaneHandle>(null);
  const [terminalSize, setTerminalSize] = useState<TerminalSize | null>(null);
  const [continueDialogOpen, setContinueDialogOpen] = useState(false);
  const [collaborationDialogOpen, setCollaborationDialogOpen] = useState(false);
  const [collaborationRefreshKey, setCollaborationRefreshKey] = useState(0);
  const [runtimeDebugOpen, setRuntimeDebugOpen] = useState(false);
  const launchRequestRef = useRef<string | null>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [isTitleTooltipOpen, setIsTitleTooltipOpen] = useState(false);
  const threadHeaderPortalTarget = useLayoutHeaderPortalTarget(MAIN_THREAD_HEADER_PORTAL_ID);

  const presentationMode = agentStatus
    ? resolveAgentPresentationMode(agentStatus.capabilities, thread.presentationMode)
    : (thread.presentationMode ?? "terminal");
  const usesTerminalPresentation = presentationMode === "terminal";
  const effectiveThread = useMemo(
    () =>
      presentationMode === thread.presentationMode
        ? thread
        : { ...thread, presentationMode, threadStatusSource: "server" as const },
    [presentationMode, thread],
  );
  const launchTerminalSize = usesTerminalPresentation ? terminalSize : DEFAULT_HIDDEN_TERMINAL_SIZE;

  // The capsule card always floats as an overlay anchored under the capsule;
  // it never reserves width in the pane, so the transcript + composer stay
  // put when the card opens.
  // Right-edge occupancy: the auxiliary rail in any non-hidden placement, or
  // any panel context that renders into the right dock (git panel included —
  // it mounts outside the auxiliary placement flow).
  const rightEdgeOccupied = usePanelStore(
    (s) =>
      s.auxiliaryPanelPlacement !== "hidden" ||
      (s.gitReviewContext !== null && s.gitReviewAsPanel) ||
      s.filesPanelContext !== null ||
      s.auxiliaryPanelTab !== null ||
      s.usagePanelOpen ||
      s.notesPanelOpen ||
      s.browserPanelOpen ||
      s.subAgentPanelContext !== null,
  );
  // Overlay mode: with the edge occupied the capsule must not take part in
  // the header layout at all — it floats top-right so Agents/Goal/Git growth
  // can never re-squeeze the chat column. Visuals unchanged, only positioning.
  const capsuleOverlay = rightEdgeOccupied;

  useEffect(() => {
    if (presentationMode !== thread.presentationMode) {
      useAppStore.getState().updateThreadPresentationMode(thread.id, presentationMode);
    }
  }, [presentationMode, thread.id, thread.presentationMode]);

  useLayoutEffect(() => {
    setContinueDialogOpen(false);
    setCollaborationDialogOpen(false);
    setRuntimeDebugOpen(false);
    setIsTitleTooltipOpen(false);
  }, [thread.id]);

  useEffect(() => {
    if (pendingLaunchPrompt === undefined) {
      launchRequestRef.current = null;
    }
  }, [pendingLaunchPrompt, thread.id]);

  useEffect(() => {
    if (pendingLaunchPrompt === undefined || launchTerminalSize === null) {
      return;
    }

    const launchKey = [
      thread.id,
      thread.sessionRef?.providerSessionId ?? "new",
      pendingLaunchPrompt,
      launchTerminalSize.cols,
      launchTerminalSize.rows,
    ].join(":");
    if (launchRequestRef.current === launchKey) {
      return;
    }

    launchRequestRef.current = launchKey;
    onLaunchConsumed?.();
    const connectionToken = useAppStore.getState().connectingThreadIds[thread.id];

    void (async () => {
      await performInitialThreadLaunch({
        thread: effectiveThread,
        projectLocation,
        prompt: pendingLaunchPrompt,
        ...(pendingLaunchSegments ? { segments: pendingLaunchSegments } : {}),
        ...(pendingLaunchUserMessageItemId
          ? { userMessageItemId: pendingLaunchUserMessageItemId }
          : {}),
        initialSize: launchTerminalSize,
      });
    })()
      .catch((error) => {
        launchRequestRef.current = null;
        onLaunchFailed?.(formatLaunchError(error, t`Thread failed to start.`));
      })
      .finally(() => {
        if (connectionToken) {
          useAppStore.getState().finishThreadConnecting(thread.id, connectionToken);
        }
      });
  }, [
    t,
    onLaunchConsumed,
    onLaunchFailed,
    pendingLaunchPrompt,
    pendingLaunchSegments,
    pendingLaunchUserMessageItemId,
    projectLocation,
    launchTerminalSize,
    thread,
    effectiveThread,
  ]);

  const alignClass =
    paneAlign === "right" ? "ml-auto" : paneAlign === "left" ? "mr-auto" : "mx-auto";
  const paddingClass = "px-2";
  // GUI chats are full-bleed so the quick-nav rail can sit flush against the
  // main sidebar. Message rows and the composer keep their own 920px centering.
  // Terminal panes stay in the historic centered column.
  const contentShellClass = usesTerminalPresentation
    ? `${alignClass} relative flex min-h-0 w-full max-w-[1040px] flex-1 flex-col ${paddingClass} px-3 pb-2`
    : "relative flex min-h-0 w-full flex-1 flex-col pb-2";
  const contentBodyClass = usesTerminalPresentation
    ? `${alignClass} flex min-h-0 w-full max-w-[920px] flex-1 flex-col pt-2`
    : "relative flex min-h-0 w-full flex-1 flex-col pt-2";
  const threadHeaderIsPortaled =
    portalThreadHeader && !hidden && paneCount === 1 && threadHeaderPortalTarget !== null;
  const threadHeader = (
    <div
      data-thread-header-portal-content=""
      className={`${threadHeaderIsPortaled ? "h-full min-w-0 flex-1" : "shrink-0"} px-2 ${
        headerNeedsTrafficLightPad ? macosTrafficLightPadClass : ""
      }`}
    >
      <div
        className={`${dragHandleRef ? "craftstation-content-over-drag-region" : "craftstation-content-over-drag-region--drag"} @container relative ${
          threadHeaderIsPortaled ? "" : alignClass
        } flex w-full min-w-0 ${threadHeaderIsPortaled ? "max-w-none" : "max-w-[920px]"} items-center gap-2 ${
          threadHeaderIsPortaled ? "h-full" : "py-1"
        }`}
      >
        <ThreadHeaderStatusButton
          threadId={thread.id}
          fallbackThread={thread}
          fallbackAgentKind={thread.agentKind}
          agentLabel={agentStatus?.label}
          agentIcon={agentStatus?.icon}
        />
        <div
          ref={dragHandleRef}
          className={`flex min-w-0 flex-1 items-center gap-2 ${dragHandleRef ? "cursor-grab active:cursor-grabbing" : ""}`}
        >
          <Tooltip
            delay={500}
            isOpen={isTitleTooltipOpen}
            onOpenChange={(open) => {
              if (open) {
                const el = titleRef.current;
                if (el && el.scrollWidth > el.clientWidth) {
                  setIsTitleTooltipOpen(true);
                }
              } else {
                setIsTitleTooltipOpen(false);
              }
            }}
          >
            <Tooltip.Trigger className="min-w-0 flex-1" tabIndex={-1} role="none">
              <span
                ref={titleRef}
                className="block truncate text-sm font-medium leading-tight text-foreground @max-[560px]:text-xs @max-[360px]:text-[11px]"
              >
                {thread.title}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content placement="bottom" className="max-w-[28rem] break-words text-xs">
              {thread.title}
            </Tooltip.Content>
          </Tooltip>
          <div
            data-capsule-slot=""
            className={`flex shrink-0 items-center gap-1 ${
              capsuleOverlay ? "absolute top-1/2 right-2 z-30 -translate-y-1/2" : ""
            }`}
          >
            {/* Project / Git status capsule replaces the previous scattered
                Home / Provider icon row. Thread lifecycle actions (ask another,
                continue in provider, close, mark-done) live in their own
                surfaces. */}
            <ThreadScheduleIndicator threadId={thread.id} />
            <ThreadStatusCapsule
              threadId={thread.id}
              projectId={thread.projectId}
              {...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {})}
              projectLocation={projectLocation}
              collaborationRefreshKey={collaborationRefreshKey}
              onOpenCollaboration={() => setCollaborationDialogOpen(true)}
            />
            {import.meta.env.DEV && !usesTerminalPresentation ? (
              <Tooltip delay={0}>
                <Tooltip.Trigger>
                  <button
                    type="button"
                    aria-label={
                      runtimeDebugOpen ? t`Hide runtime debug panel` : t`Show runtime debug panel`
                    }
                    aria-pressed={runtimeDebugOpen}
                    className={`craftstation-overlay-header__controls shrink-0 rounded p-1 transition-colors hover:bg-[var(--row-hover)] ${runtimeDebugOpen ? "text-foreground" : "text-muted/60 hover:text-foreground"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRuntimeDebugOpen((o) => !o);
                    }}
                  >
                    <Bug className="size-3.5" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  {runtimeDebugOpen
                    ? t`Hide canonical runtime item inspector`
                    : t`Inspect canonical runtime items`}
                </Tooltip.Content>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={droppableRef}
        data-craftstation-thread-pane=""
        className={`group/pane relative flex h-full min-h-0 flex-col ${isDragging ? "opacity-50" : ""}`}
      >
        {dropIndicator === "replace" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 rounded-2xl bg-accent/10 ring-1 ring-inset ring-accent/30"
          />
        )}
        {dropIndicator === "insert-left" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 bottom-0 left-0 z-20 w-0.5 rounded-full bg-accent"
          />
        )}
        {dropIndicator === "insert-right" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 bottom-0 z-20 w-0.5 rounded-full bg-accent"
          />
        )}
        {dropIndicator === "insert-top" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 left-0 z-20 h-0.5 rounded-full bg-accent"
          />
        )}
        {dropIndicator === "insert-bottom" && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-0 bottom-0 left-0 z-20 h-0.5 rounded-full bg-accent"
          />
        )}

        {/* A single pane shares the global workspace row with the auxiliary tools.
            Multi-pane layouts retain one local header per pane. */}
        {threadHeaderIsPortaled
          ? createPortal(threadHeader, threadHeaderPortalTarget)
          : threadHeader}

        <div className={contentShellClass}>
          <div className={contentBodyClass}>
            {usesTerminalPresentation ? (
              <TerminalThreadContent
                threadId={thread.id}
                fallbackThread={effectiveThread}
                agentStatus={agentStatus}
                projectLocation={projectLocation}
                paneCount={paneCount}
                terminalPaneRef={terminalPaneRef}
                onTerminalResize={setTerminalSize}
                hidden={hidden}
                {...(onSubmitInput ? { onSubmitInput } : {})}
                {...(remoteTerminalTransport ? { remoteTerminalTransport } : {})}
                {...(pickFiles ? { pickFiles } : {})}
                {...(saveClipboardImage ? { saveClipboardImage } : {})}
              />
            ) : (
              <GuiThreadContent
                threadId={thread.id}
                fallbackThread={effectiveThread}
                agentStatus={agentStatus}
                projectLocation={projectLocation}
                paneCount={paneCount}
                terminalPaneRef={terminalPaneRef}
                runtimeDebugOpen={import.meta.env.DEV && runtimeDebugOpen}
                {...(onSubmitInput ? { onSubmitInput } : {})}
                {...(onOpenProjectRelativePath ? { onOpenProjectRelativePath } : {})}
                {...(checkpointActions ? { checkpointActions } : {})}
                {...(thread.remoteServerId ? { checkpointProjectLocation: projectLocation } : {})}
                {...(pickFiles ? { pickFiles } : {})}
                {...(saveClipboardImage ? { saveClipboardImage } : {})}
              />
            )}
          </div>
        </div>
      </div>
      {onContinueInProvider && installedAgents && continueDialogOpen ? (
        <ContinueInProviderDialog
          isOpen
          thread={thread}
          projectLocation={projectLocation}
          installedAgents={installedAgents}
          {...(() => {
            const cfg = useAppStore
              .getState()
              .projects.find((p) => p.id === thread.projectId)?.lastDraftConfig;
            return cfg ? { lastDraftConfig: cfg } : {};
          })()}
          onClose={() => setContinueDialogOpen(false)}
          onContinue={(
            targetKind,
            targetConfig,
            targetPresentationMode,
            prompt,
            segments,
            closeOrig,
            ctx,
          ) => {
            setContinueDialogOpen(false);
            onContinueInProvider(
              targetKind,
              targetConfig,
              targetPresentationMode,
              prompt,
              segments,
              closeOrig,
              ctx,
            );
          }}
        />
      ) : null}
      {collaborationDialogOpen ? (
        <ThreadCollaborationDialog
          isOpen
          sourceThreadId={thread.id}
          onChanged={() => setCollaborationRefreshKey((current) => current + 1)}
          onClose={() => setCollaborationDialogOpen(false)}
        />
      ) : null}
    </>
  );
}, areThreadViewPropsEqual);
