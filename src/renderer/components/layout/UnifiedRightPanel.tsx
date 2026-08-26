export interface AuxiliaryBrowserTab {
  tabId: string;
  title: string;
  url: string;
  faviconUrl?: string | null;
  loading?: boolean;
}
import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Lock, LockOpen, Maximize2, Minimize2, PanelRightClose, Plus, X } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { PanelDockDropZone } from "@/renderer/components/layout/PanelDock/PanelDockDropZone";
import { PanelSectionHeader } from "@/renderer/components/layout/PanelDock/PanelSectionHeader";
import {
  PANEL_TAB_ICONS,
  usePanelTabLabels,
} from "@/renderer/components/layout/PanelDock/panelTabMeta";
import { useSplitPercent } from "@/renderer/components/layout/PanelDock/useSplitPercent";
import {
  panelHeaderIconButtonClass,
  panelHeaderRowClass,
  panelHeaderTabIconButtonClass,
} from "@/renderer/components/layout/sidebarChrome";
import { type RightPanelTab } from "@/renderer/state/panelStore";

export type { RightPanelTab };

const TOOL_MENU_WIDTH_PX = 176;
const TOOL_MENU_VIEWPORT_MARGIN_PX = 8;

export function UnifiedRightPanel(props: {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  terminalContent?: ReactNode;
  gitContent: ReactNode;
  filesContent: ReactNode;
  browserContent: ReactNode;
  usageContent?: ReactNode;
  notesContent?: ReactNode;
  portsContent?: ReactNode;
  planContent?: ReactNode;
  subagentContent?: ReactNode;
  subagentModel?: ReactNode;
  subagentTitle?: ReactNode;
  /** Tab-specific action buttons rendered in the header when the usage tab is active. */
  usageHeaderActions?: ReactNode;
  showTerminalTab?: boolean;
  showFilesTab?: boolean;
  showGitTab?: boolean;
  showUsageTab?: boolean;
  showNotesTab?: boolean;
  showPortsTab?: boolean;
  showPlanTab?: boolean;
  showSubagentTab?: boolean;
  showBrowserTab?: boolean;
  showHarnessTab?: boolean;
  showSideChatTab?: boolean;
  harnessContent?: ReactNode;
  sideChatContent?: ReactNode;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onCloseTab?: (tab: RightPanelTab) => void;
  showPanelCloseButton?: boolean;
  openTabs?: readonly RightPanelTab[];
  browserTabs?: readonly AuxiliaryBrowserTab[];
  activeBrowserTabId?: string;
  onAddTool?: () => void;
  launcherOpen?: boolean;
  launcherContent?: ReactNode;
  onActivateBrowserTab?: (tabId: string) => void;
  onCloseBrowserTab?: (tabId: string) => void;
  onCloseSubagent?: () => void;
  projectName: string | undefined;
  onExpandGitToOverlay?: () => void;
  onExpandFilesToOverlay?: () => void;
  onExpandBrowserToOverlay?: () => void;
  onExtractBrowserToWindow?: () => void;
  onOpenGit?: () => void;
  onOpenTerminal?: () => void;
  onOpenFiles?: () => void;
  onOpenBrowser?: () => void;
  onOpenUsage?: () => void;
  onOpenNotes?: () => void;
  onOpenPorts?: () => void;
  /** Whether the panel re-scopes itself to whichever thread is open. */
  followsThread?: boolean;
  onToggleFollowsThread?: () => void;
  /** Second tab rendered stacked with the active one (drag-and-drop split). */
  splitTab?: RightPanelTab;
  /** Which half of the panel the split tab occupies. */
  splitPlacement?: "top" | "bottom";
  onCloseSplit?: () => void;
  /** Tabs painted in the bottom row; their icons stay lit even though this panel skips them. */
  dockedTabs?: readonly RightPanelTab[];
  onClose?: () => void;
}) {
  const {
    activeTab,
    onTabChange,
    terminalContent,
    gitContent,
    filesContent,
    browserContent,
    usageContent,
    notesContent,
    portsContent,
    planContent,
    subagentContent,
    subagentModel,
    subagentTitle,
    usageHeaderActions,
    showTerminalTab = true,
    showFilesTab = true,
    showGitTab = true,
    showUsageTab = true,
    showNotesTab = true,
    showPortsTab = false,
    showPlanTab = false,
    showSubagentTab = false,
    showBrowserTab = true,
    showHarnessTab = false,
    showSideChatTab = false,
    harnessContent,
    sideChatContent,
    onCloseSubagent,
    onToggleMaximize,
    isMaximized = false,
    onCloseTab,
    openTabs,
    browserTabs = [],
    activeBrowserTabId,
    onAddTool,
    launcherOpen = false,
    launcherContent,
    onActivateBrowserTab,
    onCloseBrowserTab,
    showPanelCloseButton,
    onOpenGit,
    onOpenTerminal,
    onOpenFiles,
    onOpenBrowser,
    onOpenUsage,
    onOpenNotes,
    onOpenPorts,
    followsThread = false,
    onToggleFollowsThread,
    splitTab,
    splitPlacement = "bottom",
    onCloseSplit,
    onClose,
  } = props;
  const { t } = useLingui();
  const shouldShowPanelCloseButton = showPanelCloseButton ?? openTabs !== undefined;
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const toolMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [toolMenuPosition, setToolMenuPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const splitFirstPaneRef = useRef<HTMLDivElement>(null);
  const {
    percent: splitPercent,
    minPercent: splitMinPercent,
    maxPercent: splitMaxPercent,
    handleResizeStart: handleSplitResizeStart,
    handleResizeKeyDown: handleSplitResizeKeyDown,
  } = useSplitPercent({
    storageKey: "poracode-right-panel-split-percent",
    orientation: "column",
    containerRef: splitContainerRef,
    paneRef: splitFirstPaneRef,
    defaultPercent: 50,
    minPercent: 20,
  });
  const hasSubagentModel = activeTab === "subagent" && subagentModel !== undefined;
  const hasSubagentTitle = activeTab === "subagent" && subagentTitle !== undefined;

  /** Inline opacity/transition so animation is not dropped if Tailwind misses dynamic class strings. */
  const tabLayerStyle = (tab: RightPanelTab): CSSProperties => {
    const on = activeTab === tab;
    return {
      opacity: on ? 1 : 0,
      zIndex: on ? 10 : 0,
      pointerEvents: on ? "auto" : "none",
      transition: "opacity 120ms ease-out",
    };
  };

  const dragCtl = "poracode-overlay-header__controls";
  const labels = usePanelTabLabels();
  const tabs = [
    {
      id: "plan",
      label: labels.plan,
      icon: PANEL_TAB_ICONS.plan,
      content: planContent,
      visible: showPlanTab,
      onOpen: undefined,
    },
    {
      id: "subagent",
      label: labels.subagent,
      icon: PANEL_TAB_ICONS.subagent,
      content: subagentContent,
      visible: showSubagentTab,
      onOpen: undefined,
    },
    {
      id: "terminal",
      label: labels.terminal,
      icon: PANEL_TAB_ICONS.terminal,
      content: terminalContent,
      visible: showTerminalTab,
      onOpen: onOpenTerminal,
    },
    {
      id: "files",
      label: labels.files,
      icon: PANEL_TAB_ICONS.files,
      content: filesContent,
      visible: showFilesTab,
      onOpen: onOpenFiles,
    },
    {
      id: "git",
      label: labels.git,
      icon: PANEL_TAB_ICONS.git,
      content: gitContent,
      visible: showGitTab,
      onOpen: onOpenGit,
    },
    {
      id: "usage",
      label: labels.usage,
      icon: PANEL_TAB_ICONS.usage,
      content: usageContent,
      visible: showUsageTab,
      onOpen: onOpenUsage,
    },
    {
      id: "notes",
      label: labels.notes,
      icon: PANEL_TAB_ICONS.notes,
      content: notesContent,
      visible: showNotesTab,
      onOpen: onOpenNotes,
    },
    {
      id: "ports",
      label: labels.ports,
      icon: PANEL_TAB_ICONS.ports,
      content: portsContent,
      visible: showPortsTab,
      onOpen: onOpenPorts,
    },
    {
      id: "browser",
      label: labels.browser,
      icon: PANEL_TAB_ICONS.browser,
      content: browserContent,
      visible: showBrowserTab,
      onOpen: onOpenBrowser,
    },
    {
      id: "harness",
      label: labels.harness,
      icon: PANEL_TAB_ICONS.harness,
      content: harnessContent,
      visible: showHarnessTab,
      onOpen: undefined,
    },
    {
      id: "side-chat",
      label: labels["side-chat"],
      icon: PANEL_TAB_ICONS["side-chat"],
      content: sideChatContent,
      visible: showSideChatTab,
      onOpen: undefined,
    },
  ] as const;

  const splitEntry =
    splitTab && splitTab !== activeTab
      ? tabs.find((tab) => tab.id === splitTab && tab.visible && tab.content !== undefined)
      : undefined;
  // The right panel has two separate concepts: available tools and opened
  // tool tabs.  The old implementation rendered every available tool as a
  // bare icon, which made the header look like a toolbar and hid the actual
  // multi-tab state.  `openTabs` is authoritative when supplied; the fallback
  // keeps this low-level component backwards-compatible for existing callers.
  const visibleTabs = tabs.filter((tab) => tab.visible);
  const openedTabIds = new Set(openTabs ?? visibleTabs.map((tab) => tab.id));
  // Older persisted panel state may contain a selected tab but no entry in the
  // tab list. Keep that selected tab visible until the next store write; this
  // prevents a seemingly dead header after upgrading from the single-tool
  // panel implementation. The launcher intentionally has no selected tab.
  if (!launcherOpen) openedTabIds.add(activeTab);
  const headerTabs = visibleTabs
    .filter((tab) => openedTabIds.has(tab.id))
    .filter(
      (tab) =>
        tab.id !== "browser" ||
        browserTabs.length === 0 ||
        openTabs === undefined ||
        openTabs.includes("browser"),
    );
  const browserTabButtons = browserTabs.map((tab) => ({
    ...tab,
    label: tab.title || tab.url,
  }));
  const addableTabs = visibleTabs.filter((tab) =>
    ["git", "terminal", "browser", "files", "harness", "side-chat"].includes(tab.id),
  );

  const renderToolTab = (tab: (typeof tabs)[number]) => {
    const Icon = tab.icon;
    const onScreen = activeTab === tab.id;
    const handlePress = () => {
      if (tab.onOpen) tab.onOpen();
      // `onOpen` binds project/worktree context for scoped tools. It must not
      // replace the activation path: the tab still has to become the selected
      // tab after that context has been prepared.
      onTabChange(tab.id);
    };
    const buttonClass = `${dragCtl} group inline-flex h-6 min-w-0 items-center gap-1.5 px-2.5 text-xs transition-colors ${
      onCloseTab
        ? "text-current"
        : `rounded-lg ${
            onScreen
              ? "bg-[var(--surface-secondary)] text-foreground shadow-sm"
              : "text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
          }`
    }`;
    const tabButton = (
      <button
        key={tab.id}
        type="button"
        className={buttonClass}
        title={tab.label}
        aria-pressed={onScreen}
        aria-label={tab.label}
        onClick={handlePress}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="max-w-28 truncate">{tab.label}</span>
      </button>
    );
    if (!onCloseTab) return tabButton;
    return (
      <div
        key={tab.id}
        data-tool-tab={tab.id}
        className={`group flex h-6 min-w-0 items-center rounded-lg transition-colors ${
          onScreen
            ? "bg-[var(--surface-secondary)] text-foreground shadow-sm"
            : "text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
        }`}
      >
        {tabButton}
        <button
          type="button"
          aria-label={t`Close ${tab.label}`}
          title={t`Close ${tab.label}`}
          className={`${dragCtl} mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted/70 opacity-70 transition-colors hover:bg-[var(--row-hover)] hover:text-foreground group-hover:opacity-100`}
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
        >
          <X className="size-3" />
        </button>
      </div>
    );
  };

  const renderBrowserTab = (tab: (typeof browserTabButtons)[number]) => (
    <div
      key={tab.tabId}
      data-browser-tool-tab={tab.tabId}
      className={`group flex h-6 min-w-0 items-center rounded-lg transition-colors ${
        activeBrowserTabId === tab.tabId
          ? "bg-[var(--surface-secondary)] text-foreground shadow-sm"
          : "text-muted hover:bg-[var(--row-hover)] hover:text-foreground"
      }`}
    >
      <button
        type="button"
        aria-label={tab.label}
        aria-pressed={activeBrowserTabId === tab.tabId}
        title={tab.label}
        className={`${dragCtl} inline-flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-2.5 text-xs text-current transition-colors`}
        onClick={() => {
          onTabChange("browser");
          onActivateBrowserTab?.(tab.tabId);
        }}
      >
        <span className="max-w-32 truncate">{tab.label}</span>
      </button>
      {onCloseBrowserTab ? (
        <button
          type="button"
          aria-label={t`Close tab`}
          title={t`Close tab`}
          className={`${dragCtl} mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted/70 opacity-70 transition-colors hover:bg-[var(--row-hover)] hover:text-foreground group-hover:opacity-100`}
          onClick={(event) => {
            event.stopPropagation();
            onCloseBrowserTab(tab.tabId);
          }}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div
      data-poracode-panel=""
      data-craftstation-tools-column=""
      className="flex h-full min-h-0 flex-col bg-[var(--content-background)]"
    >
      <div
        className={`poracode-overlay-header ${panelHeaderRowClass} min-w-0 gap-0`}
        data-active-tab={activeTab}
        data-auxiliary-panel-header=""
      >
        {hasSubagentModel ? (
          <div className="flex min-w-0 flex-1 items-center">{subagentModel}</div>
        ) : null}
        <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
          <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto">
            <div data-tool-tab-row="" className="flex h-full min-w-max items-center gap-0.5">
              {headerTabs.map(renderToolTab)}
              {browserTabButtons.map(renderBrowserTab)}
              {onAddTool ? (
                <div
                  ref={toolMenuAnchorRef}
                  data-add-tool-anchor=""
                  className="relative flex h-full shrink-0 items-center"
                >
                  <button
                    type="button"
                    aria-label={t`Add tool`}
                    aria-expanded={toolMenuOpen}
                    title={t`Add tool`}
                    className={`${dragCtl} inline-flex h-6 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground`}
                    onClick={() => {
                      onAddTool();
                      const rect = toolMenuAnchorRef.current?.getBoundingClientRect();
                      if (rect) {
                        setToolMenuPosition({
                          top: rect.bottom + 4,
                          left: Math.max(
                            TOOL_MENU_VIEWPORT_MARGIN_PX,
                            Math.min(
                              rect.left,
                              window.innerWidth - TOOL_MENU_WIDTH_PX - TOOL_MENU_VIEWPORT_MARGIN_PX,
                            ),
                          ),
                        });
                      }
                      setToolMenuOpen((open) => !open);
                    }}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {toolMenuOpen && toolMenuPosition
          ? createPortal(
              <div
                role="menu"
                aria-label={t`Add tool`}
                style={{
                  position: "fixed",
                  top: toolMenuPosition.top,
                  left: toolMenuPosition.left,
                }}
                className="z-[200] min-w-44 rounded-xl border border-white/10 bg-[#222329]/[.98] p-1.5 shadow-2xl backdrop-blur-md"
              >
                {addableTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      className={`${dragCtl} flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-white/[.07] hover:text-white`}
                      onClick={() => {
                        if (tab.onOpen) tab.onOpen();
                        onTabChange(tab.id);
                        setToolMenuOpen(false);
                        setToolMenuPosition(null);
                      }}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                    </button>
                  );
                })}
              </div>,
              document.body,
            )
          : null}
        {activeTab === "usage" ? usageHeaderActions : null}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
          {onToggleFollowsThread ? (
            <button
              type="button"
              className={`${dragCtl} ${panelHeaderTabIconButtonClass(followsThread)}`}
              title={
                followsThread
                  ? t`Unlock panel from the open thread`
                  : t`Lock panel to the open thread`
              }
              aria-pressed={followsThread}
              onClick={onToggleFollowsThread}
            >
              {followsThread ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
            </button>
          ) : null}
          {onToggleMaximize ? (
            <button
              type="button"
              aria-label={isMaximized ? t`Restore side panel` : t`Maximize side panel`}
              className={`${dragCtl} ${panelHeaderIconButtonClass}`}
              title={isMaximized ? t`Restore side panel` : t`Maximize side panel`}
              onClick={onToggleMaximize}
            >
              {isMaximized ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
          ) : null}
          {shouldShowPanelCloseButton ? (
            <button
              type="button"
              aria-label={t`Hide panel`}
              className={`${dragCtl} ${panelHeaderIconButtonClass}`}
              title={t`Hide panel`}
              onClick={onClose}
            >
              <PanelRightClose className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {hasSubagentTitle ? (
        <div className="poracode-right-panel-subagent-meta flex h-6 shrink-0 items-center gap-2 border-b border-[color:var(--border)] px-3">
          <div className="min-w-0 flex-1">{subagentTitle}</div>
          {onCloseSubagent ? (
            <button
              type="button"
              className={`${dragCtl} ${panelHeaderIconButtonClass}`}
              title={t`Close subagent`}
              onClick={onCloseSubagent}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Content — stacked layers cross-fade on tab change; a dropped panel-tab
          splits this area into two stacked sections. */}
      <PanelDockDropZone
        zone="right-panel"
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {(() => {
          if (launcherOpen) {
            return (
              <div data-craftstation-tools-column="" className="flex min-h-0 flex-1 flex-col">
                {launcherContent}
              </div>
            );
          }
          const layerStack = (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {tabs.map((tab) =>
                tab.visible && tab.id !== splitEntry?.id ? (
                  <div
                    key={tab.id}
                    className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                    style={tabLayerStyle(tab.id)}
                  >
                    {tab.content}
                  </div>
                ) : null,
              )}
            </div>
          );

          if (!splitEntry) return layerStack;

          const splitSection = (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <PanelSectionHeader
                tab={splitEntry.id}
                label={splitEntry.label}
                icon={splitEntry.icon}
                {...(onCloseSplit ? { onClose: onCloseSplit } : {})}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {splitEntry.content}
              </div>
            </div>
          );

          return (
            <div ref={splitContainerRef} className="flex h-full min-h-0 flex-col">
              <div
                ref={splitFirstPaneRef}
                className="flex min-h-0 flex-col overflow-hidden"
                style={{ flexBasis: `${splitPercent}%`, flexGrow: 0, flexShrink: 0 }}
              >
                {splitPlacement === "top" ? splitSection : layerStack}
              </div>
              <div
                className="poracode-pane-divider-horizontal"
                onPointerDown={handleSplitResizeStart}
                onKeyDown={handleSplitResizeKeyDown}
                role="separator"
                tabIndex={0}
                aria-orientation="horizontal"
                aria-label={t`Resize split`}
                aria-valuenow={Math.round(splitPercent)}
                aria-valuemin={splitMinPercent}
                aria-valuemax={splitMaxPercent}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {splitPlacement === "top" ? layerStack : splitSection}
              </div>
            </div>
          );
        })()}
      </PanelDockDropZone>
    </div>
  );
}
