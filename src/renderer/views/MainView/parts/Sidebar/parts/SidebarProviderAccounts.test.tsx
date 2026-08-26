import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { usePanelStore } from "@/renderer/state/panelStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { SidebarProviderAccounts } from "./SidebarProviderAccounts";

vi.mock("@/renderer/components/providers/usageProviders", () => ({
  USAGE_PROVIDERS: [
    { id: "codex", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
    { id: "gemini", label: "Gemini" },
  ],
}));

vi.mock("@/renderer/components/providers/useUsageProviderLogin", () => ({
  useUsageProviderLogin: () => ({
    canSignIn: true,
    signingIn: false,
    handleSignIn: vi.fn<() => Promise<void>>().mockResolvedValue(),
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

    fireEvent.click(screen.getByRole("button", { name: "关闭模型与用量" }));
    expect(usePanelStore.getState().modelUsageDialogOpen).toBe(false);
  });
});
