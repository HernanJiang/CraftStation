import { msg } from "@lingui/core/macro";
import { toast } from "@heroui/react";
import { getProjectAgentStatuses, resolveAgentPresentationMode } from "@/shared/agentStatus";
import { applyHomeScopePermissions } from "@/shared/agents/unrestrictedPermissions";
import type {
  Project,
  ProjectLocation,
  PromptSegment,
  TerminalSize,
  Thread,
  ThreadConfig,
  ThreadPresentationMode,
} from "@/shared/contracts";
import {
  DEFAULT_TERMINAL_SIZE,
  isMcpServerSupportedByRuntime,
  resolveComposerMcpScope,
  resolveMcpLaunchSnapshot,
  supportsMcpAtProjectLocation,
} from "@/shared/contracts";
import { isHomeProject, isHomeProjectId } from "@/shared/homeScope";
import { resolveProjectLocation } from "@/shared/worktree";
import { friendlyError } from "@/shared/messages";
import { buildGoalContextText, isCodexNativeGoalAgent } from "@/shared/threadGoal";
import { buildPromptContentBlocks } from "@/shared/promptContent";
import { titlePromptFromSegments } from "@/shared/threadTitle";
import { captureThreadPromptSubmitted, captureThreadStarted } from "@/renderer/analytics/posthog";
import { readBridge } from "@/renderer/bridge";
import type { DraftStartInput } from "@/renderer/components/thread/ThreadDraftComposerArea";
import { i18n } from "@/renderer/i18n/i18n";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useAppStore } from "@/renderer/state/appStore";
import { findExperimentByGroupId } from "@/renderer/state/experimentStore";
import { captureFileCheckpoint } from "@/renderer/state/fileCheckpointActions";
import { refreshGitProject } from "@/renderer/state/gitRefresh";
import { unprojectProjectLocation } from "@/renderer/remoteProcedureRouter";
import { remoteOwner, remoteThreadId } from "@/renderer/state/remoteProjection";
import { isRemoteProjectUnreachable } from "@/renderer/state/remoteServers/reachability";
import { useRemoteServersStore } from "@/renderer/state/remoteServersStore";
import type { RemoteThreadLaunchResult } from "@/renderer/state/remoteServers/types";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { resolveThirdPartyAccountForLaunch } from "@/shared/thirdPartyRouting";
import { generateTitleAsync } from "@/renderer/utils/titleGen";
import { buildProjectDraftConfig } from "@/renderer/views/MainView/parts/AppContent/draftConfig";
import {
  createWorktree,
  primeWorktreeGitState,
  runWorktreeSetupScript,
} from "./worktreeLaunchActions";
import { performWorktreeRemoval } from "./worktreeActions";
import { readSessionHandoffState } from "./sessionHandoffActions";
import { setThreadGoalPrompt } from "./threadActions";

export async function performInitialThreadLaunch(input: {
  thread: Thread;
  projectLocation: ProjectLocation;
  prompt: string;
  segments?: PromptSegment[];
  userMessageItemId?: string;
  initialSize: TerminalSize;
}): Promise<void> {
  const { thread, projectLocation, prompt, segments, userMessageItemId, initialSize } = input;
  const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
  const agentStatus = getProjectAgentStatuses(
    projectLocation,
    agentStatuses,
    wslAgentStatuses,
  ).find((status) => status.kind === thread.agentKind);
  const presentation = agentStatus
    ? resolveAgentPresentationMode(agentStatus.capabilities, thread.presentationMode)
    : (thread.presentationMode ?? "terminal");
  if (presentation !== thread.presentationMode) {
    useAppStore.getState().updateThreadPresentationMode(thread.id, presentation);
  }
  const effectiveThread =
    presentation === thread.presentationMode
      ? thread
      : { ...thread, presentationMode: presentation };
  if (effectiveThread.config.model) {
    useSharedSettings
      .getState()
      .pushRecentModel(
        effectiveThread.agentKind,
        effectiveThread.config.model,
        presentation,
        effectiveThread.config.effort,
        effectiveThread.config.fast,
      );
  }

  if (
    !remoteOwner(effectiveThread) &&
    effectiveThread.sessionRef?.providerSessionId &&
    (await resumeCraftedThread({ thread: effectiveThread, projectLocation, prompt }))
  ) {
    captureThreadStarted(effectiveThread);
    if (prompt.length > 0 || (segments?.length ?? 0) > 0) {
      captureThreadPromptSubmitted(effectiveThread, prompt, segments, "initial");
    }
    return;
  }

  const optimisticUserMessageItemId =
    userMessageItemId ?? appendOptimisticInitialUserMessage(effectiveThread, prompt, segments);
  if (optimisticUserMessageItemId) {
    useAppStore.getState().updateThreadRuntime(effectiveThread.id, {
      status: "working",
      attention: "working",
      canResumeWithConfig: effectiveThread.canResumeWithConfig,
      ...(effectiveThread.sessionRef ? { sessionRef: effectiveThread.sessionRef } : {}),
    });
  }

  if (optimisticUserMessageItemId && !isHomeProjectId(effectiveThread.projectId)) {
    await captureFileCheckpoint({
      threadId: effectiveThread.id,
      checkpointItemId: optimisticUserMessageItemId,
      projectLocation,
    });
  }

  const sharedSettings = useSharedSettings.getState();
  const projectMcpServers =
    useAppStore.getState().projects.find((project) => project.id === effectiveThread.projectId)
      ?.mcpServers ?? [];
  const mcpLaunchSnapshot = resolveMcpLaunchSnapshot(sharedSettings, projectMcpServers);
  const runtimeSupportsMcp =
    !agentStatus ||
    (supportsMcpAtProjectLocation(agentStatus.capabilities, projectLocation) &&
      resolveComposerMcpScope(agentStatus.capabilities.mcpScope, presentation) !== "none");
  useAppStore
    .getState()
    .setThreadMcpLaunchCustomServerNames(
      effectiveThread.id,
      runtimeSupportsMcp
        ? mcpLaunchSnapshot.mcpServers
            .filter((server) =>
              agentStatus ? isMcpServerSupportedByRuntime(server, agentStatus.capabilities) : true,
            )
            .map((server) => server.name)
        : [],
    );

  // Local and remote launches share one payload; only the transport differs.
  // Third-party models carry their validated account binding explicitly so the
  // supervisor bypasses the subscription pool (never "No usable X account").
  const pendingAccountId = useUsageAccountsStore.getState().nextSessionAccountId ?? undefined;
  const thirdPartyAccountId = resolveThirdPartyAccountForLaunch({
    agentKind: effectiveThread.agentKind,
    model: effectiveThread.config.model,
    customModels: useSharedSettings.getState().customModels ?? [],
    accounts: useUsageAccountsStore.getState().accounts ?? [],
    ...(effectiveThread.accountBinding?.accountId
      ? { explicitAccountId: effectiveThread.accountBinding.accountId }
      : pendingAccountId
        ? { explicitAccountId: pendingAccountId }
        : {}),
  });
  const startInput = {
    agentKind: effectiveThread.agentKind,
    ...(effectiveThread.agentInstanceId
      ? { agentInstanceId: effectiveThread.agentInstanceId }
      : {}),
    config: effectiveThread.config,
    prompt,
    ...(segments ? { segments } : {}),
    initialSize,
    ...(effectiveThread.sessionRef ? { sessionRef: effectiveThread.sessionRef } : {}),
    ...(effectiveThread.presentationMode ? { presentationMode: presentation } : {}),
    ...(optimisticUserMessageItemId ? { userMessageItemId: optimisticUserMessageItemId } : {}),
    ...(thirdPartyAccountId ? { thirdPartyAccountId } : {}),
    // Launch-turn fallback goal (native-goal threads register separately
    // once the session exists). Painted output stays the raw prompt.
    ...(effectiveThread.goal &&
    !effectiveThread.goal.paused &&
    !isCodexNativeGoalAgent(effectiveThread.agentKind)
      ? { goalContext: buildGoalContextText(effectiveThread.goal.prompt) }
      : {}),
  };

  // Mirrored remote threads must launch on their host. Spawning locally would
  // apply the remote projectLocation on this machine (posix path →
  // `spawn /bin/bash ENOENT` on Windows) and never reach the remote supervisor.
  const owner = remoteOwner(effectiveThread);
  if (owner) {
    // No mcpLaunchSnapshot here: the host ignores client-supplied MCP servers
    // and resolves the launch snapshot from its own settings.
    await useRemoteServersStore.getState().withClient(owner.desktopId, (client) =>
      client.startThread({
        threadId: owner.remoteId,
        projectLocation: unprojectProjectLocation(projectLocation),
        ...startInput,
      }),
    );
  } else {
    await readBridge().startThread({
      threadId: effectiveThread.id,
      projectLocation,
      ...startInput,
      ...mcpLaunchSnapshot,
    });
    // A durable goal predating the first session still needs its native
    // registration once the session exists (later submits re-assert anyway).
    if (
      effectiveThread.goal &&
      !effectiveThread.goal.paused &&
      isCodexNativeGoalAgent(effectiveThread.agentKind)
    ) {
      try {
        await readBridge().controlThreadGoal({
          threadId: effectiveThread.id,
          action: "edit",
          objective: effectiveThread.goal.prompt,
        });
      } catch (error) {
        console.warn(`[goal] native registration after launch failed:`, error);
      }
    }
  }
  if (thirdPartyAccountId) {
    const accountBinding = {
      accountId: thirdPartyAccountId,
      provider: "openai-compatible" as const,
      credentialScopeRef: `managed:${thirdPartyAccountId}`,
      reason: "explicit" as const,
      boundAt: Date.now(),
    };
    useAppStore.setState((state) => ({
      threads: state.threads.map((candidate) =>
        candidate.id === effectiveThread.id ? { ...candidate, accountBinding } : candidate,
      ),
    }));
    const stored = useAppStore.getState().threads.find((row) => row.id === effectiveThread.id);
    if (stored) await readBridge().dbUpsertThread(stored);
    if (thirdPartyAccountId === pendingAccountId) {
      useUsageAccountsStore.getState().clearNextSessionAccount();
    }
  }
  captureThreadStarted(effectiveThread);
  if (prompt.length > 0 || (segments?.length ?? 0) > 0) {
    captureThreadPromptSubmitted(effectiveThread, prompt, segments, "initial");
  }
}

interface ThreadLaunchRequest {
  readonly threadId?: string;
  readonly remoteServerId?: string;
  readonly remoteId?: string;
  readonly project: Project;
  readonly agentKind: string;
  readonly config: ThreadConfig;
  readonly prompt: string;
  readonly compositionProvenance?: Thread["compositionProvenance"];
  /** Durable `/goal` prompt to bind right after the thread row exists. */
  readonly goal?: string;
  readonly segments?: PromptSegment[];
  readonly presentationMode?: ThreadPresentationMode;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly worktreeProvisioning?: boolean;
  readonly userMessageItemId?: string;
  readonly isNewWorktree: boolean;
  readonly options: { replacePaneId?: string; preserveActiveGroup?: boolean };
}

export interface CraftedSessionLaunchOptions {
  replacePaneId?: string;
  preserveActiveGroup?: boolean;
  /** Explicit account for this newly-created crafted Session only. */
  accountId?: string;
  /** Defaults to auto; explicit requires accountId and never falls back. */
  accountMode?: "auto" | "explicit";
  /**
   * v1.2 capability resolution policy (MCP/Skills Auto/Efficient/Creative).
   * Distinct from the Workbench 4-grid/9-grid UX mode: it is carried into the
   * CraftPlan runtime overrides so the Supervisor resolver honors it.
   */
  capabilityMode?: "auto" | "efficient" | "creative";
}

interface ThreadLaunchHostTransport {
  readonly setupRunsOnHost: boolean;
  startThread(input: ThreadLaunchRequest): Promise<RemoteThreadLaunchResult>;
}

export async function startThreadFromDraft(
  project: Project,
  input: DraftStartInput,
  options: { replacePaneId?: string; preserveActiveGroup?: boolean } = {},
): Promise<void> {
  const {
    agentKind,
    config,
    prompt,
    goal,
    segments,
    existingWorktreePath,
    worktreeBranch,
    worktreeBaseBranch,
    worktreeIsNewBranch,
    worktreeTransferUncommitted,
    presentationMode,
  } = input;
  // Everything below runs on the project's host, so a mirrored remote project
  // can't launch while its server is unreachable. Bail before creating a
  // worktree we would then have to unwind.
  if (isRemoteProjectUnreachable(project)) {
    toast.danger(
      i18n._(msg`This project's remote server is offline. Reconnect it to start a thread.`),
    );
    return;
  }

  const isHomeScope = isHomeProject(project);
  const owner = remoteOwner(project);
  const host = threadLaunchHost(project);

  useAppStore.getState().updateProjectDraftConfig(
    project.id,
    buildProjectDraftConfig({
      agentKind,
      config,
      worktreeMode: !isHomeScope && worktreeIsNewBranch === true,
    }),
  );

  let worktreePath = isHomeScope ? undefined : existingWorktreePath;
  let isNewWorktree = false;
  const createsWorktree = !isHomeScope && !worktreePath && !!worktreeBranch;
  const remoteHostThreadId = createsWorktree && owner ? crypto.randomUUID() : undefined;
  const pendingThread = createsWorktree
    ? createThreadRow({
        ...(owner && remoteHostThreadId
          ? {
              threadId: remoteThreadId(owner.desktopId, remoteHostThreadId),
              remoteServerId: owner.desktopId,
              remoteId: remoteHostThreadId,
            }
          : {}),
        project,
        agentKind,
        config,
        prompt,
        ...(segments ? { segments } : {}),
        ...(presentationMode ? { presentationMode } : {}),
        worktreeBranch,
        worktreeProvisioning: true,
        isNewWorktree: true,
        options,
      })
    : undefined;
  const pendingUserMessageItemId = pendingThread
    ? appendOptimisticInitialUserMessage(pendingThread, prompt, segments)
    : undefined;
  // A draft `/goal + Prompt` arrives here as `goal`: bind it the moment the
  // row exists so first-turn goalContext/native registration (in
  // performInitialThreadLaunch) already sees it. Plain-remote launches create
  // no local row, so there is nothing to bind to — the session still starts
  // with the clean prompt and the goal can be set inside the session.
  if (goal && pendingThread) {
    const bound = setThreadGoalPrompt(pendingThread.id, goal);
    if (!bound.ok) toast.danger(bound.error);
  }
  if (!isHomeScope && !worktreePath && worktreeBranch) {
    try {
      const transferUncommitted = worktreeTransferUncommitted ?? false;
      const result = await createWorktree(project, {
        branch: worktreeBranch,
        ...(worktreeBaseBranch ? { startPoint: worktreeBaseBranch } : {}),
        createBranch: worktreeIsNewBranch ?? false,
        transferUncommitted,
        keepChangesInSource: transferUncommitted,
      });
      worktreePath = result.path;
      isNewWorktree = true;
      if (worktreeTransferUncommitted && result.changesTransferred === false) {
        toast.danger(
          i18n._(
            msg`Couldn't copy your uncommitted changes into the new worktree — they remain on the current branch.`,
          ),
        );
      }
    } catch (error) {
      console.error("[renderer] failed to create worktree:", error);
      const message = friendlyError(error);
      if (pendingThread) {
        const store = useAppStore.getState();
        store.applyRuntimeEvent(pendingThread.id, {
          type: "error",
          threadId: pendingThread.id,
          message,
        });
        store.updateThreadRuntime(pendingThread.id, {
          status: "error",
          attention: "error",
          errorMessage: message,
          canResumeWithConfig: false,
        });
      }
      toast.danger(message);
      throw error;
    }
  }

  if (pendingThread && worktreePath) {
    const store = useAppStore.getState();
    const currentThread = store.threads.find((thread) => thread.id === pendingThread.id);
    if (!currentThread) {
      await performWorktreeRemoval(project, worktreePath, worktreeBranch);
      return;
    }
    if (currentThread.archived) {
      store.setThreadWorktree(pendingThread.id, worktreePath, worktreeBranch);
      store.updateThreadRuntime(pendingThread.id, {
        status: "inactive",
        attention: "none",
        canResumeWithConfig: false,
      });
    } else if (owner && remoteHostThreadId) {
      store.setThreadWorktree(pendingThread.id, worktreePath, worktreeBranch, {
        preserveProvisioning: true,
      });
      store.updateThreadRuntime(pendingThread.id, {
        status: "working",
        attention: "working",
        canResumeWithConfig: false,
      });
      try {
        const started = await host.startThread({
          threadId: remoteHostThreadId,
          project,
          agentKind,
          config,
          prompt,
          ...(segments ? { segments } : {}),
          ...(presentationMode ? { presentationMode } : {}),
          worktreePath,
          ...(worktreeBranch ? { worktreeBranch } : {}),
          ...(pendingUserMessageItemId ? { userMessageItemId: pendingUserMessageItemId } : {}),
          isNewWorktree: true,
          options,
        });
        if (started === "cancelled") {
          await performWorktreeRemoval(project, worktreePath, worktreeBranch);
          return;
        }
        if (started === "cancellation-failed") return;
      } catch (error) {
        if (!useAppStore.getState().threads.some((thread) => thread.id === pendingThread.id)) {
          await performWorktreeRemoval(project, worktreePath, worktreeBranch);
          return;
        }
        markThreadLaunchFailed(pendingThread.id, error);
        throw error;
      }
      if (useAppStore.getState().threads.some((thread) => thread.id === pendingThread.id)) {
        useAppStore.getState().setThreadWorktree(pendingThread.id, worktreePath, worktreeBranch);
      }
    } else {
      store.setThreadWorktree(pendingThread.id, worktreePath, worktreeBranch);
      // Launch inline, never via the view-consumed launch queue: a queued
      // launch fires only when a mounted ThreadView consumes it, so switching
      // or closing the pane while the worktree provisions would leave the
      // agent silently never started. The launch must not depend on the view.
      const launchThread =
        useAppStore.getState().threads.find((thread) => thread.id === pendingThread.id) ??
        pendingThread;
      try {
        await performInitialThreadLaunch({
          thread: launchThread,
          projectLocation: resolveProjectLocation(project.location, worktreePath),
          prompt,
          ...(segments ? { segments } : {}),
          ...(pendingUserMessageItemId ? { userMessageItemId: pendingUserMessageItemId } : {}),
          initialSize: DEFAULT_TERMINAL_SIZE,
        });
      } catch (error) {
        if (!useAppStore.getState().threads.some((thread) => thread.id === pendingThread.id)) {
          await performWorktreeRemoval(project, worktreePath, worktreeBranch);
          return;
        }
        markThreadLaunchFailed(pendingThread.id, error);
        throw error;
      }
    }
  } else {
    await host.startThread({
      project,
      agentKind,
      config,
      prompt,
      ...(segments ? { segments } : {}),
      ...(presentationMode ? { presentationMode } : {}),
      ...(worktreePath ? { worktreePath } : {}),
      ...(worktreeBranch ? { worktreeBranch } : {}),
      ...(goal ? { goal } : {}),
      isNewWorktree,
      options,
    });
  }

  if (worktreePath) {
    void primeWorktreeGitState(project, worktreePath);
    void refreshGitProject({ id: project.id, location: project.location }, "manual", "full");
  }
  if (isNewWorktree && worktreePath && !host.setupRunsOnHost) {
    const setupScript = project.scripts?.setupScript;
    if (setupScript) {
      void runWorktreeSetupScript(project, worktreePath, setupScript);
    }
  }
}

function threadLaunchHost(project: Project): ThreadLaunchHostTransport {
  const owner = remoteOwner(project);
  if (owner) {
    const remoteServer = useRemoteServersStore
      .getState()
      .servers.find((server) => server.desktopId === owner.desktopId);
    const helperHost =
      remoteServer?.hostMode === "helper" ||
      (remoteServer?.hostMode === undefined && remoteServer?.transport?.kind === "ssh");
    return {
      setupRunsOnHost: !helperHost,
      startThread: async (launch) => {
        const remoteId = launch.threadId;
        return useRemoteServersStore.getState().launchRemoteThread(
          {
            ...(remoteId ? { threadId: remoteId } : {}),
            desktopId: owner.desktopId,
            projectId: owner.remoteId,
            agentKind: launch.agentKind,
            config: launch.config,
            prompt: launch.prompt,
            ...(launch.segments ? { segments: launch.segments } : {}),
            presentationMode: launch.presentationMode ?? "terminal",
            ...(launch.worktreePath ? { worktreePath: launch.worktreePath } : {}),
            ...(launch.worktreeBranch ? { worktreeBranch: launch.worktreeBranch } : {}),
            ...(launch.isNewWorktree ? { isNewWorktree: true } : {}),
            ...(launch.userMessageItemId ? { userMessageItemId: launch.userMessageItemId } : {}),
          },
          remoteId
            ? {
                isPendingLaunchOwned: () =>
                  useAppStore.getState().provisioningWorktreeThreadIds[
                    remoteThreadId(owner.desktopId, remoteId)
                  ] === true,
              }
            : undefined,
        );
      },
    };
  }

  return {
    setupRunsOnHost: false,
    startThread: async (launch) => {
      const thread = createThreadRow(launch);
      if (launch.goal) {
        const bound = setThreadGoalPrompt(thread.id, launch.goal);
        if (!bound.ok) toast.danger(bound.error);
      }
      // Launch inline, never via the view-consumed launch queue — the launch
      // must not depend on which pane is mounted (see the worktree path above).
      try {
        await performInitialThreadLaunch({
          thread,
          projectLocation: resolveProjectLocation(launch.project.location, launch.worktreePath),
          prompt: launch.prompt,
          ...(launch.segments ? { segments: launch.segments } : {}),
          ...(launch.userMessageItemId ? { userMessageItemId: launch.userMessageItemId } : {}),
          initialSize: DEFAULT_TERMINAL_SIZE,
        });
      } catch (error) {
        if (useAppStore.getState().threads.some((row) => row.id === thread.id)) {
          markThreadLaunchFailed(thread.id, error);
        }
        throw error;
      }
      return "started";
    },
  };
}

function createThreadRow(launch: ThreadLaunchRequest): Thread {
  const store = useAppStore.getState();
  const { agentStatuses, wslAgentStatuses } = useAgentStatusesStore.getState();
  const projectAgentStatuses = getProjectAgentStatuses(
    launch.project.location,
    agentStatuses,
    wslAgentStatuses,
  );
  const titlePrompt = titlePromptFromSegments(launch.prompt, launch.segments);
  const currentView = store.view;
  const activeGroup =
    launch.options.preserveActiveGroup !== false &&
    currentView.kind === "thread" &&
    currentView.activeGroupId &&
    !findExperimentByGroupId(currentView.activeGroupId)
      ? {
          groupId: currentView.activeGroupId,
          groupName: store.threads.find((thread) => thread.groupId === currentView.activeGroupId)
            ?.groupName,
        }
      : undefined;

  const agentStatus = projectAgentStatuses.find((status) => status.kind === launch.agentKind);
  const config =
    isHomeProject(launch.project) && agentStatus
      ? applyHomeScopePermissions(launch.project.location, launch.config, agentStatus.capabilities)
      : launch.config;

  const thread = store.createThread({
    ...(launch.threadId ? { threadId: launch.threadId } : {}),
    projectId: launch.project.id,
    agentKind: launch.agentKind,
    config,
    prompt: titlePrompt,
    ...(launch.presentationMode ? { presentationMode: launch.presentationMode } : {}),
    ...(launch.worktreePath ? { worktreePath: launch.worktreePath } : {}),
    ...(launch.worktreeBranch ? { worktreeBranch: launch.worktreeBranch } : {}),
    ...(launch.worktreeProvisioning ? { worktreeProvisioning: true } : {}),
    ...(launch.compositionProvenance
      ? { compositionProvenance: launch.compositionProvenance }
      : {}),
    ...(launch.remoteServerId ? { remoteServerId: launch.remoteServerId } : {}),
    ...(launch.remoteId ? { remoteId: launch.remoteId } : {}),
    ...(launch.options.replacePaneId ? { replacePaneId: launch.options.replacePaneId } : {}),
    ...(activeGroup?.groupId ? { groupId: activeGroup.groupId } : {}),
    ...(activeGroup?.groupName ? { groupName: activeGroup.groupName } : {}),
  });
  if (!launch.remoteServerId) {
    generateTitleAsync(thread.id, launch.project.location, projectAgentStatuses, titlePrompt);
  }
  return thread;
}

/** Surface a failed launch on the thread row (error item + error status). */
function markThreadLaunchFailed(threadId: string, error: unknown): void {
  const store = useAppStore.getState();
  const message = friendlyError(error);
  store.applyRuntimeEvent(threadId, {
    type: "error",
    threadId,
    message,
  });
  store.updateThreadRuntime(threadId, {
    status: "error",
    attention: "error",
    errorMessage: message,
    canResumeWithConfig: false,
  });
}

function appendOptimisticInitialUserMessage(
  thread: Thread,
  prompt: string,
  segments?: PromptSegment[],
): string | undefined {
  const presentation = thread.presentationMode ?? "terminal";
  if (presentation !== "gui" || prompt.length === 0 || thread.sessionRef !== undefined) {
    return undefined;
  }

  const itemId = `user-${crypto.randomUUID()}`;
  useAppStore.getState().applyRuntimeEvent(thread.id, {
    type: "item.started",
    threadId: thread.id,
    itemId,
    itemType: "user_message",
    payload: { content: buildPromptContentBlocks(prompt, segments) },
  });
  useAppStore.getState().applyRuntimeEvent(thread.id, {
    type: "item.completed",
    threadId: thread.id,
    itemId,
  });
  return itemId;
}

import {
  type CraftPlan,
  type CraftResult,
  getDefaultProvenanceStore,
  nativeRuntimeExecutionConfigForPlan,
  provenanceStateKey,
} from "@/shared/crafting";

/**
 * MCP candidate snapshot for Crafting launches. Auto/Efficient plans (no
 * explicit ids) must hand the complete enabled candidate snapshot to the
 * Supervisor resolver so it can inject compatible servers; Creative/explicit
 * plans pass only the selected ids, which the Supervisor fails closed on.
 */
function craftingMcpLaunchServers(
  plan: CraftPlan,
  projectMcpServers: readonly import("@/shared/contracts").McpServer[] = [],
) {
  const snapshot = resolveMcpLaunchSnapshot(useSharedSettings.getState(), projectMcpServers);
  const selectedIds = nativeRuntimeExecutionConfigForPlan(plan).mcpServerIds;
  if (selectedIds && selectedIds.length > 0) {
    const byId = new Map(snapshot.mcpServers.map((server) => [server.id, server]));
    return selectedIds.flatMap((id) => {
      const server = byId.get(id);
      return server ? [server] : [];
    });
  }
  return [...snapshot.mcpServers];
}

export async function startThreadFromCraft(
  project: Project,
  craftResult: CraftResult,
  prompt: string,
  options: CraftedSessionLaunchOptions = {},
): Promise<void> {
  if (!craftResult.success || !craftResult.craftPlan) {
    const errorMsg =
      craftResult.errors
        ?.map((e) => `${e.message}${e.remediation ? ` (${e.remediation})` : ""}`)
        .join("; ") ?? "Crafting failed";
    toast.danger(errorMsg);
    throw new Error(errorMsg);
  }

  const threadId = planThreadId(craftResult.craftPlan.threadId);
  const projectLocation = resolveProjectLocation(project.location, undefined);
  const plan: CraftPlan = {
    ...craftResult.craftPlan,
    threadId,
    workspace: projectLocation.kind === "wsl" ? projectLocation.linuxPath : projectLocation.path,
    ...(options.capabilityMode
      ? {
          overrides: {
            ...craftResult.craftPlan.overrides,
            capabilityMode: options.capabilityMode,
          },
        }
      : {}),
  };
  const agentKind = plan.runtimeBinding.harnessKind;
  const config: ThreadConfig = {
    model: plan.runtimeBinding.modelId,
  };

  const bridge = readBridge();
  if (remoteOwner(project)) {
    const error = "Crafting a remote project is not available in this runtime.";
    toast.danger(error);
    throw new Error(error);
  }

  if (!craftResult.resultItem?.provenance) {
    const error = "Crafting provenance is missing; the Agent cannot be started safely.";
    toast.danger(error);
    throw new Error(error);
  }

  const thread = createThreadRow({
    threadId,
    project,
    agentKind,
    config,
    prompt: prompt.trim() || craftResult.resultItem.metadata.name,
    compositionProvenance: craftResult.resultItem.provenance,
    presentationMode: "gui",
    options,
    isNewWorktree: false,
  });
  appendOptimisticInitialUserMessage(thread, prompt);

  try {
    // The app-store persist is asynchronous. Upsert the thread explicitly
    // before starting the runtime so composition provenance survives an
    // immediate restart and remains attached to this exact thread row.
    await bridge.dbUpsertThread(thread);
    const store = configureProvenanceStore(bridge);
    await store.saveProvenanceAsync(threadId, craftResult.resultItem.provenance);
    // Account-row selection is a one-shot override for the next new Session.
    // It is intentionally resolved here, at the product launch boundary, rather
    // than inferred from the legacy `selected` marker in the Supervisor. An
    // explicit caller option (including `auto`) wins over the pending UI
    // choice. New launches use `preferred`: the pick is honoured while usable
    // but an exhausted account falls back to the pool instead of failing the
    // launch. (Resume keeps strict `explicit` for Session stickiness — see
    // resumeCraftedThread.)
    const pendingAccountId = useUsageAccountsStore.getState().nextSessionAccountId;
    const accountMode =
      options.accountMode ?? (options.accountId || pendingAccountId ? "preferred" : "auto");
    const accountId =
      options.accountId ??
      (options.accountMode === undefined ? (pendingAccountId ?? undefined) : undefined);
    const craftAgentResult = await bridge.craftAgent({
      craftPlan: plan,
      projectLocation,
      prompt,
      accountMode,
      mcpServers: craftingMcpLaunchServers(plan, project.mcpServers),
      ...(accountId && accountMode !== "auto" ? { accountId } : {}),
    });
    if (craftAgentResult.accountBinding) {
      const boundThread = { ...thread, accountBinding: craftAgentResult.accountBinding };
      useAppStore.setState((state) => ({
        threads: state.threads.map((candidate) =>
          candidate.id === thread.id ? boundThread : candidate,
        ),
      }));
      await bridge.dbUpsertThread(boundThread);
    }
    if (accountId === pendingAccountId) {
      useUsageAccountsStore.getState().clearNextSessionAccount();
    }
  } catch (error) {
    const detail = parseCraftingError(error);
    const userMessage = detail.code ? `[${detail.code}] ${detail.message}` : detail.message;
    markThreadLaunchFailed(threadId, userMessage);
    toast.danger(userMessage);
    throw error;
  }
}
/**
 * Channel-model repair: a thread whose model came from an OpenAI-compatible
 * account channel (e.g. `glm-5.3-flash` via a Cavoti channel on the codex
 * harness) must resume with that account's credentials. The launch-time
 * account choice is one-shot (`nextSessionAccountId`) and only a persisted
 * `accountBinding` survives restarts — threads launched before the binding
 * was saved resume on the default account and 400 on every turn. Exact
 * provider + modelId match only; never guess across channels.
 */
function resolveChannelAccountIdForThreadModel(thread: Thread): string | undefined {
  const model = thread.config.model?.trim();
  if (!model) return undefined;
  const customModels = useSharedSettings.getState().customModels ?? [];
  return customModels.find(
    (entry) => entry.provider === thread.agentKind && entry.accountId && entry.modelId === model,
  )?.accountId;
}

/**
 * Channel-model repair: a thread whose model came from an OpenAI-compatible
 * account channel (e.g. `glm-5.3-flash` via a Cavoti channel on the codex
 * harness) must resume with that account's credentials. The launch-time
 * account choice is one-shot (`nextSessionAccountId`) and only a persisted
 * `accountBinding` survives restarts — threads launched before the binding
 * was saved resume on the default account and 400 on every turn. Exact
 * provider + modelId match only; never guess across channels.
 */
function resolveChannelAccountIdForThreadModel(thread: Thread): string | undefined {
  const model = thread.config.model?.trim();
  if (!model) return undefined;
  const customModels = useSharedSettings.getState().customModels ?? [];
  return customModels.find(
    (entry) => entry.provider === thread.agentKind && entry.accountId && entry.modelId === model,
  )?.accountId;
}

async function resumeCraftedThread(input: {
  thread: Thread;
  projectLocation: ProjectLocation;
  prompt: string;
}): Promise<boolean> {
  const bridge = readBridge();
  const store = configureProvenanceStore(bridge);
  const handoffState = await readSessionHandoffState(input.thread.id).catch(() => null);
  const activeHandoff =
    handoffState?.phase === "active" &&
    handoffState.activeSegment &&
    handoffState.targetCraftPlan &&
    handoffState.targetProvenance
      ? handoffState
      : undefined;
  const provenance =
    activeHandoff?.targetProvenance ??
    input.thread.compositionProvenance ??
    (await store.loadProvenanceAsync(input.thread.id));
  const providerSessionId =
    activeHandoff?.activeSegment?.nativeSessionRef ?? input.thread.sessionRef?.providerSessionId;
  if (!provenance || !providerSessionId) return false;

  const workspace =
    input.projectLocation.kind === "wsl"
      ? input.projectLocation.linuxPath
      : input.projectLocation.path;
  const recoveredCraftPlan = activeHandoff
    ? {
        ...activeHandoff.targetCraftPlan!,
        threadId: input.thread.id,
        workspace,
        sessionRef: providerSessionId,
      }
    : store.reconstructCraftPlan(input.thread.id, provenance, {
        workspace,
        sessionRef: providerSessionId,
      }).craftPlan;
  const projectMcpServers = useAppStore
    .getState()
    .projects.find((project) => project.id === input.thread.projectId)?.mcpServers;
  const storedAccountId =
    activeHandoff?.activeAccountBinding?.accountId ?? input.thread.accountBinding?.accountId;
  const accountId = storedAccountId ?? resolveChannelAccountIdForThreadModel(input.thread);
  const result = await bridge.resumeCraftAgent({
    craftPlan: recoveredCraftPlan,
    projectLocation: input.projectLocation,
    sessionRef: providerSessionId,
    mcpServers: craftingMcpLaunchServers(recoveredCraftPlan, projectMcpServers),
    ...(accountId ? { accountId } : {}),
    ...(input.prompt.length > 0 ? { prompt: input.prompt } : {}),
  });
  if (result.accountBinding) {
    // Persist the binding the resume actually used (mirror the launch path):
    // without it the *next* resume falls back to the default account again.
    const boundThread = { ...input.thread, accountBinding: result.accountBinding };
    useAppStore.setState((state) => ({
      threads: state.threads.map((candidate) =>
        candidate.id === input.thread.id ? boundThread : candidate,
      ),
    }));
    await bridge.dbUpsertThread(boundThread);
  }
  if (result.threadId !== input.thread.id) {
    throw new Error(
      `Crafted thread resume returned mismatched thread id '${result.threadId}' for '${input.thread.id}'.`,
    );
  }
  return true;
}

function configureProvenanceStore(bridge: ReturnType<typeof readBridge>) {
  const store = getDefaultProvenanceStore();
  store.setPersistenceDriver({
    readProvenance: (id) => bridge.dbGetState(provenanceStateKey(id)),
    writeProvenance: (id, value) => bridge.dbSetState(provenanceStateKey(id), value),
    deleteProvenance: (id) => bridge.dbSetState(provenanceStateKey(id), ""),
  });
  return store;
}

function planThreadId(threadId: string | undefined): string {
  return threadId ?? `craft-thread:${crypto.randomUUID()}`;
}

function parseCraftingError(error: unknown): { message: string; code?: string; phase?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; code?: unknown; phase?: unknown };
    if (typeof parsed.message === "string") {
      return {
        message: parsed.message,
        ...(typeof parsed.code === "string" ? { code: parsed.code } : {}),
        ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {}),
      };
    }
  } catch {
    // Preserve the existing user-facing error when the IPC failure is not a CraftingError.
  }
  return { message: raw };
}
