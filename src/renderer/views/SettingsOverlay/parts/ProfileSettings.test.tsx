import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ProfileSettings } from "./ProfileSettings";

const bridge = vi.hoisted(() => ({
  getProfileDevices: vi.fn<() => Promise<unknown>>(),
  getProfileCoreStats: vi.fn<() => Promise<unknown>>(),
  getProfileTokenStats: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/renderer/bridge", () => ({
  readBridge: () => bridge,
  isRemoteSession: () => false,
}));

const device = { id: "d1", label: "PC", platform: "win32", isCurrent: true };

describe("ProfileSettings", () => {
  beforeEach(() => {
    bridge.getProfileDevices.mockResolvedValue({ devices: [device], currentDeviceId: "d1" });
    bridge.getProfileCoreStats.mockResolvedValue({
      scope: "device",
      device,
      generatedAt: 1,
      timezoneOffsetMinutes: 0,
      identity: { name: "Haona", handle: "haona", avatarColor: "#888" },
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
      providers: [],
      accounts: [],
      models: [],
      modes: [],
      skills: [],
      mcps: [],
      aiActions: [],
      availableAccounts: [],
    });
    bridge.getProfileTokenStats.mockResolvedValue(null);
  });

  it("keeps the identity header above the shared stats body after extraction", async () => {
    render(<ProfileSettings />);

    expect(await screen.findByText("Haona")).toBeInTheDocument();
    expect(screen.getByText("Lifetime tokens")).toBeInTheDocument();
    expect(screen.getByText("Providers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});
