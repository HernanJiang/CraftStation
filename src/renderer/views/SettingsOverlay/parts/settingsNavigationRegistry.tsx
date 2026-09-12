import { defineMessage, msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import {
  Archive,
  Bell,
  Box,
  Cable,
  FlaskConical,
  GitFork,
  Globe,
  FolderGit2,
  Info,
  Keyboard,
  Layers,
  Megaphone,
  MessageSquare,
  Mic,
  Palette,
  Puzzle,
  Gauge,
  QrCode,
  Search,
  Server,
  Settings2,
  Sparkles,
  TerminalSquare,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { SettingsSection } from "./types";
import { SETTINGS_SEARCH_INDEX } from "./settingsSearchIndex";

export type SettingsNavigationGroupId = "personal" | "workspace" | "agents" | "remote" | "about";

/**
 * One static Settings page. `id` is the stable identity (never the localized
 * label — CraftStation uses Lingui/i18n). Labels reuse the sidebar's exact
 * source strings (byte-identical `msg` descriptors, same `comment` context
 * where the sidebar has one) so no new catalog entries are created.
 */
export interface SettingsNavigationItem {
  /** Stable identity, e.g. "mcpServers". Also the `openSettingsSection` route. */
  id: SettingsSection;
  group: SettingsNavigationGroupId;
  label: MessageDescriptor;
  icon: LucideIcon;
  /** False for entries that must not appear in the top-bar shortcut picker. */
  pinnable?: boolean;
  /** Hidden in remote (PWA) sessions; mirrors the sidebar gate. */
  desktopOnly?: boolean;
  /** Only rendered in dev builds; mirrors the sidebar gate. */
  devOnly?: boolean;
}

export interface SettingsNavigationGroup {
  id: SettingsNavigationGroupId;
  label: MessageDescriptor;
  items: readonly SettingsNavigationItem[];
}

const personal: SettingsNavigationItem[] = [
  { id: "profile", group: "personal", label: msg`Profile`, icon: UserRound },
  { id: "workspaces", group: "personal", label: msg`Workspaces`, icon: Layers },
  { id: "general", group: "personal", label: msg`General`, icon: Settings2 },
  { id: "appearance", group: "personal", label: msg`Appearance`, icon: Palette },
  { id: "audio", group: "personal", label: msg`Audio`, icon: Mic },
  { id: "notifications", group: "personal", label: msg`Notifications`, icon: Bell },
  { id: "shortcuts", group: "personal", label: msg`Shortcuts`, icon: Keyboard, desktopOnly: true },
];

const workspace: SettingsNavigationItem[] = [
  { id: "terminal", group: "workspace", label: msg`Terminal`, icon: TerminalSquare },
  {
    id: "threads",
    group: "workspace",
    label: msg`Threads`,
    icon: MessageSquare,
    desktopOnly: true,
  },
  { id: "git", group: "workspace", label: msg`Git`, icon: GitFork },
  { id: "worktrees", group: "workspace", label: msg`Worktrees`, icon: FolderGit2 },
  { id: "search", group: "workspace", label: msg`Search`, icon: Search, desktopOnly: true },
  { id: "browser", group: "workspace", label: msg`Browser`, icon: Globe, desktopOnly: true },
  {
    id: "archived",
    group: "workspace",
    label: msg`Archived Threads`,
    icon: Archive,
    desktopOnly: true,
  },
];

const agents: SettingsNavigationItem[] = [
  {
    id: "ai",
    group: "agents",
    label: defineMessage({
      message: "AI Helpers",
      comment:
        "Settings section: AI helper features (commit messages, thread titles, conflict resolution)",
    }),
    icon: Sparkles,
  },
  { id: "skills", group: "agents", label: msg`Skills`, icon: Box, desktopOnly: true },
  { id: "mcpServers", group: "agents", label: msg`MCP Servers`, icon: Cable, desktopOnly: true },
  { id: "plugins", group: "agents", label: msg`Plugins`, icon: Puzzle, desktopOnly: true },
  {
    id: "usage",
    group: "agents",
    label: defineMessage({
      message: "Provider Usage",
      comment: "Settings section: provider usage and quota dashboard",
    }),
    icon: Gauge,
  },
];

const remote: SettingsNavigationItem[] = [
  {
    id: "remoteAccess",
    group: "remote",
    label: msg`Remote Access`,
    icon: QrCode,
    desktopOnly: true,
  },
  {
    id: "remoteServers",
    group: "remote",
    label: msg`Remote Environments`,
    icon: Server,
    desktopOnly: true,
  },
];

const about: SettingsNavigationItem[] = [
  { id: "changelog", group: "about", label: msg`Changelog`, icon: Megaphone },
  { id: "about", group: "about", label: msg`About`, icon: Info, desktopOnly: true },
  {
    id: "dev",
    group: "about",
    label: defineMessage({ message: "Dev", comment: "Settings section: developer/debug tools" }),
    icon: FlaskConical,
    pinnable: false,
    devOnly: true,
  },
];

export const SETTINGS_NAVIGATION: readonly SettingsNavigationGroup[] = [
  { id: "personal", label: msg`Personal`, items: personal },
  { id: "workspace", label: msg`Workspace`, items: workspace },
  { id: "agents", label: msg`Agents`, items: agents },
  { id: "remote", label: msg`Remote`, items: remote },
  { id: "about", label: msg`About`, items: about },
];

/** Flat lookup shared by the sidebar, the shortcut picker, and tests. */
const SETTINGS_NAVIGATION_BY_ID = new Map<SettingsSection, SettingsNavigationItem>();
for (const group of SETTINGS_NAVIGATION) {
  for (const item of group.items) SETTINGS_NAVIGATION_BY_ID.set(item.id, item);
}

export function settingsNavigationItem(id: SettingsSection): SettingsNavigationItem | undefined {
  return SETTINGS_NAVIGATION_BY_ID.get(id);
}

/**
 * Pinnable pages for the top-bar shortcut picker. Future registry items appear
 * here automatically (unless `pinnable === false`) — no TopBar change needed.
 * Visibility gates mirror the sidebar: remote sessions drop `desktopOnly`
 * items, non-dev builds drop `devOnly` items.
 */
export function pinnableSettingsNavigationItems(options?: {
  remoteSession?: boolean;
  devMode?: boolean;
}): SettingsNavigationItem[] {
  const remoteSession = options?.remoteSession === true;
  const devMode = options?.devMode === true;
  return SETTINGS_NAVIGATION.flatMap((group) => group.items).filter(
    (item) =>
      item.pinnable !== false &&
      (!remoteSession || !item.desktopOnly) &&
      (devMode || !item.devOnly),
  );
}

/** Aggregated search keywords per section, reused from the settings search index. */
const SECTION_KEYWORDS = new Map<SettingsSection, string>();
for (const entry of SETTINGS_SEARCH_INDEX) {
  if (!entry.keywords) continue;
  const prev = SECTION_KEYWORDS.get(entry.section);
  SECTION_KEYWORDS.set(entry.section, prev ? `${prev} ${entry.keywords}` : entry.keywords);
}

export function settingsSectionKeywords(section: SettingsSection): string {
  return SECTION_KEYWORDS.get(section) ?? "";
}
