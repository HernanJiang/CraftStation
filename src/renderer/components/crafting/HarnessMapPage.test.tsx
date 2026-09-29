import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { usePanelStore } from "@/renderer/state/panelStore";
import { HarnessMapPage } from "./HarnessMapPage";

const bridgeMock = vi.hoisted(() => ({
  getNativeHarnessControlPlane: vi.fn<() => Promise<NativeHarnessControlPlaneEntry[]>>(),
  refreshAgentStatuses: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  onSupervisorEvent: vi.fn<(listener: (event: unknown) => void) => () => void>(
    () => () => undefined,
  ),
}));

const installMock = vi.hoisted(() => ({
  runNativeAgentInstall: vi.fn<(input: { onComplete?: (ok: boolean) => void }) => boolean>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
}));

vi.mock("@/renderer/actions/installNativeAgent", () => ({
  runNativeAgentInstall: installMock.runNativeAgentInstall,
}));

function entry(
  harnessKind: string,
  label: string,
  status: NativeHarnessControlPlaneEntry["status"],
): NativeHarnessControlPlaneEntry {
  return {
    descriptor: {
      id: `native-harness:${harnessKind}`,
      harnessKind,
      label,
      vendor: harnessKind,
      official: true,
      transport: harnessKind === "deepseek-api" ? "openai-compatible-http" : "acp-stdio",
      machineFacingBoundary: "native runtime boundary",
      capabilities: { start: "implementation missing" },
    },
    status,
    profileConfigured: status === "ready",
    environmentKind: "windows",
    diagnostics: [],
  };
}

const initialPanelState = usePanelStore.getState();

function resetStores() {
  usePanelStore.setState({
    ...initialPanelState,
    settingsOpen: false,
    settingsSection: null,
    modelUsageDialogOpen: true,
    modelUsageWorkspaceTab: "harnesses",
  });
}

function renderPage() {
  return render(
    <HarnessMapPage
      accounts={[]}
      customModels={[]}
      configuredProviderIds={[]}
      providerOrder={[]}
    />,
  );
}

describe("HarnessMapPage", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    bridgeMock.onSupervisorEvent.mockReturnValue(() => undefined);
    bridgeMock.refreshAgentStatuses.mockResolvedValue({ windows: [], wsl: [], fromCache: false });
    bridgeMock.getNativeHarnessControlPlane.mockResolvedValue([
      entry("codex", "Codex Native Harness", "ready"),
      entry("kimi", "Kimi Code Native Harness", "not-configured"),
      entry("antigravity", "Antigravity Native Harness", "unavailable"),
      entry("deepseek-api", "DeepSeek API Runtime", "not-configured"),
    ]);
  });

  afterEach(resetStores);

  it("pairs provider rows with their default Harness/CLI and falls back to a placeholder", async () => {
    renderPage();
    await screen.findByTestId("harness-cli-row-kimi");
    expect(screen.getByTestId("harness-map-row-kimi")).toBeInTheDocument();
    expect(screen.getByTestId("harness-map-row-codex")).toBeInTheDocument();
    // Providers without a native harness (e.g. minimax/muse) show an honest
    // placeholder instead of a fabricated mapping.
    expect(screen.getAllByText("暂无原生 Harness —— 走兼容通道").length).toBeGreaterThan(0);
    // Retired catalogue entries stay out of the map entirely.
    expect(screen.queryByTestId("harness-cli-row-deepseek-api")).not.toBeInTheDocument();
  });

  it("opens agent settings when the user clicks a not-configured Harness/CLI row", async () => {
    renderPage();

    const kimiRow = await screen.findByTestId("harness-cli-row-kimi");
    fireEvent.click(kimiRow);

    await waitFor(() => {
      expect(usePanelStore.getState().settingsOpen).toBe(true);
      expect(usePanelStore.getState().settingsSection).toBe("agents:kimi");
    });
  });

  it("paints the cached control plane first, then revalidates with scoped detection on open", async () => {
    renderPage();

    // Rows render from the cached projection, before any live probe settles.
    await screen.findByTestId("harness-cli-row-kimi");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    const [wslDistros, scope] = bridgeMock.refreshAgentStatuses.mock.calls[0] ?? [];
    expect(wslDistros).toEqual([]);
    expect(scope).toEqual({
      agentKinds: expect.arrayContaining(["codex", "antigravity", "kimi", "muse"]),
    });
    // Stale-while-revalidate: the cached projection is read before detection.
    expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalled();
    const firstProjectionRead =
      bridgeMock.getNativeHarnessControlPlane.mock.invocationCallOrder[0] ?? Infinity;
    const firstDetection = bridgeMock.refreshAgentStatuses.mock.invocationCallOrder[0] ?? Infinity;
    expect(firstProjectionRead).toBeLessThan(firstDetection);
  });

  it("re-runs detection when the user clicks the Harness refresh button", async () => {
    renderPage();

    await screen.findByTestId("harness-cli-row-kimi");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTitle("刷新状态"));
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(bridgeMock.getNativeHarnessControlPlane.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("keeps the last control-plane rows and warns when status refresh times out", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => "toast-timeout");
    renderPage();

    const kimiRow = await screen.findByTestId("harness-cli-row-kimi");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    bridgeMock.refreshAgentStatuses.mockRejectedValueOnce(
      new Error('Supervisor request "refreshAgentStatuses" timed out.'),
    );

    fireEvent.click(screen.getByTitle("刷新状态"));

    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(kimiRow).toBeInTheDocument();
    // The cached projection is re-read after the failure too, so the map
    // settles on the last known rows instead of going blank: mount read +
    // post-detection read + post-failure read.
    await waitFor(() => expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(3));
  });

  it("re-reads the control plane on detection events without re-detecting", async () => {
    renderPage();

    await screen.findByTestId("harness-cli-row-kimi");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    const controlPlaneReads = bridgeMock.getNativeHarnessControlPlane.mock.calls.length;
    const listener = bridgeMock.onSupervisorEvent.mock.calls[0]?.[0] as (event: unknown) => void;

    listener({ type: "agent-status-updated", status: { kind: "antigravity" } });
    await waitFor(() =>
      expect(bridgeMock.getNativeHarnessControlPlane.mock.calls.length).toBeGreaterThan(
        controlPlaneReads,
      ),
    );
    // Projection events must not feed back into another detection sweep.
    expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1);
  });

  it("installs an unavailable harness and refreshes status without a restart", async () => {
    // The projection flips to installed-but-unconfigured only once the install
    // actually completed — independent of how often it is re-read meanwhile.
    let installed = false;
    installMock.runNativeAgentInstall.mockImplementation(
      (input: { onComplete?: (ok: boolean) => void }) => {
        installed = true;
        input.onComplete?.(true);
        return true;
      },
    );
    bridgeMock.getNativeHarnessControlPlane.mockImplementation(async () =>
      installed
        ? [entry("antigravity", "Antigravity Native Harness", "not-configured")]
        : [entry("antigravity", "Antigravity Native Harness", "unavailable")],
    );

    renderPage();

    fireEvent.click(await screen.findByTestId("harness-cli-install-antigravity"));

    await waitFor(() => expect(installMock.runNativeAgentInstall).toHaveBeenCalledTimes(1));
    expect(installMock.runNativeAgentInstall).toHaveBeenCalledWith(
      expect.objectContaining({ agentKind: "antigravity", label: "Antigravity Native Harness" }),
    );
    const row = await screen.findByTestId("harness-cli-row-antigravity");
    await waitFor(() => expect(row.textContent).toContain("未配置"));
    expect(row.textContent).not.toContain("未安装");
  });

  it("keeps the honest unavailable state after a failed install", async () => {
    installMock.runNativeAgentInstall.mockImplementation(
      (input: { onComplete?: (ok: boolean) => void }) => {
        input.onComplete?.(false);
        return true;
      },
    );

    renderPage();

    fireEvent.click(await screen.findByTestId("harness-cli-install-antigravity"));
    await waitFor(() => expect(installMock.runNativeAgentInstall).toHaveBeenCalledTimes(1));

    // The row stays honestly 未安装 (the shared action surfaces the real error
    // toast); the install action is offered again for a retry.
    const row = await screen.findByTestId("harness-cli-row-antigravity");
    await waitFor(() => expect(row.textContent).toContain("未安装"));
    await waitFor(() => expect(screen.queryByText("Installing…")).not.toBeInTheDocument());
  });
});
