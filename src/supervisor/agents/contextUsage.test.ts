import { describe, expect, it } from "vitest";
import {
  extraUsageEntries,
  isLikelyBillingAggregateUsage,
  usageFromProviderRecord,
} from "./contextUsage";

describe("usageFromProviderRecord", () => {
  it("keeps billed buckets and occupancy extras from a provider payload", () => {
    expect(
      usageFromProviderRecord({
        totalTokens: 10_000,
        inputTokens: 8_000,
        outputTokens: 500,
        cachedReadTokens: 3_000,
        systemPromptTokens: 200,
        mcpTokens: 1_200,
        skillsTokens: 400,
        toolCallTokens: 700,
      }),
    ).toEqual({
      usedTokens: 8_000,
      breakdown: [
        { id: "input", label: "Input", tokens: 8_000 },
        { id: "output", label: "Output", tokens: 500 },
        { id: "cache-read", label: "Cache read", tokens: 3_000 },
        { id: "tool-calls", label: "Tool calls", tokens: 700 },
        { id: "mcp-tools", label: "MCP tools", tokens: 1_200 },
        { id: "skills", label: "Skills", tokens: 400 },
        { id: "system-prompt", label: "System prompt", tokens: 200 },
      ],
    });
  });

  it("reads named occupancy categories off a categories array", () => {
    expect(
      extraUsageEntries({
        categories: [
          { id: "messages", label: "Messages", tokens: 40 },
          { name: "MCP tools", tokens: 10 },
        ],
      }),
    ).toEqual([
      { id: "messages", label: "Messages", tokens: 40 },
      { id: "mcp-tools", label: "MCP tools", tokens: 10 },
    ]);
  });

  it("treats input+output=total without a window as billing, not occupancy", () => {
    expect(
      isLikelyBillingAggregateUsage({
        totalTokens: 1_540,
        inputTokens: 1_000,
        outputTokens: 540,
      }),
    ).toBe(true);
    expect(
      isLikelyBillingAggregateUsage({
        tokens_used: 402_603,
        context_window: 500_000,
      }),
    ).toBe(false);
    expect(isLikelyBillingAggregateUsage({ totalTokens: 120_000 })).toBe(false);
  });

  it("reads Grok used_tokens / context_window aliases", () => {
    expect(
      usageFromProviderRecord({
        used_tokens: 48_000,
        context_window: 500_000,
        prompt_tokens: 40_000,
        completion_tokens: 1_200,
      }),
    ).toEqual({
      usedTokens: 40_000,
      maxTokens: 500_000,
      breakdown: [
        { id: "input", label: "Input", tokens: 40_000 },
        { id: "output", label: "Output", tokens: 1_200 },
      ],
    });
  });

  it("reads DeepSeek prompt_tokens / cache hit aliases from a nested usage object", () => {
    expect(
      usageFromProviderRecord({
        usage: {
          prompt_tokens: 24_000,
          completion_tokens: 800,
          prompt_cache_hit_tokens: 6_000,
        },
        size: 1_000_000,
      }),
    ).toEqual({
      usedTokens: 24_000,
      maxTokens: 1_000_000,
      breakdown: [
        { id: "input", label: "Input", tokens: 24_000 },
        { id: "output", label: "Output", tokens: 800 },
        { id: "cache-read", label: "Cache read", tokens: 6_000 },
      ],
    });
  });
});
