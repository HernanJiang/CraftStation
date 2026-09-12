import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { ProfileData } from "../useProfileData";
import { ProfileStatsBody } from "./ProfileStatsBody";

function makeData(): ProfileData {
  return {
    devices: [],
    currentDeviceId: null,
    selection: { scope: "device", window: "7d" },
    setSelection: vi.fn<(s: ProfileData["selection"]) => void>(),
    core: {
      scope: "device",
      generatedAt: 1,
      timezoneOffsetMinutes: 0,
      totals: {
        totalThreads: 3,
        totalPrompts: 10,
        messagesSent: 10,
        goalsSet: 1,
        longestTaskMs: 61000,
        currentStreakDays: 2,
        longestStreakDays: 2,
        activeDays: 2,
      },
      promptHeatmap: { metric: "prompts", windowDays: 7, cells: [], max: 0 },
      insights: {
        topProvider: { label: "Grok", percent: 80 },
        topReasoning: { label: "High", percent: 70 },
        mostActiveHour: { label: "3 PM" },
        fastModePercent: 10,
        skillsExplored: 1,
        totalSkillsUsed: 4,
        workflowRuns: 1,
        subagentRuns: 0,
        mcpToolCalls: 3,
      },
      providers: [{ key: "codex", label: "Codex", count: 8, percent: 80 }],
      accounts: [],
      models: [{ key: "codex/gpt", label: "codex/gpt", count: 8, percent: 80 }],
      modes: [
        { key: "auto", label: "自动模式", count: 6, percent: 60 },
        { key: "efficient", label: "高效模式", count: 3, percent: 30 },
        { key: "creative", label: "创造模式", count: 1, percent: 10 },
      ],
      skills: [{ kind: "tool", name: "s", displayName: "Skill S", runCount: 4 }],
      mcps: [{ kind: "mcp", name: "m", displayName: "MCP M", runCount: 3 }],
      aiActions: [{ type: "commit", label: "Commit", count: 2 }],
      availableAccounts: [],
    },
    coreLoading: false,
    tokens: {
      available: true,
      scope: "device",
      generatedAt: 1,
      timezoneOffsetMinutes: 0,
      windowDays: 7,
      lifetimeTokens: 9000,
      peakDayTokens: 5000,
      peakDay: "2026-09-01",
      providers: [{ provider: "codex", label: "Codex", tokens: 9000, percent: 100 }],
      accounts: [],
      models: [
        { key: "m-big", label: "big-model", count: 7000, percent: 78 },
        { key: "m-small", label: "small-model", count: 2000, percent: 22 },
      ],
      tokenHeatmap: { metric: "tokens", windowDays: 7, cells: [], max: 0 },
      unavailableProviders: [],
    },
    tokensLoading: false,
    error: null,
    saveIdentity: vi.fn<(i: never) => Promise<void>>(),
  } as unknown as ProfileData;
}

describe("ProfileStatsBody compact layout", () => {
  it("places model usage in the first row, ahead of providers", () => {
    const { container } = render(
      <ProfileStatsBody data={makeData()} pickedMetric={null} onPickedMetricChange={() => {}} layout="compact" />,
    );
    const html = container.innerHTML;
    expect(html.indexOf("Model usage")).toBeGreaterThan(-1);
    expect(html.indexOf("Model usage")).toBeLessThan(html.indexOf("Providers"));
    // Row 1 insights split into two cards + model card.
    expect(screen.getAllByText("Activity insights")).toHaveLength(2);
    // Insight rows render label + value (regression: labels must never be
    // empty — Lingui macros only transform the useLingui `t` binding).
    expect(screen.getByText("Most used provider").closest("div")).toHaveTextContent("Grok");
    expect(screen.getByText("Fast mode").closest("div")).toHaveTextContent("10%");
    expect(screen.getByText("Skill runs").closest("div")).toHaveTextContent("4");
    // Row 2 + row 3 sections share the same components as Settings.
    for (const title of ["Providers", "Skills", "MCP servers", "Modes", "AI git actions"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // 3-column grids for the first two detail rows.
    expect(container.querySelectorAll(".md\\:grid-cols-3")).toHaveLength(2);
  });

  it("lists only auto/efficient/creative modes with counts and shares", () => {
    render(
      <ProfileStatsBody data={makeData()} pickedMetric={null} onPickedMetricChange={() => {}} layout="compact" />,
    );
    const modes = screen.getByText("Modes").closest("section")!;
    expect(within(modes).getByText("自动模式").closest("div")).toHaveTextContent("6");
    expect(within(modes).getByText("自动模式").closest("div")).toHaveTextContent("60%");
    expect(within(modes).getByText("高效模式").closest("div")).toHaveTextContent("30%");
    expect(within(modes).getByText("创造模式").closest("div")).toHaveTextContent("10%");
    expect(within(modes).queryByText(/Chat/)).toBeNull();
    expect(within(modes).queryByText(/CLI/)).toBeNull();
  });

  it("sorts model usage by real token data", () => {
    render(
      <ProfileStatsBody data={makeData()} pickedMetric={null} onPickedMetricChange={() => {}} layout="compact" />,
    );
    const models = screen.getByText("Model usage").closest("section")!;
    const rows = within(models).getAllByText(/model/);
    expect(rows[0]).toHaveTextContent("big-model");
    expect(screen.getByText("big-model").closest("div")).toHaveTextContent("78%");
  });

  it("keeps the comfortable settings order unchanged", () => {
    const { container } = render(
      <ProfileStatsBody data={makeData()} pickedMetric={null} onPickedMetricChange={() => {}} />,
    );
    const html = container.innerHTML;
    expect(html.indexOf("Providers")).toBeLessThan(html.indexOf("Model usage"));
    expect(container.querySelectorAll(".md\\:grid-cols-3")).toHaveLength(0);
  });
});
