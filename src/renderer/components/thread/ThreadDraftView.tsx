import { DraftHomeHero } from "@/renderer/components/thread/DraftHomeHero";
import type { CraftMode } from "@/renderer/components/thread/CraftModeSwitch";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "@heroui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AgentStatus,
  BuiltInMcpServerId,
  Project,
  ProjectDraftConfig,
  ProviderDraftConfig,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import { HOME_PROJECT_NAME, isHomeProjectId } from "@/shared/homeScope";
import { readBridge } from "@/renderer/bridge";
import { getComputerUseScope } from "@/renderer/components/composer/computerUseScope";
import {
  browserMcpServer,
  chromeMcpServer,
  COMPUTER_USE_MCP_ID,
  crossagentMcpServer,
} from "@/renderer/components/composer/composerMcpServers";
import { useGitStore } from "@/renderer/state/gitStore";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { modelVisibilityKey } from "@/renderer/components/common/ProviderModelMenu/parts/providerIdentity";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { filterHiddenModels } from "@/shared/agentSelection";
import type { ProviderModelPreference } from "@/shared/settings";
import { mergeCustomModelsIntoCapabilities } from "./customModelCatalog";
import {
  appendProviderComposerControls,
  buildModelPickerControls,
  buildProviderModelMenuProviders,
  patchConfigForModelChange,
} from "./buildModelPickerControls";
import {
  agentWithCapabilities,
  formatAgentList,
  resolveContextSizeValue,
  resolveEffortValue,
  resolveFastValue,
  resolveInitialPresentationMode,
  resolveModelValue,
  resolvePreferredAgentKind,
  resolveProviderDraftConfig,
  resolveProviderModelPreference,
  resolveSavedProviderDraftConfig,
  supportsUsableFastMode,
  resolveThinkingValue,
} from "./threadDraftViewHelpers";
import { friendlyError } from "@/shared/messages";
import { ProjectSwitchMenu } from "./ProjectSwitchMenu";
import { ThreadDraftComposerArea, type DraftStartInput } from "./ThreadDraftComposerArea";
import { UniversalDockedChatInput } from "./UniversalDockedChatInput";
import type { SaveClipboardImage } from "../composer/useAttachments";
import { AgentDiscoveryScreen } from "./AgentDiscoveryScreen";
import {
  isDiscoveryActiveForLocation,
  useAgentStatusesStore,
} from "@/renderer/state/agentStatusesStore";
import {
  ThreadDraftCompactHeader,
  ThreadDraftDropIndicators,
  ThreadDraftHero,
  type ThreadDraftDropIndicator,
} from "./ThreadDraftChrome";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/** Minimum gap kept above the composer once it can no longer stay centered. */
const COMPOSER_ANCHOR_MIN_TOP = 8;

/**
 * Keeps the centered draft composer visually *stable* instead of re-centering on
 * every height change. The composer starts vertically centered, then the top
 * edge of the input is locked to that initial line: typing extra rows grows the
 * box downward (top stays put), while rows that appear above the input (slash
 * command panel, attachments, docks) grow the box upward (the input + toolbar
 * stay put). Implemented by driving the height of a spacer above the block so
 * the input's top edge holds a fixed fraction of the container height.
 */
function useStableComposerAnchor(opts: {
  enabled: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  blockRef: React.RefObject<HTMLDivElement | null>;
  spacerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { enabled, containerRef, blockRef, spacerRef } = opts;
  // Fraction of the container height where the input's top edge is pinned.
  // Captured once from the initial centered layout so window resizes keep the
  // composer at the same relative position.
  const anchorRatioRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    const block = blockRef.current;
    const spacer = spacerRef.current;
    if (!container || !block || !spacer) return;

    const apply = () => {
      const height = container.clientHeight;
      if (height <= 0) return;
      const containerTop = container.getBoundingClientRect().top;
      const blockTop = block.getBoundingClientRect().top;
      const inputEl = block.querySelector<HTMLElement>("[data-composer-input-anchor]");
      const inputTop = (inputEl ?? block).getBoundingClientRect().top;
      // Distance from the block's top to the input's top — grows when rows are
      // inserted above the input (command panel, attachments, docks).
      const aboveInput = inputTop - blockTop;
      const blockHeight = block.offsetHeight;

      // Establish the anchor once from the initial (centered) layout: the line
      // the input's top edge would sit on if the block were centered.
      if (anchorRatioRef.current === null) {
        const centeredInputOffset = (height - blockHeight) / 2 + aboveInput;
        anchorRatioRef.current = clampNumber(centeredInputOffset / height, 0, 1);
      }

      const desiredInputOffset = Math.round(anchorRatioRef.current * height);
      const currentInputOffset = inputTop - containerTop;
      const currentSpacer = spacer.offsetHeight;
      const maxSpacer = Math.max(COMPOSER_ANCHOR_MIN_TOP, height - blockHeight);
      // Snap to whole pixels. A fractional spacer height (e.g. 443.5px) reads
      // back from offsetHeight rounded, so the next correction measures a stale
      // value and the input/toolbar drift by a sub-pixel each time the box
      // changes height (the toolbar visibly creeping up as the slash panel opens).
      const nextSpacer = Math.round(
        clampNumber(
          currentSpacer + (desiredInputOffset - currentInputOffset),
          COMPOSER_ANCHOR_MIN_TOP,
          maxSpacer,
        ),
      );
      // Integer guard: only write on a whole-pixel change, never feed a fraction
      // back into the ResizeObserver loop.
      if (Math.abs(nextSpacer - currentSpacer) >= 1) {
        spacer.style.height = `${nextSpacer}px`;
      }
    };

    apply();
    const observer = new ResizeObserver(() => apply());
    observer.observe(container);
    observer.observe(block);
    return () => observer.disconnect();
  }, [enabled, containerRef, blockRef, spacerRef]);
}

export function ThreadDraftView(props: {
  project: Project;
  agentStatuses: AgentStatus[];
  /**
   * True when the supervisor hasn't yet returned agent statuses for this
   * project's environment (first launch, no cache).  The composer shows a
   * "Detecting agents…" placeholder instead of the "No supported agents"
   * prompt while this is true.
   */
  isDetectingAgents?: boolean;
  lastDraftConfig?: ProjectDraftConfig;
  compact?: boolean;
  quickComposer?: boolean;
  composerPlaceholder?: string;
  restoreWorktreeSelectionToken?: number;
  /** Override whether unmodified Enter submits instead of inserting a newline. */
  submitOnEnter?: boolean;
  pickFiles?: () => Promise<string[] | null>;
  saveClipboardImage?: SaveClipboardImage;
  paneAlign?: "left" | "center" | "right";
  showCloseButton?: boolean;
  isDragging?: boolean;
  dropIndicator?: ThreadDraftDropIndicator;
  paneIndex?: number;
  paneCount?: number;
  /**
   * True when this draft pane sits in the top-left and there is no group header
   * above it. Adds a class so CSS can pad the header to clear the macOS
   * traffic-light controls when the sidebar is collapsed.
   */
  headerNeedsTrafficLightPad?: boolean | undefined;
  /** Pane id when rendered as a draft pane; absent for the top-level draft view. */
  paneId?: string | undefined;
  droppableRef?: React.RefObject<HTMLDivElement | null>;
  onClose?: (() => void) | undefined;
  dragHandleRef?: React.RefCallback<Element>;
  onProjectChange?: (projectId: string) => void;
  onStart: (input: DraftStartInput) => void | Promise<void>;
}) {
  const {
    project,
    agentStatuses,
    lastDraftConfig,
    onStart,
    headerNeedsTrafficLightPad = false,
  } = props;
  const gitBranch = useGitStore((s) => s.statuses[project.id]?.branch);
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  // 「管理模型」页保存的自定义模型，合并进首页模型选择器。
  const customModels = useSharedSettings((s) => s.customModels);
  const sharedSettingsHydrated = useSharedSettings((s) => s.sharedSettingsHydrated);
  const showAgentDiscovery = useAgentStatusesStore((s) =>
    isDiscoveryActiveForLocation(s, project.location),
  );
  const isHomeScope = isHomeProjectId(project.id);
  const scopeLabel = isHomeScope ? HOME_PROJECT_NAME : undefined;
  const remoteConnection = useRemoteServersStore((state) => {
    const { remoteServerId } = project;
    if (!remoteServerId) return "local";
    if (!state.servers.some((server) => server.desktopId === remoteServerId)) return "missing";
    return state.runtime[remoteServerId]?.status ?? "connecting";
  });
  const hostUpdateRestarting = useRemoteServersStore((state) =>
    project.remoteServerId ? state.hostUpdateRestarts[project.remoteServerId] !== undefined : false,
  );
  const remoteConnectionMessage = useRemoteServersStore((state) =>
    project.remoteServerId ? state.runtime[project.remoteServerId]?.message : undefined,
  );

  // Debugging showed config-only edits were rebuilding the provider/model
  // payload. Keep the installed-agent list stable unless the source inputs
  // actually change.
  const installedAgents = useMemo(
    () =>
      agentStatuses.filter((status) => status.installed && !disabledAgents.includes(status.kind)),
    [agentStatuses, disabledAgents],
  );
  const preferredAgentKind = resolvePreferredAgentKind(installedAgents, lastDraftConfig);
  const [agentKind, setAgentKind] = useState<AgentStatus["kind"] | undefined>(preferredAgentKind);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();
  const effectiveAgentKind = installedAgents.some((status) => status.kind === agentKind)
    ? agentKind
    : preferredAgentKind;
  const selectedAgent =
    installedAgents.find((status) => status.kind === effectiveAgentKind) ?? installedAgents[0];
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [contextSize, setContextSize] = useState<string | undefined>(() => {
    if (
      lastDraftConfig &&
      lastDraftConfig.agentKind === preferredAgentKind &&
      lastDraftConfig.contextSize
    ) {
      return lastDraftConfig.contextSize;
    }
    if (!preferredAgentKind || isHomeScope) return undefined;
    return useSharedSettings.getState().providerConfigs[preferredAgentKind]?.contextSize;
  });
  const [fast, setFast] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [mode, setMode] = useState<"agent" | "plan" | "autopilot">("agent");
  const [approvalPolicy, setApprovalPolicy] = useState("");
  const [approvalsReviewer, setApprovalsReviewer] = useState("");
  const [sandboxMode, setSandboxMode] = useState("");
  const draftConfigRef = useRef<ProviderDraftConfig | null>(null);
  const [craftMode, setCraftMode] = useState<CraftMode>("auto");
  // Per-draft `@`-mentions of a composer MCP. These are NOT the persistent
  // enablement (that lives in `enabledMcpServers`); they capture a one-off
  // mention in this draft and reset with every new thread. The effective launch
  // flag is `mention || (persistent && scope available)`, computed below.
  const [browserMcpMention, setBrowserMcpMention] = useState(false);
  const [crossagentMcpMention, setCrossagentMcpMention] = useState(false);
  const [chromeMcpMention, setChromeMcpMention] = useState(false);
  const [computerUseMention, setComputerUseMention] = useState(false);
  const [worktreeMode, setWorktreeMode] = useState(
    isHomeScope ? false : (lastDraftConfig?.worktreeMode ?? false),
  );
  const effectiveWorktreeMode = isHomeScope ? false : worktreeMode;
  const lastAppliedAgentKindRef = useRef<AgentStatus["kind"] | undefined>(undefined);

  // Presentation remains part of the launch contract, but the composer no
  // longer exposes a separate Chat/CLI surface selector. Each provider's
  // capabilities resolve the only valid surface for the new thread.
  const lastPresentationModeByAgent = useSharedSettings((s) => s.lastPresentationModeByAgent);
  // Persistent composer MCP enablement (standing defaults across new threads).
  const enabledMcpServers = useSharedSettings((s) => s.enabledMcpServers);
  const disabledBuiltInMcpServers = useSharedSettings((s) => s.disabledBuiltInMcpServers);
  const [presentationMode, setPresentationMode] = useState<ThreadPresentationMode>(() =>
    resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent),
  );
  const selectedAgentForConfig = useMemo(() => {
    if (!selectedAgent) return undefined;
    const presentationAgent = agentWithCapabilities(selectedAgent, presentationMode);
    if (selectedAccountId) {
      const accountModels = customModels.filter(
        (entry) =>
          entry.provider === presentationAgent.kind && entry.accountId === selectedAccountId,
      );
      if (accountModels.length > 0) {
        return {
          ...presentationAgent,
          capabilities: {
            ...presentationAgent.capabilities,
            models: accountModels.map((entry) => ({
              id: entry.modelId,
              label: entry.displayName,
            })),
          },
        };
      }
    }
    // 「管理模型」页的自定义模型在 presentation 解析之后合并，避免被
    // presentationCapabilities 覆盖掉 models/contextSizes。
    return {
      ...presentationAgent,
      capabilities: mergeCustomModelsIntoCapabilities(
        presentationAgent.kind,
        presentationAgent.capabilities,
        customModels,
      ),
    };
  }, [selectedAgent, presentationMode, customModels, selectedAccountId]);
  const previousPresentationAgentKindRef = useRef<AgentStatus["kind"] | undefined>(
    selectedAgent?.kind,
  );
  // Re-resolve when the first provider arrives after an empty draft, or on a
  // provider switch when the new provider can't serve the current mode. Why
  // this set of deps:
  //   - `lastPresentationModeByAgent` is the user's per-provider memory; we
  //     intentionally read the *latest* value at provider-switch time but
  //     don't want intra-session writes to retrigger this effect (the user
  //     hasn't changed providers, so their current selection wins).
  useEffect(() => {
    const previousAgentKind = previousPresentationAgentKindRef.current;
    previousPresentationAgentKindRef.current = selectedAgent?.kind;
    if (!selectedAgent) return;
    if (!previousAgentKind) {
      setPresentationMode(
        resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent),
      );
      return;
    }
    const supported = selectedAgent.capabilities.presentationModes ?? [
      selectedAgent.capabilities.presentationMode,
    ];
    if (supported.includes(presentationMode)) return;
    setPresentationMode(resolveInitialPresentationMode(selectedAgent, lastPresentationModeByAgent));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on provider change
  }, [effectiveAgentKind]);

  // --- Per-provider config memory (app-wide via shared settings) ---
  const updateProjectDraftConfig = useAppStore((s) => s.updateProjectDraftConfig);
  const setProviderConfig = useSharedSettings((s) => s.setProviderConfig);
  const setProviderModelPreference = useSharedSettings((s) => s.setProviderModelPreference);
  const effectiveAgentKindRef = useRef(effectiveAgentKind);
  const providerConfigsRef = useRef<Record<string, ProviderDraftConfig>>({});
  const providerModelPreferencesRef = useRef<
    Record<string, Record<string, ProviderModelPreference>>
  >({});
  const initialLastDraftConfigRef = useRef(lastDraftConfig);
  const hasLocalConfigEditRef = useRef(false);
  const hasLocalContextEditRef = useRef(false);
  effectiveAgentKindRef.current = effectiveAgentKind;
  // Spread is required: the effects below mutate `providerConfigsRef.current[kind]`
  // in place to keep effort/model selections in sync mid-render. Assigning the
  // store reference directly would mutate Zustand state and skip subscribers.
  providerConfigsRef.current = { ...useSharedSettings.getState().providerConfigs };
  providerModelPreferencesRef.current = {
    ...useSharedSettings.getState().providerModelPreferences,
  };

  function persistProviderModelPreference(providerKind: string, config: ProviderDraftConfig) {
    const preference: ProviderModelPreference = {
      ...(config.effort ? { effort: config.effort } : {}),
      ...(config.fast !== undefined ? { fast: config.fast } : {}),
    };
    providerModelPreferencesRef.current = {
      ...providerModelPreferencesRef.current,
      [providerKind]: {
        ...providerModelPreferencesRef.current[providerKind],
        [config.model]: preference,
      },
    };
    setProviderModelPreference(providerKind, config.model, preference);
  }

  function persistProviderConfig(providerKind: string, config: ProviderDraftConfig) {
    providerConfigsRef.current[providerKind] = config;
    if (!isHomeScope) {
      setProviderConfig(providerKind, config);
    }
    persistProviderModelPreference(providerKind, config);
  }

  function persistProjectDraftConfig(draftConfig: ProjectDraftConfig) {
    updateProjectDraftConfig(project.id, draftConfig);
  }

  const persistProviderConfigRef = useRef(persistProviderConfig);
  const persistProjectDraftConfigRef = useRef(persistProjectDraftConfig);
  persistProviderConfigRef.current = persistProviderConfig;
  persistProjectDraftConfigRef.current = persistProjectDraftConfig;

  function handleSwitchBranch(branch: string, createNew: boolean) {
    readBridge()
      .gitSwitchBranch({
        projectLocation: project.location,
        branch,
        createNew,
      })
      .then((result) => {
        // Immediately patch the store so the UI updates without waiting
        // for the file-watcher → refreshProject cascade.
        const store = useGitStore.getState();
        const status = store.statuses[project.id];
        if (status) {
          store.setStatus(project.id, {
            ...status,
            branch: result.branch,
            tracking: result.tracking,
            ahead: result.ahead,
            behind: result.behind,
          });
        }
      })
      .catch((err: unknown) => {
        console.error("[git] switch branch failed", err);
        toast.danger(friendlyError(err));
      });
  }

  useEffect(() => {
    if (effectiveAgentKind && agentKind !== effectiveAgentKind) {
      setAgentKind(effectiveAgentKind);
    }
  }, [agentKind, effectiveAgentKind]);

  useEffect(() => {
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }

    if (lastAppliedAgentKindRef.current === effectiveAgentKind) {
      return;
    }

    const saved = resolveSavedProviderDraftConfig(
      effectiveAgentKind,
      lastDraftConfig,
      isHomeScope ? {} : providerConfigsRef.current,
      providerModelPreferencesRef.current,
    );
    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, saved);
    const nextModel = resolved.model;
    const nextEffort = resolved.effort ?? "";
    const nextContext = resolved.contextSize;
    const nextFast = resolved.fast ?? false;
    const nextThinking = resolved.thinking ?? false;
    const nextMode = (resolved.mode ?? "agent") as "agent" | "plan" | "autopilot";
    const nextApproval = resolved.approvalPolicy ?? "";
    const nextReviewer = resolved.approvalsReviewer ?? "";
    const nextSandbox = resolved.sandboxMode ?? "";

    setModel(nextModel);
    setEffort(nextEffort);
    setContextSize(nextContext);
    setFast(nextFast);
    setThinking(nextThinking);
    setMode(nextMode);
    setApprovalPolicy(nextApproval);
    setApprovalsReviewer(nextReviewer);
    setSandboxMode(nextSandbox);
    lastAppliedAgentKindRef.current = effectiveAgentKind;

    // Persist per-provider config app-wide, last-used provider per project.
    persistProviderConfigRef.current(effectiveAgentKind, resolved);
    updateProjectDraftConfig(project.id, {
      agentKind: effectiveAgentKind,
      model: nextModel,
      effort: nextEffort,
      ...(nextContext ? { contextSize: nextContext } : {}),
      ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
      ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
      mode: nextMode,
      approvalPolicy: nextApproval,
      approvalsReviewer: nextReviewer,
      sandboxMode: nextSandbox,
      worktreeMode: effectiveWorktreeMode,
    });
  }, [
    effectiveAgentKind,
    selectedAgentForConfig,
    project.id,
    lastDraftConfig,
    effectiveWorktreeMode,
    isHomeScope,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  useEffect(() => {
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }
    if (!model) {
      return;
    }

    const nextModel = resolveModelValue(selectedAgentForConfig, model);
    const nextEffort = resolveEffortValue(selectedAgentForConfig, nextModel, effort);
    const nextContext = resolveContextSizeValue(selectedAgentForConfig, nextModel, contextSize);
    const nextFast = resolveFastValue(selectedAgentForConfig, nextModel, fast);
    const nextThinking = resolveThinkingValue(selectedAgentForConfig, nextModel, thinking);
    if (
      nextModel !== model ||
      nextEffort !== effort ||
      nextContext !== contextSize ||
      nextFast !== fast ||
      nextThinking !== thinking
    ) {
      if (nextModel !== model) setModel(nextModel);
      if (nextEffort !== effort) setEffort(nextEffort);
      if (nextContext !== contextSize) setContextSize(nextContext);
      if (nextFast !== fast) setFast(nextFast);
      if (nextThinking !== thinking) setThinking(nextThinking);

      // Persist the corrected values
      const corrected: ProviderDraftConfig = {
        ...providerConfigsRef.current?.[effectiveAgentKind],
        model: nextModel,
        effort: nextEffort,
        ...(nextContext ? { contextSize: nextContext } : {}),
        fast: nextFast,
        thinking: nextThinking,
      };
      persistProviderConfigRef.current(effectiveAgentKind, corrected);
      updateProjectDraftConfig(project.id, {
        agentKind: effectiveAgentKind,
        model: nextModel,
        effort: nextEffort,
        ...(nextContext ? { contextSize: nextContext } : {}),
        fast: nextFast,
        thinking: nextThinking,
        mode,
        approvalPolicy,
        approvalsReviewer,
        sandboxMode,
        worktreeMode: effectiveWorktreeMode,
      });
    }
  }, [
    effort,
    contextSize,
    fast,
    thinking,
    model,
    selectedAgentForConfig,
    effectiveAgentKind,
    mode,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
    effectiveWorktreeMode,
    isHomeScope,
    project.id,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  useEffect(() => {
    if (!sharedSettingsHydrated || !selectedAgentForConfig || !effectiveAgentKind || !model) {
      return;
    }
    if (hasLocalConfigEditRef.current) return;

    const settings = useSharedSettings.getState();
    providerConfigsRef.current = { ...settings.providerConfigs };
    providerModelPreferencesRef.current = { ...settings.providerModelPreferences };
    const preference = resolveProviderModelPreference(
      effectiveAgentKind,
      model,
      settings.providerConfigs,
      settings.providerModelPreferences,
    );
    if (!preference) return;

    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, {
      model,
      ...(preference.effort !== undefined ? { effort: preference.effort } : {}),
      ...(contextSize ? { contextSize } : {}),
      ...(preference.fast !== undefined ? { fast: preference.fast } : {}),
      thinking,
      mode,
      approvalPolicy,
      approvalsReviewer,
      sandboxMode,
    });
    const nextEffort = resolved.effort ?? "";
    const nextFast = resolved.fast ?? false;
    if (nextEffort === effort && nextFast === fast) return;

    setEffort(nextEffort);
    setFast(nextFast);
    const corrected: ProviderDraftConfig = {
      model,
      effort: nextEffort,
      ...(contextSize ? { contextSize } : {}),
      ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
      ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
      mode,
      approvalPolicy,
      approvalsReviewer,
      sandboxMode,
    };
    persistProviderConfigRef.current(effectiveAgentKind, corrected);
    persistProjectDraftConfigRef.current({
      agentKind: effectiveAgentKind,
      ...corrected,
      worktreeMode: effectiveWorktreeMode,
    });
  }, [
    sharedSettingsHydrated,
    selectedAgentForConfig,
    effectiveAgentKind,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    mode,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
    effectiveWorktreeMode,
  ]);

  useEffect(() => {
    if (isHomeScope || !sharedSettingsHydrated) {
      return;
    }
    if (!selectedAgentForConfig || !effectiveAgentKind) {
      return;
    }
    const initialLastDraftConfig = initialLastDraftConfigRef.current;
    const hasInitialProjectDraft =
      initialLastDraftConfig?.agentKind === effectiveAgentKind &&
      Boolean(initialLastDraftConfig.model.trim());
    const hasInitialContext = hasInitialProjectDraft && Boolean(initialLastDraftConfig.contextSize);
    const shouldInheritContext = !hasInitialContext && !hasLocalContextEditRef.current;
    if (hasLocalConfigEditRef.current && !shouldInheritContext) {
      return;
    }
    if (hasInitialContext) {
      return;
    }

    const providerConfigs = useSharedSettings.getState().providerConfigs;
    const providerModelPreferences = useSharedSettings.getState().providerModelPreferences;
    const providerConfig = providerConfigs[effectiveAgentKind];
    if (!providerConfig) {
      return;
    }
    providerConfigsRef.current = { ...providerConfigs };
    providerModelPreferencesRef.current = { ...providerModelPreferences };

    if (hasLocalConfigEditRef.current) {
      const nextContext = resolveContextSizeValue(
        selectedAgentForConfig,
        model,
        providerConfig.contextSize,
      );
      if (nextContext === contextSize) {
        return;
      }
      setContextSize(nextContext);
      updateProjectDraftConfig(project.id, {
        agentKind: effectiveAgentKind,
        model,
        effort,
        ...(nextContext ? { contextSize: nextContext } : {}),
        ...(supportsUsableFastMode(selectedAgentForConfig.capabilities, model) ? { fast } : {}),
        ...(selectedAgentForConfig.capabilities.thinkingModels?.includes(model)
          ? { thinking }
          : {}),
        mode,
        approvalPolicy,
        approvalsReviewer,
        sandboxMode,
        worktreeMode: effectiveWorktreeMode,
      });
      return;
    }

    const saved = resolveSavedProviderDraftConfig(
      effectiveAgentKind,
      hasInitialProjectDraft ? initialLastDraftConfig : undefined,
      providerConfigs,
      providerModelPreferences,
    );
    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, saved);
    const nextModel = resolved.model;
    const nextEffort = resolved.effort ?? "";
    const nextContext = resolved.contextSize;
    const nextFast = resolved.fast ?? false;
    const nextThinking = resolved.thinking ?? false;
    const nextMode = (resolved.mode ?? "agent") as "agent" | "plan" | "autopilot";
    const nextApproval = resolved.approvalPolicy ?? "";
    const nextReviewer = resolved.approvalsReviewer ?? "";
    const nextSandbox = resolved.sandboxMode ?? "";

    if (
      nextModel === model &&
      nextEffort === effort &&
      nextContext === contextSize &&
      nextFast === fast &&
      nextThinking === thinking &&
      nextMode === mode &&
      nextApproval === approvalPolicy &&
      nextReviewer === approvalsReviewer &&
      nextSandbox === sandboxMode
    ) {
      return;
    }

    setModel(nextModel);
    setEffort(nextEffort);
    setContextSize(nextContext);
    setFast(nextFast);
    setThinking(nextThinking);
    setMode(nextMode);
    setApprovalPolicy(nextApproval);
    setApprovalsReviewer(nextReviewer);
    setSandboxMode(nextSandbox);
    lastAppliedAgentKindRef.current = effectiveAgentKind;

    if (
      !hasInitialProjectDraft &&
      (providerConfig.model !== nextModel ||
        providerConfig.effort !== nextEffort ||
        providerConfig.contextSize !== nextContext ||
        providerConfig.fast !== nextFast ||
        providerConfig.thinking !== nextThinking ||
        providerConfig.mode !== nextMode ||
        providerConfig.approvalPolicy !== nextApproval ||
        providerConfig.approvalsReviewer !== nextReviewer ||
        providerConfig.sandboxMode !== nextSandbox)
    ) {
      persistProviderConfigRef.current(effectiveAgentKind, resolved);
    }

    updateProjectDraftConfig(project.id, {
      agentKind: effectiveAgentKind,
      model: nextModel,
      effort: nextEffort,
      ...(nextContext ? { contextSize: nextContext } : {}),
      ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
      ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
      mode: nextMode,
      approvalPolicy: nextApproval,
      approvalsReviewer: nextReviewer,
      sandboxMode: nextSandbox,
      worktreeMode: effectiveWorktreeMode,
    });
  }, [
    sharedSettingsHydrated,
    selectedAgentForConfig,
    effectiveAgentKind,
    lastDraftConfig,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    mode,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
    project.id,
    effectiveWorktreeMode,
    isHomeScope,
    updateProjectDraftConfig,
    setProviderConfig,
  ]);

  const hiddenModelIds = useSharedSettings((s) =>
    selectedAgent
      ? s.hiddenModels[
          modelVisibilityKey(
            selectedAgent.kind,
            presentationMode,
            selectedAgentForConfig?.capabilities.runtimeLabel,
          )
        ]
      : undefined,
  );
  const allHiddenModels = useSharedSettings((s) => s.hiddenModels);
  const usageAccounts = useUsageAccountsStore((s) => s.accounts);
  const selectedAgentFilteredCapabilities = useMemo(
    () =>
      selectedAgentForConfig
        ? filterHiddenModels(selectedAgentForConfig.capabilities, hiddenModelIds)
        : undefined,
    [selectedAgentForConfig, hiddenModelIds],
  );
  const providerModelProviders = useMemo(() => {
    const baseProviders = buildProviderModelMenuProviders(installedAgents, {
      resolvePresentationMode: (agent) => {
        const supported = agent.capabilities.presentationModes ?? [
          agent.capabilities.presentationMode,
        ];
        return supported.includes(presentationMode)
          ? presentationMode
          : resolveInitialPresentationMode(agent, lastPresentationModeByAgent);
      },
      hiddenModelsByAgent: allHiddenModels,
    }).map((provider) => ({
      ...provider,
      // 普通自定义模型属于 adapter；带 accountId 的模型由独立渠道承载。
      capabilities: mergeCustomModelsIntoCapabilities(
        provider.kind,
        provider.capabilities,
        customModels,
      ),
    }));
    const accountGroups = new Map<string, typeof customModels>();
    for (const entry of customModels) {
      if (!entry.accountId) continue;
      accountGroups.set(entry.accountId, [...(accountGroups.get(entry.accountId) ?? []), entry]);
    }
    const accountProviders = [...accountGroups].flatMap(([accountId, models]) => {
      const source =
        baseProviders.find(
          (provider) =>
            provider.kind === models[0]?.provider && provider.presentationMode === "gui",
        ) ?? baseProviders.find((provider) => provider.kind === models[0]?.provider);
      if (!source) return [];
      const account = usageAccounts.find((candidate) => candidate.accountId === accountId);
      const label =
        models[0]?.channelLabel ?? account?.providerAccountId ?? account?.label ?? "第三方 API";
      return [
        {
          ...source,
          label,
          accountId,
          modelPickerKey: `openai-compatible:${accountId}`,
          hiddenModelsKey: `openai-compatible:${accountId}`,
          capabilities: {
            ...source.capabilities,
            models: models.map((entry) => ({ id: entry.modelId, label: entry.displayName })),
          },
        },
      ];
    });
    return [...baseProviders, ...accountProviders];
  }, [
    installedAgents,
    presentationMode,
    lastPresentationModeByAgent,
    allHiddenModels,
    customModels,
    usageAccounts,
  ]);
  const latestConfigPatchRef = useRef<(patch: Partial<ThreadConfig>) => void>(() => undefined);
  const latestProviderModelChangeRef = useRef<
    (next: {
      agentKind: string;
      model: string;
      presentationMode?: ThreadPresentationMode;
      accountId?: string;
    }) => void
  >(() => undefined);
  // A single menu action can update mode and permission in two consecutive
  // callbacks before React renders again. Keep an eagerly updated snapshot so
  // the second patch builds on the first instead of restoring stale state from
  // this render's closure (for example, restoring `plan` after selecting Full access).
  draftConfigRef.current = {
    model,
    effort,
    ...(contextSize ? { contextSize } : {}),
    fast,
    thinking,
    mode,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
  };
  const onConfigPatch = (patch: Partial<ThreadConfig>) => {
    if ("browserMcp" in patch) {
      // Per-draft mention flag — not part of ProviderDraftConfig, so it bypasses
      // the resolver/persistence below. Set by an `@browser` mention, cleared by
      // removing its composer chip.
      setBrowserMcpMention(patch.browserMcp === true);
      return;
    }
    if ("crossagentMcp" in patch) {
      // Per-draft mention flag — same bypass as browserMcp above.
      setCrossagentMcpMention(patch.crossagentMcp === true);
      return;
    }
    if ("chromeMcp" in patch) {
      // Per-draft mention flag — same bypass as browserMcp above.
      setChromeMcpMention(patch.chromeMcp === true);
      return;
    }
    if ("computerUse" in patch) {
      // Per-draft mention flag — same bypass as browserMcp above.
      setComputerUseMention(patch.computerUse === true);
      return;
    }
    if (!selectedAgentForConfig) return;
    hasLocalConfigEditRef.current = true;
    if ("contextSize" in patch) {
      hasLocalContextEditRef.current = true;
    }
    const current = draftConfigRef.current;
    const resolved = resolveProviderDraftConfig(selectedAgentForConfig, {
      model: patch.model ?? current?.model ?? model,
      effort: patch.effort ?? current?.effort ?? effort,
      ...(patch.contextSize !== undefined
        ? { contextSize: patch.contextSize }
        : { contextSize: current?.contextSize ?? contextSize }),
      ...(patch.fast !== undefined ? { fast: patch.fast } : { fast: current?.fast ?? fast }),
      ...(patch.thinking !== undefined
        ? { thinking: patch.thinking }
        : { thinking: current?.thinking ?? thinking }),
      mode: patch.mode ?? current?.mode ?? mode,
      approvalPolicy: patch.approvalPolicy ?? current?.approvalPolicy ?? approvalPolicy,
      approvalsReviewer: patch.approvalsReviewer ?? current?.approvalsReviewer ?? approvalsReviewer,
      sandboxMode: patch.sandboxMode ?? current?.sandboxMode ?? sandboxMode,
    });
    draftConfigRef.current = resolved;

    setModel(resolved.model);
    setEffort(resolved.effort ?? "");
    setContextSize(resolved.contextSize);
    setFast(resolved.fast ?? false);
    setThinking(resolved.thinking ?? false);
    setMode((resolved.mode ?? "agent") as "agent" | "plan" | "autopilot");
    setApprovalPolicy(resolved.approvalPolicy ?? "");
    setApprovalsReviewer(resolved.approvalsReviewer ?? "");
    setSandboxMode(resolved.sandboxMode ?? "");

    // Keep local state and persisted config in one transaction so menu
    // selection animations do not receive a second delayed state update.
    if (effectiveAgentKind) {
      if (providerConfigsRef.current) {
        providerConfigsRef.current[effectiveAgentKind] = resolved;
      }
      persistProviderConfig(effectiveAgentKind, resolved);
      persistProjectDraftConfig({
        agentKind: effectiveAgentKind,
        model: resolved.model,
        effort: resolved.effort,
        ...(resolved.contextSize ? { contextSize: resolved.contextSize } : {}),
        ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
        ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
        mode: resolved.mode,
        approvalPolicy: resolved.approvalPolicy,
        approvalsReviewer: resolved.approvalsReviewer,
        sandboxMode: resolved.sandboxMode,
        worktreeMode: effectiveWorktreeMode,
      });
    }
  };
  latestConfigPatchRef.current = onConfigPatch;

  latestProviderModelChangeRef.current = ({
    agentKind: nextKind,
    model: nextModel,
    presentationMode: nextPresentationMode,
    accountId: nextAccountId,
  }) => {
    if (!selectedAgent || !selectedAgentForConfig) return;
    hasLocalConfigEditRef.current = true;
    const targetPresentationMode = nextPresentationMode ?? presentationMode;
    setSelectedAccountId(nextAccountId);
    if (nextAccountId) useUsageAccountsStore.getState().setNextSessionAccount(nextAccountId);
    else useUsageAccountsStore.getState().clearNextSessionAccount();
    if (targetPresentationMode !== presentationMode) {
      setPresentationMode(targetPresentationMode);
    }
    if (nextKind !== selectedAgent.kind) {
      const targetAgent = installedAgents.find((agent) => agent.kind === nextKind);
      if (!targetAgent) return;
      const targetSurface = providerModelProviders.find(
        (provider) =>
          provider.kind === nextKind &&
          provider.accountId === nextAccountId &&
          provider.presentationMode === targetPresentationMode,
      );
      const targetAgentForConfig = {
        ...agentWithCapabilities(targetAgent, targetPresentationMode),
        ...(targetSurface ? { capabilities: targetSurface.capabilities } : {}),
      };

      if (effectiveAgentKind) {
        const snapshot: ProviderDraftConfig = {
          model,
          effort,
          ...(contextSize ? { contextSize } : {}),
          fast,
          thinking,
          mode,
          approvalPolicy,
          approvalsReviewer,
          sandboxMode,
        };
        persistProviderConfig(effectiveAgentKind, snapshot);
      }
      const targetSaved = isHomeScope ? undefined : providerConfigsRef.current[nextKind];
      const targetPreference = resolveProviderModelPreference(
        nextKind as AgentStatus["kind"],
        nextModel,
        providerConfigsRef.current,
        providerModelPreferencesRef.current,
      );
      const targetBase = { ...targetSaved };
      delete targetBase.effort;
      delete targetBase.fast;
      const resolved = resolveProviderDraftConfig(targetAgentForConfig, {
        ...targetBase,
        model: nextModel,
        ...(targetPreference?.effort !== undefined ? { effort: targetPreference.effort } : {}),
        ...(targetPreference?.fast !== undefined ? { fast: targetPreference.fast } : {}),
      });
      persistProviderConfig(nextKind, resolved);
      setModel(resolved.model);
      setEffort(resolved.effort ?? "");
      setContextSize(resolved.contextSize);
      setFast(resolved.fast ?? false);
      setThinking(resolved.thinking ?? false);
      setMode((resolved.mode ?? "agent") as "agent" | "plan" | "autopilot");
      setApprovalPolicy(resolved.approvalPolicy ?? "");
      setApprovalsReviewer(resolved.approvalsReviewer ?? "");
      setSandboxMode(resolved.sandboxMode ?? "");
      lastAppliedAgentKindRef.current = nextKind as AgentStatus["kind"];
      setAgentKind(nextKind as AgentStatus["kind"]);
      persistProjectDraftConfig({
        agentKind: nextKind as AgentStatus["kind"],
        model: resolved.model,
        effort: resolved.effort,
        ...(resolved.contextSize ? { contextSize: resolved.contextSize } : {}),
        ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
        ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
        mode: resolved.mode,
        approvalPolicy: resolved.approvalPolicy,
        approvalsReviewer: resolved.approvalsReviewer,
        sandboxMode: resolved.sandboxMode,
        worktreeMode: effectiveWorktreeMode,
      });
    } else {
      const targetCapabilities =
        providerModelProviders.find(
          (provider) => provider.kind === nextKind && provider.accountId === nextAccountId,
        )?.capabilities ?? selectedAgentForConfig.capabilities;
      const modelPreference = resolveProviderModelPreference(
        effectiveAgentKind as AgentStatus["kind"],
        nextModel,
        providerConfigsRef.current,
        providerModelPreferencesRef.current,
      );
      const modelPatch = patchConfigForModelChange(targetCapabilities, nextModel, {
        ...(modelPreference?.effort !== undefined ? { effort: modelPreference.effort } : {}),
        ...(contextSize ? { contextSize } : {}),
        ...(modelPreference?.fast !== undefined ? { fast: modelPreference.fast } : {}),
      });
      const resolved = resolveProviderDraftConfig(
        { ...selectedAgentForConfig, capabilities: targetCapabilities },
        {
          ...(draftConfigRef.current ?? {}),
          ...modelPatch,
        },
      );
      draftConfigRef.current = resolved;
      setModel(resolved.model);
      setEffort(resolved.effort ?? "");
      setContextSize(resolved.contextSize);
      setFast(resolved.fast ?? false);
      setThinking(resolved.thinking ?? false);
      setMode((resolved.mode ?? "agent") as "agent" | "plan" | "autopilot");
      setApprovalPolicy(resolved.approvalPolicy ?? "");
      setApprovalsReviewer(resolved.approvalsReviewer ?? "");
      setSandboxMode(resolved.sandboxMode ?? "");
      if (effectiveAgentKind) {
        persistProviderConfig(effectiveAgentKind, resolved);
        persistProjectDraftConfig({
          agentKind: effectiveAgentKind,
          model: resolved.model,
          effort: resolved.effort,
          ...(resolved.contextSize ? { contextSize: resolved.contextSize } : {}),
          ...(resolved.fast !== undefined ? { fast: resolved.fast } : {}),
          ...(resolved.thinking !== undefined ? { thinking: resolved.thinking } : {}),
          mode: resolved.mode,
          approvalPolicy: resolved.approvalPolicy,
          approvalsReviewer: resolved.approvalsReviewer,
          sandboxMode: resolved.sandboxMode,
          worktreeMode: effectiveWorktreeMode,
        });
      }
    }
  };

  const baseDraftControls = useMemo(() => {
    if (!selectedAgent || !selectedAgentForConfig) return [];
    const filteredCaps = selectedAgentFilteredCapabilities ?? selectedAgentForConfig.capabilities;
    return buildModelPickerControls({
      providers: providerModelProviders,
      selectedAgentKind: selectedAgent.kind,
      ...(selectedAccountId ? { selectedAccountId } : {}),
      model,
      effort,
      ...(contextSize ? { contextSize } : {}),
      fast,
      thinking,
      capabilities: filteredCaps,
      presentationMode,
      onProviderModelChange: (next) => latestProviderModelChangeRef.current(next),
      onConfigPatch: (patch) => latestConfigPatchRef.current(patch),
    });
  }, [
    selectedAgent,
    selectedAgentForConfig,
    selectedAgentFilteredCapabilities,
    providerModelProviders,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    presentationMode,
    selectedAccountId,
  ]);

  const providerDraftControls = useMemo(() => {
    if (!selectedAgent || !selectedAgentForConfig) return [];
    const filteredCaps = selectedAgentFilteredCapabilities ?? selectedAgentForConfig.capabilities;
    return appendProviderComposerControls([], {
      agentKind: selectedAgent.kind,
      capabilities: filteredCaps,
      config: {
        model,
        effort,
        ...(contextSize ? { contextSize } : {}),
        ...(fast ? { fast } : {}),
        ...(thinking ? { thinking } : {}),
        mode,
        approvalPolicy,
        approvalsReviewer,
        sandboxMode,
      },
      presentationMode,
      isDisabled: false,
      onConfigChange: (patch) => latestConfigPatchRef.current(patch),
    });
  }, [
    selectedAgent,
    selectedAgentForConfig,
    selectedAgentFilteredCapabilities,
    model,
    effort,
    contextSize,
    fast,
    thinking,
    mode,
    approvalPolicy,
    approvalsReviewer,
    sandboxMode,
    presentationMode,
  ]);

  const draftControls = useMemo(
    () => [...baseDraftControls, ...providerDraftControls],
    [baseDraftControls, providerDraftControls],
  );

  // Stable centering for the full (non-compact) draft view: center once, then
  // pin the input's top edge so the composer no longer jumps when it grows.
  // Declared before the early returns below to keep hook order consistent.
  const anchorContainerRef = useRef<HTMLDivElement>(null);
  const anchorBlockRef = useRef<HTMLDivElement>(null);
  const anchorSpacerRef = useRef<HTMLDivElement>(null);
  // v0.2.7: the Codex-style home pins the composer at the bottom and centers
  // the hero in the free space above it, so the old "centered then anchored"
  // spacer system is disabled for the draft home.
  useStableComposerAnchor({
    enabled: false,
    containerRef: anchorContainerRef,
    blockRef: anchorBlockRef,
    spacerRef: anchorSpacerRef,
  });

  if (remoteConnection === "connecting" && !hostUpdateRestarting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <PixelLoader size="md" />
        <p className="text-sm text-muted">
          <Trans>Connecting…</Trans>
        </p>
      </div>
    );
  }
  if (!hostUpdateRestarting && remoteConnection !== "local" && remoteConnection !== "online") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans>Connection error</Trans>
        </h1>
        <p className="text-muted">
          {remoteConnectionMessage ?? (
            <Trans>This project's remote server is offline. Reconnect it to start a thread.</Trans>
          )}
        </p>
      </div>
    );
  }

  if (!selectedAgent) {
    if (props.isDetectingAgents) {
      // First-launch fancy reveal: tiles fade in as `agent-detected` events
      // arrive. Subsequent reloads (cache present, but the user opted out of
      // every agent or none are installed) fall back to the lightweight
      // pixel loader.
      if (showAgentDiscovery) {
        return <AgentDiscoveryScreen location={project.location} />;
      }
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <PixelLoader size="md" />
          <p className="text-sm text-muted">
            <Trans>Detecting agents…</Trans>
          </p>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans>No supported agents detected</Trans>
        </h1>
        <p className="text-muted">
          <Trans>
            Install {formatAgentList(props.agentStatuses.map((s) => s.label))} to create a thread.
          </Trans>
        </p>
      </div>
    );
  }

  const alignClass =
    props.paneAlign === "right" ? "ml-auto" : props.paneAlign === "left" ? "mr-auto" : "mx-auto";
  const paddingClass = "px-2";
  const compactComposer = props.compact || props.quickComposer;
  // The quick-composer surface renders width-hugging chrome-free, so it opts out
  // of the full-height sizing, max-widths, and padding the standard/compact views use.
  const rootSizeClass = props.quickComposer ? "w-full" : "h-full min-h-0";
  const bodySizeClass = props.quickComposer ? "w-full" : "h-full min-h-0 w-full max-w-[1040px]";
  const bodyPaddingClass = props.quickComposer
    ? ""
    : `${paddingClass} px-3 pb-2 ${props.compact ? "" : "pt-2"}`;
  const blockMaxWidthClass = props.quickComposer ? "" : "max-w-[720px]";

  const handleCraftModeChange = (next: CraftMode) => {
    setCraftMode(next);
    if (next === "auto") return;
    usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting", entryMode: next });
  };

  // Effective launch flag for each composer MCP: a per-draft `@`-mention OR a
  // persistent standing default whose scope the current provider/presentation
  // actually supports. A persistent enable with a "none" scope must NOT set the
  // config flag — otherwise the composer would show a phantom "on" state and the
  // scope-reset effect there would fight it.
  const hostPlatform = readBridge()?.platform;
  const effectiveMcp = (id: BuiltInMcpServerId, mention: boolean, scope: string) =>
    scope !== "none" &&
    disabledBuiltInMcpServers[id] !== true &&
    (mention || enabledMcpServers[id] === true);
  const effectiveBrowserMcp = effectiveMcp(
    "browser",
    browserMcpMention,
    browserMcpServer.getScope(selectedAgent.capabilities, presentationMode, project.location),
  );
  const effectiveCrossagentMcp = effectiveMcp(
    "crossagents",
    crossagentMcpMention,
    crossagentMcpServer.getScope(selectedAgent.capabilities, presentationMode, project.location),
  );
  const effectiveChromeMcp = effectiveMcp(
    "chrome",
    chromeMcpMention,
    chromeMcpServer.getScope(selectedAgent.capabilities, presentationMode, project.location),
  );
  const effectiveComputerUse = effectiveMcp(
    COMPUTER_USE_MCP_ID,
    computerUseMention,
    getComputerUseScope(
      selectedAgent.capabilities,
      presentationMode,
      project.location,
      hostPlatform,
    ),
  );

  return (
    <div
      ref={props.droppableRef}
      className={`relative flex ${rootSizeClass} flex-col ${props.isDragging ? "opacity-50" : ""}`}
    >
      <ThreadDraftDropIndicators dropIndicator={props.dropIndicator} />
      {props.compact && !props.quickComposer && (
        <ThreadDraftCompactHeader
          alignClass={alignClass}
          dragHandleRef={props.dragHandleRef}
          headerNeedsTrafficLightPad={headerNeedsTrafficLightPad}
          onClose={props.onClose}
          projectId={project.id}
          {...(scopeLabel ? { scopeLabel } : {})}
          {...(props.paneId ? { paneId: props.paneId } : {})}
          showCloseButton={props.showCloseButton}
        />
      )}
      <div
        ref={compactComposer ? undefined : anchorContainerRef}
        data-draft-body=""
        className={`${compactComposer ? alignClass : "mx-auto"} relative flex ${bodySizeClass} flex-col ${bodyPaddingClass}`}
      >
        {props.quickComposer ? null : props.compact ? (
          <ThreadDraftHero compact={props.compact} />
        ) : (
          // Codex home: mascot + greeting + suggestion cards centered in the
          // free space above the bottom-pinned composer.
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <DraftHomeHero />
          </div>
        )}

        {/* Composer block: centered initially, then anchored by the input's top edge. */}
        <div
          ref={compactComposer ? undefined : anchorBlockRef}
          className={`${compactComposer ? alignClass : "mx-auto shrink-0"} w-full ${blockMaxWidthClass} ${props.quickComposer ? "quick-composer-control-surface" : ""}`}
        >
          {!props.compact && !props.quickComposer ? null : (
            <div data-draft-controls="" className="mb-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ProjectSwitchMenu
                  currentProjectId={project.id}
                  variant="compact"
                  {...(props.paneId ? { paneId: props.paneId } : {})}
                  {...(props.onProjectChange ? { onSelectProject: props.onProjectChange } : {})}
                />
              </div>
            </div>
          )}
          {props.compact || props.quickComposer ? (
            <ThreadDraftComposerArea
              project={project}
              isRemote={project.remoteServerId !== undefined}
              {...(props.paneId ? { paneId: props.paneId } : {})}
              {...(props.restoreWorktreeSelectionToken !== undefined
                ? { restoreWorktreeSelectionToken: props.restoreWorktreeSelectionToken }
                : {})}
              selectedAgent={selectedAgentForConfig ?? selectedAgent}
              controls={draftControls}
              config={{
                model,
                ...(effort ? { effort } : {}),
                ...(contextSize ? { contextSize } : {}),
                ...(selectedAgentForConfig &&
                supportsUsableFastMode(selectedAgentForConfig.capabilities, model)
                  ? { fast }
                  : {}),
                ...(thinking ? { thinking } : {}),
                ...(mode ? { mode } : {}),
                ...(approvalPolicy ? { approvalPolicy } : {}),
                ...(approvalsReviewer ? { approvalsReviewer } : {}),
                ...(sandboxMode ? { sandboxMode } : {}),
                ...(effectiveBrowserMcp ? { browserMcp: true } : {}),
                ...(effectiveCrossagentMcp ? { crossagentMcp: true } : {}),
                ...(effectiveChromeMcp ? { chromeMcp: true } : {}),
                ...(effectiveComputerUse ? { computerUse: true } : {}),
              }}
              compact={compactComposer}
              paneCount={props.paneCount}
              gitBranch={gitBranch}
              worktreeMode={effectiveWorktreeMode}
              presentationMode={presentationMode}
              {...(props.composerPlaceholder ? { placeholder: props.composerPlaceholder } : {})}
              {...(props.submitOnEnter !== undefined ? { submitOnEnter: props.submitOnEnter } : {})}
              {...(props.pickFiles ? { pickFiles: props.pickFiles } : {})}
              {...(props.saveClipboardImage
                ? { saveClipboardImage: props.saveClipboardImage }
                : {})}
              onConfigChange={onConfigPatch}
              onWorktreeModeChange={setWorktreeMode}
              onSwitchBranch={handleSwitchBranch}
              onStart={onStart}
            />
          ) : (
            <UniversalDockedChatInput
              project={project}
              placement="home"
              craftMode={craftMode}
              onCraftModeChange={handleCraftModeChange}
              {...(props.paneId ? { paneId: props.paneId } : {})}
              {...(props.onProjectChange ? { onProjectChange: props.onProjectChange } : {})}
            >
              <ThreadDraftComposerArea
                project={project}
                isRemote={project.remoteServerId !== undefined}
                {...(props.paneId ? { paneId: props.paneId } : {})}
                {...(props.restoreWorktreeSelectionToken !== undefined
                  ? { restoreWorktreeSelectionToken: props.restoreWorktreeSelectionToken }
                  : {})}
                selectedAgent={selectedAgentForConfig ?? selectedAgent}
                controls={draftControls}
                config={{
                  model,
                  ...(effort ? { effort } : {}),
                  ...(contextSize ? { contextSize } : {}),
                  ...(selectedAgentForConfig &&
                  supportsUsableFastMode(selectedAgentForConfig.capabilities, model)
                    ? { fast }
                    : {}),
                  ...(thinking ? { thinking } : {}),
                  ...(mode ? { mode } : {}),
                  ...(approvalPolicy ? { approvalPolicy } : {}),
                  ...(approvalsReviewer ? { approvalsReviewer } : {}),
                  ...(sandboxMode ? { sandboxMode } : {}),
                  ...(effectiveBrowserMcp ? { browserMcp: true } : {}),
                  ...(effectiveCrossagentMcp ? { crossagentMcp: true } : {}),
                  ...(effectiveChromeMcp ? { chromeMcp: true } : {}),
                  ...(effectiveComputerUse ? { computerUse: true } : {}),
                }}
                compact={compactComposer}
                paneCount={props.paneCount}
                gitBranch={gitBranch}
                worktreeMode={effectiveWorktreeMode}
                presentationMode={presentationMode}
                {...(props.composerPlaceholder ? { placeholder: props.composerPlaceholder } : {})}
                {...(props.submitOnEnter !== undefined
                  ? { submitOnEnter: props.submitOnEnter }
                  : {})}
                {...(props.pickFiles ? { pickFiles: props.pickFiles } : {})}
                {...(props.saveClipboardImage
                  ? { saveClipboardImage: props.saveClipboardImage }
                  : {})}
                onConfigChange={onConfigPatch}
                onWorktreeModeChange={setWorktreeMode}
                onSwitchBranch={handleSwitchBranch}
                onStart={onStart}
              />
            </UniversalDockedChatInput>
          )}
        </div>
      </div>
    </div>
  );
}
