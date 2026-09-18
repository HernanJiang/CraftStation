import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { AgentCapability, AgentStatus, ScheduledTask } from "@/shared/contracts";

const bridgeMock = vi.hoisted(() => ({
  appVersion: "1.0.1",
  getLatestAgentVersion:
    vi.fn<(payload: { agentKind: string }) => Promise<{ version?: string; source?: string }>>(),
  updateAgentBinary: vi.fn<() => Promise<{ ok: boolean; output?: string }>>(),
  refreshAgentStatuses: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
  checkForUpdate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  openExternal: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined),
}));

const toastMock = vi.hoisted(() => ({
  danger: vi.fn<(message: string) => void>(),
  success: vi.fn<(message: string) => void>(),
}));

const capabilities: AgentCapability = {
  models: [{ id: "auto", label: "Auto" }],
  efforts: [],
  modelEfforts: {},
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "server",
  presentationMode: "gui",
  settingDefs: [],
};

const codexStatus: AgentStatus = {
  kind: "codex",
  label: "Codex",
  installed: true,
  version: "1.0.0",
  update: { builtIn: { binary: "codex", args: ["update"] } },
  authState: "authenticated",
  envKind: "windows",
  capabilities,
};

const agentStatusesState = { agentStatuses: [codexStatus], wslAgentStatuses: [] };
const appState = {
  view: { kind: "thread", panes: [] },
  openPullRequests: vi.fn<() => void>(),
  openSchedules: vi.fn<() => void>(),
  openGitHubActions: vi.fn<() => void>(),
};
const panelState = {
  setAuxiliaryPanelPlacement: vi.fn<() => void>(),
  setAuxiliaryPanelTab: vi.fn<() => void>(),
  setRightPanelTab: vi.fn<() => void>(),
};
const panelActions = {
  ...panelState,
  openSettingsSection: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  openModelUsageDialog: vi.fn<() => void>(),
};
const updateState = { phase: "idle", version: undefined, downloadPercent: 0 };

const updateStoreMock = vi.hoisted(() => {
  type MockState = { phase: string };
  const listeners = new Set<(state: MockState) => void>();
  return {
    state: { phase: "idle" } as MockState,
    subscribe(listener: (state: MockState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPhase(phase: string) {
      this.state = { phase };
      for (const listener of [...listeners]) listener(this.state);
    },
    reset() {
      this.state = { phase: "idle" };
      listeners.clear();
    },
  };
});

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
  isRemoteSession: () => false,
  isDevApp: () => false,
  isWindows: () => true,
}));

vi.mock("@/renderer/state/agentStatusesStore", () => ({
  useAgentStatusesStore: (selector: (state: unknown) => unknown) => selector(agentStatusesState),
}));

vi.mock("@/renderer/state/appStore", () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(appState),
}));

vi.mock("@/renderer/state/panelStore", () => ({
  usePanelStore: Object.assign((selector: (state: unknown) => unknown) => selector(panelState), {
    getState: () => panelActions,
  }),
}));

vi.mock("@/renderer/state/updateStore", () => ({
  useUpdateStore: Object.assign((selector: (state: unknown) => unknown) => selector(updateState), {
    getState: () => ({
      phase: updateStoreMock.state.phase,
      setAvailableCliUpdates: vi.fn<() => void>(),
      beginAgentUpdate: vi.fn<() => void>(),
      finishAgentUpdate: vi.fn<() => void>(),
    }),
    subscribe: updateStoreMock.subscribe,
  }),
}));

vi.mock("@/renderer/state/sidebarOverlayStore", () => ({
  toggleSidebar: vi.fn<() => void>(),
}));

vi.mock("@/renderer/actions/recentThreadCycle", () => ({
  cycleRecentThread: vi.fn<(direction: number) => void>(),
}));

vi.mock("@/renderer/components/common/ControlTooltip", () => ({
  ControlTooltip: ({ children }: { children: ReactNode }) => children,
}));

function Trigger(props: ComponentProps<"button"> & { onPress?: () => void }) {
  const { onPress, ...rest } = props;
  return <button type="button" {...rest} onClick={onPress} />;
}

function PressableItem(props: { children: ReactNode; id?: string }) {
  const onAction = useContext(MenuActionContext);
  const press = () => props.id !== undefined && onAction?.(props.id);
  return (
    <div
      role="menuitem"
      tabIndex={0}
      onClick={press}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") press();
      }}
    >
      {props.children}
    </div>
  );
}

const MenuActionContext = createContext<((key: string) => void) | undefined>(undefined);

function ActionMenu(props: { children: ReactNode; onAction?: (key: string) => void }) {
  return (
    <MenuActionContext.Provider value={props.onAction}>
      <div>{props.children}</div>
    </MenuActionContext.Provider>
  );
}

vi.mock("@heroui/react", () => ({
  Dropdown: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    Trigger,
    Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Menu: ActionMenu,
    Item: PressableItem,
  }),
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  toast: toastMock,
}));

import { MainTitlebar } from "./MainTitlebar";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useScheduleStore } from "@/renderer/state/scheduleStore";

function scheduleTask(id: string): ScheduledTask {
  return {
    id,
    name: id,
    prompt: "x",
    agentKind: "codex",
    config: { model: "gpt-5.6" },
    recurrence: { kind: "interval", everyMinutes: 10 },
    enabled: true,
    sourceThreadId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    threadTarget: { kind: "new" },
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    lastStatus: "never",
    lastResult: null,
    lastError: null,
    createdAt: "2026-03-21T10:00:00.000Z",
    updatedAt: "2026-03-21T10:00:00.000Z",
  };
}

describe("MainTitlebar CLI 更新入口", () => {
  beforeEach(() => {
    bridgeMock.getLatestAgentVersion.mockReset().mockResolvedValue({
      version: "1.1.0",
      source: "npm",
    });
    bridgeMock.updateAgentBinary.mockReset().mockResolvedValue({ ok: true });
    bridgeMock.refreshAgentStatuses.mockReset().mockResolvedValue(undefined);
    bridgeMock.installUpdate.mockReset().mockResolvedValue(undefined);
    bridgeMock.checkForUpdate.mockClear();
    updateStoreMock.reset();
    toastMock.danger.mockReset();
    toastMock.success.mockReset();
  });

  it("点击版本号触发手动应用更新检查并在已是最新时提示", async () => {
    render(<MainTitlebar />);

    fireEvent.click(screen.getByTestId("titlebar-app-version"));
    await waitFor(() => expect(bridgeMock.checkForUpdate).toHaveBeenCalledWith({}));

    // Main reports the check lifecycle through the status channel; a
    // checking → idle transition after a manual click means "no update".
    updateStoreMock.setPhase("checking");
    updateStoreMock.setPhase("idle");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledOnce());

    // A check that finds an update must NOT toast "up to date".
    toastMock.success.mockClear();
    fireEvent.click(screen.getByTestId("titlebar-app-version"));
    updateStoreMock.setPhase("checking");
    updateStoreMock.setPhase("downloading");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(toastMock.success).not.toHaveBeenCalled();

    // While a check is in flight the pill refuses to stack another one.
    bridgeMock.checkForUpdate.mockClear();
    updateStoreMock.setPhase("checking");
    fireEvent.click(screen.getByTestId("titlebar-app-version"));
    expect(bridgeMock.checkForUpdate).not.toHaveBeenCalled();
    updateStoreMock.reset();
  });

  it("在窗口按钮左侧用一个小按钮汇总已安装 CLI 的更新", async () => {
    render(<MainTitlebar />);

    expect(screen.getByTestId("titlebar-app-version")).toHaveTextContent("v1.0.1");
    const updateButton = screen.getByTestId("titlebar-cli-update-button");
    const windowControls = screen.getByTestId("titlebar-window-controls-spacer");

    await waitFor(() =>
      expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledWith({ agentKind: "codex" }),
    );
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Codex.*v1\.0\.0.*v1\.1\.0/u)).toBeInTheDocument();
    expect(
      updateButton.compareDocumentPosition(windowControls) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(updateButton);
    // Opening the menu must NOT force a re-check in the same press: the
    // mid-open state churn rebuilt the popover's items around the pointer and
    // read as "click does nothing / menu flashes" (GitHub issue #3). Refreshes
    // run through the explicit "Check all CLIs" menu action instead.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(1);
  });
});

describe("MainTitlebar 计划数量", () => {
  beforeEach(() => {
    useScheduleStore.setState({ tasks: [], loading: false, focusedScheduleId: null });
  });

  it("hides the count when there are no schedules", () => {
    render(<MainTitlebar />);
    expect(screen.queryByTestId("titlebar-schedule-count")).not.toBeInTheDocument();
  });

  it("shows how many scheduled tasks currently exist", () => {
    useScheduleStore.setState({
      tasks: [
        scheduleTask("11111111-1111-4111-8111-111111111111"),
        scheduleTask("22222222-2222-4222-8222-222222222222"),
        scheduleTask("33333333-3333-4333-8333-333333333333"),
      ],
    });
    render(<MainTitlebar />);
    expect(screen.getByTestId("titlebar-schedule-count")).toHaveTextContent("3");
  });
});

describe("MainTitlebar 顶部快捷栏", () => {
  const defaultPins = ["crafting", "settings.mcpServers", "settingsHome"];
  beforeEach(() => {
    useSharedSettings.getState().setTopShortcutOrder([...defaultPins]);
    panelActions.openSettingsSection.mockClear();
    panelActions.openSettings.mockClear();
    panelActions.openModelUsageDialog.mockClear();
  });

  function topButtons() {
    return screen.getAllByTestId(/^top-shortcut-/);
  }

  it("默认钉住合成台、MCP 服务器和设置", () => {
    render(<MainTitlebar />);

    const labels = topButtons().map((button) => button.textContent);
    expect(labels).toEqual(["Crafting Table", "MCP Servers", "Settings"]);
  });

  it("从 + 菜单添加外观并能导航到对应设置页", async () => {
    render(<MainTitlebar />);

    fireEvent.click(screen.getByRole("menuitem", { name: /Appearance/ }));
    await waitFor(() =>
      expect(topButtons().map((button) => button.textContent)).toContain("Appearance"),
    );

    fireEvent.click(screen.getByTestId("top-shortcut-settings.appearance"));
    expect(panelActions.openSettingsSection).toHaveBeenCalledWith("appearance");
  });

  it("重复添加不会产生第二个相同入口", () => {
    useSharedSettings
      .getState()
      .setTopShortcutOrder(["settings.mcpServers", "settings.mcpServers", "crafting"]);
    render(<MainTitlebar />);

    // 移除的默认项不会自动回来：normalize 只去重不清零、不回填。
    expect(topButtons().map((button) => button.textContent)).toEqual([
      "MCP Servers",
      "Crafting Table",
    ]);
  });

  it("在 + 菜单里再次点击可移除已添加项", async () => {
    render(<MainTitlebar />);
    expect(topButtons()).toHaveLength(3);

    fireEvent.click(screen.getByRole("menuitem", { name: /MCP Servers/ }));
    await waitFor(() => expect(topButtons()).toHaveLength(2));
    expect(topButtons().map((button) => button.textContent)).not.toContain("MCP Servers");
  });

  it("搜索能过滤可添加项", async () => {
    render(<MainTitlebar />);

    const search = screen.getByPlaceholderText("Search settings");
    fireEvent.change(search, { target: { value: "mcp" } });
    expect(await screen.findByRole("menuitem", { name: /MCP Servers/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Appearance/ })).not.toBeInTheDocument();
  });

  it("根据真实 route 同步 active（经 Sidebar 打开也一样）", () => {
    Object.assign(panelState, { settingsOpen: true, settingsSection: "mcpServers" });
    try {
      render(<MainTitlebar />);
      expect(screen.getByTestId("top-shortcut-settings.mcpServers").className).toMatch(
        /row-active/,
      );
      expect(screen.getByTestId("top-shortcut-settingsHome").className).not.toMatch(/row-active/);
    } finally {
      Object.assign(panelState, { settingsOpen: false, settingsSection: null });
    }
  });
});
