import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { CraftingWorkbenchPage } from "./CraftingWorkbenchPage";

const bridgeMock = vi.hoisted(() => ({
  getNativeHarnessControlPlane: vi.fn<() => Promise<NativeHarnessControlPlaneEntry[]>>(),
  resolveCraftingCompatibility: vi.fn<() => Promise<unknown>>(),
  onSupervisorEvent: vi.fn<(listener: (event: unknown) => void) => () => void>(
    () => () => undefined,
  ),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridgeMock,
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
const initialWorkbenchState = useCraftingWorkbenchStore.getState();

function resetStores() {
  usePanelStore.setState({
    ...initialPanelState,
    settingsOpen: false,
    settingsSection: null,
    modelUsageDialogOpen: true,
    modelUsageWorkspaceTab: "crafting",
  });
  useCraftingWorkbenchStore.setState({
    lastWorkbenchMode: "efficient",
    efficientDraft: { reservedSlot: true },
    creativeDraft: { slots: Array(9).fill(undefined) },
    recipes: [],
    selectedInspectorRef: undefined,
    pendingRecipeIntent: undefined,
    cpaHelper: { present: false, selected: false },
  });
}

describe("CraftingWorkbenchPage", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
    bridgeMock.onSupervisorEvent.mockReturnValue(() => undefined);
    bridgeMock.getNativeHarnessControlPlane.mockResolvedValue([
      entry("codex", "Codex Native Harness", "ready"),
      entry("kimi", "Kimi Code Native Harness", "not-configured"),
      entry("deepseek-api", "DeepSeek API Runtime", "not-configured"),
    ]);
    bridgeMock.resolveCraftingCompatibility.mockResolvedValue({
      resolutionKey: "none",
      createdAt: new Date().toISOString(),
      status: "IMPOSSIBLE",
      internalStatus: "UNAVAILABLE",
      source: "unavailable",
      modelEntryRef: "",
      harnessRef: "",
      capabilities: [],
      diagnostics: [],
    });
  });

  afterEach(resetStores);

  it("stretches the three inventory columns to the remaining page height", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    const columns = await screen.findByTestId("crafting-inventory-columns");
    expect(columns.className).toContain("flex-1");
    expect(columns.className).toContain("min-h-0");
    expect(screen.getByTestId("models-inventory-grid").className).not.toContain("max-h-72");
    expect(screen.getByTestId("harness-inventory-grid").className).not.toContain("max-h-72");
    expect(screen.getByTestId("components-inventory-grid").className).not.toContain("max-h-72");
  });

  it("opens agent settings when the user clicks a not-configured Harness/CLI row", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    const kimiRow = await screen.findByTestId("harness-cli-row-kimi");
    fireEvent.click(kimiRow);

    await waitFor(() => {
      expect(usePanelStore.getState().settingsOpen).toBe(true);
      expect(usePanelStore.getState().settingsSection).toBe("agents:kimi");
    });
  });

  it("hides the retired DeepSeek API Runtime from the bench catalogue", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    // Sidebar rows load with the control plane; the retired kind stays out.
    await screen.findByTestId("harness-cli-row-kimi");
    expect(screen.queryByTestId("harness-cli-row-deepseek-api")).not.toBeInTheDocument();
    // The pickable grid drops it too (only codex is ready/selectable here).
    const grid = screen.getByTestId("harness-inventory-grid");
    expect(grid.textContent).not.toContain("DeepSeek API Runtime");
  });
});
