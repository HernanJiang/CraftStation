import { startTransition, type ReactNode } from "react";
import { Gauge, Hammer, Settings2 } from "lucide-react";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { useLingui } from "@lingui/react/macro";
import { i18n } from "@/renderer/i18n/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { normalizeTopShortcutOrder } from "@/shared/settings";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { isDevApp, isRemoteSession } from "@/renderer/bridge";
import {
  pinnableSettingsNavigationItems,
  settingsNavigationItem,
  settingsSectionKeywords,
  type SettingsNavigationItem,
} from "@/renderer/views/SettingsOverlay/parts/settingsNavigationRegistry";
import type { SettingsSection } from "@/renderer/views/SettingsOverlay/parts/types";

/** Stable pin identities. Sections are namespaced (`settings.<section>`). */
export type TopShortcutPin =
  | { kind: "crafting" }
  | { kind: "modelUsage" }
  | { kind: "settingsHome" }
  | { kind: "settings"; section: SettingsSection };

export function parseTopShortcutId(id: string): TopShortcutPin | undefined {
  if (id === "crafting") return { kind: "crafting" };
  if (id === "modelUsage") return { kind: "modelUsage" };
  if (id === "settingsHome") return { kind: "settingsHome" };
  if (id.startsWith("settings.")) {
    const section = id.slice("settings.".length) as SettingsSection;
    const item = settingsNavigationItem(section);
    if (!item || item.pinnable === false) return undefined;
    return { kind: "settings", section };
  }
  return undefined;
}

export function topShortcutIdForPin(pin: TopShortcutPin): string {
  if (pin.kind === "settings") return `settings.${pin.section}`;
  return pin.kind;
}

export interface TopShortcutEntry {
  id: string;
  icon: ReactNode;
  label: string;
  isActive: boolean;
  onPress: () => void;
}

export interface TopShortcutPickerItem {
  id: string;
  icon: ReactNode;
  label: string;
  keywords: string;
  pinned: boolean;
}

function SpecialIcon(props: { kind: "crafting" | "modelUsage" | "settingsHome" }) {
  if (props.kind === "crafting") return <Hammer className="size-3.5 text-amber-300" />;
  if (props.kind === "modelUsage") return <Gauge className="size-3.5" />;
  return <Settings2 className="size-3.5" />;
}

/**
 * Pinned titlebar shortcuts: the user's ordered pins resolved against the
 * shared settings-navigation registry. Unknown ids (removed sections, future
 * ids from a newer build) are skipped so a stale pref can never break the bar.
 * Single source of truth with the Settings sidebar + shortcut picker.
 */
export function useTopShortcuts(): TopShortcutEntry[] {
  const { t } = useLingui();
  const savedOrder = useSharedSettings((s) => s.topShortcutOrder);
  const settingsOpen = usePanelStore((s) => s.settingsOpen);
  const settingsSection = usePanelStore((s) => s.settingsSection);
  const modelUsageDialogOpen = usePanelStore((s) => s.modelUsageDialogOpen);
  const modelUsageWorkspaceTab = usePanelStore((s) => s.modelUsageWorkspaceTab);

  const entries: TopShortcutEntry[] = [];
  for (const id of normalizeTopShortcutOrder(savedOrder)) {
    const pin = parseTopShortcutId(id);
    if (!pin) continue;
    if (pin.kind === "crafting") {
      entries.push({
        id,
        icon: <SpecialIcon kind="crafting" />,
        label: t`Crafting Table`,
        isActive: modelUsageDialogOpen && modelUsageWorkspaceTab === "crafting",
        onPress: () => usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting" }),
      });
    } else if (pin.kind === "modelUsage") {
      entries.push({
        id,
        icon: <SpecialIcon kind="modelUsage" />,
        label: t`Usage`,
        isActive: modelUsageDialogOpen && modelUsageWorkspaceTab === "stats",
        onPress: () => usePanelStore.getState().openModelUsageWorkspace({ tab: "stats" }),
      });
    } else if (pin.kind === "settingsHome") {
      entries.push({
        id,
        icon: <SpecialIcon kind="settingsHome" />,
        label: t`Settings`,
        isActive: settingsOpen && settingsSection === null,
        onPress: () => usePanelStore.getState().openSettings(),
      });
    } else {
      const item = settingsNavigationItem(pin.section);
      if (!item) continue;
      const Icon = item.icon;
      entries.push({
        id,
        icon: <Icon className="size-3.5" />,
        label: i18n._(item.label),
        isActive: settingsOpen && settingsSection === pin.section,
        onPress: () =>
          startTransition(() => usePanelStore.getState().openSettingsSection(pin.section)),
      });
    }
  }
  return entries;
}

/** Fixed special pins offered by the shortcut picker alongside registry pages. */
const TOP_SHORTCUT_SPECIALS: readonly {
  id: string;
  icon: ReactNode;
  label: MessageDescriptor;
  keywords: string;
}[] = [
  {
    id: "crafting",
    icon: <Hammer className="size-4 text-amber-300" />,
    label: msg`Crafting Table`,
    keywords: "crafting table recipes models",
  },
  {
    id: "modelUsage",
    icon: <Gauge className="size-4" />,
    label: msg`Usage`,
    keywords: "usage models quota",
  },
  {
    id: "settingsHome",
    icon: <Settings2 className="size-4" />,
    label: msg`Settings`,
    keywords: "settings preferences",
  },
];

/**
 * Everything the shortcut picker can offer: fixed specials first, then the
 * registry pages (future registry items appear automatically). Each entry
 * carries its pinned state so the picker can split added/available.
 */
export function getTopShortcutPickerItems(
  query: string,
  pinnedIds: ReadonlySet<string>,
): TopShortcutPickerItem[] {
  const remoteSession = isRemoteSession();
  const devMode = isDevApp();
  const needle = query.trim().toLowerCase();
  const matches = (label: string, keywords: string, id: string) =>
    needle === "" ||
    label.toLowerCase().includes(needle) ||
    keywords.toLowerCase().includes(needle) ||
    id.toLowerCase().includes(needle);

  const items: TopShortcutPickerItem[] = [];
  const seen = new Set<string>();
  const pushSpecial = (entry: (typeof TOP_SHORTCUT_SPECIALS)[number]) => {
    const label = i18n._(entry.label);
    if (seen.has(entry.id) || !matches(label, entry.keywords, entry.id)) return;
    seen.add(entry.id);
    items.push({
      id: entry.id,
      icon: entry.icon,
      label,
      keywords: entry.keywords,
      pinned: pinnedIds.has(entry.id),
    });
  };
  for (const special of TOP_SHORTCUT_SPECIALS) pushSpecial(special);
  const pages: SettingsNavigationItem[] = pinnableSettingsNavigationItems({
    remoteSession,
    devMode,
  });
  for (const item of pages) {
    const id = `settings.${item.id}`;
    const label = i18n._(item.label);
    const keywords = settingsSectionKeywords(item.id);
    if (seen.has(id) || !matches(label, keywords, id)) continue;
    seen.add(id);
    const Icon = item.icon;
    items.push({
      id,
      icon: <Icon className="size-4" />,
      label,
      keywords,
      pinned: pinnedIds.has(id),
    });
  }
  return items;
}
