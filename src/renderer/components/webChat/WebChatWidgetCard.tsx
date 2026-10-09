import { useEffect, useRef, useState } from "react";
import { Modal } from "@heroui/react";
import { readBridge } from "@/renderer/bridge";
import { Button } from "@/renderer/components/common/Button";
import type { WebChatWidget, WebChatWidgetFrame, WebChatWidgetInput } from "@/shared/chatGptWeb";

export function WebChatWidgetCard({
  sessionId,
  widget,
  active,
  onActivate,
  onEdit,
}: {
  sessionId: string;
  widget: WebChatWidget;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState<WebChatWidgetFrame>();
  const [error, setError] = useState<string>();
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const surface = useRef<HTMLDivElement>(null);
  const inputQueue = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(false);
  const pressed = useRef(false);
  const lastMove = useRef(0);
  useEffect(() => {
    if (!active) {
      setFrame(undefined);
      setExpanded(false);
      return;
    }
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const refresh = async () => {
      try {
        inputQueue.current = inputQueue.current
          .catch(() => {})
          .then(async () => {
            if (cancelled) return;
            const next = await readBridge().webChatWidgetFrame({ sessionId, widgetId: widget.id });
            if (!cancelled) {
              frameRef.current = next;
              setFrame(next);
              setError(undefined);
            }
          });
        await inputQueue.current;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "组件同步失败");
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void refresh();
        }, 250);
    };
    void refresh();
    return () => {
      cancelled = true;
      alive.current = false;
      pressed.current = false;
      clearTimeout(timer);
      void inputQueue.current
        .catch(() => {})
        .then(() => readBridge().webChatWidgetClose({ sessionId, widgetId: widget.id }))
        .catch(() => {});
    };
  }, [active, sessionId, widget.id, retry]);
  const dispatch = (input: WebChatWidgetInput) => {
    const current = frameRef.current;
    const localFocus = document.activeElement;
    if (!current || !alive.current) return;
    inputQueue.current = inputQueue.current
      .then(async () => {
        if (!alive.current) return;
        await readBridge().webChatWidgetInput({
          sessionId,
          widgetId: widget.id,
          frameId: current.frameId,
          input,
        });
        if (
          localFocus instanceof HTMLElement &&
          localFocus.isConnected &&
          document.activeElement?.tagName === "WEBVIEW"
        )
          localFocus.focus({ preventScroll: true });
      })
      .catch((e: unknown) => {
        if (alive.current) setError(e instanceof Error ? e.message : "组件操作失败");
      });
  };
  const point = (clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.x) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.y) / rect.height)),
    };
  };
  useEffect(() => {
    const node = surface.current;
    if (!node || !active) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      dispatch({
        kind: "scroll",
        ...point(e.clientX, e.clientY),
        deltaX: Math.min(2000, Math.max(-2000, e.deltaX)),
        deltaY: Math.min(2000, Math.max(-2000, e.deltaY)),
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  });
  const save = async () => {
    if (!frame) return;
    try {
      const bytes = Uint8Array.from(atob(frame.dataUrl.split(",")[1]!), (c) => c.charCodeAt(0));
      const path = await readBridge().saveImageFile({
        data: bytes,
        suggestedName: "ChatGPT-组件.png",
      });
      if (path) setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    }
  };
  const viewer = frame && (
    <div
      ref={surface}
      role="button"
      aria-roledescription="交互组件"
      aria-label={`${widget.title}：点击、拖动或使用键盘操作`}
      tabIndex={0}
      data-testid="webchat-widget-surface"
      className="relative w-full touch-none select-none overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      style={{ aspectRatio: `${frame.width}/${frame.height}` }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        pressed.current = true;
        dispatch({ kind: "pointer", phase: "down", ...point(e.clientX, e.clientY), pressed: true });
      }}
      onPointerMove={(e) => {
        if (Date.now() - lastMove.current < 32) return;
        lastMove.current = Date.now();
        dispatch({
          kind: "pointer",
          phase: "move",
          ...point(e.clientX, e.clientY),
          pressed: pressed.current,
        });
      }}
      onPointerUp={(e) => {
        if (!pressed.current) return;
        pressed.current = false;
        dispatch({ kind: "pointer", phase: "up", ...point(e.clientX, e.clientY), pressed: false });
      }}
      onPointerCancel={(e) => {
        if (!pressed.current) return;
        pressed.current = false;
        dispatch({ kind: "pointer", phase: "up", ...point(e.clientX, e.clientY), pressed: false });
      }}
      onPaste={(e) => {
        e.preventDefault();
        dispatch({ kind: "text", text: e.clipboardData.getData("text/plain").slice(0, 2000) });
      }}
      onKeyDown={(e) => {
        const keys = [
          "Enter",
          "Tab",
          "Escape",
          "Backspace",
          "Delete",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
          " ",
        ] as const;
        if (keys.some((k) => k === e.key)) {
          e.preventDefault();
          dispatch({
            kind: "key",
            key: (e.key === " " ? "Space" : e.key) as Extract<
              WebChatWidgetInput,
              { kind: "key" }
            >["key"],
            shift: e.shiftKey,
          });
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          dispatch({ kind: "text", text: e.key });
        }
      }}
    >
      <img
        src={frame.dataUrl}
        alt={`${widget.title}的实时画面；文字说明见原回复`}
        draggable={false}
        className="pointer-events-none block size-full"
      />
    </div>
  );
  return (
    <section
      className="my-3 min-w-0 rounded-xl border border-border bg-default/20 p-3"
      data-testid="webchat-widget-card"
      data-widget-id={widget.id}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="mr-auto min-w-0 truncate text-sm font-medium">{widget.title}</span>
        {!active ? (
          <Button size="sm" variant="secondary" onPress={onActivate}>
            打开交互
          </Button>
        ) : (
          <>
            <Button size="sm" variant="tertiary" onPress={() => setExpanded(true)}>
              展开
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={!frame}
              onPress={() => {
                void save();
              }}
            >
              {saved ? "已保存图片" : "保存图片"}
            </Button>
            <Button size="sm" variant="tertiary" onPress={() => setRetry((v) => v + 1)}>
              刷新
            </Button>
          </>
        )}
        <Button size="sm" variant="tertiary" onPress={onEdit}>
          继续修改
        </Button>
      </div>
      {active && !expanded && viewer}
      {active && !frame && !error && (
        <p className="text-xs text-muted" role="status">
          正在连接原网页组件…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {active && (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="向组件输入文字"
            className="min-w-0 flex-1 rounded-lg border border-border bg-default px-2 py-1 text-xs"
            placeholder="先点击组件输入框，再输入文字"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            size="sm"
            variant="tertiary"
            isDisabled={!frame || !text}
            onPress={() => {
              dispatch({ kind: "text", text: text.slice(0, 2000) });
              setText("");
            }}
          >
            输入
          </Button>
        </div>
      )}
      <Modal.Backdrop isOpen={expanded} onOpenChange={setExpanded}>
        <Modal.Container>
          <Modal.Dialog className="w-[min(96vw,100rem)] max-w-none">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{widget.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="max-h-[80vh] overflow-auto">{expanded && viewer}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </section>
  );
}
