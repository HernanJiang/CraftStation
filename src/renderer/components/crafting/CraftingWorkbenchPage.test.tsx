import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "@heroui/react";
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

  it("runs real scoped agent detection before reading the control plane on open", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    await screen.findByTestId("harness-cli-row-kimi");
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    const [wslDistros, scope] = bridgeMock.refreshAgentStatuses.mock.calls[0] ?? [];
    expect(wslDistros).toEqual([]);
    expect(scope).toEqual({
      agentKinds: expect.arrayContaining(["codex", "antigravity", "kimi", "muse"]),
    });
    // Detection happens first; the projection is read after it settles.
    expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalled();
  });

  it("re-runs detection when the user clicks the Harness/CLI refresh button", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

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
    await waitFor(() => expect(bridgeMock.refreshAgentStatuses).toHaveBeenCalledTimes(1));
    bridgeMock.refreshAgentStatuses.mockRejectedValueOnce(
      new Error('Supervisor request "refreshAgentStatuses" timed out.'),
    );

    fireEvent.click(screen.getByTitle("刷新状态"));

    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(kimiRow).toBeInTheDocument();
    expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(1);
  });

  it("re-reads the control plane on detection events without re-detecting", async () => {
    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

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
    installMock.runNativeAgentInstall.mockImplementation(
      (input: { onComplete?: (ok: boolean) => void }) => {
        input.onComplete?.(true);
        return true;
      },
    );
    // After the install completes, the refreshed projection reports the CLI as
    // installed-but-unconfigured — the row updates in place, no app restart.
    bridgeMock.getNativeHarnessControlPlane.mockImplementation(async () => {
      const calls = bridgeMock.getNativeHarnessControlPlane.mock.calls.length;
      return calls > 1
        ? [entry("antigravity", "Antigravity Native Harness", "not-configured")]
        : [entry("antigravity", "Antigravity Native Harness", "unavailable")];
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

    render(
      <CraftingWorkbenchPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={() => undefined}
        configuredProviderIds={[]}
        providerOrder={[]}
      />,
    );

    fireEvent.click(await screen.findByTestId("harness-cli-install-antigravity"));
    await waitFor(() => expect(installMock.runNativeAgentInstall).toHaveBeenCalledTimes(1));

    // The row stays honestly 未安装 (the shared action surfaces the real error
    // toast); the install action is offered again for a retry.
    const row = await screen.findByTestId("harness-cli-row-antigravity");
    await waitFor(() => expect(row.textContent).toContain("未安装"));
    await waitFor(() => expect(screen.queryByText("Installing…")).not.toBeInTheDocument());
  });
});
