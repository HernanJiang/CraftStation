import { useState } from "react";
import { ChevronDown, MessageSquare, RefreshCw, ArrowRight } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/renderer/components/common/Button";
import { Popover } from "@heroui/react";
import { chatGptConversationUrl, type WebChatConversation } from "@/shared/chatGptWeb";

export function WebChatConversationRail({
  conversations,
  open,
  onOpenChange,
  currentUrl,
  loading,
  disabled,
  error,
  onRefresh,
  onSelect,
}: {
  conversations: WebChatConversation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl?: string;
  loading: boolean;
  disabled: boolean;
  error?: string;
  onRefresh: () => void;
  onSelect: (url: string) => void;
}) {
  const { t } = useLingui();
  const [value, setValue] = useState("");
  const url =
    chatGptConversationUrl(value.trim()) ??
    (/^[a-zA-Z0-9-]{8,}$/.test(value.trim()) ? `https://chatgpt.com/c/${value.trim()}` : undefined);
  return (
    <aside
      data-testid="webchat-conversation-rail"
      aria-label={t`已有对话`}
      className="relative z-20"
    >
      <Popover isOpen={open} onOpenChange={onOpenChange}>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-2 rounded-full border border-border px-3 text-xs shadow-sm"
          data-testid="webchat-conversations-toggle"
          aria-label={open ? t`收起已有对话` : t`展开已有对话`}
          aria-expanded={open}
        >
          <MessageSquare className="size-3.5" />
          <Trans>已有对话</Trans>
          <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
        {open && (
          <Popover.Content
            placement="bottom end"
            className="z-[60] w-72 max-w-[calc(100vw-4rem)] overflow-hidden rounded-2xl border border-border bg-default p-0 shadow-xl"
            data-testid="webchat-conversations-list"
          >
            <Popover.Dialog className="p-0" aria-label={t`已有对话`}>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium">
                  <Trans>已有对话</Trans>
                </span>
                <Button
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  data-testid="webchat-discover"
                  aria-label={t`刷新列表`}
                  isPending={loading}
                  isDisabled={disabled || loading}
                  onPress={onRefresh}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <div className="max-h-[min(40vh,24rem)] space-y-1 overflow-y-auto px-1 pb-2">
                {conversations.map((item) => (
                  <Button
                    key={item.url}
                    variant="ghost"
                    size="sm"
                    className={`h-auto w-full min-w-0 justify-start rounded-lg px-2 py-2 text-left ${chatGptConversationUrl(currentUrl ?? "") === item.url ? "bg-accent/10" : ""}`}
                    data-webchat-conversation-url={item.url}
                    isDisabled={disabled}
                    onPress={() => onSelect(item.url)}
                  >
                    <span className="flex min-w-0 flex-col gap-1" title={item.url}>
                      <span className="truncate text-xs">{item.title}</span>
                      <span className="truncate font-mono text-[10px] text-muted">
                        {item.url.split("/c/")[1]}
                      </span>
                    </span>
                  </Button>
                ))}
                {!conversations.length && (
                  <p className="px-2 py-3 text-xs leading-5 text-muted">
                    {loading ? t`正在读取已有对话…` : t`登录后自动显示网页已加载的对话。`}
                  </p>
                )}
              </div>
              {error && (
                <p role="alert" className="break-words px-3 pb-2 text-xs text-danger">
                  {error}
                </p>
              )}
              <form
                className="flex min-w-0 gap-1 border-t border-border p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (url && !disabled) {
                    onSelect(url);
                    setValue("");
                  }
                }}
              >
                <input
                  className="min-w-0 flex-1 rounded-lg bg-background px-2 py-1 text-xs"
                  value={value}
                  aria-label={t`ChatGPT 对话链接或 ID`}
                  placeholder={t`对话链接或 ID`}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={disabled}
                />
                <Button
                  type="submit"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={t`导入并继续`}
                  isDisabled={disabled || !url}
                >
                  <ArrowRight className="size-3.5" />
                </Button>
              </form>
            </Popover.Dialog>
          </Popover.Content>
        )}
      </Popover>
    </aside>
  );
}
