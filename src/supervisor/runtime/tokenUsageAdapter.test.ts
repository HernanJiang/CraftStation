import { describe, expect, it } from "vitest";
import type { TokenUsagePayload, TokenUsageSummary } from "@/shared/contracts";
import {
  RuntimeLedgerTokenUsageScanner,
  TokenUsageAdapter,
  type TokenUsageScanner,
} from "./tokenUsageAdapter";

const payload: TokenUsagePayload = { periods: ["today", "month", "allTime"] };

function summary(period: TokenUsageSummary["period"]): TokenUsageSummary {
  return {
    period,
    source: "tokscale",
    quality: "estimated",
    observedAt: 1_000,
    coverage: { from: 0, to: 1_000, complete: true },
    inputTokens: 2,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 5,
    byTool: [],
    byModel: [],
    byProject: [],
    bySession: [],
    byAccount: [],
  };
}

describe("TokenUsageAdapter", () => {
  it("keeps unavailable scanning explicit instead of turning it into zero usage", async () => {
    const result = await new TokenUsageAdapter(undefined, () => 2_000).getUsage(payload);
    expect(result.sources[0]).toMatchObject({
      source: "tokscale",
      quality: "estimated",
      available: false,
    });
    expect(result.summaries).toHaveLength(3);
    expect(result.summaries[0]).toMatchObject({
      totalTokens: 0,
      unavailableReason: expect.any(String),
      coverage: { complete: false },
    });
  });

  it("preserves source, quality, dimensions and requested periods from the scanner", async () => {
    const scanner: TokenUsageScanner = {
      scan: async () => ({
        available: true,
        summaries: [summary("today"), summary("month"), summary("allTime")],
      }),
    };
    const result = await new TokenUsageAdapter(scanner, () => 1_000).getUsage(payload);
    expect(result.summaries.map((item) => item.period)).toEqual(["today", "month", "allTime"]);
    expect(result.summaries[0]).toMatchObject({
      source: "tokscale",
      quality: "estimated",
      totalTokens: 5,
    });
    expect(result.sources[0]).toMatchObject({ available: true, quality: "estimated" });
  });

  it("keeps scanner source and quality on unavailable summaries", async () => {
    const scanner: TokenUsageScanner = {
      source: "runtime-ledger",
      quality: "exact",
      scan: async () => ({ available: false, unavailableReason: "ledger unavailable" }),
    };
    const result = await new TokenUsageAdapter(scanner, () => 1_000).getUsage({
      periods: ["today"],
    });

    expect(result.summaries[0]).toMatchObject({
      source: "runtime-ledger",
      quality: "exact",
      unavailableReason: "ledger unavailable",
    });
  });

  it("converts scanner crashes into a diagnostic unavailable source", async () => {
    const scanner: TokenUsageScanner = {
      scan: async () => {
        throw new Error("sidecar unavailable");
      },
    };
    const result = await new TokenUsageAdapter(scanner).getUsage({ periods: ["today"] });
    expect(result.sources[0]?.unavailableReason).toContain("sidecar unavailable");
    expect(result.summaries[0]?.unavailableReason).toContain("sidecar unavailable");
  });

  it("keeps exact runtime ledger telemetry separate from estimated scans", async () => {
    const scanner = new RuntimeLedgerTokenUsageScanner(
      () => [
        {
          ts: 900,
          provider: "codex",
          model: "gpt-5",
          accountId: "codex:work",
          sessionId: "session-1",
          tool: "terminal",
          projectId: "project-1",
          inputTokens: 4,
          outputTokens: 6,
        },
      ],
      () => 1_000,
    );
    const result = await new TokenUsageAdapter(scanner, () => 1_000).getUsage({
      periods: ["allTime"],
    });
    expect(result.sources[0]).toMatchObject({
      source: "runtime-ledger",
      quality: "exact",
      available: true,
    });
    expect(result.summaries[0]).toMatchObject({
      source: "runtime-ledger",
      quality: "exact",
      totalTokens: 10,
      byTool: [expect.objectContaining({ key: "terminal", totalTokens: 10 })],
      byModel: [expect.objectContaining({ key: "gpt-5", totalTokens: 10 })],
      byProject: [expect.objectContaining({ key: "project-1", totalTokens: 10 })],
      bySession: [expect.objectContaining({ key: "session-1", totalTokens: 10 })],
      byAccount: [expect.objectContaining({ key: "codex:work", totalTokens: 10 })],
    });
  });

  it("supports exact total-only ledger rows without inventing input/output splits", async () => {
    const scanner = new RuntimeLedgerTokenUsageScanner(
      () => [
        {
          ts: 900,
          provider: "codex",
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 42,
        },
      ],
      () => 1_000,
    );
    const result = await scanner.scan({ periods: ["allTime"] });
    expect(result.summaries?.[0]).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 42,
    });
  });
});
