import type { ComponentProps, ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { AgentCapability, AgentStatus } from "@/shared/contracts";

const bridgeMock = vi.hoisted(() => ({
  getLatestAgentVersion:
    vi.fn<(payload: { agentKind: string }) => Promise<{ version?: string; source?: string }>>(),
  updateAgentBinary: vi.fn<() => Promise<{ ok: boolean; output?: string }>>(),
  refreshAgentStatuses: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
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

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
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
  useUpdateStore: (selector: (state: unknown) => unknown) => selector(updateState),
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

vi.mock("@heroui/react", () => ({
  Dropdown: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    Trigger,
    Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Menu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }),
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  toast: toastMock,
}));

import { MainTitlebar } from "./MainTitlebar";

describe("MainTitlebar CLI 更新入口", () => {
  beforeEach(() => {
    bridgeMock.getLatestAgentVersion.mockReset().mockResolvedValue({
      version: "1.1.0",
      source: "npm",
    });
    bridgeMock.updateAgentBinary.mockReset().mockResolvedValue({ ok: true });
    bridgeMock.refreshAgentStatuses.mockReset().mockResolvedValue(undefined);
    bridgeMock.installUpdate.mockReset().mockResolvedValue(undefined);
    toastMock.danger.mockReset();
    toastMock.success.mockReset();
  });

  it("在窗口按钮左侧用一个小按钮汇总已安装 CLI 的更新", async () => {
    render(<MainTitlebar />);

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
    await waitFor(() => expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(2));
  });
});
