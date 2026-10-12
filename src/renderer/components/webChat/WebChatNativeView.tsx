import { useLayoutEffect, useRef } from "react";
import { Trans } from "@lingui/react/macro";
import { Globe } from "lucide-react";
import { Button } from "@/renderer/components/common/Button";
import { useBrowserDockStore } from "@/renderer/state/browserDockStore";
import { useBrowserPanelStore } from "@/renderer/state/browserPanelStore";
import { injectBrowserToMain } from "@/renderer/views/MainView/parts/RightPanel/parts/BrowserPanel/browserWindowActions";

/** The persistent BrowserHost paints the existing guest over this card. */
export function WebChatNativeView({ tabId }: { tabId?: string | undefined }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const extracted = useBrowserPanelStore((s) => s.extracted);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    useBrowserDockStore.getState().setConversationSlot(slot, tabId);
    return () => {
      const store = useBrowserDockStore.getState();
      if (store.conversationSlotEl === slot) store.setConversationSlot(null);
    };
  }, [tabId]);

  return (
    <div
      ref={slotRef}
      data-testid="webchat-native-view"
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--content-background)] p-6"
    >
      <div className="space-y-3 text-center text-sm text-muted">
        <Globe className="mx-auto size-8 text-emerald-400" />
        {extracted ? (
          <>
            <p>
              <Trans>网页已在独立窗口打开</Trans>
            </p>
            <Button
              variant="tertiary"
              onPress={() => {
                void injectBrowserToMain();
              }}
            >
              <Trans>移回对话卡片</Trans>
            </Button>
          </>
        ) : (
          <p role="status">
            <Trans>正在打开网页…</Trans>
          </p>
        )}
      </div>
    </div>
  );
}
