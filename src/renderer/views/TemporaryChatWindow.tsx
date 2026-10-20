import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { MessageCircle, Minus, X } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import type { Project, ProjectDraftConfig, ThreadPresentationMode } from "@/shared/contracts";
import { makeThreadTitle } from "@/shared/threadTitle";
import {
  createExclusiveQueue,
  readTemporaryChatStartupMemory,
  shouldReplaceTemporaryChatWarm,
  shouldSendIntoTemporaryChatWarm,
  TEMPORARY_CHAT_MODEL_STATE_KEY,
  temporaryChatWarmDraft,
  temporaryChatWarmKey,
} from "@/shared/temporaryChat";
import { readBridge } from "@/renderer/bridge";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { ThreadDraftView } from "@/renderer/components/thread/ThreadDraftView";
import type { DraftStartInput } from "@/renderer/components/thread/ThreadDraftComposerArea";
import { startThreadFromDraft } from "@/renderer/actions/threadLaunchActions";
import { submitThreadInput } from "@/renderer/actions/threadRuntimeActions";
import { applyExternalSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { ThreadPane } from "./MainView/parts/AppContent/parts/ThreadPane";

type ModelSelection = {
  agentKind: string;
  model: string;
  accountId?: string;
  presentationMode: ThreadPresentationMode;
};

type WarmState = {
  threadId: string;
  key: string;
  phase: "starting" | "ready" | "failed";
};

const launchOptions = {
  isEphemeral: true,
  preserveActiveGroup: false,
} as const;

function warmDraftInput(
  draft: { agentKind: string; model: string; worktreeMode?: boolean | undefined },
  selection: ModelSelection,
): DraftStartInput {
  const { agentKind, worktreeMode: _worktreeMode, ...config } = draft;
  return {
    agentKind: agentKind as DraftStartInput["agentKind"],
    config,
    prompt: "",
    presentationMode: selection.presentationMode,
    ...(selection.accountId ? { accountId: selection.accountId } : {}),
  };
}

function selectionFromDraft(
  draft: ProjectDraftConfig,
  accountId: string | undefined,
  presentationMode: ThreadPresentationMode | undefined,
): ModelSelection {
  return {
    agentKind: draft.agentKind,
    model: draft.model,
    ...(accountId ? { accountId } : {}),
    presentationMode: presentationMode ?? "gui",
  };
}

/** Main-side lifecycle rejections: stale thread id or a call from a dead window. */
function isTemporaryChatLifecycleError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return (
    message.includes("temporary-chat-id-mismatch") || message.includes("temporary-chat-closed")
  );
}

export function TemporaryChatWindow({ loading }: { loading: boolean }) {
  const [context, setContext] = useState<{
    threadId: string;
    project: Project;
    accountId?: string | undefined;
    presentationMode?: ThreadPresentationMode | undefined;
  }>();
  const [error, setError] = useState("");
  const [engaged, setEngaged] = useState(false);
  const contextRef = useRef(context);
  contextRef.current = context;
  const selectionRef = useRef<ModelSelection | undefined>(undefined);
  const engagedRef = useRef(false);
  const generationRef = useRef(0);
  const warmRef = useRef<WarmState | null>(null);
  const idleHeldRef = useRef(false);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const enqueueRef = useRef(createExclusiveQueue());
  const threads = useAppStore((state) => state.threads);
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const activeThread = context && threads.find((thread) => thread.id === context.threadId);

  /** The window's thread id can go stale (rearm, lifecycle races); adopt the live one. */
  const resyncThreadId = useCallback(async (staleId: string): Promise<string | null> => {
    const freshId = await readBridge()
      .getTemporaryChatThreadId()
      .catch(() => null);
    if (!freshId || freshId === staleId) return null;
    setContext((current) => (current ? { ...current, threadId: freshId } : current));
    return freshId;
  }, []);

  const ensureWarm = useCallback(
    (selection: ModelSelection, immediate: boolean) => {
      const run = () => {
        if (!context || engagedRef.current || idleHeldRef.current) return;
        if (!selection.model || !selection.agentKind) return;
        const threadId = context.threadId;
        const existing = warmRef.current;
        if (
          existing?.threadId === threadId &&
          !shouldReplaceTemporaryChatWarm(existing, selection)
        ) {
          return;
        }
        const draft = useAppStore
          .getState()
          .projects.find((project) => project.id === HOME_PROJECT_ID)?.lastDraftConfig;
        const prepared = temporaryChatWarmDraft(draft, selection);
        if (!prepared) return;
        const key = temporaryChatWarmKey(selection);
        const generation = ++generationRef.current;
        warmRef.current = { threadId, key, phase: "starting" };
        void enqueueRef.current(async () => {
          if (generationRef.current !== generation) return;
          if (useAppStore.getState().threads.some((thread) => thread.id === threadId)) {
            await readBridge()
              .closeThread({ threadId })
              .catch(() => undefined);
            if (generationRef.current !== generation) return;
            useAppStore.getState().deleteThread(threadId);
          }
          if (generationRef.current !== generation) return;
          try {
            await startThreadFromDraft(context.project, warmDraftInput(prepared, selection), {
              ...launchOptions,
              threadId,
            });
          } catch (cause: unknown) {
            console.error(
              "[temporary-chat] operation=warm status=error code=prepare-failed",
              cause,
            );
            if (generationRef.current !== generation) return;
            warmRef.current = { threadId, key, phase: "failed" };
            if (isTemporaryChatLifecycleError(cause)) {
              // Adopting the live id retriggers ensureWarm via the context effect.
              await resyncThreadId(threadId);
            }
            return;
          }
          if (generationRef.current !== generation) {
            // A newer prepare for this same id owns the process. Closing here
            // would kill that prepare. Rearm changes the id, so the old one
            // still has to be discarded.
            if (warmRef.current?.threadId !== threadId) {
              await readBridge()
                .closeThread({ threadId })
                .catch(() => undefined);
              if (useAppStore.getState().threads.some((thread) => thread.id === threadId)) {
                useAppStore.getState().deleteThread(threadId);
              }
            }
            return;
          }
          warmRef.current = { threadId, key, phase: "ready" };
        });
      };
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      if (immediate) run();
      else warmTimerRef.current = setTimeout(run, 400);
    },
    [context, resyncThreadId],
  );
  const ensureWarmRef = useRef(ensureWarm);
  ensureWarmRef.current = ensureWarm;

  const lastPersistedRef = useRef("");
  const remember = useCallback((selection: ModelSelection, draftConfig?: ProjectDraftConfig) => {
    selectionRef.current = selection;
    const config =
      draftConfig ??
      useAppStore.getState().projects.find((p) => p.id === HOME_PROJECT_ID)?.lastDraftConfig;
    if (!config || config.model !== selection.model || config.agentKind !== selection.agentKind)
      return;
    const payload = JSON.stringify({ draftConfig: config, ...selection });
    if (lastPersistedRef.current === payload) return;
    lastPersistedRef.current = payload;
    void readBridge()
      .dbSetState(TEMPORARY_CHAT_MODEL_STATE_KEY, payload)
      .catch((cause: unknown) => {
        lastPersistedRef.current = "";
        console.error(
          "[temporary-chat] operation=remember-model status=error code=model-memory-failed",
          cause,
        );
        setError("模型选择保存失败，请重试。");
      });
  }, []);

  useEffect(() => {
    if (loading) return;
    let active = true;
    void (async () => {
      const [threadId, memory, statuses] = await Promise.all([
        readBridge().getTemporaryChatThreadId(),
        readBridge().dbGetState(TEMPORARY_CHAT_MODEL_STATE_KEY),
        readBridge().getAgentStatuses([]),
      ]);
      if (!active) return;
      let draftConfig: ProjectDraftConfig | undefined;
      let accountId: string | undefined;
      let presentationMode: ThreadPresentationMode | undefined;
      const saved = readTemporaryChatStartupMemory(memory);
      if (saved) ({ draftConfig, accountId, presentationMode } = saved);
      const project: Project = {
        id: HOME_PROJECT_ID,
        name: "临时对话",
        location: {
          kind: readBridge().platform === "win32" ? "windows" : "posix",
          path: readBridge().homeDir ?? "",
        },
        createdAt: new Date().toISOString(),
        ...(draftConfig ? { lastDraftConfig: draftConfig } : {}),
      };
      if (draftConfig) {
        selectionRef.current = selectionFromDraft(draftConfig, accountId, presentationMode);
      }
      useAppStore.setState({ projects: [project], threads: [], view: { kind: "home" } });
      useAgentStatusesStore
        .getState()
        .hydrateFromCache({ windows: statuses.windows, wsl: statuses.wsl });
      setContext({
        threadId,
        project,
        ...(accountId ? { accountId } : {}),
        ...(presentationMode ? { presentationMode } : {}),
      });
    })().catch((cause: unknown) => {
      if (active) setError("临时对话加载失败，请关闭后重试。");
      console.error(
        "[temporary-chat] operation=open status=error code=initialization-failed",
        cause,
      );
    });
    return () => {
      active = false;
    };
  }, [loading]);

  useEffect(() => readBridge().onSharedSettingsChanged(applyExternalSharedSettings), []);

  useEffect(() => {
    if (!context || engaged) return;
    const selection = selectionRef.current;
    if (selection?.model) ensureWarm(selection, true);
  }, [context, engaged, ensureWarm]);

  useEffect(() => {
    return readBridge().onTemporaryChatIdleExpired((visible) => {
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      idleHeldRef.current = !visible;
      generationRef.current += 1;
      warmRef.current = null;
      engagedRef.current = false;
      setEngaged(false);
      const threadId = contextRef.current?.threadId;
      if (threadId && useAppStore.getState().threads.some((thread) => thread.id === threadId)) {
        useAppStore.getState().deleteThread(threadId);
      }
      if (!visible) return;
      const selection = selectionRef.current;
      if (selection?.model) ensureWarmRef.current(selection, true);
    });
  }, []);

  useEffect(() => {
    const rewarm = () => {
      if (!idleHeldRef.current || engagedRef.current) return;
      if (document.visibilityState !== "visible" && !document.hasFocus()) return;
      idleHeldRef.current = false;
      const selection = selectionRef.current;
      if (selection?.model) ensureWarmRef.current(selection, true);
    };
    document.addEventListener("visibilitychange", rewarm);
    window.addEventListener("focus", rewarm);
    return () => {
      document.removeEventListener("visibilitychange", rewarm);
      window.removeEventListener("focus", rewarm);
    };
  }, []);

  useEffect(
    () => () => {
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    },
    [],
  );

  useEffect(
    () =>
      useAppStore.subscribe((state, previous) => {
        const nextThread =
          context && state.threads.find((thread) => thread.id === context.threadId);
        const oldThread =
          context && previous.threads.find((thread) => thread.id === context.threadId);
        if (nextThread && nextThread.config !== oldThread?.config) {
          const pickerKind = nextThread.config.sourceProviderKind || nextThread.agentKind;
          remember(
            {
              agentKind: pickerKind,
              model: nextThread.config.model,
              ...(nextThread.accountBinding?.accountId
                ? { accountId: nextThread.accountBinding.accountId }
                : {}),
              presentationMode: nextThread.presentationMode ?? "gui",
            },
            { ...nextThread.config, agentKind: pickerKind },
          );
        } else if (!nextThread) {
          const draft = state.projects.find(
            (project) => project.id === HOME_PROJECT_ID,
          )?.lastDraftConfig;
          const oldDraft = previous.projects.find(
            (project) => project.id === HOME_PROJECT_ID,
          )?.lastDraftConfig;
          if (draft && draft !== oldDraft && selectionRef.current)
            remember(selectionRef.current, draft);
        }
      }),
    [context, remember],
  );

  const park = () => {
    const title = activeThread?.title?.trim();
    void readBridge().parkTemporaryChat(title && title !== "Crafted Agent" ? title : "临时对话");
  };

  const dismiss = () => {
    idleHeldRef.current = false;
    if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    const generation = ++generationRef.current;
    warmRef.current = null;
    engagedRef.current = false;
    setEngaged(false);
    void readBridge()
      .rearmTemporaryChat()
      .then((nextId) => {
        if (generationRef.current !== generation) return;
        const draft = useAppStore
          .getState()
          .projects.find((project) => project.id === HOME_PROJECT_ID)?.lastDraftConfig;
        const selection = selectionRef.current;
        useAppStore.setState({ threads: [], view: { kind: "home" } });
        setContext((current) =>
          current
            ? {
                ...current,
                threadId: nextId,
                ...(selection ? { presentationMode: selection.presentationMode } : {}),
                ...(selection?.accountId ? { accountId: selection.accountId } : {}),
                project: {
                  ...current.project,
                  ...(draft ? { lastDraftConfig: draft } : {}),
                },
              }
            : current,
        );
      })
      .catch((cause: unknown) => {
        console.error("[temporary-chat] operation=rearm status=error code=rearm-failed", cause);
        setError("临时对话关闭失败，请重试。");
      });
  };

  const send = (input: DraftStartInput) => {
    if (!context) return;
    idleHeldRef.current = false;
    if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
    engagedRef.current = true;
    const generation = generationRef.current;
    const threadId = context.threadId;
    const project = context.project;
    return enqueueRef
      .current(async () => {
        if (generationRef.current !== generation) return;
        const thread = useAppStore.getState().threads.find((item) => item.id === threadId);
        const reusable =
          thread &&
          shouldSendIntoTemporaryChatWarm({
            warm: warmRef.current,
            threadId,
            threadStatus: thread.status,
            threadAgentKind: thread.agentKind,
            threadModel: thread.config.model,
            threadSourceProviderKind: thread.config.sourceProviderKind,
            threadPresentationMode: thread.presentationMode,
            threadAccountId: thread.accountBinding?.accountId,
            launchAgentKind: input.agentKind,
            launchModel: input.config.model,
            launchPresentationMode: input.presentationMode,
            launchAccountId: input.accountId,
            hasGoal: Boolean(input.goal),
            hasWorktree: Boolean(input.worktreeBranch),
            ...(warmRef.current?.key ? { warmKey: warmRef.current.key } : {}),
          });
        if (reusable) {
          useAppStore.getState().updateThreadConfig(threadId, input.config);
          useAppStore.getState().renameThread(threadId, makeThreadTitle(input.prompt));
          setEngaged(true);
          await submitThreadInput(
            threadId,
            input.prompt,
            input.segments ? [...input.segments] : undefined,
          );
          return;
        }
        if (useAppStore.getState().threads.some((item) => item.id === threadId)) {
          await readBridge()
            .closeThread({ threadId })
            .catch(() => undefined);
          useAppStore.getState().deleteThread(threadId);
        }
        warmRef.current = null;
        try {
          await startThreadFromDraft(project, input, { ...launchOptions, threadId });
        } catch (cause: unknown) {
          if (!isTemporaryChatLifecycleError(cause)) throw cause;
          const freshId = await resyncThreadId(threadId);
          if (!freshId) throw cause;
          await startThreadFromDraft(project, input, { ...launchOptions, threadId: freshId });
        }
        if (generationRef.current !== generation) return;
        setEngaged(true);
      })
      .catch((cause: unknown) => {
        if (generationRef.current === generation) {
          engagedRef.current = false;
          setEngaged(false);
        }
        throw cause;
      });
  };

  const handleModelSelectionChange = useCallback(
    (selection: ModelSelection) => {
      const previous = selectionRef.current;
      const sameSelection = Boolean(
        previous &&
        previous.agentKind === selection.agentKind &&
        previous.model === selection.model &&
        (previous.accountId ?? "") === (selection.accountId ?? "") &&
        previous.presentationMode === selection.presentationMode,
      );
      const hadSelection = Boolean(previous?.model);
      remember(selection);
      if (engagedRef.current) return;
      // A duplicate event must not retrigger a prepare that is starting, ready, or
      // already failed for this exact selection — that looped forever on failure.
      if (sameSelection && warmRef.current) return;
      ensureWarmRef.current(selection, !hadSelection);
    },
    [remember],
  );

  const preparing =
    !engaged && activeThread
      ? activeThread.status === "error"
        ? "模型准备失败，发送时会重新打开。"
        : activeThread.status === "idle" || activeThread.status === "needs_reply"
          ? "模型已就绪，发送后直接回答。"
          : "正在打开 CLI 并加载模型，可以先输入。"
      : "";

  return (
    <main
      className="temporary-chat-window flex h-full flex-col overflow-hidden bg-background text-foreground"
      aria-label="临时对话弹窗"
    >
      <header className="temporary-chat-titlebar flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageCircle size={15} />
        <span className="flex-1 text-sm">临时对话</span>
        <span className="text-xs text-muted">关闭即删除</span>
        <Button isIconOnly size="sm" variant="ghost" aria-label="最小化到工作区" onPress={park}>
          <Minus size={16} />
        </Button>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="关闭并删除临时对话"
          onPress={dismiss}
        >
          <X size={16} />
        </Button>
      </header>
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {preparing && (
        <p className="px-4 pt-2 text-xs text-muted" aria-live="polite">
          {preparing}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {!context ? (
          <div className="flex flex-1 items-center justify-center">
            <PixelLoader size="sm" />
          </div>
        ) : engaged && activeThread ? (
          <DragDropProvider>
            <ThreadPane
              threadId={context.threadId}
              paneCount={1}
              paneAlign="center"
              portalThreadHeader={false}
              onClose={dismiss}
            />
          </DragDropProvider>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-end p-3">
            <ThreadDraftView
              key={`${context.project.lastDraftConfig?.agentKind}:${context.project.lastDraftConfig?.model}:${context.accountId ?? ""}`}
              project={context.project}
              agentStatuses={agentStatuses}
              quickComposer
              hideProjectSelector
              paneCount={1}
              {...(context.project.lastDraftConfig
                ? { lastDraftConfig: context.project.lastDraftConfig }
                : {})}
              {...(context.accountId ? { initialAccountId: context.accountId } : {})}
              {...(context.presentationMode
                ? { initialPresentationMode: context.presentationMode }
                : {})}
              composerPlaceholder="发送消息…"
              onModelSelectionChange={handleModelSelectionChange}
              onStart={send}
            />
          </div>
        )}
      </div>
    </main>
  );
}
