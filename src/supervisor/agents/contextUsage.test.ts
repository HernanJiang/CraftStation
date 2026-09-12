import { describe, expect, it } from "vitest";
import { extraUsageEntries, usageFromProviderRecord } from "./contextUsage";

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
});
