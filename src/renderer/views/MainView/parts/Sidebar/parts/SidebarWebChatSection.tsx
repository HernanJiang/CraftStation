import { useEffect } from "react";
import { ChevronRight, Globe, Pin, Plus, ExternalLink, Trash2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "@heroui/react";
import { friendlyError } from "@/shared/messages";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { SidebarButton } from "@/renderer/components/common/SidebarButton";
import { ContextMenu } from "@/renderer/components/common/ContextMenu";
import { openNewWebChat } from "@/renderer/actions/threadActions";
import { useWebChatStore } from "@/renderer/state/webChatStore";
import { useSidebarUiStore } from "@/renderer/state/sidebarUiStore";
import { chatGptConversationUrl, type WebChatSession } from "@/shared/chatGptWeb";

const REMOTE_SCOPE = "__craftstation_web_remote__";
export const webChatPinKey = (id: string) => `webchat:${id}`;

export function SidebarWebChatRow({ session }: { session: WebChatSession }) {
  const { t } = useLingui();
  const pinned = useSidebarUiStore((s) => s.pinnedProjectIds.includes(webChatPinKey(session.id)));
  const active = useWebChatStore((s) => s.open && s.selectedSessionId === session.id);
  const pin = () => useSidebarUiStore.getState().toggleProjectPinned(webChatPinKey(session.id));
  return (
    <ContextMenu
      items={[
        { id: "pin", label: pinned ? t`Unpin` : t`Pin`, icon: <Pin className="size-4" /> },
        { id: "website", label: t`打开网页`, icon: <ExternalLink className="size-4" /> },
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
        if (key === "delete") useWebChatStore.getState().openSession(session.id, true);
        if (key === "website") {
          useWebChatStore.getState().openSession(session.id);
          void readBridge()
            .webChatReveal({ sessionId: session.id })
            .catch((error) => toast.danger(friendlyError(error)));
        }
      }}
    >
      <div data-webchat-sidebar-session={session.id}>
        <SidebarButton
          icon={<Globe className="size-3.5 shrink-0" />}
          label={session.title}
          size="xs"
          isActive={active}
          onPress={() => useWebChatStore.getState().openSession(session.id)}
          suffix={
            <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted/65">
              {pinned ? <Pin className="size-2.5" /> : null}Remote
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
  const collapsed = useSidebarUiStore((s) => s.collapsedProjects[REMOTE_SCOPE] ?? false);
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
        onPress={() => useSidebarUiStore.getState().toggleProjectCollapsed(REMOTE_SCOPE)}
        suffix={
          <button
            type="button"
            aria-label={t`新增网页对话`}
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
