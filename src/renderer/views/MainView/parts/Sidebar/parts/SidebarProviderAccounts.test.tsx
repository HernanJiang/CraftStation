import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { SidebarProviderAccounts } from "./SidebarProviderAccounts";

const actions = vi.hoisted(() => ({
  createAndRunCodexProfileLogin: vi.fn<() => Promise<boolean>>(),
  createAndRunGrokProfileLogin: vi.fn<() => Promise<boolean>>(),
  runAgentLoginCommand: vi.fn<() => boolean>(),
  runCodexProfileLogin: vi.fn<() => Promise<boolean>>(),
}));

const usageLogin = vi.hoisted(() => ({
  handleSignIn: vi.fn<() => Promise<void>>(),
  handleSubmitApiKey: vi.fn<() => Promise<boolean>>(),
  handleSignOut: vi.fn<() => Promise<boolean>>(),
  setApiKey: vi.fn<(value: string) => void>(),
}));

const bridge = vi.hoisted(() => ({
  listAccounts: vi.fn<() => Promise<unknown[]>>(),
  refreshAccountQuota: vi.fn<() => Promise<void>>(),
  removeAccount: vi.fn<() => Promise<void>>(),
  reorderAccounts: vi.fn<() => Promise<void>>(),
  renameAccount: vi.fn<() => Promise<void>>(),
  selectAccount: vi.fn<() => Promise<void>>(),
  setAccountEnabled: vi.fn<() => Promise<void>>(),
  getAccountPoolScheduling:
    vi.fn<() => Promise<{ scheduling: "priority" | "round-robin" | "random" }>>(),
  setAccountPoolScheduling:
    vi.fn<
      (payload: {
        provider: string;
        scheduling: "priority" | "round-robin" | "random";
      }) => Promise<unknown>
    >(),
}));

vi.mock("@/renderer/actions/agentLoginActions", () => actions);

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
}));

const usageProvidersMock = vi.hoisted(() => ({
  providers: [
    { id: "codex", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
    { id: "gemini", label: "Gemini" },
    { id: "grok", label: "Grok" },
  ],
}));

vi.mock("@/renderer/components/providers/usageProviders", () => ({
  USAGE_PROVIDERS: usageProvidersMock.providers,
  resolveDisplayedProviders: (providerOrder: readonly string[] = []) => {
    const ordered: typeof usageProvidersMock.providers = [];
    const seen = new Set<string>();
    for (const id of providerOrder) {
      const provider = usageProvidersMock.providers.find((candidate) => candidate.id === id);
      if (provider && !seen.has(id)) {
        ordered.push(provider);
        seen.add(id);
      }
    }
    for (const provider of usageProvidersMock.providers) {
      if (!seen.has(provider.id)) ordered.push(provider);
    }
    return ordered;
  },
}));

vi.mock("@/renderer/components/providers/useUsageProviderLogin", () => ({
  useUsageProviderLogin: () => ({
    canSignIn: true,
    canReauthenticate: false,
    canApiKeySignIn: false,
    canManageApiKey: false,
    canSignOut: false,
    signingIn: false,
    apiKey: "",
    setApiKey: usageLogin.setApiKey,
    handleSignIn: usageLogin.handleSignIn,
    handleSubmitApiKey: usageLogin.handleSubmitApiKey,
    handleSignOut: usageLogin.handleSignOut,
  }),
}));

describe("SidebarProviderAccounts", () => {
  beforeEach(() => {
    usePanelStore.setState({
      modelUsageDialogOpen: false,
      settingsOpen: false,
      settingsSection: "general",
    });
    useProviderUsageStore.setState({ snapshots: {} });
    useUsageAccountsStore.getState().reset();
    bridge.listAccounts.mockReset().mockResolvedValue([]);
    bridge.refreshAccountQuota.mockReset().mockResolvedValue(undefined);
    bridge.removeAccount.mockReset().mockResolvedValue(undefined);
    bridge.reorderAccounts.mockReset().mockResolvedValue(undefined);
    bridge.renameAccount.mockReset().mockResolvedValue(undefined);
    bridge.selectAccount.mockReset().mockResolvedValue(undefined);
    bridge.setAccountEnabled.mockReset().mockResolvedValue(undefined);
    bridge.getAccountPoolScheduling.mockReset().mockResolvedValue({ scheduling: "priority" });
    bridge.setAccountPoolScheduling.mockReset().mockResolvedValue({ scheduling: "priority" });
    actions.createAndRunCodexProfileLogin.mockReset().mockResolvedValue(true);
    actions.createAndRunGrokProfileLogin.mockReset().mockResolvedValue(true);
    actions.runCodexProfileLogin.mockReset().mockResolvedValue(true);
    actions.runAgentLoginCommand.mockReset().mockReturnValue(true);
    usageLogin.handleSignIn.mockReset().mockResolvedValue();
    usageLogin.handleSubmitApiKey.mockReset().mockResolvedValue(true);
    usageLogin.handleSignOut.mockReset().mockResolvedValue(true);
    usageLogin.setApiKey.mockReset();
  });

  it("renders the default provider avatar group and the two-line model usage entry", () => {
    render(<SidebarProviderAccounts />);

    const accountButton = screen.getByRole("button", { name: "Provider accounts" });
    expect(accountButton).toHaveTextContent("模型与用量");
    expect(accountButton).toHaveTextContent("✨ 添加新模型");
    expect(screen.getByTitle("ChatGPT")).toBeInTheDocument();
    expect(screen.getByTitle("Claude")).toBeInTheDocument();
    expect(screen.getByTitle("Gemini")).toBeInTheDocument();
    expect(accountButton.querySelector('[data-provider-logo="codex"]')).toBeInTheDocument();
    expect(accountButton.querySelector('[data-provider-logo="claude"]')).toBeInTheDocument();
    expect(accountButton.querySelector('[data-provider-logo="gemini"]')).toBeInTheDocument();
    expect(screen.queryByText("CraftStation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });

  it("replaces the default avatars with currently authorized providers", () => {
    useProviderUsageStore.setState({
      snapshots: {
        claude: {
          providerId: "claude",
          status: "ok",
          authenticatedAs: "claude@example.com",
          windows: [],
          fetchedAt: 1,
        },
      },
    });

    render(<SidebarProviderAccounts />);

    expect(screen.getByTitle("Claude")).toBeInTheDocument();
    expect(screen.queryByTitle("ChatGPT")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Gemini")).not.toBeInTheDocument();
  });

  it("opens the shared model usage dialog and settings separately", async () => {
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("模型与用量");
    expect(dialog).toHaveTextContent("ChatGPT");
    expect(dialog).toHaveTextContent("Claude");
    expect(dialog).toHaveTextContent("Gemini");
    expect(dialog.querySelector('[data-provider-logo="openai-compatible"]')).toBeInTheDocument();
    expect(dialog.querySelector('[data-provider-logo="codex"]')).toBeInTheDocument();
    expect(dialog.querySelector('[data-provider-logo="claude"]')).toBeInTheDocument();
    expect(dialog.querySelector('[data-provider-logo="gemini"]')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("🔑 模型与用量");
    expect(dialog).not.toHaveTextContent("等待授权");
    expect(within(dialog).getByTestId("provider-grid")).toHaveClass(
      "grid-cols-[minmax(0,4fr)_minmax(190px,1fr)]",
    );
    expect(within(dialog).getByTestId("authorized-provider-grid")).toHaveClass("grid-cols-4");
    expect(within(dialog).getByTestId("unauthorized-provider-grid")).toHaveClass("grid-cols-1");
    expect(within(dialog).getByTestId("provider-card-codex")).toHaveAttribute(
      "data-grid-span",
      "1",
    );
    expect(within(dialog).queryByRole("button", { name: "导入账号" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "新增账号" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭模型与用量" }));
    expect(usePanelStore.getState().modelUsageDialogOpen).toBe(false);
  });

  it("routes the ChatGPT card through isolated profile login without duplicate header actions", async () => {
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    const chatGptCard = screen
      .getByRole("heading", { name: "ChatGPT" })
      .closest('[data-testid="provider-card-codex"]');
    expect(chatGptCard).toBeInstanceOf(HTMLElement);

    fireEvent.click(within(chatGptCard as HTMLElement).getByRole("button", { name: "登录/授权" }));
    await waitFor(() =>
      expect(actions.createAndRunCodexProfileLogin).toHaveBeenCalledWith({ label: "New Codex" }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("button", { name: "新增账号" })).not.toBeInTheDocument();
  });

  it("uses isolated profile creation for Add account on an authorised ChatGPT card", async () => {
    const account = {
      accountId: "codex:signed-in",
      provider: "codex",
      label: "Work profile",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:codex:signed-in",
      maskedIdentity: "si***@example.com",
    };
    bridge.listAccounts.mockResolvedValue([account]);
    useUsageAccountsStore.getState().setAccounts([account]);
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    const accountPoolCard = within(dialog).getByTestId("provider-card-codex");
    expect(accountPoolCard).toHaveAttribute("data-grid-span", "4");
    expect(accountPoolCard).toHaveClass("col-span-4");
    fireEvent.click(within(accountPoolCard).getByRole("button", { name: "添加 ChatGPT 账号" }));

    await waitFor(() =>
      expect(actions.createAndRunCodexProfileLogin).toHaveBeenCalledWith({ label: "New Codex" }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
  });

  it("persists provider pool scheduling from the authorised pool header", async () => {
    const grokAccount = {
      accountId: "grok:scheduling",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:scheduling",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);
    bridge.getAccountPoolScheduling.mockResolvedValue({ scheduling: "priority" });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    const scheduling = await within(dialog).findByTestId("account-scheduling-grok");

    fireEvent.change(scheduling, { target: { value: "round-robin" } });

    await waitFor(() =>
      expect(bridge.setAccountPoolScheduling).toHaveBeenCalledWith({
        provider: "grok",
        scheduling: "round-robin",
      }),
    );
  });

  it("expands only an authorised provider card to two columns", async () => {
    useProviderUsageStore.setState({
      snapshots: {
        claude: {
          providerId: "claude",
          status: "ok",
          authenticatedAs: "claude@example.com",
          windows: [],
          fetchedAt: 1,
        },
      },
    });
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("provider-card-claude")).toHaveAttribute(
      "data-grid-span",
      "2",
    );
    expect(within(dialog).getByTestId("provider-card-gemini")).toHaveAttribute(
      "data-grid-span",
      "1",
    );
  });

  it("routes an existing unauthorised account through its managed profile login", async () => {
    const account = {
      accountId: "codex:existing",
      provider: "codex",
      label: "Work profile",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "auth-expired" as const,
      credentialScopeRef: "managed:codex:existing",
    };
    bridge.listAccounts.mockResolvedValue([account]);
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    await screen.findByRole("dialog");
    fireEvent.click(await screen.findByRole("button", { name: "Work profile 登录授权" }));

    await waitFor(() =>
      expect(actions.runCodexProfileLogin).toHaveBeenCalledWith({
        accountId: account.accountId,
        label: account.label,
      }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
  });

  it("routes the Grok card through the isolated official device login, never the browser usage login", async () => {
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    await screen.findByRole("dialog");
    const grokCard = screen
      .getByRole("heading", { name: "Grok" })
      .closest('[data-testid="provider-card-grok"]');
    expect(grokCard).toBeInstanceOf(HTMLElement);

    fireEvent.click(within(grokCard as HTMLElement).getByRole("button", { name: "登录/授权" }));

    await waitFor(() =>
      expect(actions.createAndRunGrokProfileLogin).toHaveBeenCalledWith({ label: "New Grok" }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
    expect(usageLogin.handleSignIn).not.toHaveBeenCalled();
    expect(actions.createAndRunCodexProfileLogin).not.toHaveBeenCalled();
  });

  it("selects and enables a Grok account from the compact sidebar card", async () => {
    const grokAccount = {
      accountId: "grok:compact",
      provider: "grok",
      label: "her",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: false,
      selected: false,
      order: 0,
      status: "disabled" as const,
      credentialScopeRef: "managed:grok:compact",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const grokCard = await screen.findByTestId("provider-card-grok");
    fireEvent.click(within(grokCard).getByText("her", { selector: "p" }));

    await waitFor(() =>
      expect(bridge.setAccountEnabled).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        enabled: true,
      }),
    );
    expect(bridge.selectAccount).not.toHaveBeenCalled();
    expect(useUsageAccountsStore.getState().nextSessionAccountId).toBe(grokAccount.accountId);
    expect(actions.createAndRunGrokProfileLogin).not.toHaveBeenCalled();
  });

  it("renames a Grok account from the compact sidebar card context menu", async () => {
    const grokAccount = {
      accountId: "grok:compact-rename",
      provider: "grok",
      label: "her",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:compact-rename",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Work");

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const grokCard = await screen.findByTestId("provider-card-grok");
    fireEvent.contextMenu(within(grokCard).getByText("her", { selector: "p" }));

    await waitFor(() =>
      expect(bridge.renameAccount).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        label: "Work",
      }),
    );
    expect(prompt).toHaveBeenCalledWith("重命名账号", "her");
    prompt.mockRestore();
  });

  it("renders an imported Grok account in the model usage dialog", async () => {
    const grokAccount = {
      accountId: "grok:existing",
      provider: "grok",
      label: "New Grok",
      maskedIdentity: "person***@example.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:existing",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByTestId("provider-card-grok")).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("Grok 账号池")).toBeInTheDocument();
    expect(within(dialog).getByText("person***@example.com")).toBeInTheDocument();
    expect(within(dialog).getAllByText("available").length).toBeGreaterThan(0);
  });

  it("enables and selects a Grok row when the account row is clicked", async () => {
    const grokAccount = {
      accountId: "grok:disabled",
      provider: "grok",
      label: "per",
      maskedIdentity: "per***son@example.com",
      createdAt: 1,
      enabled: false,
      selected: false,
      order: 0,
      status: "disabled" as const,
      credentialScopeRef: "managed:grok:disabled",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("per", { selector: "p" }));

    await waitFor(() =>
      expect(bridge.setAccountEnabled).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        enabled: true,
      }),
    );
    expect(bridge.selectAccount).not.toHaveBeenCalled();
    expect(useUsageAccountsStore.getState().nextSessionAccountId).toBe(grokAccount.accountId);
    expect(actions.createAndRunGrokProfileLogin).not.toHaveBeenCalled();
  });

  it("renames a Grok account from its context menu without exposing credentials", async () => {
    const grokAccount = {
      accountId: "grok:rename",
      provider: "grok",
      label: "per",
      maskedIdentity: "per***son@example.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:rename",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Renamed");

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.contextMenu(within(dialog).getByText("per", { selector: "p" }));

    await waitFor(() =>
      expect(bridge.renameAccount).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        label: "Renamed",
      }),
    );
    expect(prompt).toHaveBeenCalledWith("重命名账号", "per");
    prompt.mockRestore();
  });

  it("shows the real identity as primary text with the alias secondary (v0.5 T06)", async () => {
    const grokAccount = {
      accountId: "grok:identity",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:identity",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByText("her***g01@gmail.com")).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("Grok Account 1")).toBeInTheDocument();
  });

  it("renders the per-account 2x2 usage grid and shows — when no cache is available (v0.5 T06)", async () => {
    const grokAccount = {
      accountId: "grok:grid",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:grid",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);
    useProviderUsageStore.setState({
      snapshots: {
        grok: {
          providerId: "grok",
          status: "ok",
          windows: [{ id: "session-5h", usedPercent: 42 }],
          fetchedAt: Date.now(),
        } as never,
      },
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");

    await waitFor(() =>
      expect(within(dialog).getByTestId("account-usage-grid-grok:grid")).toBeInTheDocument(),
    );
    const grid = within(dialog).getByTestId("account-usage-grid-grok:grid");
    // Provider-wide usage must not be copied to every account row. Without an
    // account-scoped quota window this row intentionally has no exact value.
    expect(grid).not.toHaveTextContent("42%");
    expect(grid).toHaveTextContent("—");
    expect(grid).toHaveTextContent("available");
  });

  it("renders quota only when the account carries an account-scoped window", async () => {
    const grokAccount = {
      accountId: "grok:scoped-quota",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:scoped-quota",
      quotaWindows: [{ id: "session-5h", label: "5h", usedPercent: 42 }],
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByRole("dialog");
    const grid = await within(dialog).findByTestId("account-usage-grid-grok:scoped-quota");

    expect(grid).toHaveTextContent("42%");
  });
});
