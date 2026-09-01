import { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  AgentCapability,
  AgentStatus,
  ExtractContextResult,
  ProjectDraftConfig,
  ProjectLocation,
  PromptSegment,
  Thread,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import { Button } from "@/renderer/components/common/Button";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { modelVisibilityKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { readBridge } from "@/renderer/bridge";
import type { ComposerControl } from "./ThreadComposer";
import { ThreadComposer } from "./ThreadComposer";
import {
  appendProviderComposerControls,
  buildModelPickerControls,
  buildProviderModelMenuProviders,
} from "./buildModelPickerControls";
import { AttachmentBar } from "../composer/AttachmentBar";
import { openAttachmentLightbox } from "../composer/ImageLightbox";
import { openPdfPreview } from "../pdf/openPdfPreview";
import { MentionInput, type MentionInputHandle } from "../composer/MentionInput";
import { useAttachments } from "../composer/useAttachments";
import { flattenSegments } from "../composer/serializeMentions";
import {
  agentStatusForPresentation,
  capabilitiesForPresentation,
  filterHiddenModels,
  resolveModelSelection,
  resolveReasoningSelection,
} from "@/shared/agentSelection";
import { supportsUsableFastMode } from "./threadDraftViewHelpers";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import type { RuntimeChatItem } from "@/renderer/state/slices/runtimeEventSlice";
import {
  cancelSessionHandoff,
  compileHandoffTarget,
  readSessionHandoffState,
  requestSessionHandoff,
} from "@/renderer/actions/sessionHandoffActions";
import { useSessionHandoffStore } from "@/renderer/state/sessionHandoffStore";
import type { SessionSwitchMode, SessionSwitchPhase } from "@/shared/sessionHandoff";

type Phase = "select" | "extracting" | "error";
type PendingSubmission = { prompt: string; segments?: PromptSegment[] };
const MAX_TRANSCRIPT_CONTEXT_CHARS = 50_000;
const DEFAULT_HANDOFF_PROMPT =
  "Continue from the transferred context and pick up where the previous provider left off.";
const HANDOFF_BUSY_PHASES = new Set<SessionSwitchPhase>([
  "queued",
  "interrupting_source",
  "preparing",
  "checkpointed",
  "target_starting",
  "target_ready",
  "activating",
  "rolling_back",
]);

function supportedPresentationModes(agent: AgentStatus): ThreadPresentationMode[] {
  return agent.capabilities.presentationModes ?? [agent.capabilities.presentationMode];
}

function supportsPresentation(agent: AgentStatus, mode: ThreadPresentationMode): boolean {
  return supportedPresentationModes(agent).includes(mode);
}

function resolveInitialPresentationMode(
  agent: AgentStatus | undefined,
  lastByAgent: Record<string, ThreadPresentationMode>,
  sourceMode: ThreadPresentationMode,
): ThreadPresentationMode {
  if (!agent) return "terminal";
  const supported = supportedPresentationModes(agent);
  const last = lastByAgent[agent.kind];
  if (last && supported.includes(last)) return last;
  if (supported.includes(sourceMode)) return sourceMode;
  if (supported.includes("gui")) return "gui";
  return supported[0] ?? agent.capabilities.presentationMode ?? "terminal";
}

function resolveContextSizeValue(
  capabilities: AgentCapability,
  model: string,
  preferred?: string,
): string | undefined {
  const allowed = capabilities.modelContextSizes?.[model];
  if (!allowed?.length) return capabilities.defaultContextSize;
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0];
}

function resolveModeValue(
  capabilities: AgentCapability,
  preferred?: ThreadConfig["mode"],
): ThreadConfig["mode"] | undefined {
  return preferred && capabilities.modes.includes(preferred)
    ? preferred
    : (capabilities.modes[0] ?? undefined);
}

function resolveLabeledOptionValue(
  options: ReadonlyArray<{ id: string }>,
  preferred: string | undefined,
  bypass: string | undefined,
): string {
  if (preferred !== undefined) {
    return options.some((o) => o.id === preferred) ? preferred : "";
  }
  if (bypass && options.some((o) => o.id === bypass)) {
    return bypass;
  }
  return options[0]?.id ?? "";
}

function resolveDefaultConfig(
  agent: AgentStatus,
  presentationMode: ThreadPresentationMode,
  preferred?: Partial<ThreadConfig>,
): ThreadConfig {
  const capabilities = capabilitiesForPresentation(agent.capabilities, presentationMode);
  const model = resolveModelSelection(capabilities, preferred?.model);
  const effort = resolveReasoningSelection(capabilities, model, preferred?.effort);
  const contextSize = resolveContextSizeValue(capabilities, model, preferred?.contextSize);
  const fast = supportsUsableFastMode(capabilities, model) ? preferred?.fast === true : false;
  const thinking = capabilities.thinkingModels?.includes(model)
    ? preferred?.thinking === true
    : false;
  const mode = resolveModeValue(capabilities, preferred?.mode);
  const approvalPolicy = resolveLabeledOptionValue(
    capabilities.approvalPolicies,
    preferred?.approvalPolicy,
    capabilities.bypassPermissions?.approvalPolicy,
  );
  const sandboxMode = resolveLabeledOptionValue(
    capabilities.sandboxModes,
    preferred?.sandboxMode,
    capabilities.bypassPermissions?.sandboxMode,
  );

  return {
    model,
    ...(effort ? { effort } : {}),
    ...(contextSize ? { contextSize } : {}),
    ...(fast ? { fast } : {}),
    ...(thinking ? { thinking } : {}),
    ...(mode ? { mode } : {}),
    ...(approvalPolicy ? { approvalPolicy } : {}),
    ...(preferred?.approvalsReviewer ? { approvalsReviewer: preferred.approvalsReviewer } : {}),
    ...(sandboxMode ? { sandboxMode } : {}),
  };
}

function savedConfigForAgent(agent: AgentStatus, savedConfig?: ProjectDraftConfig) {
  return savedConfig?.agentKind === agent.kind ? savedConfig : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function textFromContentBlocks(payload: unknown): string {
  const content = asRecord(payload)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const record = asRecord(block);
      if (!record) return "";
      if (record.kind === "text" && typeof record.text === "string") return record.text;
      if (record.kind === "file" && typeof record.path === "string") return `@${record.path}`;
      if (record.kind === "image") {
        if (typeof record.path === "string") return `@${record.path}`;
        if (typeof record.name === "string") return `[image: ${record.name}]`;
        return "[image]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatRuntimeItemForHandoff(item: RuntimeChatItem): string | null {
  const streams = item.streams;
  const payload = asRecord(item.payload);
  switch (item.type) {
    case "user_message": {
      const text = textFromContentBlocks(item.payload);
      return text ? `User:\n${text}` : null;
    }
    case "assistant_message": {
      const text = textFromContentBlocks(item.payload) || streams.assistant_text;
      return text ? `Assistant:\n${text}` : null;
    }
    case "plan": {
      const steps = payload?.steps;
      if (!Array.isArray(steps)) return null;
      const text = steps
        .map((step) => {
          const record = asRecord(step);
          if (!record || typeof record.step !== "string") return "";
          const status = typeof record.status === "string" ? record.status : "pending";
          return `- [${status}] ${record.step}`;
        })
        .filter(Boolean)
        .join("\n");
      return text ? `Plan:\n${text}` : null;
    }
    case "goal": {
      const objective = typeof payload?.objective === "string" ? payload.objective : "";
      const status = typeof payload?.status === "string" ? ` (${payload.status})` : "";
      return objective ? `Goal${status}:\n${objective}` : null;
    }
    case "tool_call":
    case "mcp_tool_call":
    case "image_view":
    case "dynamic_tool_call": {
      const name = typeof payload?.title === "string" ? payload.title : payload?.name;
      const status = typeof payload?.status === "string" ? payload.status : item.state;
      return typeof name === "string" ? `Tool ${status}: ${name}` : null;
    }
    case "command_execution": {
      const command = typeof payload?.command === "string" ? payload.command : "";
      const output = streams.command_output;
      return command || output
        ? `Command:\n${command}${output ? `\nOutput:\n${output}` : ""}`
        : null;
    }
    case "file_change": {
      const path = typeof payload?.path === "string" ? payload.path : "";
      const kind = typeof payload?.changeKind === "string" ? payload.changeKind : "change";
      return path ? `File ${kind}: ${path}` : null;
    }
    case "web_search": {
      const query = typeof payload?.query === "string" ? payload.query : "";
      return query ? `Web search: ${query}` : null;
    }
    case "error": {
      const message = typeof payload?.message === "string" ? payload.message : "";
      return message ? `Error:\n${message}` : null;
    }
    default:
      return null;
  }
}

export function ContinueInProviderDialog(props: {
  isOpen: boolean;
  thread: Thread;
  projectLocation: ProjectLocation;
  installedAgents: AgentStatus[];
  lastDraftConfig?: ProjectDraftConfig;
  onClose: () => void;
  onContinue: (
    targetAgentKind: string,
    targetConfig: ThreadConfig,
    targetPresentationMode: ThreadPresentationMode,
    prompt: string,
    segments: PromptSegment[] | undefined,
    closeOriginal: boolean,
    extractedContext: ExtractContextResult | null,
  ) => void;
}) {
  const { thread, installedAgents, onClose, onContinue } = props;
  const { t } = useLingui();

  const otherAgents = installedAgents.filter((a) => a.kind !== thread.agentKind);
  const [selectedKind, setSelectedKind] = useState<string>(otherAgents[0]?.kind ?? "");
  const [phase, setPhase] = useState<Phase>("select");
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingCloseOriginal, setPendingCloseOriginal] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [switchMode, setSwitchMode] = useState<SessionSwitchMode>("after-current-turn");
  const [switchError, setSwitchError] = useState("");
  const mentionRef = useRef<MentionInputHandle>(null);
  const attachments = useAttachments();
  const handoffState = useSessionHandoffStore((state) => state.statesByThread[thread.id]);

  const sourceAgent = installedAgents.find((a) => a.kind === thread.agentKind);
  const selectedAgent = otherAgents.find((a) => a.kind === selectedKind);
  const sourcePresentationMode =
    thread.presentationMode ?? sourceAgent?.capabilities.presentationMode ?? "terminal";
  const sourceRuntimeStatus = sourceAgent
    ? agentStatusForPresentation(sourceAgent, sourcePresentationMode, thread.sessionRef)
    : undefined;
  const lastPresentationModeByAgent = useSharedSettings((s) => s.lastPresentationModeByAgent);
  const setLastPresentationMode = useSharedSettings((s) => s.setLastPresentationMode);
  const [targetPresentationMode, setTargetPresentationMode] = useState<ThreadPresentationMode>(() =>
    resolveInitialPresentationMode(
      selectedAgent,
      lastPresentationModeByAgent,
      sourcePresentationMode,
    ),
  );

  // --- Target provider config ---
  const [targetConfig, setTargetConfig] = useState<ThreadConfig>(() =>
    selectedAgent
      ? resolveDefaultConfig(
          selectedAgent,
          resolveInitialPresentationMode(
            selectedAgent,
            lastPresentationModeByAgent,
            sourcePresentationMode,
          ),
          savedConfigForAgent(selectedAgent, props.lastDraftConfig),
        )
      : { model: "" },
  );

  function handleProviderChange(kind: string, preferred?: Partial<ThreadConfig>) {
    setSelectedKind(kind);
    const agent = otherAgents.find((a) => a.kind === kind);
    if (agent) {
      const nextPresentationMode = supportsPresentation(agent, targetPresentationMode)
        ? targetPresentationMode
        : resolveInitialPresentationMode(
            agent,
            lastPresentationModeByAgent,
            sourcePresentationMode,
          );
      if (nextPresentationMode !== targetPresentationMode) {
        setTargetPresentationMode(nextPresentationMode);
      }
      setTargetConfig(
        resolveDefaultConfig(agent, nextPresentationMode, {
          ...savedConfigForAgent(agent, props.lastDraftConfig),
          ...preferred,
        }),
      );
    }
  }

  function handleTargetConfigPatch(patch: Partial<ThreadConfig>) {
    if (!selectedAgent) return;
    setTargetConfig((prev) =>
      resolveDefaultConfig(selectedAgent, targetPresentationMode, { ...prev, ...patch }),
    );
  }

  const allHiddenModels = useSharedSettings((s) => s.hiddenModels);
  const selectedTargetCapabilities = selectedAgent
    ? filterHiddenModels(
        capabilitiesForPresentation(selectedAgent.capabilities, targetPresentationMode),
        allHiddenModels[modelVisibilityKey(selectedAgent.kind, targetPresentationMode)],
      )
    : undefined;
  const providerModelProviders = buildProviderModelMenuProviders(otherAgents, {
    presentationMode: targetPresentationMode,
    hiddenModelsByAgent: allHiddenModels,
    filterAgent: (agent) => supportsPresentation(agent, targetPresentationMode),
  });
  const targetControls: ComposerControl[] = selectedAgent
    ? appendProviderComposerControls(
        buildModelPickerControls({
          providers: providerModelProviders,
          selectedAgentKind: selectedKind,
          model: targetConfig.model,
          ...(targetConfig.effort ? { effort: targetConfig.effort } : {}),
          ...(targetConfig.contextSize ? { contextSize: targetConfig.contextSize } : {}),
          ...(targetConfig.fast ? { fast: targetConfig.fast } : {}),
          ...(targetConfig.thinking ? { thinking: targetConfig.thinking } : {}),
          capabilities: selectedTargetCapabilities ?? selectedAgent.capabilities,
          presentationMode: targetPresentationMode,
          onProviderModelChange: (next) =>
            handleProviderChange(next.agentKind, { model: next.model }),
          onConfigPatch: handleTargetConfigPatch,
        }),
        {
          agentKind: selectedKind,
          capabilities: selectedTargetCapabilities ?? selectedAgent.capabilities,
          config: targetConfig,
          presentationMode: targetPresentationMode,
          isDisabled: false,
          onConfigChange: handleTargetConfigPatch,
        },
      )
    : [];
  const handoffTarget = useMemo(
    () =>
      compileHandoffTarget({
        thread,
        projectLocation: props.projectLocation,
        targetAgentKind: selectedKind,
        targetConfig,
      }),
    [props.projectLocation, selectedKind, targetConfig, thread],
  );
  const canSwitchInPlace =
    targetPresentationMode === "gui" && handoffTarget.available && Boolean(handoffTarget.craftPlan);
  const isSwitchBusy = handoffState ? HANDOFF_BUSY_PHASES.has(handoffState.phase) : false;
  const isQueuedSwitch = handoffState?.phase === "queued";
  const activeSegment = handoffState?.phase === "active" ? handoffState.activeSegment : undefined;

  useEffect(() => {
    if (!props.isOpen || thread.remoteServerId) return;
    let cancelled = false;
    void readSessionHandoffState(thread.id).catch((error) => {
      if (!cancelled) setSwitchError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [props.isOpen, thread.id, thread.remoteServerId]);
  // --- Extraction config (source provider) ---
  const hiddenModelIds = useSharedSettings(
    (s) => s.hiddenModels[modelVisibilityKey(thread.agentKind, sourcePresentationMode)],
  );
  const filteredSourceCaps = sourceRuntimeStatus
    ? filterHiddenModels(sourceRuntimeStatus.capabilities, hiddenModelIds)
    : undefined;
  const models = filteredSourceCaps?.models ?? [];
  const extractModel = thread.config.model || models[0]?.id || "";
  const extractEffort = thread.config.effort ?? "";
  const extractionEfforts =
    filteredSourceCaps?.modelEfforts?.[extractModel] ?? filteredSourceCaps?.efforts ?? [];
  const effectiveExtractEffort = extractionEfforts.includes(extractEffort)
    ? extractEffort
    : filteredSourceCaps?.defaultEffort &&
        extractionEfforts.includes(filteredSourceCaps.defaultEffort)
      ? filteredSourceCaps.defaultEffort
      : (extractionEfforts[0] ?? "");
  function buildSubmission(inputSegments?: PromptSegment[]): PendingSubmission | null {
    const composerSegments = inputSegments ?? mentionRef.current?.serializeSegments() ?? [];
    const allSegments = [...attachments.toSegments(), ...composerSegments];
    const flatPrompt = flattenSegments(allSegments);
    if (!flatPrompt.trim()) {
      return { prompt: DEFAULT_HANDOFF_PROMPT };
    }
    return {
      prompt: flatPrompt,
      ...(allSegments.length > 0 ? { segments: allSegments } : {}),
    };
  }

  function buildTranscriptContext(): ExtractContextResult | null {
    const state = useAppStore.getState();
    const itemIds = state.runtimeItemIdsByThread[thread.id] ?? [];
    const itemsById = state.runtimeItemsByIdByThread[thread.id];
    if (!itemsById || itemIds.length === 0) return null;

    const transcript = itemIds
      .map((itemId) => itemsById[itemId])
      .filter((item): item is RuntimeChatItem => Boolean(item && !item.parentItemId))
      .map(formatRuntimeItemForHandoff)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n\n");

    if (!transcript.trim()) return null;
    const sourceLabel = sourceAgent?.label ?? thread.agentKind;
    const summary = [
      `Context captured from the ${sourceLabel} chat transcript because provider resume and terminal scrollback were unavailable.`,
      "",
      transcript.length > MAX_TRANSCRIPT_CONTEXT_CHARS
        ? `${transcript.slice(-MAX_TRANSCRIPT_CONTEXT_CHARS)}\n\n[earlier transcript truncated]`
        : transcript,
    ].join("\n");

    return {
      summary,
      sourceProvider: thread.agentKind,
      sourceSessionId: thread.sessionRef?.providerSessionId ?? thread.id,
      ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
      extractedAt: new Date().toISOString(),
    };
  }

  async function handleAction(closeOriginal: boolean, inputSegments?: PromptSegment[]) {
    const submission = buildSubmission(inputSegments);
    if (!submission) return;
    setPendingCloseOriginal(closeOriginal);
    setPendingSubmission(submission);
    setLastPresentationMode(selectedKind, targetPresentationMode);

    if (!thread.sessionRef) {
      onContinue(
        selectedKind,
        targetConfig,
        targetPresentationMode,
        submission.prompt,
        submission.segments,
        closeOriginal,
        null,
      );
      return;
    }

    setPhase("extracting");
    try {
      const result = await readBridge().extractContext({
        threadId: thread.id,
        agentKind: thread.agentKind,
        sessionRef: thread.sessionRef,
        projectLocation: props.projectLocation,
        ...(thread.worktreePath ? { worktreePath: thread.worktreePath } : {}),
        ...(extractModel ? { model: extractModel } : {}),
        ...(effectiveExtractEffort ? { effort: effectiveExtractEffort } : {}),
      });
      onContinue(
        selectedKind,
        targetConfig,
        targetPresentationMode,
        submission.prompt,
        submission.segments,
        closeOriginal,
        result,
      );
    } catch (err) {
      const fallback = buildTranscriptContext();
      if (fallback) {
        onContinue(
          selectedKind,
          targetConfig,
          targetPresentationMode,
          submission.prompt,
          submission.segments,
          closeOriginal,
          fallback,
        );
        return;
      }
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSwitchInPlace() {
    const submission = buildSubmission();
    if (!submission || !canSwitchInPlace) return;
    setSwitchError("");
    setLastPresentationMode(selectedKind, "gui");
    try {
      const state = await requestSessionHandoff({
        thread,
        projectLocation: props.projectLocation,
        targetAgentKind: selectedKind,
        targetConfig,
        mode: switchMode,
        prompt: submission.prompt,
      });
      if (state.phase === "active") onClose();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCancelSwitch() {
    if (!handoffState) return;
    setSwitchError("");
    try {
      await cancelSessionHandoff(thread.id, handoffState.requestId);
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : String(error));
    }
  }

  function handleCancel() {
    if (phase === "extracting") {
      readBridge()
        .cancelExtractContext({ threadId: thread.id })
        .catch(() => {});
    }
    setPhase("select");
    setErrorMessage("");
    onClose();
  }

  function handleStartWithoutContext() {
    const submission = pendingSubmission ?? buildSubmission();
    if (!submission) return;
    onContinue(
      selectedKind,
      targetConfig,
      targetPresentationMode,
      submission.prompt,
      submission.segments,
      pendingCloseOriginal,
      null,
    );
  }

  const canSubmit = Boolean(selectedKind && targetConfig.model);
  const targetProviderFallback = t`the target provider`;

  return (
    <>
      <Modal.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && handleCancel()}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[760px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                <Trans>Continue in another provider</Trans>
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body className="px-5 pb-5 pt-2">
              {phase === "select" && (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <ThreadComposer
                      autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
                      compact
                      variant="draft"
                      hideSubmitButton
                      controls={targetControls}
                      toolbarLayoutKey={[
                        selectedKind,
                        targetPresentationMode,
                        targetConfig.model,
                        targetConfig.effort ?? "",
                        targetConfig.contextSize ?? "",
                        targetConfig.fast ? "fast" : "normal",
                        targetConfig.thinking ? "thinking" : "standard",
                      ].join("|")}
                      attachmentBar={
                        <AttachmentBar
                          attachments={attachments.attachments}
                          onRemove={attachments.removeAttachment}
                          onPreviewImage={(att) => {
                            const imageAttachments = attachments.attachments.filter(
                              (a) => a.isImage,
                            );
                            const idx = imageAttachments.findIndex((a) => a.id === att.id);
                            if (idx >= 0) openAttachmentLightbox(imageAttachments, idx);
                          }}
                          onPreviewPdf={(att) => openPdfPreview(att.path)}
                        />
                      }
                      inputContent={
                        <MentionInput
                          ref={mentionRef}
                          autoFocus // eslint-disable-line jsx-a11y/no-autofocus -- desktop app, expected UX
                          compact
                          placeholder={t`Tell ${selectedAgent?.label ?? targetProviderFallback} what to do next...`}
                          projectLocation={props.projectLocation}
                          projectId={thread.projectId}
                          onTextChange={() => undefined}
                          onPasteImage={(file) => {
                            void attachments.addClipboardImage(file, `handoff:${thread.id}`);
                          }}
                          onSubmit={(segments) => {
                            void handleAction(false, segments);
                          }}
                        />
                      }
                      placeholder={t`Tell the target provider what to do next...`}
                      prompt=""
                      submitDisabled={!canSubmit}
                      submitLabel={t`Fork`}
                      onPromptChange={() => undefined}
                      onSubmit={() => {
                        void handleAction(false);
                      }}
                      afterControls={
                        <Button
                          isIconOnly
                          aria-label={t`Attach files`}
                          className="craftstation-composer-menu min-w-9 px-2"
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            void readBridge()
                              .pickFiles()
                              .then((paths) => {
                                if (paths) attachments.addFiles(paths);
                              });
                          }}
                        >
                          <Paperclip className="size-4" />
                        </Button>
                      }
                    />
                  </div>
                  {thread.presentationMode === "gui" &&
                    thread.compositionProvenance &&
                    !thread.remoteServerId && (
                      <section
                        className="rounded-lg border border-border px-3 py-3"
                        aria-label={t`Switch in this conversation`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">
                              <Trans>Switch in this conversation</Trans>
                            </p>
                            <p className="text-xs text-muted">
                              <Trans>
                                Current:{" "}
                                {activeSegment?.recipeId ?? thread.compositionProvenance?.recipeId}{" "}
                                · {activeSegment?.runtimeBinding.modelId ?? thread.config.model} ·{" "}
                                {activeSegment?.runtimeBinding.harnessKind ?? thread.agentKind}
                              </Trans>
                            </p>
                            <p className="text-xs text-muted">
                              <Trans>
                                Target: {targetConfig.model} · {selectedKind}
                              </Trans>
                            </p>
                          </div>
                          {handoffState && (
                            <span
                              className="rounded bg-default-100 px-2 py-1 text-xs"
                              data-testid="session-switch-phase"
                            >
                              {handoffState.phase}
                            </span>
                          )}
                        </div>
                        <fieldset
                          className="mt-3 flex flex-col gap-2 text-sm"
                          disabled={isSwitchBusy}
                        >
                          <legend className="sr-only">
                            <Trans>Switch timing</Trans>
                          </legend>
                          <label
                            htmlFor="session-switch-after-turn"
                            aria-label={t`After current turn`}
                            className="flex cursor-pointer items-start gap-2"
                          >
                            <input
                              id="session-switch-after-turn"
                              type="radio"
                              name="session-switch-mode"
                              value="after-current-turn"
                              checked={switchMode === "after-current-turn"}
                              onChange={() => setSwitchMode("after-current-turn")}
                            />
                            <span>
                              <span className="block">
                                <Trans>After current turn</Trans>
                              </span>
                              <span className="block text-xs text-muted">
                                <Trans>
                                  Wait for a completed-turn boundary, then create a portable
                                  checkpoint and a new native Session.
                                </Trans>
                              </span>
                            </span>
                          </label>
                          <label
                            htmlFor="session-switch-abort-turn"
                            aria-label={t`Abort current turn and switch`}
                            className="flex cursor-pointer items-start gap-2"
                          >
                            <input
                              id="session-switch-abort-turn"
                              type="radio"
                              name="session-switch-mode"
                              value="abort-current-turn"
                              checked={switchMode === "abort-current-turn"}
                              onChange={() => setSwitchMode("abort-current-turn")}
                            />
                            <span>
                              <span className="block">
                                <Trans>Abort current turn and switch</Trans>
                              </span>
                              <span className="block text-xs text-muted">
                                <Trans>
                                  Confirm the source turn stopped before activating a new Runtime
                                  Segment.
                                </Trans>
                              </span>
                            </span>
                          </label>
                        </fieldset>
                        <p className="mt-2 text-xs text-muted">
                          <Trans>
                            This transfers portable conversation context; it does not resume another
                            provider's native Session. Attachments are not copied into the
                            checkpoint.
                          </Trans>
                        </p>
                        {!canSwitchInPlace && (
                          <p className="mt-2 text-xs text-warning">
                            {targetPresentationMode !== "gui"
                              ? t`Choose the GUI presentation to switch in place.`
                              : handoffTarget.reason}
                          </p>
                        )}
                        {(switchError || handoffState?.diagnostic?.message) && (
                          <p className="mt-2 text-xs text-danger">
                            {switchError || handoffState?.diagnostic?.message}
                          </p>
                        )}
                        <div className="mt-3 flex justify-end gap-2">
                          {isQueuedSwitch && (
                            <Button variant="ghost" onPress={() => void handleCancelSwitch()}>
                              <Trans>Cancel queued switch</Trans>
                            </Button>
                          )}
                          <Button
                            variant="primary"
                            isDisabled={!canSwitchInPlace || isSwitchBusy}
                            onPress={() => void handleSwitchInPlace()}
                          >
                            <Trans>Switch in this conversation</Trans>
                          </Button>
                        </div>
                      </section>
                    )}
                </div>
              )}

              {phase === "extracting" && (
                <div className="flex items-center gap-3 py-2">
                  <PixelLoader size="sm" />
                  <p className="text-sm text-muted">
                    <Trans>
                      Extracting context from {sourceAgent?.label ?? thread.agentKind}...
                    </Trans>
                  </p>
                </div>
              )}

              {phase === "error" && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm">
                    <Trans>Could not extract context.</Trans>
                  </p>
                  {errorMessage && (
                    <p className="max-h-20 overflow-y-auto text-xs text-muted">{errorMessage}</p>
                  )}
                </div>
              )}
            </Modal.Body>

            <Modal.Footer>
              {phase === "select" && (
                <>
                  <Button slot="close" variant="ghost" className="text-muted">
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button
                    variant="secondary"
                    isDisabled={!canSubmit}
                    onPress={() => {
                      void handleAction(false);
                    }}
                  >
                    <Trans>Fork</Trans>
                  </Button>
                  <Button
                    variant="tertiary"
                    isDisabled={!canSubmit}
                    onPress={() => {
                      void handleAction(true);
                    }}
                  >
                    <Trans>Move</Trans>
                  </Button>
                </>
              )}
              {phase === "extracting" && (
                <Button variant="ghost" className="text-muted" onPress={handleCancel}>
                  <Trans>Cancel</Trans>
                </Button>
              )}
              {phase === "error" && (
                <>
                  <Button variant="ghost" className="text-muted" onPress={handleCancel}>
                    <Trans>Cancel</Trans>
                  </Button>
                  <Button variant="secondary" onPress={handleStartWithoutContext}>
                    <Trans>Start Without Context</Trans>
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
