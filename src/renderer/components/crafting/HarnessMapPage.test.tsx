import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import type { SharedSettings } from "@/shared/settings";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
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

/** Custom-model rows filed under providers so they count as selected channels. */
const TEST_CUSTOM_MODELS: SharedSettings["customModels"] = [
  {
    id: "cm-codex",
    provider: "codex",
    modelId: "gpt-5.6-sol",
    displayName: "5.6 Sol",
    contextSize: "",
  },
  {
    id: "cm-kimi",
    provider: "kimi",
    modelId: "k3-256k",
    displayName: "K3",
    contextSize: "",
  },
  {
    id: "cm-cursor",
    provider: "cursor",
    modelId: "cursor-1",
    displayName: "Cursor One",
    contextSize: "",
  },
];

function resetStores() {
  usePanelStore.setState({
    ...initialPanelState,
    settingsOpen: false,
    settingsSection: null,
    modelUsageDialogOpen: true,
    modelUsageWorkspaceTab: "harnesses",
  });
  useSharedSettings.setState({ compatDefaultHarness: "opencode" });
}

function renderPage() {
  return render(
    <HarnessMapPage
      accounts={[]}
      customModels={TEST_CUSTOM_MODELS}
      configuredProviderIds={["codex", "kimi", "cursor"]}
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
      entry("codex", "Codex Harness", "ready"),
      entry("kimi", "Kimi Code Harness", "not-configured"),
      entry("antigravity", "Antigravity Harness", "unavailable"),
      entry("opencode", "OpenCode Harness", "ready"),
      entry("stepcode", "Step Code Harness", "ready"),
      entry("deepseek-api", "DeepSeek API Runtime", "not-configured"),
    ]);
  });

  afterEach(resetStores);

  it("draws channel → model → harness layers with crossing edges", async () => {
    renderPage();
    await screen.findByTestId("harness-map-compat-trunk");
    // Layer 1: one node per channel (custom inventory: codex/kimi/cursor).
    expect(screen.getAllByTestId(/^harness-map-provider-/)).toHaveLength(3);
    // Layer 2: one node per selected model.
    expect(screen.getAllByTestId(/^harness-map-model-node-/)).toHaveLength(3);
    expect(screen.getByText("5.6 Sol")).toBeInTheDocument();
    expect(screen.getByText("K3")).toBeInTheDocument();
    expect(screen.getByText("Cursor One")).toBeInTheDocument();
    // Channels with no selected model (e.g. claude/qwen) never appear.
    expect(screen.queryAllByTestId(/^harness-map-provider-claude/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^harness-map-model-node-claude-/)).toHaveLength(0);
    expect(screen.queryAllByTestId(/^harness-map-model-node-qwen-/)).toHaveLength(0);
    // Layer 3: native models resolve onto their own harness…
    expect(screen.getByTestId("harness-map-harness-node-codex")).toBeInTheDocument();
    expect(screen.getByTestId("harness-map-harness-node-kimi")).toBeInTheDocument();
    // …while cursor has no native harness, so it converges onto the compat
    // trunk (OpenCode) — several models, one Harness node.
    const opencodeNode = screen.getByTestId("harness-map-harness-node-opencode");
    expect(opencodeNode.textContent).toContain("OpenCode Harness");
    expect(opencodeNode.textContent).toContain("1 models");
    const codexModels = screen.getAllByTestId(/^harness-map-model-node-codex-/);
    expect(codexModels).toHaveLength(1);
    expect(codexModels[0]?.textContent).toContain("Native");
    const cursorModels = screen.getAllByTestId(/^harness-map-model-node-cursor-/);
    expect(cursorModels).toHaveLength(1);
    expect(cursorModels[0]?.textContent).toContain("Compatibility default");
    // Edges: one 渠道→模型 and one 模型→Harness per model; the cursor model's
    // second-layer edge lands on opencode.
    const page = screen.getByTestId("harness-map-page");
    expect(page.querySelectorAll('[data-testid^="harness-map-edge-pm-"]')).toHaveLength(3);
    expect(page.querySelectorAll('[data-testid^="harness-map-edge-mh-"]')).toHaveLength(3);
    expect(
      page.querySelector('[data-testid^="harness-map-edge-mh-"][data-to="opencode"]'),
    ).not.toBeNull();
    // Edges carry the source channel brand accent end to end.
    expect(
      page
        .querySelector('[data-testid^="harness-map-edge-pm-"][data-from="codex"]')
        ?.getAttribute("stroke"),
    ).toBe("#10A37F");
    expect(
      page
        .querySelector('[data-testid^="harness-map-edge-mh-"][data-to="opencode"]')
        ?.getAttribute("stroke"),
    ).toBe("#F8FAFC");
    // Retired catalogue entries stay out of the map entirely.
    expect(screen.queryByTestId("harness-cli-row-deepseek-api")).not.toBeInTheDocument();
    expect(screen.queryByTestId("harness-map-orphan-deepseek-api")).not.toBeInTheDocument();
  });

  it("lets the user repoint the compat-lane default Harness", async () => {
    renderPage();
    await screen.findByTestId("harness-cli-row-kimi");

    const select = await screen.findByLabelText("Compatibility default Harness");
    expect((select as HTMLSelectElement).value).toBe("opencode");
    fireEvent.change(select, { target: { value: "stepcode" } });

    expect(useSharedSettings.getState().compatDefaultHarness).toBe("stepcode");
    // The trunk now carries Step Code; the former default drops to the
    // unlinked-harness group rather than disappearing.
    const trunk = screen.getByTestId("harness-map-compat-trunk");
    await waitFor(() => expect(trunk.textContent).toContain("Step Code"));
    expect(screen.getByTestId("harness-map-harness-node-stepcode")).toBeInTheDocument();
    expect(screen.getByTestId("harness-map-orphan-opencode")).toBeInTheDocument();
    // Layer-2 routing follows the trunk: the cursor model's edge now lands on
    // Step Code instead of OpenCode.
    const page = screen.getByTestId("harness-map-page");
    await waitFor(() =>
      expect(
        page.querySelector('[data-testid^="harness-map-edge-mh-"][data-to="stepcode"]'),
      ).not.toBeNull(),
    );
    expect(
      page.querySelector('[data-testid^="harness-map-edge-mh-"][data-to="opencode"]'),
    ).toBeNull();
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

    fireEvent.click(screen.getByTitle("Refresh status"));
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

    fireEvent.click(screen.getByTitle("Refresh status"));

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
        ? [entry("antigravity", "Antigravity Harness", "not-configured")]
        : [entry("antigravity", "Antigravity Harness", "unavailable")],
    );

    renderPage();

    fireEvent.click(await screen.findByTestId("harness-cli-install-antigravity"));

    await waitFor(() => expect(installMock.runNativeAgentInstall).toHaveBeenCalledTimes(1));
    expect(installMock.runNativeAgentInstall).toHaveBeenCalledWith(
      expect.objectContaining({ agentKind: "antigravity", label: "Antigravity Harness" }),
    );
    const row = await screen.findByTestId("harness-cli-row-antigravity");
    await waitFor(() => expect(row.textContent).toContain("Not configured"));
    expect(row.textContent).not.toContain("Not installed");
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
    await waitFor(() => expect(row.textContent).toContain("Not installed"));
    await waitFor(() => expect(screen.queryByText("Installing…")).not.toBeInTheDocument());
  });
});
