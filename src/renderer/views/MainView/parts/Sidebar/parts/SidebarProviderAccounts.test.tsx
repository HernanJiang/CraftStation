import type { ReactElement } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useTokenUsageStore } from "@/renderer/state/tokenUsageStore";
import { SidebarProviderAccounts } from "./SidebarProviderAccounts";
import { ModelUsageWorkspace } from "./ModelUsageWorkspace";
import "@/renderer/components/providers/bootstrap";

function render(ui: ReactElement) {
  return renderWithI18n(
    <>
      {ui}
      <ModelUsageWorkspace />
    </>,
  );
}

function renderSidebarOnly() {
  return renderWithI18n(<SidebarProviderAccounts />);
}

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
  refreshAccountQuota: vi.fn<() => Promise<unknown>>(),
  refreshTokenUsage: vi.fn<() => Promise<unknown>>(),
  removeAccount: vi.fn<() => Promise<void>>(),
  applyAntigravityHostLogin: vi.fn<() => Promise<unknown>>(),
  forgetProviderUsage: vi.fn<() => Promise<void>>(),
  reorderAccounts: vi.fn<() => Promise<void>>(),
  renameAccount: vi.fn<() => Promise<void>>(),
  selectAccount: vi.fn<() => Promise<void>>(),
  setAccountEnabled: vi.fn<() => Promise<void>>(),
  getAccountPoolScheduling:
    vi.fn<() => Promise<{ scheduling: "priority" | "round-robin" | "random" }>>(),
  getProfileDevices: vi.fn<() => Promise<unknown>>(),
  getProfileCoreStats: vi.fn<() => Promise<unknown>>(),
  getProfileTokenStats: vi.fn<() => Promise<unknown>>(),
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
  isRemoteSession: () => false,
}));

const usageProvidersMock = vi.hoisted(() => ({
  providers: [
    { id: "codex", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
    { id: "gemini", label: "Gemini" },
    { id: "cursor", label: "Cursor" },
    { id: "grok", label: "Grok" },
    { id: "kimi", label: "Kimi Code" },
    { id: "antigravity", label: "Antigravity" },
    { id: "commandcode", label: "Command Code" },
    { id: "openai-compatible", label: "OpenAI 兼容 API" },
    { id: "opencode", label: "OpenCode" },
  ],
}));

vi.mock("@/renderer/components/providers/usageProviders", () => ({
  USAGE_PROVIDERS: usageProvidersMock.providers,
  cookiePasteUrl: () => undefined,
  needsBrowserSessionForUsage: () => false,
  resolveDisplayedProviders: (
    providerOrder: readonly string[] = [],
    disabledProviders: readonly string[] = [],
  ) => {
    const ordered: typeof usageProvidersMock.providers = [];
    const seen = new Set<string>();
    for (const id of providerOrder) {
      const provider = usageProvidersMock.providers.find((candidate) => candidate.id === id);
      if (provider && !disabledProviders.includes(id) && !seen.has(id)) {
        ordered.push(provider);
        seen.add(id);
      }
    }
    for (const provider of usageProvidersMock.providers) {
      if (!disabledProviders.includes(provider.id) && !seen.has(provider.id)) {
        ordered.push(provider);
      }
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
      modelUsageWorkspaceTab: "usage",
      modelUsageEntryMode: null,
      settingsOpen: false,
      settingsSection: "general",
    });
    useSharedSettings.setState((state) => ({
      customModels: [],
      usage: {
        ...state.usage,
        disabledProviders: ["gemini", "cursor"],
        providerOrder: [],
      },
    }));
    useProviderUsageStore.setState({ snapshots: {} });
    useTokenUsageStore.getState().reset();
    useUsageAccountsStore.getState().reset();
    bridge.listAccounts.mockReset().mockResolvedValue([]);
    bridge.refreshAccountQuota.mockReset().mockResolvedValue(undefined);
    bridge.refreshTokenUsage.mockReset().mockResolvedValue({ summaries: [], sources: [] });
    bridge.removeAccount.mockReset().mockResolvedValue(undefined);
    bridge.applyAntigravityHostLogin
      .mockReset()
      .mockResolvedValue({ applied: true, email: "a@example.com" });
    bridge.forgetProviderUsage.mockReset().mockResolvedValue(undefined);
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

  it("opens the shared model usage workspace and settings separately", async () => {
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(workspace).toHaveTextContent("渠道与额度");
    expect(workspace).toHaveTextContent("管理模型");
    expect(workspace).toHaveTextContent("用量统计");
    expect(workspace).toHaveTextContent("ChatGPT");
    expect(workspace).toHaveTextContent("Claude");
    expect(workspace).toHaveTextContent("Gemini");
    expect(workspace).toHaveTextContent("Cursor");
    expect(workspace.querySelector('[data-testid="provider-grid"]')).toBeInTheDocument();
    expect(within(workspace).getByTestId("authorized-provider-grid")).toBeInTheDocument();
    expect(within(workspace).getByTestId("unauthorized-provider-grid")).toBeInTheDocument();
    // Unauthorised codex card stays single column (F26/F30); authorised pool is separate full-width section
    expect(within(workspace).getByTestId("provider-card-codex")).toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "导入账号" })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "新增账号" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭模型与用量" }));
    await waitFor(() =>
      expect(screen.queryByTestId("model-usage-workspace")).not.toBeInTheDocument(),
    );
    expect(usePanelStore.getState().modelUsageDialogOpen).toBe(false);
  });

  it("keeps the inline workspace out of the sidebar tree", () => {
    usePanelStore.setState({ modelUsageDialogOpen: true });
    renderSidebarOnly();

    expect(screen.queryByTestId("model-usage-workspace")).not.toBeInTheDocument();
  });

  it("routes the ChatGPT card through isolated profile login without duplicate header actions", async () => {
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const chatGptCard = screen
      .getByRole("heading", { name: "ChatGPT" })
      .closest('[data-testid="provider-card-codex"]');
    expect(chatGptCard).toBeInstanceOf(HTMLElement);

    fireEvent.click(within(chatGptCard as HTMLElement).getByRole("button", { name: "登录/授权" }));
    await waitFor(() =>
      expect(actions.createAndRunCodexProfileLogin).toHaveBeenCalledWith({ label: "New Codex" }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
    expect(within(workspace).queryByRole("button", { name: "新增账号" })).not.toBeInTheDocument();
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
    const workspace2 = await screen.findByTestId("model-usage-workspace");
    const accountPoolCard = within(workspace2).getByTestId("provider-card-codex");
    expect(accountPoolCard).toBeInTheDocument();
    fireEvent.click(within(accountPoolCard).getByRole("button", { name: "添加 ChatGPT 账号" }));

    await waitFor(() =>
      expect(actions.createAndRunCodexProfileLogin).toHaveBeenCalledWith({ label: "New Codex" }),
    );
    expect(actions.runAgentLoginCommand).not.toHaveBeenCalled();
  });

  it("persists provider pool scheduling from the authorised pool header", async () => {
    // Scheduling lives in the multi-account pool header; one row renders as a
    // compact card instead.
    const grokAccounts = ["grok:scheduling-a", "grok:scheduling-b"].map((accountId, index) => ({
      accountId,
      provider: "grok",
      label: `Grok Account ${index + 1}`,
      maskedIdentity: `user${index}@gmail.com`,
      createdAt: 1,
      enabled: true,
      selected: index === 0,
      order: index,
      status: "available" as const,
      credentialScopeRef: `managed:${accountId}`,
    }));
    bridge.listAccounts.mockResolvedValue(grokAccounts);
    useUsageAccountsStore.getState().setAccounts(grokAccounts);
    bridge.getAccountPoolScheduling.mockResolvedValue({ scheduling: "priority" });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace3 = await screen.findByTestId("model-usage-workspace");
    const scheduling = await within(workspace3).findByTestId("account-scheduling-grok");

    fireEvent.change(scheduling, { target: { value: "round-robin" } });

    await waitFor(() =>
      expect(bridge.setAccountPoolScheduling).toHaveBeenCalledWith({
        provider: "grok",
        scheduling: "round-robin",
      }),
    );
  });

  it("lays authorised provider cards out two per row", async () => {
    useProviderUsageStore.setState({
      snapshots: {
        claude: {
          providerId: "claude",
          status: "ok",
          authenticatedAs: "claude@example.com",
          windows: [],
          fetchedAt: 1,
        },
        gemini: {
          providerId: "gemini",
          status: "ok",
          authenticatedAs: "gemini@example.com",
          windows: [],
          fetchedAt: 1,
        },
      },
    });
    render(<SidebarProviderAccounts />);

    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace4 = await screen.findByTestId("model-usage-workspace");
    const grid = within(workspace4).getByTestId("authorized-provider-grid");
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).toHaveClass("auto-rows-max", "content-start");
    expect(grid).toHaveAttribute("data-layout", "two-column");
    expect(within(grid).getByTestId("provider-card-claude")).toHaveClass("col-span-1");
    expect(within(grid).getByTestId("provider-card-gemini")).toHaveClass("col-span-1");
  });

  it("routes an existing unauthorised account through its managed profile login", async () => {
    const account = {
      accountId: "codex:existing",
      provider: "codex",
      label: "Work profile",
      providerAccountId: "work@example.com",
      maskedIdentity: "work@example.com",
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
    await screen.findByTestId("model-usage-workspace");
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
    await screen.findByTestId("model-usage-workspace");
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
    fireEvent.click(
      within(grokCard).getByTestId("account-quota-card-grok:compact").closest("[data-account-id]")!,
    );

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
    // Electron renderers throw on window.prompt; the rename must use the
    // in-app dialog only.
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("prompt() is not supported.");
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const grokCard = await screen.findByTestId("provider-card-grok");
    fireEvent.contextMenu(
      within(grokCard)
        .getByTestId("account-quota-card-grok:compact-rename")
        .closest("[data-account-id]")!,
    );

    const dialog = await screen.findByRole("dialog", { name: "重命名账号" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Work" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(bridge.renameAccount).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        label: "Work",
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("renders an imported Grok account in the model usage workspace", async () => {
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
    const dialog = await screen.findByTestId("model-usage-workspace");

    await waitFor(() =>
      expect(within(dialog).getByTestId("provider-card-grok")).toBeInTheDocument(),
    );
    // Single-account pool renders as a compact (half-width) card, matching the
    // ChatGPT/Command Code card style — not the wide pool section.
    expect(within(dialog).getByTestId("provider-card-grok")).toHaveClass(
      "col-span-1",
      "self-start",
      "h-fit",
    );
    const accountRow = within(dialog)
      .getByText("person***@example.com")
      .closest('[data-account-id="grok:existing"]');
    expect(accountRow).not.toBeNull();
    expect(accountRow).toHaveClass("self-start", "h-fit");
    expect(within(dialog).queryByText("Grok 账号池")).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("account-grid-grok")).not.toBeInTheDocument();
    expect(within(dialog).getByText("person***@example.com")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("account-status-grok:existing")).not.toBeInTheDocument();
  });

  it("renders registered provider icons for the Grok account row and catalog cards", async () => {
    const grokAccount = {
      accountId: "grok:icon",
      provider: "grok",
      label: "her",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:icon",
    };
    bridge.listAccounts.mockResolvedValue([grokAccount]);
    useUsageAccountsStore.getState().setAccounts([grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");

    expect(within(workspace).getByTestId("account-provider-icon-grok:icon")).toBeInTheDocument();
    expect(within(workspace).getByTestId("provider-badge-grok")).toBeInTheDocument();
    expect(
      within(workspace)
        .getByTestId("provider-badge-openai-compatible")
        .querySelector('[data-provider-logo="openai-compatible"]'),
    ).toBeInTheDocument();
    // Grok renders the vendored brand asset on a white tile.
    expect(
      within(workspace)
        .getByTestId("provider-badge-grok")
        .querySelector('[data-provider-logo="grok"]'),
    ).toBeInTheDocument();
    expect(within(workspace).queryByText("Gr")).not.toBeInTheDocument();
    expect(within(workspace).queryByText("Op")).not.toBeInTheDocument();
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
    const dialog = await screen.findByTestId("model-usage-workspace");
    fireEvent.click(
      within(dialog).getByTestId("account-quota-card-grok:disabled").closest("[data-account-id]")!,
    );

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
    const prompt = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("prompt() is not supported.");
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");
    fireEvent.contextMenu(
      within(dialog).getByTestId("account-quota-card-grok:rename").closest("[data-account-id]")!,
    );

    const renameDialog = await screen.findByRole("dialog", { name: "重命名账号" });
    fireEvent.change(within(renameDialog).getByRole("textbox"), { target: { value: "Renamed" } });
    fireEvent.click(within(renameDialog).getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(bridge.renameAccount).toHaveBeenCalledWith({
        accountId: grokAccount.accountId,
        label: "Renamed",
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("renders a stale identity-less account as an inert, removable row", async () => {
    // Legacy residue (seen on OpenCode): an account row that never resolved an
    // identity can never select a working session and must not be clickable.
    const stale = {
      accountId: "opencode:stale",
      provider: "opencode",
      label: "OpenCode",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "unavailable" as const,
      credentialScopeRef: "managed:opencode:stale",
    };
    bridge.listAccounts.mockResolvedValue([stale]);
    useUsageAccountsStore.getState().setAccounts([stale]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const staleRow = await within(workspace).findByTestId(
      "compact-account-row-stale-opencode:stale",
    );
    expect(within(staleRow).getByText("账号身份未知（已失效）")).toBeInTheDocument();

    fireEvent.click(staleRow);
    expect(bridge.setAccountEnabled).not.toHaveBeenCalled();
    expect(useUsageAccountsStore.getState().nextSessionAccountId).toBeNull();

    // Main-process removal succeeds: the next listing no longer returns it.
    bridge.listAccounts.mockResolvedValue([]);
    fireEvent.click(within(staleRow).getByRole("button", { name: "删除失效的 OpenCode 缓存" }));
    await waitFor(() =>
      expect(bridge.removeAccount).toHaveBeenCalledWith({ accountId: stale.accountId }),
    );
    await waitFor(() => expect(useUsageAccountsStore.getState().accounts).toEqual([]));
  });

  it("reorders channel cards by drag and persists the new provider order", async () => {
    const codexAccount = {
      accountId: "codex:drag",
      provider: "codex",
      label: "C",
      maskedIdentity: "c***t@example.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:codex:drag",
    };
    const grokAccount = {
      accountId: "grok:drag",
      provider: "grok",
      label: "G",
      maskedIdentity: "g***k@example.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:drag",
    };
    bridge.listAccounts.mockResolvedValue([codexAccount, grokAccount]);
    useUsageAccountsStore.getState().setAccounts([codexAccount, grokAccount]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const codexCard = await within(workspace).findByTestId("provider-card-codex");
    const grokCard = within(workspace).getByTestId("provider-card-grok");

    fireEvent.dragStart(codexCard, { dataTransfer: { setData: vi.fn<() => void>() } });
    fireEvent.drop(grokCard, { dataTransfer: { setData: vi.fn<() => void>() } });

    const order = useSharedSettings.getState().usage.providerOrder;
    expect(order.indexOf("grok")).toBeLessThan(order.indexOf("codex"));
    // The Grok pool card must now render above the ChatGPT pool card. Re-query:
    // React replaces the DOM nodes on reorder, so the earlier reference is stale.
    const grokAfter = within(workspace).getByTestId("provider-card-grok");
    const codexAfter = within(workspace).getByTestId("provider-card-codex");
    expect(
      grokAfter.compareDocumentPosition(codexAfter) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the real identity first and the subscription tier second (v0.5 T06)", async () => {
    const grokAccount = {
      accountId: "grok:identity",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      plan: "SuperGrok",
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
    const dialog = await screen.findByTestId("model-usage-workspace");

    await waitFor(() =>
      expect(within(dialog).getByText("her***g01@gmail.com")).toBeInTheDocument(),
    );
    expect(within(dialog).getByText("SuperGrok")).toBeInTheDocument();
    expect(within(dialog).queryByText("Grok Account 1")).not.toBeInTheDocument();
  });

  it("keeps account actions on the same header row as the identity", async () => {
    const account = {
      accountId: "grok:header-actions",
      provider: "grok",
      label: "Grok Account 1",
      providerAccountId: "full.account@example.com",
      plan: "SuperGrok",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:header-actions",
      quotaWindows: [{ id: "weekly", label: "Weekly", usedPercent: 18 }],
    };
    bridge.listAccounts.mockResolvedValue([account]);
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const row = within(workspace)
      .getByTestId("account-identity-grok:header-actions")
      .closest("[data-account-id]");
    expect(row).not.toBeNull();
    expect(row).toContainElement(within(row as HTMLElement).getByLabelText("刷新账号配额"));
    expect(row).toContainElement(within(row as HTMLElement).getByLabelText("禁用账号"));
    expect(row).toContainElement(within(row as HTMLElement).getByLabelText("移除账号"));
    expect(
      within(row as HTMLElement).queryByTestId("account-status-grok:header-actions"),
    ).not.toBeInTheDocument();
  });

  it("applies an Antigravity pool row as the host agy login", async () => {
    const first = {
      accountId: "antigravity:first",
      provider: "antigravity",
      label: "First AG",
      providerAccountId: "first@example.com",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:antigravity:first",
    };
    const second = {
      ...first,
      accountId: "antigravity:second",
      label: "Second AG",
      providerAccountId: "second@example.com",
      selected: false,
      order: 1,
      credentialScopeRef: "managed:antigravity:second",
    };
    bridge.listAccounts.mockResolvedValue([first, second]);
    useUsageAccountsStore.getState().setAccounts([first, second]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const row = within(workspace)
      .getByTestId(`account-identity-${first.accountId}`)
      .closest("[data-account-id]");
    expect(row).not.toBeNull();

    fireEvent.click(within(row as HTMLElement).getByLabelText("First AG 设为本机登录"));

    await waitFor(() =>
      expect(bridge.applyAntigravityHostLogin).toHaveBeenCalledWith({
        accountId: first.accountId,
      }),
    );
  });

  it("deletes only the managed API account, its models, and its pending session binding", async () => {
    const deleted = {
      accountId: "openai-compatible:deleted",
      provider: "openai-compatible",
      label: "Deleted API",
      providerAccountId: "Deleted-API",
      createdAt: 1,
      enabled: true,
      selected: true,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:openai-compatible:deleted",
    };
    const retained = {
      ...deleted,
      accountId: "openai-compatible:retained",
      label: "Retained API",
      providerAccountId: "Retained-API",
      selected: false,
      order: 1,
      credentialScopeRef: "managed:openai-compatible:retained",
    };
    bridge.listAccounts.mockResolvedValue([deleted, retained]);
    useUsageAccountsStore.getState().setAccounts([deleted, retained]);
    useUsageAccountsStore.getState().setNextSessionAccount(deleted.accountId);
    useSharedSettings.setState({
      customModels: [
        {
          id: "deleted-model",
          provider: "openai-compatible",
          accountId: deleted.accountId,
          channelLabel: "Deleted-API",
          modelId: "deleted-model",
          displayName: "Deleted Model",
          contextSize: "",
        },
        {
          id: "retained-model",
          provider: "openai-compatible",
          accountId: retained.accountId,
          channelLabel: "Retained-API",
          modelId: "retained-model",
          displayName: "Retained Model",
          contextSize: "",
        },
      ],
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const deletedRow = within(workspace)
      .getByTestId(`account-identity-${deleted.accountId}`)
      .closest("[data-account-id]");
    expect(deletedRow).not.toBeNull();

    bridge.listAccounts.mockResolvedValue([retained]);
    fireEvent.click(within(deletedRow as HTMLElement).getByLabelText("移除账号"));

    await waitFor(() =>
      expect(bridge.removeAccount).toHaveBeenCalledWith({ accountId: deleted.accountId }),
    );
    await waitFor(() => expect(useUsageAccountsStore.getState().accounts).toEqual([retained]));
    expect(useUsageAccountsStore.getState().nextSessionAccountId).toBeNull();
    expect(useSharedSettings.getState().customModels).toEqual([
      expect.objectContaining({ accountId: retained.accountId, modelId: "retained-model" }),
    ]);
    expect(usageLogin.handleSignOut).not.toHaveBeenCalled();

    fireEvent.click(within(workspace).getByRole("tab", { name: "管理模型" }));
    await waitFor(() =>
      expect(within(workspace).getAllByText("Retained-API").length).toBeGreaterThan(0),
    );
    expect(within(workspace).queryByText("Deleted-API")).not.toBeInTheDocument();
    expect(within(workspace).getByText("Retained Model")).toBeInTheDocument();
    expect(within(workspace).queryByText("Deleted Model")).not.toBeInTheDocument();
  });

  it("renders the per-account quota card with long bars and no cache grid as primary (F31)", async () => {
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
    const workspace = await screen.findByTestId("model-usage-workspace");

    await waitFor(() =>
      expect(within(workspace).getByTestId("account-quota-card-grok:grid")).toBeInTheDocument(),
    );
    const card = within(workspace).getByTestId("account-quota-card-grok:grid");
    // F31: long quota bars, not a 2x2 cache grid; an account with no quota
    // data says so honestly instead of rendering two meaningless "--" bars.
    expect(card).toHaveTextContent("暂无可用额度数据。");
    expect(card).not.toHaveTextContent("5h 限额");
    expect(within(workspace).queryByTestId("account-usage-grid-grok:grid")).not.toBeInTheDocument();
    // Provider-wide usage must not be copied to every account row.
    expect(card).not.toHaveTextContent("42%");
    const accountRow = within(workspace)
      .getByTestId("account-quota-card-grok:grid")
      .closest("[data-account-id]");
    expect(accountRow).not.toBeNull();
    expect(
      within(accountRow as HTMLElement).queryByTestId("account-status-grok:grid"),
    ).not.toBeInTheDocument();
    expect(within(workspace).getByTestId("account-meta-grok:grid")).not.toHaveTextContent(
      "available",
    );
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
    const workspace = await screen.findByTestId("model-usage-workspace");
    const card = await within(workspace).findByTestId("account-quota-card-grok:scoped-quota");

    await waitFor(() => expect(card).toHaveTextContent("42%"));
  });

  it("uses the same long-bar card for an authorised Kimi snapshot", async () => {
    useProviderUsageStore.setState({
      snapshots: {
        kimi: {
          providerId: "kimi",
          status: "ok",
          authenticatedAs: "kimi@example.com",
          windows: [
            { id: "session-5h", label: "Session", usedPercent: 18, resetsAt: 1 },
            { id: "weekly", label: "Weekly", usedPercent: 36, resetsAt: 2 },
          ],
          tokens: { input: 1200, output: 3400 },
          fetchedAt: 1,
        } as never,
      },
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const card = await within(workspace).findByTestId("provider-quota-card-kimi");
    expect(within(workspace).getByTestId("authorized-provider-grid")).toHaveClass("items-start");
    expect(within(workspace).getByTestId("provider-card-kimi")).toHaveClass("self-start", "h-fit");

    // Windows render with the collector's own labels (Session / Weekly), not a
    // forced "5h 限额 / 周/月限额" pair.
    expect(card).toHaveTextContent("Session");
    expect(card).toHaveTextContent("Weekly");
    expect(card).toHaveTextContent("18%");
    expect(card).toHaveTextContent("36%");
    expect(card).toHaveTextContent("已用额度 18%");
    expect(card).toHaveTextContent("已用额度 36%");
    const bars = within(card).getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(within(bars[0]!).getByText("已用额度 18%")).toBeInTheDocument();
    expect(within(bars[1]!).getByText("已用额度 36%")).toBeInTheDocument();
    expect(within(card).getByTestId("provider-meta-kimi")).not.toHaveTextContent("已用额度");
    expect(card).toHaveTextContent("输入 1.2k");
    expect(card).toHaveTextContent("输出 3.4k");
    const kimiProviderCard = within(workspace).getByTestId("provider-card-kimi");
    expect(within(kimiProviderCard).queryByTestId("provider-status-kimi")).not.toBeInTheDocument();
    expect(within(kimiProviderCard).getByText("已用额度 36%")).toBeInTheDocument();
    expect(
      within(kimiProviderCard).queryByText("已用额度 36%", { selector: "span" }),
    ).not.toBeNull();
    expect(within(card).getByTestId("provider-meta-kimi")).not.toHaveTextContent("可用");
    expect(within(card).getByTestId("provider-meta-kimi")).not.toHaveTextContent("ok");
  });

  it("keeps a verified Antigravity identity in the left card while the app is closed", async () => {
    useProviderUsageStore.setState({
      snapshots: {
        antigravity: {
          providerId: "antigravity",
          status: "app-not-running",
          authenticatedAs: "full.antigravity@example.com",
          plan: "Google AI Pro",
          windows: [],
          fetchedAt: 1,
        },
      },
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    const card = within(workspace).getByTestId("provider-card-antigravity");

    expect(within(workspace).getByTestId("authorized-provider-grid")).toContainElement(card);
    expect(within(workspace).getByTestId("unauthorized-provider-grid")).not.toContainElement(card);
    expect(within(card).getByText("full.antigravity@example.com")).toBeInTheDocument();
    expect(within(card).getByText("Google AI Pro")).toBeInTheDocument();
    expect(within(card).queryByTestId("provider-status-antigravity")).not.toBeInTheDocument();
  });

  it("refreshes managed quota and exact token usage when the dialog opens", async () => {
    const account = {
      accountId: "grok:refresh-on-open",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:refresh-on-open",
    };
    const updatedAccount = {
      ...account,
      quotaWindows: [{ id: "session-5h", label: "5h", usedPercent: 42 }],
    };
    const tokenResponse = {
      summaries: [
        {
          period: "today",
          source: "runtime-ledger",
          quality: "exact",
          observedAt: 1,
          coverage: { from: 1, to: 1, complete: true },
          inputTokens: 100,
          outputTokens: 234,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 334,
          byTool: [],
          byModel: [],
          byProject: [],
          bySession: [],
          byAccount: [
            {
              key: account.accountId,
              label: account.label,
              inputTokens: 100,
              outputTokens: 234,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
              totalTokens: 1_234,
            },
          ],
        },
      ],
      sources: [{ source: "runtime-ledger", quality: "exact", available: true }],
    };
    bridge.listAccounts
      .mockReset()
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([updatedAccount]);
    bridge.refreshAccountQuota.mockResolvedValue(updatedAccount);
    bridge.refreshTokenUsage.mockResolvedValue(tokenResponse);
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");

    await waitFor(() =>
      expect(bridge.refreshAccountQuota).toHaveBeenCalledWith({
        accountId: account.accountId,
      }),
    );
    expect(bridge.refreshTokenUsage).toHaveBeenCalledWith({
      periods: ["today", "month", "allTime"],
    });
    const card = await within(dialog).findByTestId("account-quota-card-grok:refresh-on-open");
    await waitFor(() => {
      expect(card).toHaveTextContent("42%");
    });
    await waitFor(() =>
      expect(within(dialog).getByTestId("account-meta-grok:refresh-on-open")).toHaveTextContent(
        "\u8F93\u5165",
      ),
    );
  });

  it("shows quota and token refresh failures in the account grid", async () => {
    const account = {
      accountId: "grok:refresh-failure",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:refresh-failure",
    };
    bridge.listAccounts.mockReset().mockResolvedValue([account]);
    bridge.refreshAccountQuota.mockRejectedValue(new Error("quota network unavailable"));
    bridge.refreshTokenUsage.mockRejectedValue(new Error("token ledger unavailable"));
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");
    const meta = await within(dialog).findByTestId("account-meta-grok:refresh-failure");

    await waitFor(() => {
      expect(meta).toHaveTextContent("quota network unavailable");
      expect(meta).toHaveTextContent("暂无精确 Token 用量");
    });
  });

  it("shows an unavailable quota response instead of a successful dash", async () => {
    const account = {
      accountId: "grok:unavailable-quota",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:unavailable-quota",
    };
    const unavailableAccount = {
      ...account,
      status: "unavailable" as const,
      lastError: "Grok quota request timed out after 15000ms.",
      quotaWindows: [],
    };
    bridge.listAccounts
      .mockReset()
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([unavailableAccount]);
    bridge.refreshAccountQuota.mockResolvedValue(unavailableAccount);
    bridge.refreshTokenUsage.mockResolvedValue({ summaries: [], sources: [] });
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");
    const meta2 = await within(dialog).findByTestId("account-meta-grok:unavailable-quota");

    await waitFor(() => {
      expect(meta2).toHaveTextContent("Grok quota request timed out");
      expect(meta2).not.toHaveTextContent("—");
    });
  });

  it("shows no exact token usage when the scanner has no account breakdown", async () => {
    const account = {
      accountId: "grok:no-exact-token",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:no-exact-token",
    };
    const tokenUnavailable = {
      summaries: [
        {
          period: "today",
          source: "runtime-ledger",
          quality: "exact",
          observedAt: 1,
          coverage: { from: 1, to: 1, complete: false },
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 0,
          byTool: [],
          byModel: [],
          byProject: [],
          bySession: [],
          byAccount: [],
          unavailableReason: "Runtime ledger has no exact account usage.",
        },
      ],
      sources: [
        {
          source: "runtime-ledger",
          quality: "exact",
          available: false,
          unavailableReason: "Runtime ledger has no exact account usage.",
        },
      ],
    };
    bridge.listAccounts.mockReset().mockResolvedValue([account]);
    bridge.refreshAccountQuota.mockResolvedValue(account);
    bridge.refreshTokenUsage.mockResolvedValue(tokenUnavailable);
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");
    const meta3 = await within(dialog).findByTestId("account-meta-grok:no-exact-token");

    await waitFor(() => {
      expect(meta3).toHaveTextContent("暂无精确 Token 用量");
      expect(meta3).not.toHaveTextContent("Runtime ledger");
      expect(meta3).not.toHaveTextContent("—");
    });
  });

  it("shows 无法精确归因 when token data exists but not for this account", async () => {
    const account = {
      accountId: "grok:unattributed",
      provider: "grok",
      label: "Grok Account 1",
      maskedIdentity: "her***g01@gmail.com",
      createdAt: 1,
      enabled: true,
      selected: false,
      order: 0,
      status: "available" as const,
      credentialScopeRef: "managed:grok:unattributed",
    };
    const tokenWithOtherAccount = {
      summaries: [
        {
          period: "today",
          source: "runtime-ledger",
          quality: "exact",
          observedAt: 1,
          coverage: { from: 1, to: 1, complete: true },
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
          totalTokens: 1500,
          byTool: [],
          byModel: [],
          byProject: [],
          bySession: [],
          byAccount: [
            {
              key: "grok:someone-else",
              label: "someone-else",
              inputTokens: 1000,
              outputTokens: 500,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
              totalTokens: 1500,
            },
          ],
        },
      ],
      sources: [{ source: "runtime-ledger", quality: "exact", available: true }],
    };
    bridge.listAccounts.mockReset().mockResolvedValue([account]);
    bridge.refreshAccountQuota.mockResolvedValue(account);
    bridge.refreshTokenUsage.mockResolvedValue(tokenWithOtherAccount);
    useUsageAccountsStore.getState().setAccounts([account]);

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const dialog = await screen.findByTestId("model-usage-workspace");
    const meta = await within(dialog).findByTestId("account-meta-grok:unattributed");

    await waitFor(() => {
      expect(meta).toHaveTextContent("无法精确归因");
      expect(meta).not.toHaveTextContent("暂无精确 Token 用量");
    });
  });

  it("restores the last-visited tab when reopened from the sidebar", async () => {
    usePanelStore.getState().openModelUsageWorkspace({ tab: "models" });
    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    expect(within(workspace).getByRole("tab", { name: "管理模型" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭模型与用量" }));
    await waitFor(() =>
      expect(screen.queryByTestId("model-usage-workspace")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const reopened = await screen.findByTestId("model-usage-workspace");
    // The plain sidebar open keeps the last tab instead of forcing usage.
    expect(within(reopened).getByRole("tab", { name: "管理模型" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("renders the reused usage-stats page on the 用量统计 tab", async () => {
    const device = { id: "d1", label: "PC", platform: "win32", isCurrent: true };
    bridge.getProfileDevices.mockResolvedValue({ devices: [device], currentDeviceId: "d1" });
    bridge.getProfileCoreStats.mockResolvedValue({
      scope: "device",
      device,
      generatedAt: 1,
      timezoneOffsetMinutes: 0,
      identity: { name: "T", handle: "t", avatarColor: "#fff" },
      totals: {
        totalThreads: 1,
        totalPrompts: 2,
        messagesSent: 2,
        goalsSet: 0,
        longestTaskMs: 61000,
        currentStreakDays: 1,
        longestStreakDays: 1,
        activeDays: 1,
      },
      promptHeatmap: { metric: "prompts", windowDays: 7, cells: [], max: 0 },
      insights: {
        fastModePercent: 0,
        skillsExplored: 0,
        totalSkillsUsed: 0,
        workflowRuns: 0,
        subagentRuns: 0,
        mcpToolCalls: 0,
      },
      providers: [{ key: "grok", label: "Grok", count: 2, percent: 100 }],
      accounts: [],
      models: [],
      modes: [],
      skills: [],
      mcps: [],
      aiActions: [],
      availableAccounts: [],
    });
    bridge.getProfileTokenStats.mockResolvedValue({
      available: true,
      scope: "device",
      device,
      generatedAt: 1,
      timezoneOffsetMinutes: 0,
      windowDays: 7,
      lifetimeTokens: 5400000,
      peakDayTokens: 1800000,
      peakDay: "2026-09-01",
      providers: [],
      accounts: [],
      models: [{ key: "grok:grok-4", label: "grok-4", count: 100, percent: 100 }],
      tokenHeatmap: { metric: "tokens", windowDays: 7, cells: [], max: 0 },
      unavailableProviders: [],
    });

    render(<SidebarProviderAccounts />);
    fireEvent.click(screen.getByRole("button", { name: "Provider accounts" }));
    const workspace = await screen.findByTestId("model-usage-workspace");
    fireEvent.click(within(workspace).getByRole("tab", { name: "用量统计" }));

    const page = await within(workspace).findByTestId("usage-stats-page");
    expect(page).toHaveTextContent("Lifetime tokens");
    expect(page).toHaveTextContent("Providers");
    // The usage-stats page reuses the Settings profile header (avatar, name,
    // device, Share/Edit) above the compact stats body.
    expect(within(page).getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(within(page).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(page).toHaveTextContent("Model usage");
  });
});
