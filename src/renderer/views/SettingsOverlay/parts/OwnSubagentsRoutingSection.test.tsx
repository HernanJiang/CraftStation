import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { AgentStatus } from "@/shared/contracts";
import type { CrossagentRoutingState } from "@/shared/crossagentRanking";
import { OwnSubagentsRoutingSection } from "./OwnSubagentsRoutingSection";

const mocks = vi.hoisted(() => ({
  getOwnSubagentsRouting: vi.fn<() => Promise<CrossagentRoutingState>>(),
  removeOwnSubagentsRoutingOverride:
    vi.fn<
      (payload: {
        tags: string[];
      }) => Promise<ReturnType<typeof useSharedSettings.getState>["ownSubagentRoutingOverrides"]>
    >(),
  removeOwnSubagentsMemoryEntry: vi.fn<(payload: { entry: unknown }) => Promise<unknown[]>>(),
  updateOwnSubagentsMemoryEntryTags:
    vi.fn<(payload: { entry: unknown; tags: string[] }) => Promise<unknown[]>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => ({
    appVersion: "desktop",
    getOwnSubagentsRouting: mocks.getOwnSubagentsRouting,
    removeOwnSubagentsRoutingOverride: mocks.removeOwnSubagentsRoutingOverride,
    removeOwnSubagentsMemoryEntry: mocks.removeOwnSubagentsMemoryEntry,
    updateOwnSubagentsMemoryEntryTags: mocks.updateOwnSubagentsMemoryEntryTags,
  }),
  isRemoteSession: () => false,
}));

function makeStatus(kind: string, label: string, model: string): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: model, label: model.toUpperCase() }],
      efforts: ["high", "max"],
      defaultEffort: "high",
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      presentationModes: ["terminal", "gui"],
      settingDefs: [],
    },
  } as AgentStatus;
}

describe("OwnSubagentsRoutingSection", () => {
  beforeEach(() => {
    mocks.removeOwnSubagentsRoutingOverride.mockResolvedValue([]);
    mocks.getOwnSubagentsRouting.mockImplementation(async () => {
      const { disabledAgents, ownSubagentPausedProviders, ownSubagentHiddenModels } =
        useSharedSettings.getState();
      const kimiRanked =
        !disabledAgents.includes("kimi") &&
        !ownSubagentPausedProviders.includes("kimi") &&
        !(ownSubagentHiddenModels.kimi ?? []).includes("k3");
      const claudeEntry = (rank: number): CrossagentRoutingState["ranked"][number] => ({
        provider: "claude",
        label: "Claude Code",
        execution: "structured",
        rank,
        source: "favorite",
        usageCount: 0,
        model: { id: "sonnet", label: "SONNET" },
        reasoning: "high",
        fast: false,
        learnedTags: [{ tag: "frontend", count: 3 }],
      });
      return {
        ranked: kimiRanked
          ? [
              {
                provider: "kimi",
                label: "Kimi Code",
                execution: "one-shot",
                rank: 1,
                source: "crossagent-usage",
                usageCount: 4,
                model: { id: "k3", label: "K3" },
                reasoning: "max",
                fast: false,
                learnedTags: [
                  { tag: "mobile", count: 4 },
                  { tag: "simulator", count: 4 },
                ],
              },
              claudeEntry(2),
            ]
          : [claudeEntry(1)],
        providers: [
          ...(disabledAgents.includes("kimi")
            ? []
            : [
                {
                  kind: "kimi",
                  label: "Kimi Code",
                  execution: "one-shot" as const,
                  paused: ownSubagentPausedProviders.includes("kimi"),
                },
              ]),
          {
            kind: "claude",
            label: "Claude Code",
            execution: "structured" as const,
            paused: false,
          },
        ],
      };
    });
    useAgentStatusesStore.setState({
      agentStatuses: [
        makeStatus("claude", "Claude Code", "sonnet"),
        makeStatus("kimi", "Kimi Code", "k3"),
      ],
    });
    useSharedSettings.setState({
      ownSubagentRoutingGuide: "",
      disabledAgents: [],
      hiddenModels: {},
      ownSubagentPausedProviders: [],
      ownSubagentHiddenModels: {},
      ownSubagentsRouteOrder: [],
      favoriteModels: [{ agentKind: "claude", modelId: "sonnet", presentationMode: "gui" }],
      agentSelectionUsage: [],
      ownSubagentSelectionUsage: [
        {
          agentKind: "kimi",
          modelId: "k3",
          effort: "max",
          fast: false,
          count: 4,
          lastUsedAt: 10,
        },
      ],
      ownSubagentRoutingOverrides: [
        {
          tags: ["frontend", "design"],
          agentKind: "claude",
          modelId: "sonnet",
          effort: "high",
          fast: true,
          updatedAt: 11,
        },
      ],
    });
  });

  it("shows the supervisor's active learned order and refreshes it when availability changes", async () => {
    render(<OwnSubagentsRoutingSection />);

    expect(await screen.findByText("Kimi Code · K3")).toBeInTheDocument();
    expect(screen.getByText("Own Subagents usage")).toBeInTheDocument();
    expect(screen.getByText("4 uses")).toBeInTheDocument();
    expect(screen.getByText("#mobile (4) · #simulator (4)")).toBeInTheDocument();
    expect(screen.getByText("#frontend + #design")).toBeInTheDocument();
    expect(screen.getByText("claude · sonnet · High · Fast")).toBeInTheDocument();
    // Route positions: native lane #1, kimi #2, claude #3.
    expect(screen.getByText("Current harness native subagent")).toBeInTheDocument();
    expect(screen.getAllByText("#1")).toHaveLength(1);
    expect(screen.getAllByText("#2")).toHaveLength(1);
    expect(screen.getAllByText("#3")).toHaveLength(1);

    act(() => useSharedSettings.setState({ disabledAgents: ["kimi"] }));

    await waitFor(() => expect(screen.queryByText("Kimi Code · K3")).not.toBeInTheDocument());
    expect(screen.getByText("Claude Code · SONNET")).toBeInTheDocument();
    expect(screen.getByText("Favorite")).toBeInTheDocument();
    // Native lane #1 plus claude's route position #2.
    expect(screen.getAllByText("#1")).toHaveLength(1);
    expect(screen.getAllByText("#2")).toHaveLength(1);
  });

  it("renders the native lane first by default and persists reorder operations", async () => {
    render(<OwnSubagentsRoutingSection />);
    expect(await screen.findByText("Current harness native subagent")).toBeInTheDocument();

    // Move the native lane down past kimi: the persisted order flips.
    fireEvent.click(screen.getByRole("button", { name: "Move native lane down" }));
    await waitFor(() =>
      expect(useSharedSettings.getState().ownSubagentsRouteOrder[0]).toBe("kimi"),
    );
    expect(useSharedSettings.getState().ownSubagentsRouteOrder).toContain("native");

    // Provider rows move the same way: kimi down past the native lane.
    fireEvent.click(screen.getByRole("button", { name: "Move Kimi Code down" }));
    await waitFor(() =>
      expect(useSharedSettings.getState().ownSubagentsRouteOrder).toEqual([
        "native",
        "kimi",
        "claude",
      ]),
    );

    // The native lane has no remove control: it is reorderable, not removable.
    expect(
      screen.queryByRole("button", { name: /Remove native lane/i }),
    ).not.toBeInTheDocument();
  });

  it("shows unavailable pinned routes and removes them from Settings", async () => {
    useSharedSettings.setState({
      ownSubagentRoutingOverrides: [
        {
          tags: ["review"],
          agentKind: "removed-provider",
          modelId: "gone",
          updatedAt: 20,
        },
      ],
    });
    render(<OwnSubagentsRoutingSection />);

    expect(await screen.findByText("#review")).toBeInTheDocument();
    expect(screen.getByText("removed-provider · gone · Unavailable provider")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove pinned route for #review" }));

    await waitFor(() =>
      expect(mocks.removeOwnSubagentsRoutingOverride).toHaveBeenCalledWith({ tags: ["review"] }),
    );
    expect(useSharedSettings.getState().ownSubagentRoutingOverrides).toEqual([]);
  });

  it("pauses a provider by unchecking it in the global filter and resumes it", async () => {
    render(<OwnSubagentsRoutingSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Own Subagents auto-selection" }));
    fireEvent.click(await screen.findByRole("option", { name: /Kimi Code/ }));
    expect(useSharedSettings.getState().ownSubagentPausedProviders).toEqual(["kimi"]);

    // Paused providers drop out of the ranked list but stay in the checklist,
    // and the closed-state note calls them out.
    await waitFor(() =>
      expect(screen.getByText("Skipped by Own Subagents: Kimi Code")).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.queryByText("Own Subagents usage")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("option", { name: /Kimi Code/ }));
    expect(useSharedSettings.getState().ownSubagentPausedProviders).toEqual([]);
  });

  it("filters Own Subagents models from the global filter without touching global visibility", async () => {
    render(<OwnSubagentsRoutingSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Own Subagents auto-selection" }));
    fireEvent.click(await screen.findByRole("option", { name: /k3/i }));

    expect(useSharedSettings.getState().ownSubagentHiddenModels).toEqual({ kimi: ["k3"] });
    expect(useSharedSettings.getState().hiddenModels).toEqual({});
  });

  it("treats Hide all and Show all as inverses across providers and models", async () => {
    render(<OwnSubagentsRoutingSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Own Subagents auto-selection" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hide all" }));

    // Nothing is usable afterwards: every model hidden and every provider unchecked.
    expect(useSharedSettings.getState().ownSubagentHiddenModels).toEqual({
      claude: ["sonnet"],
      kimi: ["k3"],
    });
    expect(useSharedSettings.getState().ownSubagentPausedProviders.toSorted()).toEqual([
      "claude",
      "kimi",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(useSharedSettings.getState().ownSubagentHiddenModels).toEqual({ claude: [], kimi: [] });
    expect(useSharedSettings.getState().ownSubagentPausedProviders).toEqual([]);
    expect(useSharedSettings.getState().hiddenModels).toEqual({});
  });

  it("shows a fully filtered provider as unchecked rather than partially checked", async () => {
    useSharedSettings.setState({ ownSubagentHiddenModels: { kimi: ["k3"] } });
    render(<OwnSubagentsRoutingSection />);

    fireEvent.click(await screen.findByRole("button", { name: "Own Subagents auto-selection" }));

    const [kimiHeader] = await screen.findAllByRole("option", { name: /Kimi Code/ });
    expect(kimiHeader).toHaveAccessibleName(/Unchecked/);
    const [claudeHeader] = screen.getAllByRole("option", { name: /Claude Code/ });
    expect(claudeHeader).toHaveAccessibleName(/Checked/);
    expect(
      screen.getByText(
        "Unchecked providers and models are excluded from automatic Own Subagents routing, but remain available for manual agent threads.",
      ),
    ).toBeInTheDocument();
  });

  it("edits tags and removes learned memory entries", async () => {
    useSharedSettings.setState({
      ownSubagentSelectionUsage: [
        {
          agentKind: "kimi",
          modelId: "k3",
          effort: "max",
          fast: false,
          count: 4,
          lastUsedAt: 10,
          tags: ["mobile", "simulator"],
          explicitFields: { provider: false, model: true, effort: true, fast: false },
        },
      ],
    });
    mocks.updateOwnSubagentsMemoryEntryTags.mockImplementation(async ({ tags }) => [
      {
        agentKind: "kimi",
        modelId: "k3",
        effort: "max",
        fast: false,
        count: 4,
        lastUsedAt: 10,
        tags,
        explicitFields: { provider: false, model: true, effort: true, fast: false },
      },
    ]);
    mocks.removeOwnSubagentsMemoryEntry.mockResolvedValue([]);
    render(<OwnSubagentsRoutingSection />);

    expect(await screen.findByText("Learned selections")).toBeInTheDocument();
    expect(screen.getByText("#mobile · #simulator")).toBeInTheDocument();
    expect(screen.getByText("#mobile · #simulator").closest("div.max-h-80")).toHaveClass(
      "overflow-y-auto",
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit tags for Kimi Code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove tag mobile" }));
    await waitFor(() =>
      expect(mocks.updateOwnSubagentsMemoryEntryTags).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ["simulator"],
          entry: expect.objectContaining({
            explicitFields: { provider: false, model: true, effort: true, fast: false },
          }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove memory entry for Kimi Code" }));
    await waitFor(() => expect(mocks.removeOwnSubagentsMemoryEntry).toHaveBeenCalled());
    expect(useSharedSettings.getState().ownSubagentSelectionUsage).toEqual([]);
  });
});
