import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { toast } from "@heroui/react";
import { ChevronDown, Monitor, TerminalSquare, Webhook } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type {
  AgentStatus,
  Project,
  ProjectLocation,
  PromptSegment,
  Thread,
} from "@/shared/contracts";
import { supportsHeaderBearingHttpMcp, supportsMcpAtProjectLocation } from "@/shared/contracts";
import { friendlyError } from "@/shared/messages";
import { fileNameFromPath, isAudioPath, isImagePath } from "@/shared/promptContent";
import {
  adaptThreadConfigForCapabilities,
  agentStatusForPresentation,
  capabilitiesForPresentation,
  hasSelectableReasoning,
} from "@/shared/agentSelection";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { continueInterruptedTaskSegments, isThreadTaskPaused } from "./pausedTurn";
import {
  changeThreadConfig,
  clearThreadPendingSteer,
} from "@/renderer/actions/threadRuntimeActions";
import {
  clearQueuedFollowUp,
  sendQueuedFollowUpNow,
} from "@/renderer/actions/queuedFollowUpActions";
import { modelVisibilityKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { AttachmentBar } from "../composer/AttachmentBar";
import { ComposerAddMenu } from "../composer/ComposerAddMenu";
import { ComposerVoiceInput } from "../composer/ComposerVoiceInput";
import {
  composerMcpServers,
  COMPUTER_USE_MCP_ID,
  isAlwaysOnComposerMcp,
  providerOwnsMcpConfig,
} from "../composer/composerMcpServers";
import { openAttachmentLightbox } from "../composer/ImageLightbox";
import { openPdfPreview } from "../pdf/openPdfPreview";
import {
  MentionInput,
  type McpMentionItem,
  type MentionInputHandle,
} from "../composer/MentionInput";
import {
  storableAttachment,
  useAttachments,
  type Attachment,
  type SaveClipboardImage,
} from "../composer/useAttachments";
import type { VoiceInputHandle } from "../composer/VoiceInputButton";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { threadProductProperties } from "@/renderer/analytics/posthog";
import { captureProductEvent } from "@/renderer/analytics/productAnalytics";
import { useAppStore } from "@/renderer/state/appStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { useBrowserAttachInbox } from "@/renderer/state/browserAttachInbox";
import {
  useComposerInputInbox,
  worktreeComposerInboxKey,
} from "@/renderer/state/composerInputInbox";
import { useComposerUiStore } from "@/renderer/state/composerUiStore";
import { useGitStore } from "@/renderer/state/gitStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { getRuntimeExecutionEnvelope } from "@/renderer/state/sessionHandoffStore";
import { isDraftContentNonEmpty } from "@/renderer/state/slices/types";
import { selectActiveSubAgentParentItemIds } from "@/renderer/state/subAgentSelectors";
import { useThread } from "@/renderer/state/useThread";
import { recordCraftModeUse } from "@/renderer/state/usageRecorder";
import { ThreadComposer, type ComposerControl } from "./ThreadComposer";
import type { CraftMode } from "./CraftModeSwitch";
import { UniversalDockedChatInput } from "./UniversalDockedChatInput";
import { ThreadQueuedFollowUpStrip } from "./ThreadQueuedFollowUpStrip";
import { ContextQuotaRing } from "./ComposerStatusRow";
import { supportsUsableFastMode } from "./threadDraftViewHelpers";
import { getApprovalDenyOption } from "./ThreadRuntimeRequestPanel/helpers";
import { resolveThreadContextUsageSummary, shouldShowContextUsageDock } from "./threadContextUsage";
import { buildControls } from "./buildModelPickerControls";
import { useManagedComposerProviders } from "./useManagedComposerProviders";
import { switchLiveThreadProvider } from "@/renderer/actions/sessionHandoffActions";
import { getLaunchableAgentStatuses } from "@/shared/agentStatus";
import {
  applyThirdPartyPickerSelection,
  composerPickerAgentKind,
  isThirdPartyAccountId,
} from "@/shared/thirdPartyRouting";
import {
  isPendingSwitchResolved,
  shouldStageModelSwitch,
  type PendingModelSwitch,
} from "./pendingModelSwitch";
import { submitComposerPrompt } from "./threadComposerSubmit";
import {
  filterSlashCommands,
  handleSlashCommandPanelKeyDown,
  resolveAvailableSlashCommands,
} from "./threadSlashCommands";
import { useKeybindingStore } from "@/renderer/commands/keybindingStore";
import { handleComposerControlShortcut } from "./threadComposerShortcuts";
import { resolveThreadAuthState, type ThreadErrorDockState } from "./threadErrorState";
import type { ThreadGoalDockState } from "./threadGoalState";
import type { ThreadTodoDockState } from "./threadTodoState";
import type { TerminalPaneHandle } from "./TerminalPane";
import { ThreadComposerDocks } from "./ThreadComposerDocks";
import {
  usePluginMentionItems,
  useSkillSlashCommands,
} from "@/renderer/components/skills/useSkills";
import { useDelayedPendingSteer } from "./useDelayedPendingSteer";

/** Rebuild a composer attachment from a durable attachment segment — preview
 * object URLs are long revoked, so rendering falls back to the file path. */
function attachmentFromSegment(
  segment: Extract<PromptSegment, { kind: "attachment" }>,
): Attachment {
  const name = fileNameFromPath(segment.path);
  return {
    id: crypto.randomUUID(),
    path: segment.path,
    name,
    ...(segment.mimeType ? { mimeType: segment.mimeType } : {}),
    isImage: isImagePath(name, segment.mimeType),
    isAudio: isAudioPath(name, segment.mimeType),
  };
}

type ThreadComposerSectionProps = {
  threadId: string;
  fallbackThread: Thread;
  agentStatus: AgentStatus | undefined;
  projectLocation: ProjectLocation;
  paneCount: number;
  terminalPaneRef: RefObject<TerminalPaneHandle | null>;
  todoDockCollapsed: boolean;
  todoDockPlacement: "composer" | "right";
  todoDockState: ThreadTodoDockState | null;
  goalDockState: ThreadGoalDockState | null;
  errorDockStates: ThreadErrorDockState[];
  onGoalDockDismiss: () => void;
  onDismissError: (sourceItemId: string) => void;
  /**
   * Optional override for the thread-input submit. Desktop omits this so the
   * composer calls `submitThreadInput` from the actions module directly. Mobile
   * injects its own wrapper so it can collapse the floating dock after the send
   * resolves and route through the mobile transport.
   */
  onSubmitInput?: ((prompt: string, segments?: PromptSegment[]) => Promise<void>) | undefined;
  pickFiles?: (() => Promise<string[] | null>) | undefined;
  saveClipboardImage?: SaveClipboardImage | undefined;
  /** Optional surface-specific placeholder for the active-thread input. */
  composerPlaceholder?: string | undefined;
  /** Override whether unmodified Enter submits instead of inserting a newline. */
  submitOnEnter?: boolean | undefined;
  /**
   * Override mount autofocus for the composer. Electron omits this and always
   * uses desktop behavior; the PWA supplies its desktop-pointer media-query
   * result so phone layouts do not summon the software keyboard.
   */
  autoFocusComposer?: boolean | undefined;
  /**
   * Suppress the informational docks (subagents/crossagents/workflows, context,
   * goal, plan, errors) inside the composer. The mobile PWA sets this and surfaces
   * the same state as compact chips above the floating composer instead
   * (ComposerInfoChips). The action docks are gated separately — see
   * {@link ThreadComposerSectionProps.hideActionDocks}.
   */
  hideInfoDocks?: boolean | undefined;
  /**
   * Suppress the action docks (auth required, pending steer, runtime requests)
   * because the host renders them itself. The mobile PWA sets this: its compact
   * composer clips to a single control line, so those docks are hoisted into the
   * floating dock above the bubble (ComposerActionDocks). The slash-command
   * panel stays inline — it only appears while the user is typing, i.e. with the
   * composer already expanded. Deny-with-feedback from the input keeps working
   * either way: this gates the panels, not the open request.
   */
  hideActionDocks?: boolean | undefined;
  onOpenProjectRelativePath?: ((path: string, lineNumber?: number) => void) | undefined;
  onTodoDockCollapsedChange: (collapsed: boolean) => void;
  onTodoDockPlacementChange: (placement: "composer" | "right") => void;
  onTodoDockRetire?: () => void;
};

export function ThreadComposerSection(props: ThreadComposerSectionProps) {
  const thread = useThread(props.threadId) ?? props.fallbackThread;
  return <ThreadComposerSectionInner {...props} thread={thread} />;
}

function ThreadComposerSectionInner(props: ThreadComposerSectionProps & { thread: Thread }) {
  const {
    thread,
    agentStatus,
    projectLocation,
    paneCount,
    todoDockCollapsed,
    todoDockPlacement,
    todoDockState,
    goalDockState,
    errorDockStates,
  } = props;
  const isConnecting = useAppStore((state) => state.connectingThreadIds[thread.id] !== undefined);
  const { t } = useLingui();
  const [prompt, setPrompt] = useState("");
  const [hasContent, setHasContent] = useState(false);
  const isRemoteSurface = isRemoteSession();
  const usesRemoteTransport = isRemoteSurface || thread.remoteServerId !== undefined;
  const showVoiceInputButton =
    useSharedSettings((s) => s.audio.showVoiceInputButton) && !isRemoteSurface;
  const mentionRef = useRef<MentionInputHandle>(null);
  const voiceInputRef = useRef<VoiceInputHandle>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [craftMode, setCraftMode] = useState<CraftMode>("auto");
  const [isInterrupting, setIsInterrupting] = useState(false);
  const attachments = useAttachments({
    ...(props.saveClipboardImage ? { saveClipboardImage: props.saveClipboardImage } : {}),
  });
  // Remote-thread attachments are stored on the paired desktop; resolve
  // previews through its image endpoint instead of the local-file protocol.
  const remoteDesktopId = thread.remoteServerId;
  const attachmentImageUrlForPath = remoteDesktopId
    ? (path: string) => useRemoteServersStore.getState().localImageUrl(remoteDesktopId, path)
    : undefined;
  // Unsent composer content survives leaving this thread. The primary GUI pane
  // keeps this section mounted across thread switches, so the thread-keyed
  // layout effects below save and restore without exposing another thread's
  // editor state for a paint.
  const saveThreadDraftContent = useAppStore((s) => s.saveThreadDraftContent);
  const clearThreadDraftContent = useAppStore((s) => s.clearThreadDraftContent);
  // The MentionInput owns the live editor DOM; mirror its latest serialized
  // segments here (updated on every text change) so the unmount cleanup can read
  // them without touching a possibly-detached editor ref. Attachments are synced
  // every render below.
  const latestSegmentsRef = useRef<PromptSegment[]>([]);
  const attachmentsRef = useRef(attachments.attachments);
  attachmentsRef.current = attachments.attachments;
  // True only while a real submit is in flight. Terminal/CLI threads clear the
  // composer *after* the send resolves (the synchronous pre-send clear below is
  // GUI-only), so without this guard, navigating away mid-send would unmount and
  // re-save the just-sent text as a stale draft. Reset every time (success or
  // failure) because this composer is reused for the next message.
  const submittedRef = useRef(false);
  const composerSessionRef = useRef({ threadId: thread.id });
  if (composerSessionRef.current.threadId !== thread.id) {
    composerSessionRef.current = { threadId: thread.id };
  }
  const preparedThreadIdRef = useRef<string | null>(null);
  const restoredThreadIdRef = useRef<string | null>(null);
  const pendingPickedAttachments = useBrowserAttachInbox((s) => s.itemsByThread[thread.id]);
  const addPickedRef = useRef(attachments.addPicked);
  addPickedRef.current = attachments.addPicked;
  useEffect(() => {
    if (!pendingPickedAttachments || pendingPickedAttachments.length === 0) return;
    const drained = useBrowserAttachInbox.getState().drain(thread.id);
    for (const item of drained) {
      addPickedRef.current({
        path: item.attachmentPath,
        name: item.attachmentName,
        mimeType: item.mimeType,
        selector: item.selector,
        sourceUrl: item.sourceUrl,
      });
    }
  }, [pendingPickedAttachments, thread.id]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const commandListId = useId();
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [controlOpenRequest, setControlOpenRequest] = useState<{
    target: "model" | "effort";
    nonce: number;
  } | null>(null);
  const [contextDockOpen, setContextDockOpen] = useState(false);
  const presentationMode =
    thread.presentationMode ?? agentStatus?.capabilities.presentationMode ?? "terminal";
  const effectiveAgentStatus = agentStatus
    ? agentStatusForPresentation(agentStatus, presentationMode, thread.sessionRef)
    : undefined;
  const usesTerminalPresentation = presentationMode === "terminal";
  const disabledBuiltInMcpServers = useSharedSettings((s) => s.disabledBuiltInMcpServers);
  const appControlsDisabled = disabledBuiltInMcpServers["app-controls"] === true;
  const appControlsEnabled =
    !appControlsDisabled &&
    Boolean(
      effectiveAgentStatus &&
      supportsHeaderBearingHttpMcp(effectiveAgentStatus.capabilities) &&
      supportsMcpAtProjectLocation(effectiveAgentStatus.capabilities, projectLocation),
    );
  // Composer MCP servers are bound at session-create time for the active
  // thread, so the "+" menu shows this run's bindings read-only: the enabled
  // built-ins (from thread config), the custom servers recorded at launch,
  // and Computer Use. Users change servers in the draft composer or settings
  // before launching a new thread.
  // Bindings are display-only for an active session; toggles are no-ops.
  const providerOwnsMcp = effectiveAgentStatus
    ? providerOwnsMcpConfig(effectiveAgentStatus.capabilities)
    : false;
  const runtimeLaunchConfig = useAppStore((s) => s.runtimeLaunchConfigByThreadId[thread.id]);
  const effectiveMcpConfig = providerOwnsMcp
    ? (runtimeLaunchConfig ?? thread.config)
    : thread.config;
  const mcpServers = composerMcpServers.map((descriptor) => {
    const scopeOk =
      descriptor.isAvailable(projectLocation) &&
      Boolean(
        effectiveAgentStatus &&
        descriptor.getScope(
          effectiveAgentStatus.capabilities,
          presentationMode,
          projectLocation,
        ) !== "none",
      );
    const enabled = isAlwaysOnComposerMcp(descriptor)
      ? disabledBuiltInMcpServers[descriptor.id] !== true
      : Boolean(descriptor.configKey && effectiveMcpConfig?.[descriptor.configKey] === true);
    return {
      descriptor,
      enabled,
      // Always-on built-ins inject on every launch unless the user disabled
      // them, so they stay visible on live threads instead of looking absent.
      visible: scopeOk && enabled,
      onToggle: () => {},
    };
  });
  const launchCustomMcpNames = useAppStore(
    (s) => s.mcpLaunchCustomServerNamesByThreadId[thread.id],
  );
  const customMcpServers = (
    providerOwnsMcp && usesRemoteTransport ? [] : (launchCustomMcpNames ?? [])
  ).map((name) => ({
    id: name,
    name,
    enabled: true,
  }));
  const mcpMentions: McpMentionItem[] = [
    ...(appControlsEnabled && !providerOwnsMcp
      ? [
          {
            id: "app-controls",
            name: t`Terminal`,
            searchAliases: ["Terminal"],
            icon: TerminalSquare,
            detail: t`Terminal`,
            enabled: true,
          },
        ]
      : []),
    ...composerMcpServers
      .filter((descriptor) => {
        if (descriptor.id === "app-controls") return false;
        const scopeOk =
          descriptor.isAvailable(projectLocation) &&
          Boolean(
            effectiveAgentStatus &&
            descriptor.getScope(
              effectiveAgentStatus.capabilities,
              presentationMode,
              projectLocation,
            ) !== "none",
          );
        if (!scopeOk) return false;
        if (isAlwaysOnComposerMcp(descriptor)) {
          return disabledBuiltInMcpServers[descriptor.id] !== true;
        }
        return Boolean(descriptor.configKey && effectiveMcpConfig?.[descriptor.configKey] === true);
      })
      .map((descriptor) => ({
        id: descriptor.id,
        name: t(descriptor.label),
        icon: descriptor.icon,
        detail: t`MCP server`,
        enabled: true,
      })),
    ...customMcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      icon: Webhook,
      detail: t`MCP server`,
      enabled: true,
    })),
    ...(effectiveMcpConfig?.computerUse === true &&
    readBridge()?.platform !== "linux" &&
    projectLocation?.kind !== "wsl"
      ? [
          {
            id: COMPUTER_USE_MCP_ID,
            name: t`Computer Use`,
            icon: Monitor,
            detail: t`Computer Use`,
            enabled: true,
          },
        ]
      : []),
  ];
  const skillCommands = useSkillSlashCommands(projectLocation, thread.agentKind, presentationMode);
  const pluginMentions = usePluginMentionItems(projectLocation, thread.agentKind, presentationMode);
  const availableCommands = resolveAvailableSlashCommands(
    thread.slashCommands,
    effectiveAgentStatus?.capabilities.slashCommands,
    {
      agentKind: thread.agentKind,
      presentationMode,
      runtimeLabel: effectiveAgentStatus?.capabilities.runtimeLabel,
      hasEffort: hasSelectableReasoning(
        effectiveAgentStatus?.capabilities,
        thread.config?.model ?? "",
      ),
      supportsFast: effectiveAgentStatus
        ? supportsUsableFastMode(effectiveAgentStatus.capabilities, thread.config?.model ?? "")
        : false,
      skillCommands,
      disabledSkillNames: effectiveAgentStatus?.capabilities.disabledSkillNames,
      skillCatalogAuthoritative:
        effectiveAgentStatus?.capabilities.reportsSkillCatalog === true &&
        presentationMode === "gui" &&
        thread.slashCommands !== undefined,
    },
  );
  const filteredCommands = filterSlashCommands(availableCommands, slashQuery);
  const showCommandPanel = filteredCommands.length > 0;
  const { authRequired, hasRuntimeAuthError } = resolveThreadAuthState({
    authState: effectiveAgentStatus?.authState,
    errorDockStates,
    sourceProviderKind: thread.config.sourceProviderKind,
    accountId: thread.accountBinding?.accountId,
    agentKind: thread.agentKind,
    model: thread.config.model,
  });
  const canShowRuntimeChrome = !usesTerminalPresentation || usesRemoteTransport;
  const isServerControlled =
    effectiveAgentStatus?.capabilities.liveInputMode === "server" || !usesTerminalPresentation;
  const isTerminalInput = effectiveAgentStatus?.capabilities.liveInputMode === "terminal";
  const needsFocusBeforeInput =
    effectiveAgentStatus?.capabilities.requiresTerminalFocusBeforeInput === true;
  // A running turn must never lock the composer. On GUI threads a submit while
  // working routes through the pending-steer path (native steer where the
  // runtime supports it, interrupt-then-send otherwise), so a missing
  // `sessionRef` on fresh crafted sessions must not block the send.
  const canQueueServerInput =
    isServerControlled && !usesTerminalPresentation && thread.status === "working";
  const canSubmitServerInput =
    isServerControlled &&
    !isConnecting &&
    (thread.status === "idle" ||
      thread.status === "needs_reply" ||
      thread.status === "error" ||
      canQueueServerInput);
  const canSubmitTerminalInput =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const showServerComposer = isServerControlled && thread.status !== "inactive";
  const showTerminalComposer =
    usesTerminalPresentation &&
    isTerminalInput &&
    thread.status !== "inactive" &&
    thread.status !== "launching";
  const hideInfoDocks = props.hideInfoDocks === true;
  // GUI plans surface only in the top-right status capsule (single step entry).
  // Keep the legacy dock only for remote terminal surfaces, where the capsule
  // is not the plan interaction surface.
  const showTodoInComposer =
    !hideInfoDocks &&
    usesTerminalPresentation &&
    usesRemoteTransport &&
    todoDockState !== null &&
    todoDockPlacement === "composer";
  // GUI goals live in the composer context bar (to the right of Local). Keep
  // the legacy above-input dock only for remote terminal surfaces.
  const showGoalInComposer =
    !hideInfoDocks &&
    canShowRuntimeChrome &&
    goalDockState !== null &&
    usesTerminalPresentation &&
    usesRemoteTransport;
  const showErrorInComposer =
    !hideInfoDocks &&
    (!usesTerminalPresentation || usesRemoteTransport) &&
    errorDockStates.length > 0 &&
    !hasRuntimeAuthError;
  // Sub-agent details surface only in the top-right status capsule on GUI
  // surfaces (single step entry, same as plans). Keep the legacy
  // above-composer tile only for remote terminal surfaces, where the capsule
  // is not the agent interaction surface.
  const hasActiveSubAgent = useAppStore(
    (s) =>
      !hideInfoDocks &&
      canShowRuntimeChrome &&
      usesTerminalPresentation &&
      usesRemoteTransport &&
      selectActiveSubAgentParentItemIds(s, thread.id).length > 0,
  );
  const collapseTerminalComposerSetting = useSharedSettings((s) => s.collapseTerminalComposer);
  const [composerCollapsed, setComposerCollapsed] = useState(collapseTerminalComposerSetting);
  const canCollapseComposer = showTerminalComposer && !isRemoteSurface;
  const isComposerCollapsed = canCollapseComposer && composerCollapsed;
  const shouldAutoFocusComposer =
    paneCount === 1 && !isComposerCollapsed && (props.autoFocusComposer ?? !isRemoteSurface);
  const setComposerUi = useComposerUiStore((s) => s.setComposerUi);
  const branchName = useGitStore(
    (s) =>
      thread.worktreeBranch ??
      (thread.worktreePath
        ? s.worktreeStatuses[thread.worktreePath]?.branch
        : s.statuses[thread.projectId]?.branch),
  );
  const catalogAgentKind = composerPickerAgentKind({
    agentKind: thread.agentKind,
    model: thread.config.model,
    sourceProviderKind: thread.config.sourceProviderKind,
  });
  const hiddenModelIds = useSharedSettings(
    (s) =>
      s.hiddenModels[
        modelVisibilityKey(
          catalogAgentKind,
          presentationMode,
          effectiveAgentStatus?.capabilities.runtimeLabel,
        )
      ],
  );
  const shownModelIds = useSharedSettings(
    (s) =>
      s.shownModels?.[
        modelVisibilityKey(
          catalogAgentKind,
          presentationMode,
          effectiveAgentStatus?.capabilities.runtimeLabel,
        )
      ],
  );
  const modelPreferences = useSharedSettings((s) => s.providerModelPreferences[catalogAgentKind]);
  const setProviderModelPreference = useSharedSettings((s) => s.setProviderModelPreference);
  // Staged provider/model pick: selecting in the model selector must NOT
  // switch immediately. The pick waits here until the user sends — the
  // provider/harness switch then commits as part of that send (marker first,
  // message delivered to the new session). Picking back to the live
  // combination clears the stage.
  const [pendingSwitch, setPendingSwitch] = useState<PendingModelSwitch | null>(null);
  const liveAccountId = isThirdPartyAccountId(thread.accountBinding?.accountId)
    ? thread.accountBinding?.accountId
    : undefined;
  useEffect(() => {
    setPendingSwitch(null);
  }, [thread.id]);
  useEffect(() => {
    if (
      pendingSwitch &&
      isPendingSwitchResolved(
        { agentKind: catalogAgentKind, model: thread.config.model, accountId: liveAccountId },
        pendingSwitch,
      )
    ) {
      setPendingSwitch(null);
    }
  }, [pendingSwitch, catalogAgentKind, thread.config.model, liveAccountId]);
  const managedProviders = useManagedComposerProviders({
    presentationMode,
    includeAgentKind: catalogAgentKind,
  });
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const wslAgentStatuses = useAgentStatusesStore((state) => state.wslAgentStatuses);
  const launchableHarnesses = getLaunchableAgentStatuses(
    projectLocation,
    agentStatuses,
    wslAgentStatuses,
  )
    .filter((entry) => entry.installed)
    .map((entry) => entry.kind);
  const isStagingSwitch = Boolean(
    pendingSwitch &&
    shouldStageModelSwitch(
      { agentKind: catalogAgentKind, model: thread.config.model, accountId: liveAccountId },
      pendingSwitch,
    ),
  );
  const pendingAgentStatus =
    isStagingSwitch && pendingSwitch
      ? (agentStatuses.find((entry) => entry.kind === pendingSwitch.agentKind) ??
        wslAgentStatuses.find((entry) => entry.kind === pendingSwitch.agentKind))
      : undefined;
  const displayAgentStatus =
    isStagingSwitch && pendingAgentStatus
      ? agentStatusForPresentation(
          pendingAgentStatus,
          pendingSwitch?.presentationMode ?? presentationMode,
        )
      : effectiveAgentStatus;
  const displayConfig = (() => {
    const base = {
      ...thread.config,
      ...(pendingSwitch ? { model: pendingSwitch.model, ...pendingSwitch.configPatch } : {}),
    };
    if (!isStagingSwitch || !displayAgentStatus) return base;
    return adaptThreadConfigForCapabilities(
      base,
      capabilitiesForPresentation(
        displayAgentStatus.capabilities,
        pendingSwitch?.presentationMode ?? presentationMode,
      ),
    );
  })();
  // Picker display follows the staged pick. Permission / effort controls must
  // also follow the target agent's capabilities, otherwise Grok's
  // bypassPermissions is shown as Codex "Ask for approval" and cannot change.
  const displayThread =
    isStagingSwitch && pendingSwitch
      ? {
          ...thread,
          agentKind: pendingSwitch.agentKind,
          config: displayConfig,
        }
      : thread;
  const displayAccountId = pendingSwitch?.accountId ?? liveAccountId;
  const controls = buildControls(
    displayThread,
    displayAgentStatus,
    hiddenModelIds,
    shownModelIds,
    (config) => {
      if (isStagingSwitch && pendingSwitch) {
        const { model: _model, ...configPatch } = config;
        setPendingSwitch({ ...pendingSwitch, configPatch });
        return;
      }
      changeThreadConfig(thread.id, config);
    },
    modelPreferences,
    (model, preference) =>
      setProviderModelPreference(
        isStagingSwitch && pendingSwitch ? pendingSwitch.agentKind : catalogAgentKind,
        model,
        preference,
      ),
    {
      providers: managedProviders,
      ...(displayAccountId ? { selectedAccountId: displayAccountId } : {}),
      installedHarnesses: launchableHarnesses,
      pickerAgentKind:
        isStagingSwitch && pendingSwitch ? pendingSwitch.agentKind : catalogAgentKind,
      onProviderChange: (next) => {
        // Stage only: the switch commits on send (see submitPrompt). This
        // keeps "pick model, tweak effort, send" as one atomic user action
        // instead of tearing down the live session mid-thought.
        if (
          !shouldStageModelSwitch(
            { agentKind: catalogAgentKind, model: thread.config.model, accountId: liveAccountId },
            next,
          )
        ) {
          setPendingSwitch(null);
          return;
        }
        setPendingSwitch({
          agentKind: next.agentKind,
          model: next.model,
          ...(next.presentationMode ? { presentationMode: next.presentationMode } : {}),
          ...(next.accountId ? { accountId: next.accountId } : {}),
        });
      },
    },
  );
  const controlsWithOpenSignal = controls.map((control): ComposerControl => {
    if (controlOpenRequest?.target === "model" && control.kind === "provider-model") {
      return { ...control, openSignal: controlOpenRequest.nonce };
    }
    if (controlOpenRequest?.target === "effort" && control.kind === "effort-context") {
      return { ...control, openSignal: controlOpenRequest.nonce };
    }
    return control;
  });
  const isCliThread = usesTerminalPresentation;
  const canSubmit =
    (canSubmitServerInput || canSubmitTerminalInput) && !isSubmitting && !authRequired;
  const taskPaused = useAppStore((state) => isThreadTaskPaused(state, thread.id));
  const canContinuePausedTask =
    taskPaused && canSubmit && !hasContent && attachments.attachments.length === 0;
  const canInterruptStructuredTurn = canShowRuntimeChrome && thread.status === "working";
  const pendingSteer = useAppStore((s) => s.pendingSteerByThreadId[thread.id]);
  const visiblePendingSteer = useDelayedPendingSteer(pendingSteer);
  const queuedFollowUp = useAppStore((s) => s.queuedFollowUpByThreadId[thread.id]);
  const usesPendingSteerPath =
    !isConnecting && !usesTerminalPresentation && thread.status === "working";
  const runtimeRequests = useAppStore((s) => s.runtimeRequestsByThread[thread.id]);
  const activeRuntimeRequest = canShowRuntimeChrome ? runtimeRequests?.[0] : undefined;
  const approvalDenyOption = activeRuntimeRequest
    ? getApprovalDenyOption(activeRuntimeRequest)
    : undefined;
  // Gate the inline docks only. `activeRuntimeRequest` still drives the
  // composer's deny-with-feedback submit path, and `authRequired` still disables
  // submit/voice, when a host renders these docks itself.
  const hideActionDocks = props.hideActionDocks === true;
  const composerRuntimeRequest = hideActionDocks ? undefined : activeRuntimeRequest;
  const composerPendingSteer = hideActionDocks ? undefined : visiblePendingSteer;
  const composerQueuedFollowUp = hideActionDocks ? undefined : queuedFollowUp;
  const showAuthInComposer = authRequired && !hideActionDocks;
  const reportedContextUsage = useAppStore((s) =>
    canShowRuntimeChrome ? s.runtimeContextByThread[thread.id] : undefined,
  );
  const contextSummary = resolveThreadContextUsageSummary({
    thread,
    agentStatus: effectiveAgentStatus,
    reportedUsage: reportedContextUsage,
  });
  const showContextIndicator =
    !hideInfoDocks && canShowRuntimeChrome && shouldShowContextUsageDock(contextSummary);
  const showContextInComposer = showContextIndicator && contextDockOpen;
  const project = useAppStore((s) =>
    s.projects.find((candidate) => candidate.id === thread.projectId),
  );
  const contextProject: Project = project ?? {
    id: thread.projectId,
    name: t`Current project`,
    location: projectLocation,
    createdAt: "1970-01-01T00:00:00.000Z",
  };

  const handleCraftModeChange = (next: CraftMode) => {
    setCraftMode(next);
    useCraftingWorkbenchStore.getState().setCapabilityMode(next);
    if (next === "auto") return;
    usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting", entryMode: next });
  };

  useEffect(() => {
    if (!showContextIndicator && contextDockOpen) {
      setContextDockOpen(false);
    }
  }, [contextDockOpen, showContextIndicator]);

  function handleInterrupt() {
    if (isInterrupting) return;
    setIsInterrupting(true);
    const execution = getRuntimeExecutionEnvelope(thread.id);
    // Capture the live turn's start before the stop round-trips: a turn the
    // user stops renders as 已取消 (matched by start timestamp), which is the
    // only honest cancelled signal — turn records carry no end state.
    const interruptedTurnStartedAt = thread.activeTurnStartedAt
      ? Date.parse(thread.activeTurnStartedAt)
      : NaN;
    useAppStore.getState().pauseQueuedFollowUp(thread.id);
    void readBridge()
      .interruptThread({
        threadId: thread.id,
        ...(execution ? { execution } : {}),
      })
      .then(() => {
        captureProductEvent("thread.interrupted", threadProductProperties(thread));
        if (Number.isFinite(interruptedTurnStartedAt)) {
          useAppStore.getState().markUserCancelledTurn(thread.id, interruptedTurnStartedAt);
        }
        // The stop round-trip finished — re-arm the button even if the turn
        // status hasn't flipped yet (slow wind-down, follow-up turn). Without
        // this the stop control stays disabled with a spinner forever.
        setIsInterrupting(false);
      })
      .catch((error: unknown) => {
        setIsInterrupting(false);
        console.error("[thread] failed to interrupt turn", error);
        toast.danger(friendlyError(error));
      });
  }

  function writeTerminalInput(data: string) {
    return readBridge().writeTerminal({ threadId: thread.id, data });
  }

  // Move a queued follow-up back into the composer for editing: text segments
  // restore into the editor, attachment segments become composer attachments
  // again, and the queue entry is consumed.
  function handleEditQueuedFollowUp() {
    const queued = useAppStore.getState().queuedFollowUpByThreadId[thread.id];
    if (!queued) return;
    const segments = queued.segments ?? [];
    const textSegments = segments.filter((segment) => segment.kind !== "attachment");
    mentionRef.current?.restoreFromSegments(
      textSegments.length > 0 ? textSegments : [{ kind: "text", content: queued.prompt }],
    );
    const restoredAttachments = segments
      .filter(
        (segment): segment is Extract<PromptSegment, { kind: "attachment" }> =>
          segment.kind === "attachment",
      )
      .map(attachmentFromSegment);
    if (restoredAttachments.length > 0) {
      attachments.restore([...attachmentsRef.current, ...restoredAttachments]);
    }
    setPrompt(queued.prompt);
    setHasContent(true);
    clearQueuedFollowUp(thread.id);
    mentionRef.current?.focus();
  }

  async function submitPrompt(segments: PromptSegment[]) {
    const composerSession = composerSessionRef.current;
    const hasPromptText = segments.some(
      (segment) => segment.kind !== "text" || segment.content.trim().length > 0,
    );
    const resumePausedTask =
      !hasPromptText && isThreadTaskPaused(useAppStore.getState(), thread.id);
    const submitSegments = resumePausedTask ? continueInterruptedTaskSegments() : segments;
    // A staged provider/model pick commits here, not at pick time: switch
    // first (marker lands, message goes to the NEW session), then send. A
    // failed switch aborts the send — the draft and the stage are kept so the
    // user can retry instead of firing into the wrong session.
    let sendThread = useAppStore.getState().threads.find((item) => item.id === thread.id) ?? thread;
    const staged = pendingSwitch;
    let switchedForSend = false;
    if (
      staged &&
      !isPendingSwitchResolved(
        {
          agentKind: composerPickerAgentKind({
            agentKind: sendThread.agentKind,
            model: sendThread.config.model,
            sourceProviderKind: sendThread.config.sourceProviderKind,
          }),
          model: sendThread.config.model,
          accountId: isThirdPartyAccountId(sendThread.accountBinding?.accountId)
            ? sendThread.accountBinding?.accountId
            : undefined,
        },
        staged,
      )
    ) {
      setIsSubmitting(true);
      try {
        const remapped =
          craftMode === "auto" && !useCraftingWorkbenchStore.getState().pendingRecipeIntent
            ? applyThirdPartyPickerSelection(
                {
                  agentKind: staged.agentKind,
                  model: staged.model,
                  ...(staged.presentationMode ? { presentationMode: staged.presentationMode } : {}),
                  ...(staged.accountId ? { accountId: staged.accountId } : {}),
                },
                launchableHarnesses,
              )
            : staged;
        await switchLiveThreadProvider({
          thread: sendThread,
          projectLocation,
          targetAgentKind: remapped.agentKind,
          targetConfig: {
            ...sendThread.config,
            model: remapped.model,
            ...staged.configPatch,
            sourceProviderKind:
              remapped.agentKind !== staged.agentKind ? staged.agentKind : undefined,
          },
          ...(remapped.presentationMode
            ? { targetPresentationMode: remapped.presentationMode }
            : staged.presentationMode
              ? { targetPresentationMode: staged.presentationMode }
              : {}),
          ...(remapped.accountId
            ? { targetAccountId: remapped.accountId }
            : staged.accountId
              ? { targetAccountId: staged.accountId }
              : {}),
        });
      } catch (error: unknown) {
        setIsSubmitting(false);
        toast.danger(friendlyError(error));
        return;
      }
      setPendingSwitch(null);
      sendThread =
        useAppStore.getState().threads.find((item) => item.id === thread.id) ?? sendThread;
      setIsSubmitting(false);
      // The fresh session is idle by construction: never steer into it.
      switchedForSend = true;
    } else if (craftMode === "auto" && !useCraftingWorkbenchStore.getState().pendingRecipeIntent) {
      const remapped = applyThirdPartyPickerSelection(
        {
          agentKind: sendThread.agentKind,
          model: sendThread.config.model ?? "",
          ...(presentationMode ? { presentationMode } : {}),
          ...(liveAccountId ? { accountId: liveAccountId } : {}),
          ...(sendThread.config.sourceProviderKind
            ? { sourceProviderKind: sendThread.config.sourceProviderKind }
            : {}),
        },
        launchableHarnesses,
      );
      if (
        remapped.agentKind !== sendThread.agentKind ||
        remapped.presentationMode !== presentationMode
      ) {
        setIsSubmitting(true);
        try {
          await switchLiveThreadProvider({
            thread: sendThread,
            projectLocation,
            targetAgentKind: remapped.agentKind,
            targetConfig: {
              ...sendThread.config,
              model: remapped.model,
              sourceProviderKind:
                remapped.agentKind !== sendThread.agentKind
                  ? sendThread.agentKind
                  : sendThread.config.sourceProviderKind,
            },
            ...(remapped.presentationMode
              ? { targetPresentationMode: remapped.presentationMode }
              : {}),
            ...(remapped.accountId ? { targetAccountId: remapped.accountId } : {}),
          });
        } catch (error: unknown) {
          setIsSubmitting(false);
          toast.danger(friendlyError(error));
          return;
        }
        sendThread =
          useAppStore.getState().threads.find((item) => item.id === thread.id) ?? sendThread;
        setIsSubmitting(false);
        switchedForSend = true;
      }
    }
    // One prompt submit = one CraftStation mode use (auto / efficient /
    // creative) for the usage-stats mode breakdown.
    recordCraftModeUse(craftMode, sendThread.agentKind, sendThread.config?.model ?? null);
    submitComposerPrompt(submitSegments, {
      thread: sendThread,
      agentStatus: effectiveAgentStatus,
      presentationMode,
      usesTerminalPresentation,
      canSubmit,
      usesPendingSteerPath: switchedForSend ? false : usesPendingSteerPath,
      needsFocusBeforeInput,
      activeRuntimeRequest,
      approvalDenyOption,
      availableCommands,
      attachments,
      mentionRef,
      terminalPaneRef: props.terminalPaneRef,
      latestSegmentsRef,
      submittedRef,
      isCurrentSession: () => composerSessionRef.current === composerSession,
      setPrompt,
      setHasContent,
      setIsSubmitting,
      requestOpenControl: (target) =>
        setControlOpenRequest((prev) => ({ target, nonce: (prev?.nonce ?? 0) + 1 })),
      onSubmitInput: props.onSubmitInput,
    });
  }

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (filteredCommands.length === 0) {
      if (slashActiveIndex !== 0) {
        setSlashActiveIndex(0);
      }
      return;
    }
    if (slashActiveIndex >= filteredCommands.length) {
      setSlashActiveIndex(filteredCommands.length - 1);
    }
  }, [filteredCommands.length, slashActiveIndex]);

  // Restore an unsent draft saved the last time this thread's composer was
  // active. useLayoutEffect runs before paint so the previous thread's editor
  // content is cleared before the new thread is visible. Consume the entry so
  // a later real send doesn't resurrect it.
  //
  // A terminal thread that is still `launching` hides the whole composer (so the
  // MentionInput — and `mentionRef` — does not exist yet). Restoring into a null
  // editor would silently drop the text while still consuming the stored draft,
  // so defer until the editor mounts; the effect re-runs when `editorMounted`
  // flips, at which point `mentionRef` is attached.
  const editorMounted = !usesTerminalPresentation || thread.status !== "launching";
  const pendingComposerInputs = useComposerInputInbox((s) => s.itemsByComposer[thread.id]);
  const fallbackComposerInboxKey = thread.worktreePath
    ? worktreeComposerInboxKey(thread.projectId, thread.worktreePath)
    : `draft:${thread.projectId}`;
  const pendingFallbackComposerInputs = useComposerInputInbox(
    (s) => s.itemsByComposer[fallbackComposerInboxKey],
  );
  useLayoutEffect(() => {
    if (preparedThreadIdRef.current !== thread.id) {
      preparedThreadIdRef.current = thread.id;
      mentionRef.current?.clear();
      latestSegmentsRef.current = [];
      attachments.clearAll();
      submittedRef.current = false;
      setPrompt("");
      setHasContent(false);
      setIsSubmitting(false);
      setIsInterrupting(false);
      setSlashQuery(null);
      setSlashActiveIndex(0);
      setControlOpenRequest(null);
      setContextDockOpen(false);
      setComposerCollapsed(collapseTerminalComposerSetting);
    }
    if (restoredThreadIdRef.current === thread.id || !editorMounted) return;
    restoredThreadIdRef.current = thread.id;
    const saved = useAppStore.getState().threadDraftContents[thread.id];
    if (!saved) return;
    if (saved.segments.length > 0) {
      mentionRef.current?.restoreFromSegments(saved.segments);
      latestSegmentsRef.current = saved.segments;
    }
    if (saved.attachments.length > 0) {
      attachments.restore(saved.attachments);
    }
    clearThreadDraftContent(thread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset/restore is keyed to the active thread and editor mount; attachment/editor methods are read from this render
  }, [editorMounted, thread.id]);

  useEffect(() => {
    const composer = mentionRef.current;
    if (
      isSubmitting ||
      !editorMounted ||
      !composer ||
      (!pendingComposerInputs?.length && !pendingFallbackComposerInputs?.length)
    ) {
      return;
    }
    let composerHasContent = composer.serializeSegments().length > 0;
    const inboxAttachments: Attachment[] = [];
    for (const key of [fallbackComposerInboxKey, thread.id]) {
      const items = useComposerInputInbox.getState().drain(key);
      for (const segments of items) {
        // Attachment segments can't live in the editor; they rejoin the
        // composer as attachments (queued follow-up edit on mobile).
        const editorSegments: PromptSegment[] = [];
        for (const segment of segments) {
          if (segment.kind === "attachment") {
            inboxAttachments.push(attachmentFromSegment(segment));
          } else {
            editorSegments.push(segment);
          }
        }
        if (editorSegments.length === 0) continue;
        const separator: PromptSegment[] = composerHasContent
          ? [{ kind: "text", content: "\n\n" }]
          : [];
        composer.insertSegments([...separator, ...editorSegments], { atEnd: true, focus: false });
        composerHasContent = true;
      }
    }
    if (inboxAttachments.length > 0) {
      attachments.restore([...attachmentsRef.current, ...inboxAttachments]);
    }
  }, [
    attachments,
    editorMounted,
    fallbackComposerInboxKey,
    isSubmitting,
    pendingComposerInputs,
    pendingFallbackComposerInputs,
    thread.id,
  ]);

  useEffect(() => {
    setComposerCollapsed(collapseTerminalComposerSetting);
  }, [collapseTerminalComposerSetting]);

  // Save whatever is left in the composer when this thread's section unmounts
  // (navigating to another thread/pane). A cleared composer leaves both refs
  // empty, so a just-sent message is not re-saved; an in-flight submit is
  // skipped via submittedRef because its text has already been handed off.
  useLayoutEffect(() => {
    const tid = thread.id;
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- reading the latest refs at unmount is the point: they mirror the live composer state
      if (submittedRef.current) return;
      // Stash path-only attachment copies: `previewUrl` object URLs belong to
      // this composer's live session and are revoked when it clears/unmounts.
      const content = {
        segments: latestSegmentsRef.current,
        attachments: attachmentsRef.current.map(storableAttachment),
      };
      if (isDraftContentNonEmpty(content)) {
        saveThreadDraftContent(tid, content);
      } else {
        clearThreadDraftContent(tid);
      }
    };
  }, [thread.id, saveThreadDraftContent, clearThreadDraftContent]);

  useEffect(() => {
    if (thread.status !== "working") setIsInterrupting(false);
  }, [thread.status]);

  useEffect(() => {
    if (isComposerCollapsed) {
      setSlashQuery(null);
    }
  }, [isComposerCollapsed]);

  useEffect(() => {
    function handlePasteToComposer(e: Event) {
      const text = (e as CustomEvent<string>).detail;
      if (text) setPrompt((prev) => prev + text);
    }
    window.addEventListener("craftstation:paste-to-composer", handlePasteToComposer);
    return () =>
      window.removeEventListener("craftstation:paste-to-composer", handlePasteToComposer);
  }, []);

  // Publish the rendered presentation + collapsed state so the browser element
  // picker can decide whether a pick should go to the terminal or the composer.
  useEffect(() => {
    setComposerUi(thread.id, { presentation: presentationMode, collapsed: isComposerCollapsed });
  }, [thread.id, presentationMode, isComposerCollapsed, setComposerUi]);
  useEffect(() => {
    return () => useComposerUiStore.getState().clearComposerUi(thread.id);
  }, [thread.id]);

  const pendingComposerFocusThreadId = useAppStore((s) => s.pendingComposerFocusThreadId);
  useEffect(() => {
    if (pendingComposerFocusThreadId !== thread.id || isComposerCollapsed) return;
    const raf = requestAnimationFrame(() => {
      mentionRef.current?.focus();
      useAppStore.getState().clearComposerFocusRequest(thread.id);
    });
    return () => cancelAnimationFrame(raf);
  }, [isComposerCollapsed, pendingComposerFocusThreadId, thread.id]);

  return (
    <>
      {thread.status !== "launching" || !usesTerminalPresentation ? (
        <div className="relative">
          <UniversalDockedChatInput
            project={contextProject}
            placement="conversation"
            craftMode={craftMode}
            onCraftModeChange={handleCraftModeChange}
            threadId={thread.id}
            showGoalStrip={!hideInfoDocks && !usesTerminalPresentation}
            {...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {})}
            {...(composerQueuedFollowUp
              ? {
                  afterContextBar: (
                    <ThreadQueuedFollowUpStrip
                      queued={composerQueuedFollowUp}
                      onSendNow={() => {
                        void sendQueuedFollowUpNow(thread);
                      }}
                      onEdit={handleEditQueuedFollowUp}
                      onDelete={() => clearQueuedFollowUp(thread.id)}
                      {...(attachmentImageUrlForPath
                        ? { imageUrlForPath: attachmentImageUrlForPath }
                        : {})}
                    />
                  ),
                }
              : {})}
          >
            <div
              className={`grid transition-[grid-template-rows] ease-[cubic-bezier(0.16,1,0.3,1)] ${isComposerCollapsed ? "duration-300" : "duration-200"}`}
              style={{ gridTemplateRows: isComposerCollapsed ? "0fr" : "1fr" }}
            >
              {/* Bottom-anchor the shell inside the clip so collapsing slides it
                down like a drawer instead of chopping off its bottom border. */}
              <div className="flex min-h-0 flex-col justify-end overflow-hidden">
                <div
                  className={`relative ${isComposerCollapsed ? "pointer-events-none" : ""}`}
                  style={{
                    opacity: isComposerCollapsed ? 0 : 1,
                    // Fade over the same window as the height transition so the
                    // collapse reads as one motion, not height-then-border steps.
                    transition: isComposerCollapsed
                      ? "opacity 300ms cubic-bezier(0.16,1,0.3,1)"
                      : "opacity 200ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  <ThreadComposer
                    autoFocus={shouldAutoFocusComposer} // eslint-disable-line jsx-a11y/no-autofocus -- Electron is always desktop; the PWA enables this only for desktop-like input
                    compact={isCliThread}
                    variant={isCliThread ? "active" : "draft"}
                    controlsDisplay={isCliThread ? "inline" : "menu"}
                    {...(isCliThread
                      ? {}
                      : {
                          // 上下文/额度圆环：紧贴模型选择器左侧，悬浮展开详情。
                          beforeEndControls: (
                            <ContextQuotaRing
                              threadId={thread.id}
                              contextSummary={contextSummary}
                              quotaProviderId={thread.agentKind}
                              {...(liveAccountId ? { quotaAccountId: liveAccountId } : {})}
                            />
                          ),
                        })}
                    toolbarLayoutKey={[
                      isCliThread ? "cli" : "chat",
                      showContextIndicator ? "ctx" : "no-ctx",
                      authRequired ? "auth-required" : "auth-ready",
                    ].join("|")}
                    fixedContent={
                      hasActiveSubAgent ||
                      showContextInComposer ||
                      showErrorInComposer ||
                      showGoalInComposer ||
                      showTodoInComposer ||
                      showAuthInComposer ||
                      composerPendingSteer ||
                      composerRuntimeRequest ||
                      showCommandPanel ? (
                        <ThreadComposerDocks
                          hasActiveSubAgent={hasActiveSubAgent}
                          showContextInComposer={showContextInComposer}
                          showErrorInComposer={showErrorInComposer}
                          showGoalInComposer={showGoalInComposer}
                          showTodoInComposer={showTodoInComposer}
                          authRequired={showAuthInComposer}
                          showCommandPanel={showCommandPanel}
                          threadId={thread.id}
                          projectLocation={projectLocation}
                          threadConfig={thread.config}
                          worktreePath={thread.worktreePath}
                          branchName={branchName}
                          agentStatus={effectiveAgentStatus}
                          project={project}
                          contextSummary={contextSummary}
                          errorDockStates={errorDockStates}
                          goalDockState={goalDockState}
                          todoDockState={todoDockState}
                          todoDockCollapsed={todoDockCollapsed}
                          todoDockPlacement={todoDockPlacement}
                          pendingSteer={composerPendingSteer}
                          activeRuntimeRequest={composerRuntimeRequest}
                          filteredCommands={filteredCommands}
                          slashActiveIndex={slashActiveIndex}
                          commandListId={commandListId}
                          onCloseContextDock={() => setContextDockOpen(false)}
                          onDismissError={props.onDismissError}
                          onGoalDockDismiss={props.onGoalDockDismiss}
                          onTodoDockCollapsedChange={props.onTodoDockCollapsedChange}
                          onTodoDockPlacementChange={props.onTodoDockPlacementChange}
                          {...(props.onTodoDockRetire
                            ? { onTodoDockRetire: props.onTodoDockRetire }
                            : {})}
                          onCancelPendingSteer={() => clearThreadPendingSteer(thread.id)}
                          {...(props.onOpenProjectRelativePath
                            ? { onOpenProjectRelativePath: props.onOpenProjectRelativePath }
                            : {})}
                          onSlashActiveIndexChange={setSlashActiveIndex}
                          onSelectCommand={(cmd) => {
                            mentionRef.current?.insertSlashCommand(cmd);
                            setSlashQuery(null);
                          }}
                        />
                      ) : null
                    }
                    attachmentBar={
                      <AttachmentBar
                        attachments={attachments.attachments}
                        onRemove={attachments.removeAttachment}
                        onPreviewImage={(att) => {
                          const imageAttachments = attachments.attachments.filter((a) => a.isImage);
                          const idx = imageAttachments.findIndex((a) => a.id === att.id);
                          if (idx >= 0) {
                            openAttachmentLightbox(
                              imageAttachments,
                              idx,
                              attachmentImageUrlForPath,
                            );
                          }
                        }}
                        onPreviewPdf={(att) => openPdfPreview(att.path)}
                        {...(attachmentImageUrlForPath
                          ? { imageUrlForPath: attachmentImageUrlForPath }
                          : {})}
                      />
                    }
                    inputContent={
                      <MentionInput
                        ref={mentionRef}
                        autoFocus={shouldAutoFocusComposer} // eslint-disable-line jsx-a11y/no-autofocus -- Electron is always desktop; the PWA enables this only for desktop-like input
                        compact={isCliThread}
                        disabled={!(showServerComposer || showTerminalComposer)}
                        placeholder={
                          approvalDenyOption
                            ? t`Deny and tell the agent what to do differently…`
                            : canContinuePausedTask
                              ? t`Task paused. Click continue or send a new message.`
                              : (props.composerPlaceholder ?? t`Send a message...`)
                        }
                        projectLocation={projectLocation}
                        submitOnEnter={props.submitOnEnter ?? !isRemoteSurface}
                        {...(showCommandPanel
                          ? {
                              commandListId,
                              commandActiveDescendant: `${commandListId}-option-${slashActiveIndex}`,
                            }
                          : {})}
                        projectId={thread.projectId}
                        mcpMentions={mcpMentions}
                        pluginMentions={pluginMentions}
                        onTextChange={(hasText) => {
                          setHasContent(hasText);
                          latestSegmentsRef.current = mentionRef.current?.serializeSegments() ?? [];
                        }}
                        onSubmit={submitPrompt}
                        onPasteImage={(file: File) => {
                          void attachments
                            .addClipboardImage(file, thread.id)
                            .catch((error: unknown) => toast.danger(friendlyError(error)));
                        }}
                        onInterceptKey={(e) => {
                          if (
                            !usesTerminalPresentation &&
                            handleComposerControlShortcut(e, {
                              controls: controlsWithOpenSignal,
                              keybindings: useKeybindingStore.getState().keybindings,
                              platform: readBridge().platform,
                              onOpenModelPicker: () => {
                                setControlOpenRequest((prev) => ({
                                  target: "model",
                                  nonce: (prev?.nonce ?? 0) + 1,
                                }));
                              },
                              onStartDictation: () => voiceInputRef.current?.toggle() ?? false,
                            })
                          ) {
                            return true;
                          }

                          if (
                            showCommandPanel &&
                            handleSlashCommandPanelKeyDown(e, {
                              slashQuery,
                              filteredCommands,
                              slashActiveIndex,
                              setSlashActiveIndex,
                              setSlashQuery,
                              mentionRef,
                            })
                          ) {
                            return true;
                          }

                          if (showTerminalComposer) {
                            if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                              e.preventDefault();
                              void writeTerminalInput("\x1b[Z").catch((error: unknown) => {
                                toast.danger(friendlyError(error));
                              });
                              return true;
                            }
                            if (
                              (e.ctrlKey || e.metaKey) &&
                              !e.shiftKey &&
                              !e.altKey &&
                              e.key.toLowerCase() === "t"
                            ) {
                              e.preventDefault();
                              void writeTerminalInput("\x14").catch((error: unknown) => {
                                toast.danger(friendlyError(error));
                              });
                              return true;
                            }
                          }
                          return false;
                        }}
                        onSlashCommandChange={setSlashQuery}
                      />
                    }
                    controls={controlsWithOpenSignal}
                    placeholder={
                      canContinuePausedTask
                        ? t`Task paused. Click continue or send a new message.`
                        : t`Send a message...`
                    }
                    prompt={prompt}
                    promptDisabled={!(showServerComposer || showTerminalComposer)}
                    stopPending={isInterrupting}
                    submitDisabled={
                      !(
                        hasContent ||
                        attachments.attachments.length > 0 ||
                        canContinuePausedTask
                      ) || !canSubmit
                    }
                    submitLabel={canContinuePausedTask ? t`Continue` : t`Send message`}
                    onStop={canInterruptStructuredTurn ? handleInterrupt : undefined}
                    {...(() => {
                      const renderExtras = () => (
                        <ComposerAddMenu
                          mcpServers={mcpServers}
                          customMcpServers={customMcpServers}
                          workbench={{
                            onOpen: () => {
                              const entryMode = craftMode === "creative" ? "creative" : "efficient";
                              useCraftingWorkbenchStore.getState().setCapabilityMode(craftMode);
                              usePanelStore
                                .getState()
                                .openModelUsageWorkspace({ tab: "crafting", entryMode });
                            },
                          }}
                          readOnly
                          computerUse={{
                            enabled: effectiveMcpConfig?.computerUse === true,
                            visible:
                              effectiveMcpConfig?.computerUse === true &&
                              readBridge()?.platform !== "linux" &&
                              projectLocation?.kind !== "wsl",
                            onToggle: () => {},
                          }}
                          showFileOption={!usesRemoteTransport || props.pickFiles !== undefined}
                          onPickFiles={() => {
                            void (
                              props.pickFiles
                                ? props.pickFiles()
                                : readBridge().pickFiles({ attachmentThreadId: thread.id })
                            )
                              .then((paths) => {
                                if (paths) attachments.addFiles(paths);
                              })
                              .catch((error: unknown) => toast.danger(friendlyError(error)));
                          }}
                        />
                      );
                      const renderVoiceInput = () => (
                        <ComposerVoiceInput
                          key={thread.id}
                          show={showVoiceInputButton}
                          isDisabled={
                            authRequired ||
                            isSubmitting ||
                            !(showServerComposer || showTerminalComposer)
                          }
                          mentionRef={mentionRef}
                          voiceInputRef={voiceInputRef}
                        />
                      );
                      return {
                        leadingControls: renderExtras,
                        afterControls: renderVoiceInput,
                      };
                    })()}
                    onPromptChange={setPrompt}
                    {...(!usesRemoteTransport ? { onAttachFiles: attachments.addFiles } : {})}
                    onSubmit={() => {
                      const segments = mentionRef.current?.serializeSegments();
                      submitPrompt(
                        segments && segments.length > 0
                          ? segments
                          : [{ kind: "text", content: prompt.trim() }],
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          </UniversalDockedChatInput>
          {canCollapseComposer ? (
            <div className="relative z-10 flex h-0 justify-center">
              <button
                type="button"
                aria-label={isComposerCollapsed ? t`Show composer` : t`Collapse composer`}
                className="absolute -top-[9px] flex items-center rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0 text-muted transition-colors hover:text-foreground"
                onClick={() => setComposerCollapsed(!composerCollapsed)}
              >
                <ChevronDown
                  className={`size-3.5 transition-transform duration-150 ${isComposerCollapsed ? "rotate-180" : ""}`}
                />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
