import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type { CustomModel } from "@/renderer/components/thread/customModelCatalog";
import { ModelManagementPage } from "./ModelManagementPage";

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
});
