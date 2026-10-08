import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Globe, Plus, ExternalLink } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { readBridge } from "@/renderer/bridge";
import { ThreadComposer } from "@/renderer/components/thread/ThreadComposer";
import { ItemMarkdown } from "@/renderer/components/thread/ChatPane/parts/items/ItemMarkdown";
import { useWebChatStore } from "@/renderer/state/webChatStore";
import type { WebChatSession } from "@/shared/chatGptWeb";

export function ChatGptWebPage() {
  const { t } = useLingui();
  const [sessions, setSessions] = useState<WebChatSession[]>([]);
  const [session, setSession] = useState<WebChatSession>();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const selectedId = session?.id;
  const busy = session?.status === "sending" || session?.status === "streaming";
  const replace = (next: WebChatSession) => {
    setSession(next);
    setSessions((list) => [next, ...list.filter((s) => s.id !== next.id)]);
  };
  useEffect(() => {
    let cancelled = false;
    void readBridge()
      .webChatList()
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setSession(list[0]);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
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
  }, [session?.messages]);
  const create = async () => {
    setPending(true);
    setError(undefined);
    try {
      replace(await readBridge().webChatCreate());
      setPrompt("");
      follow.current = true;
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const send = async () => {
    if (!session || !prompt.trim() || pending || busy) return;
    setPending(true);
    setError(undefined);
    follow.current = true;
    try {
      replace(
        await readBridge().webChatSend({
          sessionId: session.id,
          prompt,
          requestId: crypto.randomUUID(),
        }),
      );
      setPrompt("");
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
    if (!session) return;
    setError(undefined);
    try {
      await readBridge().webChatReveal({ sessionId: session.id });
    } catch (e) {
      setError(String(e));
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
        <div className="ml-auto flex min-w-0 items-center gap-2">
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
            isDisabled={pending}
            onPress={() => {
              void create();
            }}
          >
            <Plus className="size-4" />
            <Trans>新对话</Trans>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!session}
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
          {!session && (
            <div className="mx-auto mt-16 max-w-lg text-center">
              <Globe className="mx-auto mb-4 size-12 text-emerald-400" />
              <h2 className="mb-3 text-xl font-semibold">
                <Trans>在这里聊，由 ChatGPT 网页回答</Trans>
              </h2>
              <p className="mb-6 text-sm leading-6 text-muted">
                <Trans>
                  创建对话并在内置浏览器登录
                  ChatGPT。此处发送的文字会提交到网页，回复实时显示在这里；模型和网页工具沿用网页中的选择。
                </Trans>
              </p>
              <Button
                isPending={pending}
                onPress={() => {
                  void create();
                }}
              >
                <Trans>连接 ChatGPT 网页</Trans>
              </Button>
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
        {session && (
          <>
            <p className="mb-2 flex items-center gap-2 text-xs text-muted" role="status">
              <span
                className={`size-1.5 rounded-full ${status === "ready" ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              {statusText}
            </p>
            <ThreadComposer
              prompt={prompt}
              placeholder={t`发送到 ChatGPT 网页…`}
              onPromptChange={setPrompt}
              onSubmit={() => {
                void send();
              }}
              submitLabel={t`发送`}
              submitDisabled={pending || busy || status !== "ready" || !prompt.trim()}
              submitPending={pending}
              stopPending={pending}
              onStop={
                busy
                  ? () => {
                      void stop();
                    }
                  : undefined
              }
              controls={[
                { kind: "static", value: t`跟随网页模型`, icon: <Globe className="size-4" /> },
              ]}
            />
          </>
        )}
      </footer>
    </section>
  );
}
