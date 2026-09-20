import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { CustomModel } from "@/renderer/components/thread/customModelCatalog";
import { useCraftingWorkbenchStore } from "@/renderer/state/craftingWorkbenchStore";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { formatContextBadge, ModelManagementPage } from "./ModelManagementPage";

function makeStatus(kind: string, label: string, models: string[]): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: models.map((id) => ({ id, label: id.toUpperCase() })),
      efforts: [],
      modelEfforts: {},
      modes: [],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "terminal",
      presentationMode: "terminal",
      settingDefs: [],
    },
  } as AgentStatus;
}

function renderPage(input?: {
  customModels?: CustomModel[];
  onUpdateCustomModels?: (next: CustomModel[]) => void;
  accounts?: React.ComponentProps<typeof ModelManagementPage>["accounts"];
  configuredProviderIds?: React.ComponentProps<typeof ModelManagementPage>["configuredProviderIds"];
}) {
  const onUpdateCustomModels =
    input?.onUpdateCustomModels ?? vi.fn<(next: CustomModel[]) => void>();
  return {
    ...render(
      <ModelManagementPage
        accounts={input?.accounts ?? []}
        customModels={input?.customModels ?? []}
        onUpdateCustomModels={onUpdateCustomModels}
        configuredProviderIds={input?.configuredProviderIds ?? ["codex", "claude"]}
      />,
    ),
    onUpdateCustomModels,
  };
}

describe("ModelManagementPage bulk model visibility", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentStatusesStore.setState({
      agentStatuses: [
        makeStatus("codex", "Codex", ["gpt-5", "gpt-5-mini"]),
        makeStatus("claude", "Claude Code", ["sonnet", "opus"]),
      ],
      wslAgentStatuses: [],
      windowsLoaded: true,
      wslLoaded: true,
    });
    useSharedSettings.setState({ hiddenModels: {} });
  });

  it("formats context badges with decimal units", () => {
    expect(formatContextBadge("")).toBeUndefined();
    expect(formatContextBadge("  ")).toBeUndefined();
    expect(formatContextBadge("1000000")).toBe("1M");
    expect(formatContextBadge("128000")).toBe("128K");
    expect(formatContextBadge("1500")).toBe("1500");
    expect(formatContextBadge("1M")).toBe("1M");
  });

  it("selects or clears every model in the current channel", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "取消 Codex 渠道全部模型" }));

    expect(useSharedSettings.getState().hiddenModels.codex).toEqual(["gpt-5", "gpt-5-mini"]);
    for (const checkbox of within(screen.getByTestId("agent-model-rows")).getAllByRole(
      "checkbox",
    )) {
      expect(checkbox).toHaveAttribute("aria-checked", "false");
    }

    fireEvent.click(screen.getByRole("button", { name: "全选 Codex 渠道全部模型" }));

    expect(useSharedSettings.getState().hiddenModels.codex).toEqual([]);
    for (const checkbox of within(screen.getByTestId("agent-model-rows")).getAllByRole(
      "checkbox",
    )) {
      expect(checkbox).toHaveAttribute("aria-checked", "true");
    }
  });

  it("selects or clears every regular provider without deleting custom API models", () => {
    const customModels: CustomModel[] = [
      {
        id: "openai-compatible:custom-model",
        provider: "openai-compatible",
        accountId: "openai-compatible:test",
        modelId: "custom-model",
        displayName: "Custom Model",
        contextSize: "128K",
      },
    ];
    const onUpdateCustomModels = vi.fn<(next: CustomModel[]) => void>();
    renderPage({
      customModels,
      onUpdateCustomModels,
      accounts: [
        {
          accountId: "openai-compatible:test",
          provider: "openai-compatible",
          label: "Custom API",
          providerAccountId: "Custom API",
          createdAt: 1,
          enabled: true,
          selected: true,
          order: 0,
          status: "available",
          credentialScopeRef: "managed:openai-compatible:test",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "取消全部渠道模型" }));

    expect(useSharedSettings.getState().hiddenModels).toMatchObject({
      codex: ["gpt-5", "gpt-5-mini"],
      claude: ["sonnet", "opus"],
    });
    expect(onUpdateCustomModels).not.toHaveBeenCalled();
    expect(screen.getByText("Custom Model")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全选全部渠道模型" }));

    expect(useSharedSettings.getState().hiddenModels).toMatchObject({ codex: [], claude: [] });
    expect(onUpdateCustomModels).not.toHaveBeenCalled();
  });

  it("clears regular provider selections from the selected-model roster", () => {
    const customModels: CustomModel[] = [
      {
        id: "openai-compatible:custom-model",
        provider: "openai-compatible",
        accountId: "openai-compatible:test",
        modelId: "custom-model",
        displayName: "Custom Model",
        contextSize: "128K",
      },
    ];
    const onUpdateCustomModels = vi.fn<(next: CustomModel[]) => void>();
    renderPage({
      customModels,
      onUpdateCustomModels,
      accounts: [
        {
          accountId: "openai-compatible:test",
          provider: "openai-compatible",
          label: "Custom API",
          providerAccountId: "Custom API",
          createdAt: 1,
          enabled: true,
          selected: true,
          order: 0,
          status: "available",
          credentialScopeRef: "managed:openai-compatible:test",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "从名单取消全部渠道模型" }));

    const roster = within(screen.getByTestId("model-roster-panel"));
    expect(roster.queryByText("GPT-5")).not.toBeInTheDocument();
    expect(roster.queryByText("SONNET")).not.toBeInTheDocument();
    expect(roster.getByText("Custom Model")).toBeInTheDocument();
    expect(onUpdateCustomModels).not.toHaveBeenCalled();
  });

  it("uses each compatible account name as its own model channel", async () => {
    const listChannelModels = vi
      .fn<() => Promise<{ models: string[] }>>()
      .mockResolvedValue({ models: ["gpt-chiral"] });
    Object.assign(window, {
      craftstation: { ...(window.craftstation ?? {}), listChannelModels },
    });
    renderPage({
      accounts: [
        {
          accountId: "openai-compatible:chiral",
          provider: "openai-compatible",
          label: "Chiral fallback",
          providerAccountId: "Chiral-API",
          createdAt: 1,
          enabled: true,
          selected: false,
          order: 0,
          status: "available",
          credentialScopeRef: "managed:chiral",
        },
      ],
    });

    expect(screen.getByRole("button", { name: /Chiral-API/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Chiral-API/u }));
    await waitFor(() =>
      expect(listChannelModels).toHaveBeenCalledWith({
        provider: "openai-compatible",
        accountId: "openai-compatible:chiral",
      }),
    );
    expect(screen.queryByText("OpenAI 兼容 API")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("上下文大小")).not.toBeInTheDocument();
  });

  it("manages saved recipes through the 我的配方 channel", () => {
    // Workbench store writes persist through dbStorage: stub the bridge for
    // this case only, then restore so other cases keep a bridgeless env.
    const previousBridge = (window as unknown as { craftstation?: unknown }).craftstation;
    Object.assign(window, {
      craftstation: {
        ...((previousBridge ?? {}) as Record<string, unknown>),
        dbGetState: vi.fn<() => Promise<null>>().mockResolvedValue(null),
        dbSetState: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    });
    try {
      useCraftingWorkbenchStore.setState({
        recipes: [
          {
            id: "recipe:harness:codex:agent:codex:gpt-5",
            version: "1.0.0",
            systemName: "Codex Harness · GPT-5",
            modelEntryRef: "agent:codex:gpt-5",
            harnessRef: "harness:codex",
            compatibility: { uiStatus: "NATIVE" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      renderPage();
      fireEvent.click(
        within(screen.getByTestId("model-channel-rail")).getByRole("button", { name: /我的配方/u }),
      );

      const rows = within(screen.getByTestId("recipe-rows"));
      const checkbox = rows.getByRole("checkbox");
      expect(checkbox).toHaveAttribute("aria-checked", "false");
      fireEvent.click(checkbox);
      expect(useCraftingWorkbenchStore.getState().recipes[0]?.homepageVisible).toBe(true);
      // 右名单出现该配方。
      expect(
        within(screen.getByTestId("model-roster-panel")).getByText("Codex Harness · GPT-5"),
      ).toBeInTheDocument();
    } finally {
      useCraftingWorkbenchStore.setState({ recipes: [] });
      if (previousBridge === undefined) {
        delete (window as unknown as { craftstation?: unknown }).craftstation;
      } else {
        (window as unknown as { craftstation?: unknown }).craftstation = previousBridge;
      }
    }
  });

  it("does not expose an installed provider until it is configured in the usage workspace", () => {
    useAgentStatusesStore.setState({
      agentStatuses: [makeStatus("antigravity", "Antigravity", ["gemini-pro"])],
      wslAgentStatuses: [],
      windowsLoaded: true,
      wslLoaded: true,
    });

    const { rerender } = render(
      <ModelManagementPage
        accounts={[]}
        customModels={[]}
        onUpdateCustomModels={vi.fn<(next: CustomModel[]) => void>()}
        configuredProviderIds={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Antigravity/u })).not.toBeInTheDocument();

    rerender(
      <ModelManagementPage
        accounts={[
          {
            accountId: "antigravity:one",
            provider: "antigravity",
            label: "Google",
            providerAccountId: "user@example.com",
            createdAt: 1,
            enabled: true,
            selected: true,
            order: 0,
            status: "available",
            credentialScopeRef: "managed:antigravity:one",
          },
        ]}
        customModels={[]}
        onUpdateCustomModels={vi.fn<(next: CustomModel[]) => void>()}
        configuredProviderIds={["antigravity"]}
      />,
    );
    expect(
      within(screen.getByTestId("model-channel-rail")).getByText("Antigravity"),
    ).toBeInTheDocument();
  });

  it("turns a hanging model-list fetch into a retryable error instead of a stuck spinner", async () => {
    vi.useFakeTimers();
    try {
      let resolveFetch!: (value: { models: string[] }) => void;
      const listChannelModels = vi.fn<() => Promise<{ models: string[] }>>(
        () =>
          new Promise<{ models: string[] }>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      Object.assign(window, {
        craftstation: { ...(window.craftstation ?? {}), listChannelModels },
      });
      renderPage({
        accounts: [
          {
            accountId: "openai-compatible:stepfun",
            provider: "openai-compatible",
            label: "StepFun",
            providerAccountId: "StepFun",
            createdAt: 1,
            enabled: true,
            selected: false,
            order: 0,
            status: "available",
            credentialScopeRef: "managed:stepfun",
          },
        ],
      });

      fireEvent.click(screen.getByRole("button", { name: /StepFun/u }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText(/正在获取模型列表/u)).toBeInTheDocument();

      // The upstream never answers: after the client timeout the spinner must
      // give way to an error plus a reachable retry action.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_001);
      });
      expect(screen.getByText(/获取模型列表超时/u)).toBeInTheDocument();
      const retry = screen.getByRole("button", { name: /获取 StepFun 上游可用模型列表/u });
      listChannelModels.mockResolvedValueOnce({ models: ["step-5-preview"] });
      fireEvent.click(retry);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("step-5-preview")).toBeInTheDocument();
      expect(resolveFetch).toBeDefined();
      delete (window as unknown as { craftstation?: unknown }).craftstation;
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits a channel model's context and effort tiers through the edit dialog", async () => {
    const customModels: CustomModel[] = [
      {
        id: "openai-compatible:kimi-k2.8-preview",
        provider: "kimi",
        accountId: "openai-compatible:ark",
        channelLabel: "Volcengine Ark",
        modelId: "kimi-k2.8-preview",
        displayName: "Kimi K2.8 Preview",
        contextSize: "1000000",
        efforts: ["low", "high", "max"],
        defaultEffort: "high",
      },
    ];
    const onUpdateCustomModels = vi.fn<(next: CustomModel[]) => void>();
    const listChannelModels = vi
      .fn<() => Promise<{ models: string[] }>>()
      .mockResolvedValue({ models: [] });
    Object.assign(window, {
      craftstation: { ...(window.craftstation ?? {}), listChannelModels },
    });
    try {
      renderPage({
        customModels,
        onUpdateCustomModels,
        accounts: [
          {
            accountId: "openai-compatible:ark",
            provider: "openai-compatible",
            label: "Volcengine Ark",
            providerAccountId: "Volcengine Ark",
            createdAt: 1,
            enabled: true,
            selected: false,
            order: 0,
            status: "available",
            credentialScopeRef: "managed:ark",
          },
        ],
      });

      fireEvent.click(screen.getByRole("button", { name: /Volcengine Ark/u }));
      const row = await screen.findByTestId("custom-model-openai-compatible:kimi-k2.8-preview");
      fireEvent.click(within(row).getByRole("button", { name: "编辑 Kimi K2.8 Preview" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("编辑模型")).toBeInTheDocument();
      // 模型 ID 在编辑模式锁定不可改。
      expect(within(dialog).getByDisplayValue("kimi-k2.8-preview")).toBeDisabled();
      expect(within(dialog).getByDisplayValue("Kimi K2.8 Preview")).toBeInTheDocument();
      expect(within(dialog).getByDisplayValue("1000000")).toBeInTheDocument();
      expect(within(dialog).getByDisplayValue("low, high, max")).toBeInTheDocument();

      fireEvent.change(within(dialog).getByDisplayValue("1000000"), {
        target: { value: "2000000" },
      });
      fireEvent.change(within(dialog).getByDisplayValue("low, high, max"), {
        target: { value: "low, high, max, ultra" },
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

      expect(onUpdateCustomModels).toHaveBeenLastCalledWith([
        expect.objectContaining({
          id: "openai-compatible:kimi-k2.8-preview",
          modelId: "kimi-k2.8-preview",
          contextSize: "2000000",
          efforts: ["low", "high", "max", "ultra"],
          defaultEffort: "high",
        }),
      ]);

      // 清空档位后保存：浅合并语义下 efforts: [] 必须正确覆盖旧值。
      fireEvent.click(within(row).getByRole("button", { name: "编辑 Kimi K2.8 Preview" }));
      const dialogAgain = await screen.findByRole("dialog");
      fireEvent.change(within(dialogAgain).getByDisplayValue("low, high, max"), {
        target: { value: "" },
      });
      fireEvent.click(within(dialogAgain).getByRole("button", { name: "保存" }));
      expect(onUpdateCustomModels).toHaveBeenLastCalledWith([
        expect.objectContaining({
          id: "openai-compatible:kimi-k2.8-preview",
          modelId: "kimi-k2.8-preview",
          efforts: [],
        }),
      ]);
    } finally {
      delete (window as unknown as { craftstation?: unknown }).craftstation;
    }
  });
});
