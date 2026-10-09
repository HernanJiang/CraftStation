import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Globe, Plus, ExternalLink, Download, Trash2, Brain } from "lucide-react";
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
import { WebChatWidgetCard } from "./WebChatWidgetCard";
import {
  chatGptConversationUrl,
  type WebChatSession,
  type WebChatConversation,
  type WebChatReasoning,
} from "@/shared/chatGptWeb";

export function ChatGptWebPage() {
  const { t } = useLingui();
  const draftVersion = useWebChatStore((s) => s.draftVersion);
  const requestedSessionId = useWebChatStore((s) => s.selectedSessionId);
  const deleteRequestId = useWebChatStore((s) => s.deleteRequestId);
  const webProjectId = useWebChatStore((s) => s.projectId);
  const currentProjectId = useCurrentProjectId();
  const projectId = webProjectId ?? currentProjectId;
  const project = useAppStore((s) => s.projects.find((p) => p.id === projectId) ?? s.projects[0]);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const [sessions, setSessions] = useState<WebChatSession[]>([]);
  const [session, setSession] = useState<WebChatSession>();
  const [prompt, setPrompt] = useState("");
  const [activeWidgetId, setActiveWidgetId] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<"import" | "reasoning">();
  const [dialogError, setDialogError] = useState<string>();
  const [importUrl, setImportUrl] = useState("");
  const [available, setAvailable] = useState<WebChatConversation[]>([]);
  const [reasoning, setReasoning] = useState<WebChatReasoning>();
  const [effort, setEffort] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<WebChatSession>();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const selectedId = session?.id;
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
    if (!session || activeWidgetId?.startsWith(`${session.id}:`)) return;
    const widget = session.messages
      .flatMap((message) => message.widgets ?? [])
      .find((w) => w.kind !== "response");
    if (widget) setActiveWidgetId(`${session.id}:${widget.id}`);
  }, [session, activeWidgetId]);
  const replace = (next: WebChatSession) => {
    setSession(next);
    setSessions((list) => [next, ...list.filter((s) => s.id !== next.id)]);
    const store = useWebChatStore.getState();
    store.setSessions([next, ...store.sessions.filter((s) => s.id !== next.id)]);
    if (store.selectedSessionId !== next.id) store.selectSession(next.id);
  };
  useEffect(() => {
    let cancelled = false;
    void readBridge()
      .webChatList()
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        useWebChatStore.getState().setSessions(list);
        const draft = useWebChatStore.getState().isDraft;
        const requested = useWebChatStore.getState().selectedSessionId;
        setSession(draft ? undefined : (list.find((s) => s.id === requested) ?? list[0]));
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
    const read = async () => {
      try {
        const next = await readBridge().webChatRead({ sessionId: selectedId });
        if (!cancelled) replace(next);
      } catch (e) {
        if (!cancelled) setError(String(e));
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
  }, [selectedId, pending]);
  useEffect(() => {
    if (follow.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [transcriptTailKey]);
  const create = () => {
    if (pending || busy) return;
    setSession(undefined);
    setPrompt("");
    setError(undefined);
    useWebChatStore.getState().startDraft(project?.id);
    follow.current = true;
  };
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
      if (next.status === "error") throw new Error(next.error);
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
    try {
      const connected = await ensureSession();
      if (!connected) return;
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
    setError(undefined);
    try {
      const next = session ?? (await readBridge().webChatCreate());
      if (!session) replace(next);
      await readBridge().webChatReveal({ sessionId: next.id });
    } catch (e) {
      setError(String(e));
    }
  };
  const openImport = async () => {
    setDialog("import");
    setDialogError(undefined);
    setAvailable([]);
    setPending(true);
    try {
      const connected = await ensureSession();
      if (connected) setAvailable(await readBridge().webChatDiscover({ sessionId: connected.id }));
    } catch (e) {
      setDialogError(String(e));
    } finally {
      setPending(false);
    }
  };
  const importConversation = async (url: string) => {
    if (pending) return;
    setPending(true);
    setDialogError(undefined);
    try {
      const imported = await readBridge().webChatImport({ url });
      replace(imported);
      useWebChatStore.getState().finishDraft();
      useWebChatStore.getState().selectSession(imported.id);
      setPrompt("");
      setError(undefined);
      setImportUrl("");
      setDialog(undefined);
      follow.current = true;
    } catch (e) {
      setDialogError(String(e));
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
      setSessions(list);
      useWebChatStore.getState().setSessions(list);
      setSession(list[0]);
      setPrompt("");
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleteTarget(undefined);
      setPending(false);
    }
  };
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
    <section className="flex h-full min-h-0 flex-col bg-background" data-testid="chatgpt-web-page">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Button
          isIconOnly
          size="sm"
          variant="tertiary"
          aria-label={t`返回`}
          onPress={() => useWebChatStore.getState().setOpen(false)}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Globe className="size-5 text-emerald-400" />
        <h1 className="font-semibold">
          ChatGPT <Trans>网页</Trans>
        </h1>
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
          <Trans>实验</Trans>
        </span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <select
              aria-label={t`网页会话`}
              className="max-w-40 rounded-lg bg-default px-2 py-1 text-xs"
              value={selectedId ?? ""}
              disabled={pending}
              onChange={(e) => {
                const next = sessions.find((s) => s.id === e.target.value);
                setSession(next);
                setPrompt("");
                setError(undefined);
                useWebChatStore.getState().finishDraft();
                if (next) useWebChatStore.getState().selectSession(next.id);
                follow.current = true;
              }}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          )}
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={pending || busy}
            onPress={() => {
              void create();
            }}
          >
            <Plus className="size-4" />
            <Trans>新对话</Trans>
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={pending || busy}
            onPress={() => {
              void openImport();
            }}
          >
            <Download className="size-4" />
            <Trans>导入已有对话</Trans>
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isIconOnly
            aria-label={t`删除账号中的对话`}
            isDisabled={pending || busy || !session || !chatGptConversationUrl(session.url)}
            onPress={() => setDeleteTarget(session)}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={pending}
            onPress={() => {
              void reveal();
            }}
          >
            <ExternalLink className="size-4" />
            <Trans>打开网页</Trans>
          </Button>
        </div>
      </header>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-6"
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
      <footer className="mx-auto w-full max-w-4xl shrink-0 px-4 pb-4">
        {(error || session?.error) && (
          <p
            role="alert"
            className="mb-3 break-words rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {error || session?.error}
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
            session ? (
              <span className="flex items-center gap-2 text-xs text-muted" role="status">
                <span
                  className={`size-1.5 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-amber-400"}`}
                />
                {statusText}
              </span>
            ) : undefined
          }
        >
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
        </UniversalDockedChatInput>
      </footer>
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
              <Modal.Heading>{dialog === "import" ? t`导入已有对话` : t`思考强度`}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              {dialogError && (
                <p role="alert" className="break-words text-sm text-danger">
                  {dialogError}
                </p>
              )}
              {dialog === "import" ? (
                <>
                  <p className="text-sm text-muted">
                    <Trans>
                      从已登录账号选择对话，或粘贴自己的对话链接。导入后可继续原对话；分享链接不支持续聊。
                    </Trans>
                  </p>
                  <label className="block space-y-2 text-sm">
                    <span>
                      <Trans>ChatGPT 对话链接</Trans>
                    </span>
                    <input
                      aria-label={t`ChatGPT 对话链接`}
                      className="w-full rounded-lg border border-border bg-default px-3 py-2"
                      placeholder="https://chatgpt.com/c/…"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      disabled={pending}
                    />
                  </label>
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      <Trans>网页已加载的对话</Trans>
                    </span>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={pending || status !== "ready"}
                      onPress={() => {
                        void openImport();
                      }}
                    >
                      <Trans>刷新列表</Trans>
                    </Button>
                  </div>
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {available.map((item) => (
                      <Button
                        key={item.url}
                        className="w-full justify-start"
                        variant="tertiary"
                        isDisabled={pending}
                        onPress={() => {
                          void importConversation(item.url);
                        }}
                      >
                        <span className="truncate">{item.title}</span>
                      </Button>
                    ))}
                    {!pending && available.length === 0 && (
                      <p className="text-sm text-muted">
                        <Trans>
                          没有已加载的对话。可先打开网页登录、加载旧对话，或直接粘贴链接。
                        </Trans>
                      </p>
                    )}
                  </div>
                </>
              ) : (
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
              )}
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
                isDisabled={
                  pending || (dialog === "import" ? !chatGptConversationUrl(importUrl) : !reasoning)
                }
                onPress={() => {
                  if (dialog === "import") void importConversation(importUrl);
                  else void applyReasoning();
                }}
              >
                {dialog === "import" ? t`导入并继续` : t`应用到网页`}
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
