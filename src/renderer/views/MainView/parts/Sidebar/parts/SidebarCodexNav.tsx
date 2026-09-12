import { Bell, FolderPlus, MessageSquarePlus, Plus, Search, Trash2 } from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { openThread, openNewThread } from "@/renderer/actions/threadActions";
import { usePanelStore } from "@/renderer/state/panelStore";
import {
  selectHasUnread,
  useNotificationStore,
  type NotificationItem,
} from "@/renderer/state/notificationStore";
import brandLogoUrl from "@/renderer/assets/craftstation-logo.png";

/**
 * Codex-style sidebar top block (v0.2.4+, layout 1:1 to Codex Desktop).
 *
 * The CraftStation brand is intentionally static: unlike Codex's workspace
 * switcher it has no nested destination, so it must not suggest a dropdown.
 * Nav rows mirror Codex: New chat / Pull
 * requests / Sites / Schedules / Work / Plugins. Rows with a real
 * CraftStation destination are wired to the existing actions; Sites and
 * Plugins are display-only placeholders for this UI iteration.
 */

const TONE_DOT_CLASS: Record<NotificationItem["tone"], string> = {
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
  info: "bg-sky-400",
};

function formatNotificationTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    createdAt,
  );
}

export function SidebarCodexNav() {
  const { t } = useLingui();
  const notifications = useNotificationStore((state) => state.items);
  const hasUnread = useNotificationStore((state) => selectHasUnread(state.items));

  const openNotificationThread = (threadId: string | undefined) => {
    if (threadId) openThread(threadId, { focusComposer: true, switchWorkspace: true });
  };

  return (
    <section aria-label="CraftStation" className="shrink-0 space-y-2 px-1 pb-1 pt-1">
      <div className="flex items-center gap-2 px-1 pt-1">
        <ControlTooltip label={t`Home`} placement="right" triggerClassName="min-w-0 flex-1">
          <button
            type="button"
            aria-label={t`Home`}
            onClick={() => openNewThread()}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-none px-1 py-1 text-left transition-colors hover:bg-[var(--row-hover)]"
          >
            <img
              src={brandLogoUrl}
              alt=""
              draggable={false}
              className="size-5 shrink-0 rounded-none object-contain"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
              CraftStation
            </span>
          </button>
        </ControlTooltip>
        <ControlTooltip label={t`Search`} placement="right">
          <button
            type="button"
            aria-label={t`Search`}
            onClick={() => usePanelStore.getState().openThreadSearch()}
            className="rounded-xl p-1.5 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
          >
            <Search className="size-4" />
          </button>
        </ControlTooltip>
        <Dropdown>
          <ControlTooltip label={t`Notifications`} placement="right">
            <Dropdown.Trigger
              aria-label={t`Notifications`}
              className="relative rounded-xl p-1.5 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
            >
              <Bell className="size-4" />
              {hasUnread ? (
                <span
                  aria-hidden="true"
                  data-testid="notification-unread-dot"
                  className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-400"
                />
              ) : null}
            </Dropdown.Trigger>
          </ControlTooltip>
          <Dropdown.Popover placement="bottom end" className="min-w-[280px] rounded-none">
            <Dropdown.Menu
              aria-label={t`Notifications`}
              onAction={(key) => {
                if (key === "clear-notifications") {
                  useNotificationStore.getState().clear();
                  return;
                }
                const item = notifications.find((entry) => entry.id === key);
                if (!item) return;
                openNotificationThread(item.threadId);
                useNotificationStore.getState().remove(item.id);
              }}
            >
              {notifications.length === 0 ? (
                <Dropdown.Item id="empty" textValue={t`No notifications`} className="rounded-none">
                  <span className="min-w-0 flex-1 whitespace-normal break-words text-[11px] text-muted">
                    {t`No notifications`}
                  </span>
                </Dropdown.Item>
              ) : (
                notifications.map((item) => (
                  <Dropdown.Item
                    key={item.id}
                    id={item.id}
                    textValue={item.title}
                    className="rounded-none"
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${TONE_DOT_CLASS[item.tone]}`}
                    />
                    <span className="min-w-0 flex-1">
                      <Label>
                        <span className="block min-w-0 whitespace-normal break-words text-xs font-medium text-foreground">
                          {item.title}
                        </span>
                      </Label>
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted">
                        <span className="min-w-0 whitespace-normal break-words">{item.status}</span>
                        {item.project ? (
                          <span className="shrink-0 opacity-70">{item.project}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted">
                      {formatNotificationTime(item.createdAt)}
                    </span>
                  </Dropdown.Item>
                ))
              )}
              {notifications.length > 0 ? (
                <Dropdown.Item id="clear-notifications" textValue={t`Clear all`}>
                  <Trash2 className="size-3.5 shrink-0 text-muted" />
                  <Label>
                    <span className="text-[11px] text-muted">{t`Clear all`}</span>
                  </Label>
                </Dropdown.Item>
              ) : null}
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>

      <Dropdown>
        <ControlTooltip
          label={t`New session`}
          shortcut="Ctrl+N"
          placement="right"
          triggerClassName="w-full"
        >
          <Dropdown.Trigger className="flex h-9 w-full items-center justify-center gap-2 rounded-none bg-[var(--surface-secondary)] px-3 text-sm font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
            <Plus className="size-4" />
            <span>{t`New chat / project`}</span>
          </Dropdown.Trigger>
        </ControlTooltip>
        <Dropdown.Popover placement="bottom start" className="min-w-[250px] rounded-none">
          <Dropdown.Menu
            aria-label={t`New chat / project`}
            onAction={(key) => {
              if (key === "thread") openNewThread();
              if (key === "project-thread") usePanelStore.getState().openSelectProjectModal();
              if (key === "project") usePanelStore.getState().openCreateProjectModal();
            }}
          >
            <Dropdown.Item id="thread" textValue={t`New chat`} className="rounded-none">
              <MessageSquarePlus className="size-4 text-muted" />
              <Label>{t`New chat`}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="project-thread" textValue={t`New chat in project`} className="rounded-none">
              <FolderPlus className="size-4 text-muted" />
              <Label>{t`New chat in project`}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="project" textValue={t`New project`} className="rounded-none">
              <Plus className="size-4 text-muted" />
              <Label>{t`New project`}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </section>
  );
}
