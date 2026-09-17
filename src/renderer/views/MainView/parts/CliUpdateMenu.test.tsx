import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { CliUpdateMenu } from "./MainTitlebar";

const bridgeMock = vi.hoisted(() => ({
  appVersion: "1.2.6",
  getLatestAgentVersion: vi.fn<() => Promise<{ version: string; source: string }>>(),
  updateAgentBinary: vi.fn<() => Promise<{ ok: boolean; output?: string }>>(),
  refreshAgentStatuses: vi.fn<() => Promise<unknown>>(),
  checkForUpdate: vi.fn<() => Promise<void>>(),
  installUpdate: vi.fn<() => Promise<void>>(),
  openExternal: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
  isDevApp: () => false,
  isRemoteSession: () => false,
}));

function status(kind: string, version: string): AgentStatus {
  return {
    kind,
    label: kind === "codex" ? "Codex Native Harness" : kind,
    installed: true,
    version,
    authState: "authenticated",
    update: "npm update -g",
    envKind: "windows",
    capabilities: {
      models: [],
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
    },
  } as AgentStatus;
}

describe("CliUpdateMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStatusesStore.setState({
      agentStatuses: [status("codex", "v1.0.0")],
      wslAgentStatuses: [],
    });
    useUpdateStore.setState({ agentUpdates: {}, availableCliUpdates: [] });
    bridgeMock.getLatestAgentVersion.mockResolvedValue({ version: "v9.9.9", source: "npm" });
    bridgeMock.refreshAgentStatuses.mockResolvedValue({});
  });

  it("opens the menu without forcing a version check in the same press", async () => {
    render(<CliUpdateMenu />);
    // Mount auto-check populates the update list once.
    await waitFor(() => expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(1));
    bridgeMock.getLatestAgentVersion.mockClear();

    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    const menu = await screen.findByRole("menu");

    // The press that opens the popover must not trigger another check —
    // state churn mid-open is what tore the popover back down.
    expect(bridgeMock.getLatestAgentVersion).not.toHaveBeenCalled();
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(0);
  });

  it("runs the update exactly once per click on an update item", async () => {
    let settleUpdate: ((value: { ok: boolean }) => void) | undefined;
    bridgeMock.updateAgentBinary.mockReturnValue(
      new Promise((resolve) => {
        settleUpdate = resolve;
      }),
    );

    render(<CliUpdateMenu />);
    await waitFor(() => expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    const menu = await screen.findByRole("menu");
    const item = await within(menu).findByRole("menuitem", { name: /Codex Native Harness/u });
    fireEvent.click(item);

    // One click, one update call — no double-click required.
    expect(bridgeMock.updateAgentBinary).toHaveBeenCalledTimes(1);
    expect(bridgeMock.updateAgentBinary).toHaveBeenCalledWith({
      agentKind: "codex",
      envKind: "windows",
    });

    // The update runs through the shared in-flight store, so the updating
    // state is visible (menu row, bench rows, sidebar dock) while it runs.
    await waitFor(() =>
      expect(useUpdateStore.getState().agentUpdates["codex:windows:"]).toBeTruthy(),
    );

    settleUpdate?.({ ok: true });
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalled());
    // Post-update availability re-check runs once after the update settles.
    await waitFor(() => expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(useUpdateStore.getState().agentUpdates["codex:windows:"]).toBeUndefined(),
    );
  });

  it("does not rebuild the update list when a re-check finds the same availability", async () => {
    render(<CliUpdateMenu />);
    await waitFor(() => expect(bridgeMock.getLatestAgentVersion).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    await screen.findByRole("menuitem", { name: /Codex Native Harness/u });
    const before = useUpdateStore.getState().availableCliUpdates;

    // Manual "Check all CLIs" re-check with identical findings must not
    // publish a fresh array identity — that churn rebuilt open menus around
    // the user's pointer.
    fireEvent.click(screen.getByRole("menuitem", { name: /Check all CLIs/u }));
    await waitFor(() =>
      expect(bridgeMock.getLatestAgentVersion.mock.calls.length).toBeGreaterThan(1),
    );
    expect(useUpdateStore.getState().availableCliUpdates).toBe(before);
  });

  it("shows app-check progress while its own check is in flight and main is quiet", async () => {
    bridgeMock.getLatestAgentVersion.mockImplementation(() => new Promise(() => {}));
    useUpdateStore.setState({ phase: "idle", version: null, manualDownloadUrl: null });
    render(<CliUpdateMenu />);
    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: /Checking for CraftStation update/u }),
    ).toBeTruthy();
  });

  it("lists the app itself with restart-to-install once downloaded", async () => {
    useUpdateStore.setState({
      phase: "downloaded",
      version: "1.2.13",
      manualDownloadUrl: null,
    });
    render(<CliUpdateMenu />);
    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    const menu = await screen.findByRole("menu");
    const item = await within(menu).findByRole("menuitem", { name: /CraftStation.*1\.2\.13/u });
    fireEvent.click(item);
    expect(bridgeMock.installUpdate).toHaveBeenCalledTimes(1);
    useUpdateStore.setState({ phase: "idle", version: null });
  });

  it("offers the manual package for portable builds", async () => {
    useUpdateStore.setState({
      phase: "available-manual",
      version: "1.2.13",
      manualDownloadUrl: "https://github.com/HernanJiang/CraftStation/releases",
    });
    render(<CliUpdateMenu />);
    fireEvent.click(screen.getByTestId("titlebar-cli-update-button"));
    const menu = await screen.findByRole("menu");
    const item = await within(menu).findByRole("menuitem", { name: /CraftStation.*1\.2\.13/u });
    fireEvent.click(item);
    expect(bridgeMock.openExternal).toHaveBeenCalledWith(
      "https://github.com/HernanJiang/CraftStation/releases",
    );
    useUpdateStore.setState({ phase: "idle", version: null, manualDownloadUrl: null });
  });
});
