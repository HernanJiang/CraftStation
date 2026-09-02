import {
  Bot,
  FileDiff,
  FolderOpen,
  Gauge,
  Globe,
  ListChecks,
  MessageCircle,
  NotebookPen,
  TerminalSquare,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import type { RightPanelTab } from "@/renderer/state/panelStore";

/**
 * Single source of truth for panel-tab chrome, shared by the toolbar and
 * every dock section.
 *
 * The old "harness" Crafting Table tab was removed in v1.0.0: the Crafting
 * Table now lives in the model-usage workspace ("合成台" first-level tab).
 * Stale persisted values of "harness" are sanitized by `sanitizePanelTabs`
 * in panelStore instead of being rendered as a dead panel.
 */
export const PANEL_TAB_ICONS: Record<RightPanelTab, LucideIcon> = {
  plan: ListChecks,
  subagent: Bot,
  terminal: TerminalSquare,
  files: FolderOpen,
  git: FileDiff,
  usage: Gauge,
  notes: NotebookPen,
  ports: Waypoints,
  browser: Globe,
  "side-chat": MessageCircle,
};

export function usePanelTabLabels(): Record<RightPanelTab, string> {
  const { t } = useLingui();
  return {
    plan: t`Plan`,
    subagent: t`Subagent`,
    terminal: t`Terminal`,
    files: t`Files`,
    git: t`Review`,
    usage: t`Usage`,
    notes: t`Notes`,
    ports: t`Ports`,
    browser: t`Browser`,
    "side-chat": t`Side Chat`,
  };
}
