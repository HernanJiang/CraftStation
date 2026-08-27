import { Bell, FolderPlus, MessageSquarePlus, Plus, Search, Sparkles } from "lucide-react";
import { Dropdown, Label } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { ControlTooltip } from "@/renderer/components/common/ControlTooltip";
import { openNewThread } from "@/renderer/actions/threadActions";
import { usePanelStore } from "@/renderer/state/panelStore";
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

export function SidebarCodexNav() {
  const { t } = useLingui();

  return (
    <section aria-label="CraftStation" className="shrink-0 space-y-2 px-1 pb-1 pt-1">
      <div className="flex items-center gap-2 px-1 pt-1">
        <ControlTooltip label={t`Home`} placement="right" triggerClassName="min-w-0 flex-1">
          <button
            type="button"
            aria-label={t`Home`}
            onClick={() => openNewThread()}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-[var(--row-hover)]"
          >
            <img
              src={brandLogoUrl}
              alt=""
              draggable={false}
              className="size-5 shrink-0 rounded-[6px] object-contain"
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
              className="rounded-xl p-1.5 text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
            >
              <Bell className="size-4" />
            </Dropdown.Trigger>
          </ControlTooltip>
          <Dropdown.Popover placement="bottom end" className="min-w-[260px] rounded-[14px]">
            <Dropdown.Menu aria-label={t`Notifications`}>
              <Dropdown.Item id="runtime" textValue={t`Runtime is ready`}>
                <Sparkles className="size-4 text-amber-400" />
                <Label>{t`Runtime is ready`}</Label>
                <span className="text-[10px] text-muted">CraftStation</span>
              </Dropdown.Item>
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
          <Dropdown.Trigger className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-[var(--surface-secondary)] px-3 text-sm font-medium text-foreground transition-colors hover:bg-[var(--row-active)]">
            <Plus className="size-4" />
            <span>{t`New chat / project`}</span>
          </Dropdown.Trigger>
        </ControlTooltip>
        <Dropdown.Popover placement="bottom start" className="min-w-[250px] rounded-[14px]">
          <Dropdown.Menu
            aria-label={t`New chat / project`}
            onAction={(key) => {
              if (key === "thread") openNewThread();
              if (key === "project-thread") usePanelStore.getState().openSelectProjectModal();
              if (key === "project") usePanelStore.getState().openCreateProjectModal();
            }}
          >
            <Dropdown.Item id="thread" textValue={t`New chat`}>
              <MessageSquarePlus className="size-4 text-muted" />
              <Label>{t`New chat`}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="project-thread" textValue={t`New chat in project`}>
              <FolderPlus className="size-4 text-muted" />
              <Label>{t`New chat in project`}</Label>
            </Dropdown.Item>
            <Dropdown.Item id="project" textValue={t`New project`}>
              <Plus className="size-4 text-muted" />
              <Label>{t`New project`}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    </section>
  );
}
