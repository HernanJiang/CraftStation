import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, Plus, Download, X } from "lucide-react";
import { Modal } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import {
  MAIN_CONTENT_DIALOG_PORTAL_ID,
  useLayoutHeaderPortalTarget,
} from "@/renderer/components/layout/layoutHeaderPortals";
import { readBridge } from "@/renderer/bridge";
import { openNewWebChat } from "@/renderer/actions/threadActions";
import { undockPanelTab } from "@/renderer/actions/panelActions";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useWebChatStore } from "@/renderer/state/webChatStore";
import { chatGptConversationUrl, isChatGptWebUrl } from "@/shared/chatGptWeb";

/** Keep the import guide in the chat area so the source browser remains operable. */
export function WebChatRemoteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const [stage, setStage] = useState<"choose" | "import">("choose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const target = useLayoutHeaderPortalTarget(MAIN_CONTENT_DIALOG_PORTAL_ID);
  const guideRef = useRef<HTMLElement>(null);
  const source = useBrowserPanelStore((s) => s.tabs.find((tab) => tab.tabId === s.activeTabId));
  const sourceUrl = source && !source.loading ? chatGptConversationUrl(source.url) : undefined;

  useEffect(() => {
    if (stage !== "import") return;
    guideRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !pending &&
        event.target instanceof Node &&
        guideRef.current?.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stage, pending, onClose]);

  const openBrowser = async () => {
    setPending(true);
    setError(undefined);
    try {
      const bridge = readBridge();
      const state = await bridge.browserGetState();
      const tab =
        state.tabs.find((item) => item.tabId === state.activeTabId && isChatGptWebUrl(item.url)) ??
        state.tabs.find((item) => isChatGptWebUrl(item.url));
      if (tab) await bridge.browserActivateTab({ tabId: tab.tabId });
      else await bridge.browserCreateTab({ url: "https://chatgpt.com/", activate: true });
      undockPanelTab("browser");
      const panels = usePanelStore.getState();
      panels.setBrowserOverlayOpen(false);
      panels.setBrowserPanelOpen(true);
      panels.setRightPanelTab("browser");
      panels.setAuxiliaryPanelPlacement("right");
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  const importCurrent = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const bridge = readBridge();
      // Re-read at the moment of import; a preview can become stale after navigation.
      const state = await bridge.browserGetState();
      const tab = state.tabs.find((item) => item.tabId === state.activeTabId);
      const url = tab && !tab.loading ? chatGptConversationUrl(tab.url) : undefined;
      if (!url || !tab) throw new Error(t`请先在右侧网页登录并打开要同步的对话，再点击导入。`);
      const session = await bridge.webChatImport({ url, tabId: tab.tabId });
      const store = useWebChatStore.getState();
      store.setSessions([session, ...store.sessions.filter((item) => item.id !== session.id)]);
      store.openSession(session.id);
      if (!store.nativeView) await bridge.webChatReveal({ sessionId: session.id });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  if (stage === "choose")
    return (
      <Modal.Backdrop
        isOpen
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="w-full max-w-md" data-testid="webchat-remote-choice">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>
                <Trans>创建远程对话</Trans>
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <Button
                variant="secondary"
                className="h-auto w-full justify-start gap-3 px-4 py-4"
                data-testid="webchat-remote-new"
                onPress={() => {
                  openNewWebChat();
                  onClose();
                }}
              >
                <Plus className="size-5 shrink-0" />
                <Trans>新建远程网页对话</Trans>
              </Button>
              <Button
                variant="secondary"
                className="h-auto w-full justify-start gap-3 px-4 py-4"
                data-testid="webchat-remote-sync"
                onPress={() => {
                  setStage("import");
                  void openBrowser();
                }}
              >
                <Download className="size-5 shrink-0" />
                <Trans>从已有对话网页同步</Trans>
              </Button>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    );

  return (
    target &&
    createPortal(
      <section
        ref={guideRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="webchat-import-heading"
        tabIndex={-1}
        data-testid="webchat-import-guide"
        className="pointer-events-auto absolute left-4 top-4 w-96 max-w-[calc(100%-2rem)] space-y-4 rounded-2xl border border-border bg-default p-5 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="webchat-import-heading" className="text-sm font-semibold">
            <Trans>从已有对话网页同步</Trans>
          </h2>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label={t`关闭`}
            isDisabled={pending}
            onPress={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>
            <Trans>在右侧网页侧边栏登录 ChatGPT。</Trans>
          </li>
          <li>
            <Trans>在网页中选择并打开要同步的已有对话。</Trans>
          </li>
          <li>
            <Trans>回到此弹窗点击“导入”，同步到左侧远程线程。</Trans>
          </li>
        </ol>
        <div className="rounded-xl bg-background p-3 text-xs" aria-live="polite">
          {sourceUrl ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <Globe className="size-3.5" />
                <span className="truncate">{source?.title}</span>
              </div>
              <p className="break-all font-mono text-muted">{sourceUrl.split("/c/")[1]}</p>
            </>
          ) : (
            <p className="text-muted">
              <Trans>等待在右侧打开已有对话…</Trans>
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="break-words text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="tertiary" isDisabled={pending} onPress={onClose}>
            <Trans>取消</Trans>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isDisabled={pending}
            onPress={() => {
              void openBrowser();
            }}
          >
            <Trans>打开右侧网页</Trans>
          </Button>
          <Button
            size="sm"
            data-testid="webchat-import-current"
            isDisabled={pending || !sourceUrl}
            isPending={pending}
            onPress={() => {
              void importCurrent();
            }}
          >
            <Trans>导入</Trans>
          </Button>
        </div>
      </section>,
      target,
    )
  );
}
