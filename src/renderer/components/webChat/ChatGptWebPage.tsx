import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, ExternalLink, Trash2, Brain, RefreshCw } from "lucide-react";
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { readBridge } from "@/renderer/bridge";
import { ThreadComposer } from "@/renderer/components/thread/ThreadComposer";
import { UniversalDockedChatInput } from "@/renderer/components/thread/UniversalDockedChatInput";
import { useCurrentProjectId } from "@/renderer/hooks/uiSelectors";
import { useAppStore } from "@/renderer/state/appStore";
import { flattenSegments } from "@/renderer/components/composer/serializeMentions";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { useWebChatStore } from "@/renderer/state/webChatStore";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { WebChatWidgetCard } from "./WebChatWidgetCard";
import { WebChatConversationRail } from "./WebChatConversationRail";
import { WebChatNativeView } from "./WebChatNativeView";
import { WebChatThreadSidebarDialog } from "./WebChatThreadSidebarDialog";
import {
  useLayoutHeaderPortalTarget,
  WEB_CHAT_HEADER_PORTAL_ID,
} from "@/renderer/components/layout/layoutHeaderPortals";
import {
  chatGptConversationUrl,
  type WebChatSession,
  type WebChatConversation,
  type WebChatReasoning,
} from "@/shared/chatGptWeb";

export function ChatGptWebPage() {
  const { t } = useLingui();
  const headerTarget = useLayoutHeaderPortalTarget(WEB_CHAT_HEADER_PORTAL_ID);
  const draftVersion = useWebChatStore((s) => s.draftVersion);
  const nativeView = useWebChatStore((s) => s.nativeView);
  const requestedSessionId = useWebChatStore((s) => s.selectedSessionId);
  const sessionOpenVersion = useWebChatStore((s) => s.sessionOpenVersion);
  const savedSessions = useWebChatStore((s) => s.sessions);
  const deleteRequestId = useWebChatStore((s) => s.deleteRequestId);
  const webProjectId = useWebChatStore((s) => s.projectId);
  const currentProjectId = useCurrentProjectId();
  const projectId = webProjectId ?? currentProjectId;
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId) ?? s.projects[0]);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [session, setSession] = useState<WebChatSession>();
  const [prompt, setPrompt] = useState("");
  const [activeWidgetId, setActiveWidgetId] = useState<string>();
  const widgetTurnRef = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [syncError, setSyncError] = useState<string>();
  const [dialog, setDialog] = useState<"reasoning">();
  const [dialogError, setDialogError] = useState<string>();
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [available, setAvailable] = useState<WebChatConversation[]>([]);
  const conversations = [
    ...new Map(
      [
        ...savedSessions.flatMap((s) => {
          const url = chatGptConversationUrl(s.url);
          return url ? [{ title: s.title, url }] : [];
        }),
        ...available,
      ].map((item) => [item.url, item]),
    ).values(),
  ];
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string>();
  const [discoveryVersion, setDiscoveryVersion] = useState(0);
  const [reasoning, setReasoning] = useState<WebChatReasoning>();
  const [effort, setEffort] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WebChatSession>();
  const [threadSidebarSession, setThreadSidebarSession] = useState<WebChatSession>();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const selectedId = requestedSessionId ?? session?.id;
  const nativeTabId = (savedSessions.find((s) => s.id === requestedSessionId) ?? session)?.tabId;
  const nativeLoading = useBrowserPanelStore(
    (s) => s.tabs.find((tab) => tab.tabId === nativeTabId)?.loading ?? false,
  );
  const busy = session?.status === "sending" || session?.status === "streaming";
  const tail = session?.messages.at(-1);
  const transcriptTailKey = JSON.stringify([
    session?.id,
    session?.messages.length,
    tail?.id,
    tail?.text,
    tail?.widgets,
  ]);
  useEffect(() => {
    if (!session) return;
    const message = session.messages.findLast((m) => m.widgets?.some((w) => w.kind !== "response"));
    const widget = message?.widgets?.find((w) => w.kind !== "response");
    if (!message || !widget) return;
    const turnKey = `${session.id}:${message.id}`;
    if (widgetTurnRef.current === turnKey && activeWidgetId?.startsWith(`${session.id}:`)) return;
    widgetTurnRef.current = turnKey;
    setActiveWidgetId(`${session.id}:${widget.id}`);
  }, [session, activeWidgetId]);
  const replace = (next: WebChatSession) => {
    setSession(next);
    const store = useWebChatStore.getState();
    store.setSessions([next, ...store.sessions.filter((s) => s.id !== next.id)]);
    if (store.selectedSessionId !== next.id) store.selectSession(next.id);
  };
  useEffect(() => {
    let cancelled = false;
    void readBridge()
      .webChatList()
      .then(async (list) => {
        if (cancelled) return;
        useWebChatStore.getState().setSessions(list);
        const draft = useWebChatStore.getState().isDraft;
        const requested = useWebChatStore.getState().selectedSessionId;
        let next = draft ? undefined : list.find((s) => s.id === requested);
        if (!draft && !next && useWebChatStore.getState().nativeView) {
          const browser = await readBridge().browserGetState();
          if (cancelled || useWebChatStore.getState().selectedSessionId !== requested) return;
          const source =
            browser.tabs.find(
              (tab) => tab.tabId === browser.activeTabId && chatGptConversationUrl(tab.url),
            ) ?? browser.tabs.find((tab) => chatGptConversationUrl(tab.url));
          if (source) {
            next = await readBridge().webChatImport({
              url: chatGptConversationUrl(source.url)!,
              tabId: source.tabId,
            });
          }
        }
        next ??= draft ? undefined : (list.find((s) => chatGptConversationUrl(s.url)) ?? list[0]);
        if (!next && useWebChatStore.getState().nativeView) {
          next = await readBridge().webChatCreate();
        }
        if (cancelled || useWebChatStore.getState().selectedSessionId !== requested) return;
        if (next) replace(next);
        else setSession(undefined);
        const pid = projectIdRef.current;
        setPrompt(
          draft && useWebChatStore.getState().inheritLocalDraft && pid
            ? flattenSegments(useAppStore.getState().draftContents[pid]?.segments ?? [])
            : "",
        );
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [draftVersion]);
  useEffect(() => {
    if (!requestedSessionId) return;
    const next = useWebChatStore.getState().sessions.find((s) => s.id === requestedSessionId);
    if (next) {
      setSession(next);
      if (next.messages.length) setPrompt("");
      setError(undefined);
      follow.current = true;
    }
  }, [requestedSessionId]);
  useEffect(() => {
    if (session?.id === deleteRequestId && !pending && !busy) {
      setDeleteTarget(session);
      useWebChatStore.getState().clearDeleteRequest();
    }
  }, [deleteRequestId, session, pending, busy]);
  useEffect(() => {
    if (!selectedId || pending) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let restoreBinding = nativeView;
    const read = async () => {
      try {
        if (restoreBinding && nativeView) {
          const opened = await readBridge().webChatOpen({ sessionId: selectedId });
          if (cancelled || useWebChatStore.getState().selectedSessionId !== selectedId) return;
          replace(opened);
        }
        const restore = restoreBinding;
        restoreBinding = false;
        const next = await readBridge().webChatRead({
          sessionId: selectedId,
          ...(restore ? { restoreBinding: true } : {}),
          ...(nativeView ? { followNavigation: true } : {}),
        });
        if (!cancelled && useWebChatStore.getState().selectedSessionId === selectedId) {
          replace(next);
          setSyncError(undefined);
          if (next.status === "ready")
            setError((previous) =>
              previous &&
              /\bWEB_(DISCONNECTED|LOGIN_REQUIRED|PAGE_CHANGED|REPLY_FAILED)\b/.test(previous)
                ? undefined
                : previous,
            );
        }
      } catch (e) {
        if (!cancelled && useWebChatStore.getState().selectedSessionId === selectedId)
          setSyncError(String(e));
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void read();
        }, 300);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedId, pending, nativeView, sessionOpenVersion]);
  useEffect(() => {
    if (follow.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [transcriptTailKey]);
  // 登录完成前保留输入，不自动重发；浏览器沿用侧边浏览器的持久登录状态。
  const ensureSession = async () => {
    let next = session ?? (await readBridge().webChatCreate());
    const deadline = Date.now() + 15_000;
    do {
      next = await readBridge().webChatRead({ sessionId: next.id });
      replace(next);
      if (next.status === "login-required") {
        await readBridge().webChatReveal({ sessionId: next.id });
        return undefined;
      }
      if (next.status === "ready" || next.status === "streaming") return next;
      if (next.status === "error") return undefined;
      await new Promise((resolve) => setTimeout(resolve, 300));
    } while (Date.now() < deadline);
    throw new Error(t`网页连接超时，请打开网页检查后重试。`);
  };
  const switchToLocal = () => {
    if (pending || busy || session?.messages.length) return;
    if (project) {
      const store = useAppStore.getState();
      store.saveDraftContent(project.id, {
        segments: prompt ? [{ kind: "text", content: prompt }] : [],
        attachments: store.draftContents[project.id]?.attachments ?? [],
      });
      store.openDraft(project.id);
    }
    useWebChatStore.getState().setOpen(false);
  };
  const send = async () => {
    if (!prompt.trim() || pending || busy) return;
    setPending(true);
    setError(undefined);
    follow.current = true;
    let connectedId: string | undefined;
    try {
      const connected = await ensureSession();
      if (!connected) return;
      connectedId = connected.id;
      replace(
        await readBridge().webChatSend({
          sessionId: connected.id,
          prompt,
          requestId: crypto.randomUUID(),
        }),
      );
      setPrompt("");
      useWebChatStore.getState().finishDraft();
      useWebChatStore.getState().selectSession(connected.id);
    } catch (e) {
      setError(String(e));
      if (connectedId && /\bWEB_LOGIN_REQUIRED\b/.test(String(e))) {
        await readBridge()
          .webChatReveal({ sessionId: connectedId })
          .catch((revealError: unknown) => setSyncError(String(revealError)));
      }
    } finally {
      setPending(false);
    }
  };
  const stop = async () => {
    if (!session) return;
    setPending(true);
    setError(undefined);
    try {
      replace(await readBridge().webChatStop({ sessionId: session.id }));
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const reveal = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    setSyncError(undefined);
    try {
      const next = session ?? (await readBridge().webChatCreate());
      replace(next);
      useWebChatStore.getState().selectSession(next.id);
      await readBridge().webChatReveal({ sessionId: next.id });
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    if (pending || (!nativeView && busy)) return;
    setPending(true);
    setRefreshing(true);
    setError(undefined);
    setSyncError(undefined);
    let targetId = requestedSessionId;
    try {
      const next =
        savedSessions.find((s) => s.id === targetId) ??
        session ??
        (await readBridge().webChatCreate());
      targetId = next.id;
      if (!useWebChatStore.getState().selectedSessionId) replace(next);
      if (useWebChatStore.getState().selectedSessionId === next.id)
        useWebChatStore.getState().selectSession(next.id);
      if (nativeView && next.tabId) {
        await readBridge().browserReload({ tabId: next.tabId });
        return;
      }
      const refreshed = await readBridge().webChatRefresh({
        sessionId: next.id,
        ...(nativeView ? { followNavigation: true } : {}),
      });
      if (useWebChatStore.getState().selectedSessionId === next.id) replace(refreshed);
      else {
        const store = useWebChatStore.getState();
        store.setSessions(store.sessions.map((s) => (s.id === next.id ? refreshed : s)));
      }
    } catch (e) {
      if (useWebChatStore.getState().selectedSessionId === targetId) setError(String(e));
    } finally {
      setPending(false);
      setRefreshing(false);
    }
  };
  const importConversation = async (url: string) => {
    if (pending || busy) return;
    setPending(true);
    setDiscoveryError(undefined);
    try {
      const imported = await readBridge().webChatImport({ url });
      replace(imported);
      useWebChatStore.getState().finishDraft();
      useWebChatStore.getState().selectSession(imported.id);
      setPrompt("");
      setError(undefined);
      setConversationsOpen(false);
      if (nativeView) useWebChatStore.getState().openSession(imported.id);
      else await readBridge().webChatReveal({ sessionId: imported.id });
      follow.current = true;
    } catch (e) {
      setDiscoveryError(String(e));
    } finally {
      setPending(false);
    }
  };
  const openReasoning = async () => {
    if (pending || busy) return;
    setDialog("reasoning");
    setDialogError(undefined);
    setReasoning(undefined);
    setPending(true);
    try {
      const connected = await ensureSession();
      if (!connected) {
        setDialog(undefined);
        return;
      }
      const next = await readBridge().webChatReasoning({ sessionId: connected.id });
      setReasoning(next);
      setEffort(next.value);
    } catch (e) {
      setDialogError(String(e));
    } finally {
      setPending(false);
    }
  };
  const applyReasoning = async () => {
    const option = reasoning?.options.find((o) => o.id === effort);
    if (!session || !option || pending) return;
    setPending(true);
    setDialogError(undefined);
    try {
      replace(await readBridge().webChatSetReasoning({ sessionId: session.id, option }));
      setDialog(undefined);
      setError(undefined);
    } catch (e) {
      setDialogError(String(e));
    } finally {
      setPending(false);
    }
  };
  const remove = async () => {
    if (!deleteTarget || pending) return;
    const target = deleteTarget;
    setPending(true);
    setError(undefined);
    try {
      await readBridge().webChatDelete({ sessionId: target.id, url: target.url, confirmed: true });
      const list = await readBridge().webChatList();
      useWebChatStore.getState().setSessions(list);
      setAvailable((items) =>
        items.filter((item) => item.url !== chatGptConversationUrl(target.url)),
      );
      if (list[0]) replace(list[0]);
      else {
        setSession(undefined);
        useWebChatStore.getState().startDraft(projectIdRef.current);
      }
      setPrompt("");
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteTarget(undefined);
      setPending(false);
    }
  };
  const canDiscover = Boolean(
    conversationsOpen && selectedId && session?.status === "ready" && !pending && !busy,
  );
  useEffect(() => {
    if (!selectedId || !canDiscover) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const discover = async () => {
      setDiscovering(true);
      try {
        const list = await readBridge().webChatDiscover({ sessionId: selectedId });
        if (!cancelled) {
          setAvailable(list);
          setDiscoveryError(undefined);
        }
      } catch (e) {
        if (!cancelled) setDiscoveryError(String(e));
      } finally {
        if (!cancelled) {
          setDiscovering(false);
          timer = setTimeout(() => {
            void discover();
          }, 8000);
        }
      }
    };
    void discover();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setDiscovering(false);
    };
  }, [selectedId, canDiscover, discoveryVersion]);
  const status = session?.status;
  const statusText = busy
    ? t`正在同步网页回复…`
    : status === "login-required"
      ? t`请在网页中登录`
      : status === "ready"
        ? t`已连接`
        : status === "error"
          ? t`同步中断`
          : t`正在连接网页…`;
  return (
    <section
      className="relative flex h-full min-h-0 flex-col bg-background"
      data-testid="chatgpt-web-page"
    >
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {nativeView ? (
          <WebChatNativeView tabId={nativeTabId} />
        ) : (
          <div
            ref={scrollRef}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto px-2 pb-3"
            onScroll={() => {
              const el = scrollRef.current;
              if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
          >
            <div className="mx-auto max-w-4xl space-y-7">
              {!session?.messages.length && (
                <div className="mx-auto mt-16 max-w-lg text-center">
                  <Globe className="mx-auto mb-4 size-12 text-emerald-400" />
                  <h2 className="mb-3 text-xl font-semibold">
                    <Trans>在这里聊，由 ChatGPT 网页回答</Trans>
                  </h2>
                  <p className="mb-6 text-sm leading-6 text-muted">
                    <Trans>
                      使用侧边浏览器已登录的 ChatGPT
                      账号。发送后回复实时显示在这里；尚未登录时会打开官方登录页。
                    </Trans>
                  </p>
                </div>
              )}
              {session?.messages.map((message) => (
                <article
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[90%] rounded-2xl bg-default px-4 py-3"
                      : "min-w-0"
                  }
                >
                  <div className="mb-2 text-xs text-muted">
                    {message.role === "user" ? t`你` : "ChatGPT"}
                  </div>
                  <ItemMarkdown text={message.text} />
                  {message.widgets
                    ?.filter((w) => w.kind !== "response")
                    .map((widget) => (
                      <WebChatWidgetCard
                        key={`${session.id}:${widget.id}`}
                        sessionId={session.id}
                        widget={widget}
                        active={activeWidgetId === `${session.id}:${widget.id}`}
                        onActivate={() => setActiveWidgetId(`${session.id}:${widget.id}`)}
                        onEdit={() => setPrompt(`请继续修改上面「${widget.title}」这个交互组件：`)}
                      />
                    ))}
                  {message.widgets
                    ?.filter((w) => w.kind === "response")
                    .map((widget) => (
                      <WebChatWidgetCard
                        key={`${session.id}:${widget.id}`}
                        sessionId={session.id}
                        widget={widget}
                        active={activeWidgetId === `${session.id}:${widget.id}`}
                        onActivate={() => setActiveWidgetId(`${session.id}:${widget.id}`)}
                        onEdit={() => setPrompt("请继续修改上面的回复和交互组件：")}
                      />
                    ))}
                </article>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        )}
        {headerTarget &&
          createPortal(
            nativeView ? (
              <div className="craftstation-overlay-header__controls flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="craftstation-overlay-header__controls h-7 gap-2 rounded-full border border-border px-3 text-xs shadow-sm"
                  data-testid="webchat-header-thread-sidebar"
                  isDisabled={!selectedId || !nativeTabId}
                  onPress={() => {
                    const target = savedSessions.find((item) => item.id === selectedId) ?? session;
                    if (target) setThreadSidebarSession(target);
                  }}
                >
                  <ExternalLink className="size-3.5" />
                  <Trans>打开为本地对话侧边栏</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="craftstation-overlay-header__controls h-7 gap-2 rounded-full border border-border px-3 text-xs shadow-sm"
                  data-testid="webchat-header-refresh"
                  aria-label={t`刷新网页`}
                  isDisabled={pending || nativeLoading || !selectedId}
                  isPending={refreshing || nativeLoading}
                  onPress={() => {
                    void refresh();
                  }}
                >
                  <RefreshCw className="size-3.5" />
                  <Trans>刷新网页</Trans>
                </Button>
              </div>
            ) : (
              <WebChatConversationRail
                conversations={conversations}
                open={conversationsOpen}
                onOpenChange={(open) => {
                  setConversationsOpen(open);
                  if (open && !session && !pending && !discovering) {
                    setPending(true);
                    setDiscovering(true);
                    void readBridge()
                      .webChatCreate()
                      .then(replace)
                      .catch((e: unknown) => setDiscoveryError(String(e)))
                      .finally(() => {
                        setPending(false);
                        setDiscovering(false);
                      });
                  }
                }}
                {...(session ? { currentUrl: session.url } : {})}
                loading={discovering}
                disabled={pending || busy}
                {...(discoveryError ? { error: discoveryError } : {})}
                onRefresh={() => setDiscoveryVersion((v) => v + 1)}
                onSelect={(url) => {
                  void importConversation(url);
                }}
              />
            ),
            headerTarget,
          )}
      </div>
      {threadSidebarSession && (
        <WebChatThreadSidebarDialog
          session={threadSidebarSession}
          onClose={() => setThreadSidebarSession(undefined)}
        />
      )}
      {nativeView && (error || syncError || session?.error) && (
        <p
          role="alert"
          className="absolute inset-x-6 top-6 z-50 rounded-xl bg-danger/90 px-3 py-2 text-sm text-white"
        >
          {error || syncError || session?.error}
        </p>
      )}
      {!nativeView && (
        <footer className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4">
          {(error || syncError || session?.error) && (
            <p
              role="alert"
              className="mb-3 break-words rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error || syncError || session?.error}
            </p>
          )}
          <UniversalDockedChatInput
            {...(project ? { project } : {})}
            placement="conversation"
            craftMode="efficient"
            onCraftModeChange={() => undefined}
            runtimeMode="web"
            {...(!session?.messages.length && !pending && !busy
              ? {
                  onRuntimeModeChange: (mode: "local" | "web") => {
                    if (mode === "local") switchToLocal();
                  },
                  onProjectChange: (id: string) => useWebChatStore.getState().setProjectId(id),
                }
              : {})}
            rightActions={
              <div
                className="flex min-w-0 flex-wrap items-center justify-end gap-1"
                data-testid="webchat-controls"
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto min-h-6 max-w-full shrink-0 gap-1.5 whitespace-normal px-1.5 py-1 text-left text-xs"
                  data-testid="webchat-reveal"
                  aria-label={t`打开原远程网页对话`}
                  isDisabled={pending}
                  onPress={() => {
                    void reveal();
                  }}
                >
                  <ExternalLink className="size-3.5 shrink-0" />
                  <Trans>打开原远程网页对话</Trans>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto min-h-6 max-w-full shrink-0 gap-1.5 whitespace-normal px-1.5 py-1 text-left text-xs"
                  data-testid="webchat-refresh"
                  aria-label={t`刷新网页`}
                  isDisabled={pending || busy}
                  isPending={refreshing}
                  onPress={() => {
                    void refresh();
                  }}
                >
                  <RefreshCw className="size-3.5 shrink-0" />
                  <Trans>刷新网页</Trans>
                </Button>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  className="size-6 min-w-6"
                  aria-label={t`删除账号中的对话`}
                  isDisabled={pending || busy || !session || !chatGptConversationUrl(session.url)}
                  onPress={() => setDeleteTarget(session)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <span
                  className="ml-1 flex min-w-0 items-center gap-2 text-xs text-muted"
                  role="status"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                  <span className="max-w-28 truncate">{statusText}</span>
                </span>
              </div>
            }
          >
            {!nativeView && (
              <ThreadComposer
                prompt={prompt}
                placeholder={t`发送到 ChatGPT 网页…`}
                onPromptChange={setPrompt}
                onSubmit={() => {
                  void send();
                }}
                submitLabel={t`发送`}
                submitDisabled={pending || busy || !prompt.trim()}
                submitPending={pending}
                stopPending={pending}
                onStop={
                  busy
                    ? () => {
                        void stop();
                      }
                    : undefined
                }
                toolbarLayoutKey={session?.reasoningLabel ?? "web-thinking"}
                afterControls={
                  <Button
                    size="sm"
                    variant="tertiary"
                    aria-label={t`思考强度`}
                    data-testid="webchat-thinking"
                    className="max-w-28 shrink-0"
                    isDisabled={pending || busy}
                    onPress={() => {
                      void openReasoning();
                    }}
                  >
                    <Brain className="size-4" />
                    {session?.reasoningLabel || t`思考强度`}
                  </Button>
                }
                controls={[
                  {
                    kind: "static",
                    value: "ChatGPT",
                    icon: <Globe className="size-4" />,
                    hideLabelOnWrap: true,
                  },
                ]}
              />
            )}
          </UniversalDockedChatInput>
        </footer>
      )}
      <Modal.Backdrop
        isOpen={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(undefined);
        }}
        isDismissable={!pending}
      >
        <Modal.Container>
          <Modal.Dialog className="w-full max-w-xl">
            <Modal.CloseTrigger isDisabled={pending} />
            <Modal.Header>
              <Modal.Heading>{t`思考强度`}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              {dialogError && (
                <p role="alert" className="break-words text-sm text-danger">
                  {dialogError}
                </p>
              )}
              <>
                <p className="text-sm text-muted">
                  <Trans>
                    选项来自当前网页账号和模型。应用后会核实网页档位；模型或套餐变化时，请重新读取选项。
                  </Trans>
                </p>
                {reasoning && (
                  <label className="block space-y-2 text-sm">
                    <span>
                      <Trans>网页思考强度</Trans>
                    </span>
                    <select
                      aria-label={t`网页思考强度`}
                      className="w-full rounded-lg bg-default px-3 py-2"
                      disabled={pending}
                      value={effort}
                      onChange={(e) => setEffort(e.target.value)}
                    >
                      {reasoning.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
              {pending && (
                <p role="status" className="text-sm text-muted">
                  <Trans>正在读取或应用网页设置…</Trans>
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" isDisabled={pending} onPress={() => setDialog(undefined)}>
                <Trans>取消</Trans>
              </Button>
              <Button
                isPending={pending}
                isDisabled={pending || !reasoning}
                onPress={() => {
                  void applyReasoning();
                }}
              >
                {t`应用到网页`}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        isPending={pending}
        title={t`删除账号中的对话？`}
        body={
          <div className="space-y-3">
            <p>
              <Trans>这会同步删除你的 ChatGPT 账号中的原对话及本地记录，无法撤销。</Trans>
            </p>
            <p className="font-medium">{deleteTarget?.title}</p>
            <p className="break-all text-xs text-muted">{deleteTarget?.url}</p>
          </div>
        }
        confirmLabel={t`删除原对话`}
        onConfirm={() => {
          void remove();
        }}
        onClose={() => {
          if (!pending) setDeleteTarget(undefined);
        }}
      />
    </section>
  );
}
