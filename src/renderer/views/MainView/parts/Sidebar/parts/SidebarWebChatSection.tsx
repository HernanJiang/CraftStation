import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Globe,
  Pin,
  Plus,
  ExternalLink,
  Trash2,
  EyeOff,
  Pencil,
  Ellipsis,
} from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "@heroui/react";
import { friendlyError } from "@/shared/messages";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { ContextMenu, type ContextMenuOpenRequest } from "@/renderer/components/common/ContextMenu";
import { InlineRenameInput } from "./InlineRenameInput";
import { openNewWebChat } from "@/renderer/actions/threadActions";
import { openWebChatBeside } from "@/renderer/actions/webChatActions";
import { useWebChatStore, WEB_REMOTE_SCOPE } from "@/renderer/state/webChatStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { chatGptConversationUrl, type WebChatSession } from "@/shared/chatGptWeb";

export const webChatPinKey = (id: string) => `webchat:${id}`;

export function SidebarWebChatRow({ session }: { session: WebChatSession }) {
  const { t } = useLingui();
  const pinned = useSidebarUiStore((s) => s.pinnedProjectIds.includes(webChatPinKey(session.id)));
  const active = useWebChatStore((s) => s.open && s.selectedSessionId === session.id);
  const [editing, setEditing] = useState(false);
  const [contextMenuRequest, setContextMenuRequest] = useState<ContextMenuOpenRequest | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const pin = () => useSidebarUiStore.getState().toggleProjectPinned(webChatPinKey(session.id));
  const rename = async (title: string) => {
    setEditing(false);
    try {
      const renamed = await readBridge().webChatRename({ sessionId: session.id, title });
      const store = useWebChatStore.getState();
      store.setSessions(store.sessions.map((item) => (item.id === session.id ? renamed : item)));
    } catch (error) {
      toast.danger(friendlyError(error));
    }
  };
  const iconButtonClass =
    "flex size-[18px] shrink-0 items-center justify-center rounded-md text-muted/70 opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-[var(--row-hover)] hover:text-foreground";
  const forget = async () => {
    try {
      await readBridge().webChatForget({ sessionId: session.id });
      const store = useWebChatStore.getState();
      const list = store.sessions.filter((item) => item.id !== session.id);
      store.setSessions(list);
      if (store.selectedSessionId === session.id) {
        if (list[0]) store.openSession(list[0].id);
        else {
          store.setOpen(false);
          useWebChatStore.setState({ selectedSessionId: undefined, deleteRequestId: undefined });
        }
      }
      const sidebar = useSidebarUiStore.getState();
      if (sidebar.pinnedProjectIds.includes(webChatPinKey(session.id)))
        sidebar.toggleProjectPinned(webChatPinKey(session.id));
    } catch (error) {
      toast.danger(friendlyError(error));
    }
  };
  return (
    <ContextMenu
      openRequest={contextMenuRequest}
      items={[
        { id: "pin", label: pinned ? t`Unpin` : t`Pin`, icon: <Pin className="size-4" /> },
        { id: "rename", label: t`Rename`, icon: <Pencil className="size-4" /> },
        { id: "website", label: t`打开网页`, icon: <ExternalLink className="size-4" /> },
        { id: "forget", label: t`删除对话显示`, icon: <EyeOff className="size-4" /> },
        {
          id: "delete",
          label: t`删除账号中的对话`,
          icon: <Trash2 className="size-4" />,
          variant: "danger",
          isDisabled:
            !chatGptConversationUrl(session.url) ||
            session.status === "sending" ||
            session.status === "streaming",
        },
      ]}
      onAction={(key) => {
        if (key === "pin") pin();
        if (key === "rename") setEditing(true);
        if (key === "forget") void forget();
        if (key === "delete") useWebChatStore.getState().openSession(session.id, true);
        if (key === "website") {
          useWebChatStore.getState().openSession(session.id);
          void (
            useWebChatStore.getState().nativeView
              ? openWebChatBeside(session)
              : readBridge().webChatReveal({ sessionId: session.id })
          ).catch((error) => toast.danger(friendlyError(error)));
        }
      }}
    >
      <div ref={rowRef} data-webchat-sidebar-session={session.id}>
        <SidebarButton
          icon={<Globe className="size-3.5 shrink-0" />}
          label={
            editing ? (
              <InlineRenameInput
                initialValue={session.title}
                onCommit={(title) => void rename(title)}
                onCancel={() => setEditing(false)}
              />
            ) : (
              session.title
            )
          }
          tooltip={editing ? undefined : session.title}
          size="xs"
          isActive={active}
          onPress={() => useWebChatStore.getState().openSession(session.id)}
          onDoubleClick={() => setEditing(true)}
          suffix={
            <span className="ml-auto flex shrink-0 items-center justify-end">
              {pinned ? (
                <button
                  type="button"
                  aria-label={t`Unpin ${session.title}`}
                  className="flex size-[18px] shrink-0 items-center justify-center rounded-md text-foreground hover:bg-[var(--row-hover)]"
                  onClick={(event) => {
                    event.stopPropagation();
                    pin();
                  }}
                >
                  <Pin className="size-3 fill-current" />
                </button>
              ) : null}
              <span
                data-webchat-row-actions
                className={`flex w-0 items-center gap-0.5 overflow-hidden transition-[width] ${pinned ? "group-hover:w-[38px] group-focus-within:w-[38px]" : "group-hover:w-[58px] group-focus-within:w-[58px]"}`}
              >
                {!pinned ? (
                  <button
                    type="button"
                    aria-label={t`Pin ${session.title}`}
                    className={iconButtonClass}
                    onClick={(event) => {
                      event.stopPropagation();
                      pin();
                    }}
                  >
                    <Pin className="size-3" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={t`More actions for ${session.title}`}
                  className={iconButtonClass}
                  data-webchat-more
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenuRequest({ x: rect.right, y: rect.bottom, nonce: Date.now() });
                  }}
                >
                  <Ellipsis className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t`删除对话显示`}
                  className={iconButtonClass}
                  data-webchat-forget
                  onClick={(event) => {
                    event.stopPropagation();
                    void forget();
                  }}
                >
                  <EyeOff className="size-3" />
                </button>
              </span>
            </span>
          }
        />
      </div>
    </ContextMenu>
  );
}

/** 网页账号会话独立于本地 Harness 项目，不伪造 cwd 或上下文额度。 */
export function SidebarWebChatSection() {
  const { t } = useLingui();
  const sessions = useWebChatStore((s) => s.sessions);
  const collapsed = useSidebarUiStore((s) => s.collapsedProjects[WEB_REMOTE_SCOPE] ?? false);
  useEffect(() => {
    if (isRemoteSession()) return;
    let cancelled = false;
    void readBridge()
      .webChatList()
      .then((list) => {
        if (!cancelled) useWebChatStore.getState().setSessions(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (isRemoteSession()) return null;
  return (
    <section className="space-y-0.5" data-testid="sidebar-web-remote">
      <SidebarButton
        icon={
          <ChevronRight
            className={`size-3.5 transition-transform ${collapsed ? "" : "rotate-90"}`}
          />
        }
        label={
          <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Globe className="size-3.5 text-muted" />
            <Trans>远程</Trans>
          </span>
        }
        className="craftstation-sidebar-project-nudge !pl-1"
        onPress={() => useSidebarUiStore.getState().toggleProjectCollapsed(WEB_REMOTE_SCOPE)}
        suffix={
          <button
            type="button"
            aria-label={t`新增网页对话`}
            data-testid="webchat-add-remote"
            className="rounded p-1 hover:bg-[var(--row-hover)]"
            onClick={(e) => {
              e.stopPropagation();
              openNewWebChat();
            }}
          >
            <Plus className="size-3" />
          </button>
        }
      />
      {!collapsed &&
        sessions.map((session) => <SidebarWebChatRow key={session.id} session={session} />)}
    </section>
  );
}
