import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CraftResult,
  CraftingModelInventory,
  CraftingModelInventoryPayload,
  Item,
  NativeHarnessControlPlaneEntry,
} from "@/shared/crafting";

const bridgeMock = vi.hoisted(() => ({
  getNativeHarnessControlPlane: vi.fn<() => Promise<NativeHarnessControlPlaneEntry[]>>(),
  getCraftingModelInventory:
    vi.fn<(payload: CraftingModelInventoryPayload) => Promise<CraftingModelInventory>>(),
  onSupervisorEvent: vi.fn<(listener: (event: unknown) => void) => () => void>(
    () => () => undefined,
  ),
}));

const mockCraftingGrid = vi.fn<(props: unknown) => void>();
const mockCraftingRegistrySections = vi.fn<(props: unknown) => void>();
const startThreadFromCraftMock = vi.fn<(...args: unknown[]) => Promise<void>>();

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));
vi.mock("@/renderer/actions/threadLaunchActions", () => ({
  startThreadFromCraft: (...args: unknown[]) => startThreadFromCraftMock(...args),
}));
vi.mock("@/renderer/components/crafting/CraftingGrid", () => ({
  CraftingGrid: (props: unknown) => {
    mockCraftingGrid(props);
    return <div data-testid="crafting-grid-placeholder" />;
  },
}));
vi.mock("@/renderer/components/crafting/CraftingRegistrySections", () => ({
  CraftingRegistrySections: (props: unknown) => {
    mockCraftingRegistrySections(props);
    return <div data-testid="crafting-registry-placeholder" />;
  },
}));
const mockAppState = {
  view: { kind: "thread" as const, panes: ["thread-1"] as [string, ...string[]] },
  threads: [{ id: "thread-1", projectId: "proj-1" }],
  focusedPaneId: "thread-1",
  projects: [
    {
      id: "proj-1",
      name: "CraftStation Repo",
      path: "C:\\repo",
      location: { kind: "windows" as const, path: "C:\\repo" },
    },
  ],
};

vi.mock("@/renderer/state/appStore", () => {
  const useAppStoreMock = Object.assign(
    (selector: (state: typeof mockAppState) => unknown) => selector(mockAppState),
    { getState: () => mockAppState },
  );
  return { useAppStore: useAppStoreMock };
});

import { HarnessPanel } from "./HarnessPanel";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

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
      transport: harnessKind === "deepseek" ? "deepseek-json-rpc-stdio" : "acp-stdio",
      machineFacingBoundary: "native runtime boundary",
      capabilities: { start: "implementation missing" },
    },
    status,
    profileConfigured: status === "ready",
    environmentKind: "windows",
    diagnostics: [
      {
        code: status === "unavailable" ? "RUNTIME_UNAVAILABLE" : "RUNTIME_NOT_CONFIGURED",
        harnessKind,
        phase: "readiness",
        operation: "control-plane-status",
        message: `${harnessKind} safe diagnostic`,
      },
    ],
  };
}

describe("HarnessPanel native control-plane surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.projects[0] = {
      id: "proj-1",
      name: "CraftStation Repo",
      path: "C:\\repo",
      location: { kind: "windows", path: "C:\\repo" },
    };
    bridgeMock.onSupervisorEvent.mockReturnValue(() => undefined);
    bridgeMock.getNativeHarnessControlPlane.mockResolvedValue([
      entry("codex", "Codex Native Harness", "ready"),
      entry("grok", "Grok Build Native Harness", "not-configured"),
      entry("kimi", "Kimi Code Native Harness", "ready"),
      entry("antigravity", "Antigravity Native Harness", "error"),
      entry("deepseek", "DeepSeek / DSH Native Harness", "unavailable"),
    ]);
    bridgeMock.getCraftingModelInventory.mockResolvedValue({
      status: "ready",
      source: "codex-app-server-model-list",
      models: [{ id: "gpt-official-live", displayName: "GPT Official Live" }],
    });
  });

  it("loads all five safe status rows through the typed IPC procedure", async () => {
    render(<HarnessPanel />);

    await waitFor(() => {
      expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledWith({});
    });
    expect(screen.getByTestId("native-harness-status")).toBeInTheDocument();
    expect(screen.getByTestId("native-harness-codex")).toHaveTextContent("Ready");
    expect(screen.getByTestId("native-harness-grok")).toHaveTextContent("Not configured");
    expect(screen.getByTestId("native-harness-kimi")).toHaveTextContent("Ready");
    expect(screen.getByTestId("native-harness-antigravity")).toHaveTextContent("Error");
    expect(screen.getByTestId("native-harness-deepseek")).toHaveTextContent("Unavailable");
    expect(screen.getByTestId("native-harness-deepseek")).toHaveTextContent("RUNTIME_UNAVAILABLE");
  });

  it("replaces stale OpenAI models with the official app-server inventory for both Crafting surfaces", async () => {
    render(<HarnessPanel />);

    await waitFor(() => {
      expect(bridgeMock.getCraftingModelInventory).toHaveBeenCalledWith({
        projectLocation: { kind: "windows", path: "C:\\repo" },
      });
      expect(screen.getByTestId("crafting-model-inventory-status")).toHaveTextContent("Ready");
    });

    const gridProps = mockCraftingGrid.mock.calls.at(-1)?.[0] as { models: Item[] };
    const registryProps = mockCraftingRegistrySections.mock.calls.at(-1)?.[0] as { models: Item[] };
    for (const props of [gridProps, registryProps]) {
      expect(props.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "openai:gpt-official-live" }),
          expect.objectContaining({ id: "xai:grok-4.6" }),
        ]),
      );
      expect(props.models.map((item) => item.id)).not.toEqual(
        expect.arrayContaining([
          "openai:gpt-4o",
          "openai:gpt-5-hybrid",
          "openai:gpt-5.3-codex",
          "openai:o3-mini",
        ]),
      );
    }
  });

  it("fails closed without discovered Codex models when official discovery is unavailable", async () => {
    bridgeMock.getCraftingModelInventory.mockResolvedValue({
      status: "unavailable",
      source: "codex-app-server-model-list",
      models: [],
      diagnostic: {
        code: "RUNTIME_UNAVAILABLE",
        message: "Official Codex model inventory is unavailable.",
        remediation: "Retry discovery.",
      },
    });

    render(<HarnessPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("crafting-model-inventory-status")).toHaveTextContent(
        "Unavailable",
      );
    });
    const gridProps = mockCraftingGrid.mock.calls.at(-1)?.[0] as { models: Item[] };
    expect(
      gridProps.models.some(
        (item) => item.metadata.vendor === "openai" && item.metadata.source === "discovered",
      ),
    ).toBe(false);
    expect(gridProps.models.some((item) => item.metadata.tags?.includes("opencode"))).toBe(true);
  });

  it("does not let a stale project discovery replace the current project inventory", async () => {
    const firstProject = deferred<CraftingModelInventory>();
    const secondProject = deferred<CraftingModelInventory>();
    bridgeMock.getCraftingModelInventory.mockImplementation(({ projectLocation }) =>
      projectLocation.kind === "windows" && projectLocation.path === "C:\\repo"
        ? firstProject.promise
        : secondProject.promise,
    );

    const view = render(<HarnessPanel />);
    await waitFor(() => expect(bridgeMock.getCraftingModelInventory).toHaveBeenCalledTimes(1));

    mockAppState.projects[0] = {
      id: "proj-1",
      name: "Second Repo",
      path: "D:\\repo",
      location: { kind: "windows", path: "D:\\repo" },
    };
    view.rerender(<HarnessPanel />);
    await waitFor(() => expect(bridgeMock.getCraftingModelInventory).toHaveBeenCalledTimes(2));

    secondProject.resolve({
      status: "ready",
      source: "codex-app-server-model-list",
      models: [{ id: "second-project-model", displayName: "Second Project Model" }],
    });
    await waitFor(() => {
      const props = mockCraftingGrid.mock.calls.at(-1)?.[0] as { models: Item[] };
      expect(props.models.map((item) => item.id)).toContain("openai:second-project-model");
    });

    firstProject.resolve({
      status: "ready",
      source: "codex-app-server-model-list",
      models: [{ id: "stale-first-project-model", displayName: "Stale First Project Model" }],
    });
    await Promise.resolve();

    const props = mockCraftingGrid.mock.calls.at(-1)?.[0] as { models: Item[] };
    expect(props.models.map((item) => item.id)).toContain("openai:second-project-model");
    expect(props.models.map((item) => item.id)).not.toContain("openai:stale-first-project-model");
  });

  it("passes onCraft callback to CraftingGrid and routes to startThreadFromCraft", async () => {
    render(<HarnessPanel />);

    await waitFor(() => {
      expect(mockCraftingGrid).toHaveBeenCalled();
    });
    const lastProps = mockCraftingGrid.mock.calls[0]?.[0] as {
      onCraft?: (result: CraftResult, prompt: string) => Promise<void>;
      workspace?: string;
    };
    expect(lastProps.onCraft).toBeDefined();
    expect(lastProps.workspace).toBe("C:\\repo");

    const fakeResult = {
      resultItem: { id: "result:test" },
      craftPlan: { id: "plan:test" },
    } as unknown as CraftResult;
    await lastProps.onCraft?.(fakeResult, "inspect repository");

    expect(startThreadFromCraftMock).toHaveBeenCalledWith(
      {
        id: "proj-1",
        name: "CraftStation Repo",
        path: "C:\\repo",
        location: { kind: "windows", path: "C:\\repo" },
      },
      fakeResult,
      "inspect repository",
      { capabilityMode: "auto" },
    );
  });

  it("refreshes after supervisor agent status events without exposing private runtime fields", async () => {
    let listener: ((event: { type: "agent-status-updated" }) => void) | undefined;
    bridgeMock.onSupervisorEvent.mockImplementation((next: (event: unknown) => void) => {
      listener = next as (event: { type: "agent-status-updated" }) => void;
      return () => undefined;
    });
    render(<HarnessPanel />);
    await waitFor(() => expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(1));

    listener?.({ type: "agent-status-updated" });
    await waitFor(() => expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText(/CODEX_HOME|executablePath|token|C:\\Users/u),
    ).not.toBeInTheDocument();
  });
});
