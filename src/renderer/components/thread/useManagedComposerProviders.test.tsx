import { beforeEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import type { AgentStatus } from "@/shared/contracts";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useUsageAccountsStore } from "@/renderer/state/usageAccountsStore";
import { useUsageLoginStateStore } from "@/renderer/state/usageLoginStateStore";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { useManagedComposerProviders } from "./useManagedComposerProviders";

function guiStatus(kind: string, label = kind): AgentStatus {
  return {
    kind,
    label,
    installed: true,
    authState: "authenticated",
    capabilities: {
      models: [{ id: `${kind}-model`, label: `${kind} model` }],
      efforts: ["low", "medium", "high"],
      modelEfforts: {},
      modes: ["agent"],
      approvalPolicies: [],
      sandboxModes: [],
      supportsResume: true,
      supportsDirectInput: true,
      liveInputMode: "server",
      presentationMode: "gui",
      presentationModes: ["gui"],
      settingDefs: [],
    },
  };
}

let captured: ReturnType<typeof useManagedComposerProviders> = [];
function Probe() {
  captured = useManagedComposerProviders({ presentationMode: "gui" });
  return null;
}

function kinds(): string[] {
  return captured.filter((provider) => !provider.accountId).map((provider) => provider.kind);
}

describe("useManagedComposerProviders hydration stability", () => {
  beforeEach(() => {
    act(() => {
      useAgentStatusesStore.setState({
        agentStatuses: [
          guiStatus("codex"),
          guiStatus("antigravity", "Antigravity"),
          guiStatus("kimi", "Kimi Code"),
          guiStatus("grok", "Grok Build"),
        ],
        wslAgentStatuses: [],
      });
      useSharedSettings.setState({ disabledAgents: ["grok"], customModels: [] });
      useUsageAccountsStore.getState().reset();
      useUsageLoginStateStore.setState({ stored: {} });
      useProviderUsageStore.setState({ snapshots: {} });
    });
  });

  it("keeps every installed provider across usage/account hydration (no shrink to configured only)", () => {
    render(<Probe />);
    // Before hydration: all installed (non-disabled) providers are visible.
    expect(kinds()).toEqual(["codex", "antigravity", "kimi"]);

    // Hydration lands with only codex configured — the detected directory
    // must NOT collapse to the configured subset.
    act(() => {
      useUsageAccountsStore.getState().setAccounts([
        {
          accountId: "acc-codex",
          provider: "codex",
          providerAccountId: "user@example.com",
          label: "Codex",
          enabled: true,
        } as never,
      ]);
    });

    expect(kinds()).toEqual(["codex", "antigravity", "kimi"]);
  });

  it("marks installed-but-unconfigured providers (Antigravity) instead of dropping them", () => {
    render(<Probe />);
    act(() => {
      useUsageAccountsStore.getState().setAccounts([
        {
          accountId: "acc-codex",
          provider: "codex",
          providerAccountId: "user@example.com",
          label: "Codex",
          enabled: true,
        } as never,
      ]);
    });

    const byKind = new Map(captured.map((provider) => [provider.kind, provider]));
    expect(byKind.get("codex")?.unconfigured).toBe(false);
    expect(byKind.get("antigravity")?.unconfigured).toBe(true);
    expect(byKind.get("kimi")?.unconfigured).toBe(true);
  });

  it("drops a provider only when real detection says disabled/not-installed", () => {
    render(<Probe />);
    expect(kinds()).toContain("kimi");

    // Detection update: kimi is gone from the machine.
    act(() => {
      useAgentStatusesStore.setState({
        agentStatuses: [guiStatus("codex"), guiStatus("antigravity", "Antigravity")],
      });
    });
    expect(kinds()).toEqual(["codex", "antigravity"]);
  });
});
