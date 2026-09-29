import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { CraftingWorkbenchPage } from "./CraftingWorkbenchPage";

const bridgeMock = vi.hoisted(() => ({
  getNativeHarnessControlPlane: vi.fn<() => Promise<NativeHarnessControlPlaneEntry[]>>(),
  refreshAgentStatuses: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  resolveCraftingCompatibility: vi.fn<() => Promise<unknown>>(),
  ensureCompatibilityBridge: vi.fn<() => Promise<unknown>>(),
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
  it("saves a compatible recipe only after confirmation, and cancellation keeps the list intact", async () => {
    const resolution = {
      resolutionKey: "bridge",
      createdAt: new Date().toISOString(),
      status: "CRAFTABLE",
      source: "compatibility-layer",
      modelEntryRef: "agent:antigravity:gui:gemini-3.8-flash",
      harnessRef: "harness:codex",
      capabilities: [],
      diagnostics: [],
    };
    bridgeMock.resolveCraftingCompatibility.mockResolvedValue(resolution);
    bridgeMock.ensureCompatibilityBridge.mockResolvedValue({ status: "running" });
    useCraftingWorkbenchStore.getState().setEfficientModel(resolution.modelEntryRef);
    useCraftingWorkbenchStore.getState().setEfficientHarness(resolution.harnessRef);
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => {}}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("craft-button")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("craft-button"));
    const save = await screen.findByTestId("confirm-save-recipe");
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(0);
    expect(save).not.toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("例如：日常编码组合"), {
      target: { value: "我的兼容配方" },
    });
    fireEvent.click(save);
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(1);
    expect(useCraftingWorkbenchStore.getState().recipes[0]).toMatchObject({
      alias: "我的兼容配方",
      compatibility: { uiStatus: "CRAFTABLE" },
    });
    fireEvent.click(screen.getByTestId("craft-button"));
    await screen.findByTestId("confirm-save-recipe");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(useCraftingWorkbenchStore.getState().recipes[0]?.alias).toBe("我的兼容配方");
  });

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

    // The pickable grid drops the retired kind (only codex is ready/selectable
    // here); the harness rows themselves live on the Harness map tab.
    const grid = await screen.findByTestId("harness-inventory-grid");
    expect(grid.textContent).not.toContain("DeepSeek API Runtime");
  });

  it("deletes a saved recipe from the workbench quick list", async () => {
    useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:opencode:gui:gemini-3.8-flash",
      harnessRef: "harness:opencode",
      modelName: "Gemini 3.8 Flash",
      harnessName: "OpenCode Native Harness",
      resolution: {
        resolutionKey: "test",
        createdAt: new Date().toISOString(),
        status: "CRAFTABLE",
        source: "compatibility-layer",
        modelEntryRef: "agent:opencode:gui:gemini-3.8-flash",
        harnessRef: "harness:opencode",
        capabilities: [],
        diagnostics: [],
      },
    });

    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    expect(
      await screen.findByText("OpenCode Native Harness · Gemini 3.8 Flash"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /删除配方/ }));
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(0);
    expect(
      screen.queryByText("OpenCode Native Harness · Gemini 3.8 Flash"),
    ).not.toBeInTheDocument();
  });

  it("deletes a saved recipe from the workbench via context menu", async () => {
    useCraftingWorkbenchStore.getState().saveRecipe({
      modelEntryRef: "agent:opencode:gui:gemini-3.8-flash",
      harnessRef: "harness:opencode",
      modelName: "Gemini 3.8 Flash",
      harnessName: "OpenCode Native Harness",
      resolution: {
        resolutionKey: "test",
        createdAt: new Date().toISOString(),
        status: "CRAFTABLE",
        source: "compatibility-layer",
        modelEntryRef: "agent:opencode:gui:gemini-3.8-flash",
        harnessRef: "harness:opencode",
        capabilities: [],
        diagnostics: [],
      },
    });

    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    const card = await screen.findByText("OpenCode Native Harness · Gemini 3.8 Flash");
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除配方" }));
    expect(useCraftingWorkbenchStore.getState().recipes).toHaveLength(0);
  });

  it("keeps the refresh-free workbench stable while the shared control-plane hook loads", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    // The shared hook paints the cached projection then revalidates with a
    // scoped detection — the workbench itself no longer renders Harness rows
    // (they live on the Harness map tab), but the inventory grid does.
    await screen.findByTestId("harness-inventory-grid");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalled();
  });
});
