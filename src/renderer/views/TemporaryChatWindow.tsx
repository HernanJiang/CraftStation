import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { MessageCircle, X } from "lucide-react";
import { DragDropProvider } from "@dnd-kit/react";
import { HOME_PROJECT_ID } from "@/shared/homeScope";
import type { Project, ProjectDraftConfig, ThreadPresentationMode } from "@/shared/contracts";
import { projectDraftConfigSchema } from "@/shared/contracts/config";
import { readBridge } from "@/renderer/bridge";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { ThreadDraftView } from "@/renderer/components/thread/ThreadDraftView";
import { startThreadFromDraft } from "@/renderer/actions/threadLaunchActions";
import { applyExternalSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useAppStore } from "@/renderer/state/appStore";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { ThreadPane } from "./MainView/parts/AppContent/parts/ThreadPane";

const MODEL_MEMORY_KEY = "temporary-chat-model";
type ModelSelection = {
  agentKind: string;
  model: string;
  accountId?: string;
  presentationMode: ThreadPresentationMode;
};

export function TemporaryChatWindow({ loading }: { loading: boolean }) {
  const [context, setContext] = useState<{
    threadId: string;
    project: Project;
    accountId?: string;
    presentationMode?: ThreadPresentationMode;
  }>();
  const [error, setError] = useState("");
  const selectionRef = useRef<ModelSelection | undefined>(undefined);
  const threads = useAppStore((state) => state.threads);
  const agentStatuses = useAgentStatusesStore((state) => state.agentStatuses);
  const activeThread = context && threads.find((thread) => thread.id === context.threadId);

  const remember = useCallback((selection: ModelSelection, draftConfig?: ProjectDraftConfig) => {
    selectionRef.current = selection;
    const config =
      draftConfig ??
      useAppStore.getState().projects.find((p) => p.id === HOME_PROJECT_ID)?.lastDraftConfig;
    if (!config || config.model !== selection.model || config.agentKind !== selection.agentKind)
      return;
    void readBridge()
      .dbSetState(MODEL_MEMORY_KEY, JSON.stringify({ draftConfig: config, ...selection }))
      .catch((cause: unknown) => {
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
        readBridge().dbGetState(MODEL_MEMORY_KEY),
        readBridge().getAgentStatuses([]),
      ]);
      if (!active) return;
      let draftConfig: ProjectDraftConfig | undefined;
      let accountId: string | undefined;
      let presentationMode: ThreadPresentationMode | undefined;
      try {
        const saved = memory ? JSON.parse(memory) : undefined;
        const parsed = projectDraftConfigSchema.safeParse(saved?.draftConfig);
        if (parsed.success) {
          draftConfig = parsed.data;
          accountId = typeof saved.accountId === "string" ? saved.accountId : undefined;
          presentationMode = ["gui", "terminal"].includes(saved.presentationMode)
            ? saved.presentationMode
            : undefined;
        }
      } catch {
        /* Invalid old preference falls back to the managed model defaults. */
      }
      const project: Project = {
        id: HOME_PROJECT_ID,
        name: "临时对话",
        location: { kind: "windows", path: readBridge().homeDir ?? "" },
        createdAt: new Date().toISOString(),
        ...(draftConfig ? { lastDraftConfig: draftConfig } : {}),
      };
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

  const close = () => {
    void readBridge().closeTemporaryChat();
  };
  return (
    <main
      className="temporary-chat-window flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground"
      aria-label="临时对话弹窗"
    >
      <header className="temporary-chat-titlebar flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <MessageCircle size={15} />
        <span className="flex-1 text-sm">临时对话</span>
        <span className="text-xs text-muted">关闭即删除</span>
        <Button
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label="关闭并删除临时对话"
          onPress={close}
        >
          <X size={16} />
        </Button>
      </header>
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {!context ? (
          <div className="flex flex-1 items-center justify-center">
            <PixelLoader size="sm" />
          </div>
        ) : activeThread ? (
          <DragDropProvider>
            <ThreadPane
              threadId={context.threadId}
              paneCount={1}
              paneAlign="center"
              portalThreadHeader={false}
              onClose={close}
            />
          </DragDropProvider>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-end p-3">
            <ThreadDraftView
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
              onModelSelectionChange={remember}
              onStart={(input) =>
                startThreadFromDraft(context.project, input, {
                  threadId: context.threadId,
                  isEphemeral: true,
                  preserveActiveGroup: false,
                })
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}
