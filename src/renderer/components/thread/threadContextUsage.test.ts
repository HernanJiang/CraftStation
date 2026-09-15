// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentStatus, Thread } from "@/shared/contracts";
import { formatTokenCount } from "./formatTokenCount";
import {
  classifyContextOccupancy,
  hasReportedContextUsage,
  resolveContextOccupancy,
  resolveSessionCacheHitRate,
  resolveThreadContextUsageSummary,
  shouldShowContextUsageDock,
} from "./threadContextUsage";

const baseThread: Thread = {
  id: "thread-1",
  projectId: "project-1",
  title: "Thread",
  agentKind: "claude",
  config: { model: "claude-opus-4-7", contextSize: "200k" },
  status: "idle",
  attention: "none",
  canResumeWithConfig: true,
  presentationMode: "gui",
  archived: false,
  done: false,
  starred: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseAgent: AgentStatus = {
  kind: "claude",
  label: "Claude Code",
  installed: true,
  authState: "authenticated",
  capabilities: {
    models: [{ id: "claude-opus-4-7", label: "Opus 4.7" }],
    efforts: [],
    modelEfforts: {},
    contextSizes: [
      { id: "200k", label: "200K" },
      { id: "1m", label: "1M" },
    ],
    defaultContextSize: "200k",
    modes: ["agent"],
    approvalPolicies: [],
    sandboxModes: [],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "server",
    presentationMode: "gui",
    settingDefs: [],
  },
};

describe("threadContextUsage", () => {
  it("formats compact token counts", () => {
    expect(formatTokenCount(595)).toBe("595");
    expect(formatTokenCount(8_400)).toBe("8.4K");
    expect(formatTokenCount(200_000)).toBe("200K");
    expect(formatTokenCount(1_000_000)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
    expect(formatTokenCount(24_767_000)).toBe("24.8M");
    expect(formatTokenCount(150_000_000)).toBe("150M");
  });

  it("combines provider usage with configured context limit", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: baseThread,
      agentStatus: baseAgent,
      reportedUsage: {
        usedTokens: 71_000,
        breakdown: [{ id: "input", label: "Input", tokens: 71_000 }],
      },
    });

    expect(summary.maxTokens).toBe(200_000);
    expect(summary.percent).toBe(36);
    expect(summary.detail).toBe("71K / 200K tokens");
    expect(summary.remainingLabel).toBe("129K");
    expect(summary.breakdown).toEqual([{ id: "input", label: "Input", tokens: 71_000 }]);
  });

  it("uses the session-pinned runtime's context catalog", () => {
    const sdkCapabilities = {
      ...baseAgent.capabilities,
      models: [{ id: "sdk-model", label: "Pinned SDK model" }],
      contextSizes: [{ id: "272k", label: "272K" }],
      modelContextSizes: { "sdk-model": ["272k"] },
      defaultContextSize: "272k",
    };
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "cursor",
        config: { model: "sdk-model" },
        sessionRef: {
          providerSessionId: "sdk:session-1",
          discoveredAt: "2026-01-01T00:00:00.000Z",
        },
      },
      agentStatus: {
        ...baseAgent,
        kind: "cursor",
        runtimeVariants: {
          sdk: {
            presentationMode: "gui",
            installed: true,
            authState: "authenticated",
            authUsesProviderLogin: false,
            capabilities: sdkCapabilities,
          },
        },
        sessionRuntimeRouting: { prefixes: { "sdk:": "sdk" } },
      },
      reportedUsage: { usedTokens: 68_000 },
    });

    expect(summary.maxTokens).toBe(272_000);
    expect(summary.percent).toBe(25);
  });

  it("keeps provider-reported max authoritative over the selected context intent", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: { ...baseThread, config: { model: "claude-opus-4-7", contextSize: "1m" } },
      agentStatus: baseAgent,
      reportedUsage: { usedTokens: 71_000, maxTokens: 200_000 },
    });

    expect(summary.maxTokens).toBe(200_000);
    expect(summary.detail).toBe("71K / 200K tokens");
    expect(summary.remainingLabel).toBe("129K");
  });

  it("treats zero-token provider context usage as reportable", () => {
    expect(hasReportedContextUsage(undefined)).toBe(false);
    expect(hasReportedContextUsage({})).toBe(false);
    expect(hasReportedContextUsage({ maxTokens: 200_000 })).toBe(false);
    expect(hasReportedContextUsage({ usedTokens: 0, maxTokens: 200_000 })).toBe(true);
    expect(hasReportedContextUsage({ usedTokens: 1, maxTokens: 200_000 })).toBe(true);
    expect(
      shouldShowContextUsageDock({
        maxTokens: 500_000,
        usedLabel: "Unknown",
        maxLabel: "500K",
        remainingLabel: "Unknown",
        percentLabel: "Context",
        headline: "500K context",
        detail: "Provider has not reported token usage.",
        breakdown: [],
        occupancy: [],
      }),
    ).toBe(true);
  });

  it("infers the configured window when the provider has not reported usage yet", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "grok",
        config: { model: "grok-4.6" },
      },
      agentStatus: {
        ...baseAgent,
        kind: "grok",
        capabilities: {
          ...baseAgent.capabilities,
          models: [{ id: "grok-4.6", label: "Grok 4.6" }],
          contextSizes: [{ id: "500K", label: "500K" }],
          modelContextSizes: { "grok-4.6": ["500K"] },
          defaultContextSize: "500K",
        },
      },
      reportedUsage: undefined,
    });
    expect(summary.maxTokens).toBe(500_000);
    expect(summary.usedTokens).toBeUndefined();
    expect(summary.headline).toBe("500K context");
    expect(shouldShowContextUsageDock(summary)).toBe(true);
  });

  it("ignores a stale contextSize that the current model does not advertise", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "grok",
        config: { model: "grok-4.6", contextSize: "500K" },
      },
      agentStatus: {
        ...baseAgent,
        kind: "grok",
        capabilities: {
          ...baseAgent.capabilities,
          models: [{ id: "grok-4.6", label: "Grok 4.6" }],
          contextSizes: [
            { id: "500K", label: "500K" },
            { id: "2M", label: "2M" },
          ],
          modelContextSizes: { "grok-4.6": ["2M"], "grok-4.5": ["500K"] },
          defaultContextSize: "500K",
        },
      },
      reportedUsage: undefined,
    });
    expect(summary.maxTokens).toBe(2_000_000);
  });

  it("matches Antigravity Gemini slugs to the advertised 1M window", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "antigravity",
        config: { model: "gemini-3.8-flash-high" },
      },
      agentStatus: {
        ...baseAgent,
        kind: "antigravity",
        capabilities: {
          ...baseAgent.capabilities,
          models: [{ id: "Gemini 3.8 Flash", label: "Gemini 3.8 Flash" }],
          contextSizes: [{ id: "1M", label: "1M" }],
          modelContextSizes: { "Gemini 3.8 Flash": ["1M"] },
          defaultContextSize: "1M",
        },
      },
      reportedUsage: undefined,
    });
    expect(summary.maxTokens).toBe(1_000_000);
    expect(shouldShowContextUsageDock(summary)).toBe(true);
  });

  it("matches DeepSeek display names to the advertised 1M window", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "deepseek",
        config: { model: "DeepSeek V4.1 Flash" },
      },
      agentStatus: {
        ...baseAgent,
        kind: "deepseek",
        capabilities: {
          ...baseAgent.capabilities,
          models: [{ id: "deepseek-v4.1-flash", label: "V4.1 Flash" }],
          contextSizes: [{ id: "1M", label: "1M" }],
          modelContextSizes: { "deepseek-v4.1-flash": ["1M"] },
          defaultContextSize: "1M",
        },
      },
      reportedUsage: undefined,
    });
    expect(summary.maxTokens).toBe(1_000_000);
    expect(shouldShowContextUsageDock(summary)).toBe(true);
  });

  it("replaces a 256Ki placeholder window with DeepSeek's advertised 1M", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "deepseek",
        config: { model: "deepseek-v4.1-flash" },
      },
      agentStatus: {
        ...baseAgent,
        kind: "deepseek",
        capabilities: {
          ...baseAgent.capabilities,
          models: [{ id: "deepseek-v4.1-flash", label: "V4.1 Flash" }],
          contextSizes: [{ id: "1M", label: "1M" }],
          modelContextSizes: { "deepseek-v4.1-flash": ["1M"] },
          defaultContextSize: "1M",
        },
      },
      reportedUsage: {
        usedTokens: 24_000,
        maxTokens: 262_144,
        breakdown: [{ id: "input", label: "Input", tokens: 24_000 }],
      },
    });
    expect(summary.maxTokens).toBe(1_000_000);
    expect(summary.percent).toBe(2);
    expect(summary.cacheHitRate).toBe(0);
  });

  it("parses a raw token-count context size", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: { ...baseThread, config: { model: "grok-4.6", contextSize: "256000" } },
      agentStatus: undefined,
      reportedUsage: undefined,
    });
    expect(summary.maxTokens).toBe(256_000);
  });

  it("infers Cursor-style context suffixes from model ids", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: {
        ...baseThread,
        agentKind: "cursor",
        config: { model: "gpt-5.5[context=272k,reasoning=medium,fast=false]" },
      },
      agentStatus: undefined,
      reportedUsage: undefined,
    });

    expect(summary.maxTokens).toBe(272_000);
    expect(summary.headline).toBe("272K context");
  });

  it("maps provider buckets onto occupancy rows including MCP, skills, and tool calls", () => {
    const occupancy = resolveContextOccupancy(
      [
        { id: "messages-1", label: "Messages", tokens: 69_400 },
        { id: "mcp-tools", label: "MCP tools", tokens: 13_000 },
        { id: "tools", label: "Tool definitions", tokens: 12_800 },
        { id: "tool-calls", label: "Tool calls", tokens: 4_000 },
        { id: "skills", label: "Skills", tokens: 2_400 },
        { id: "system-prompt-0", label: "System prompt", tokens: 1_300 },
        { id: "cache-read", label: "Cache read", tokens: 50_000 },
        { id: "other", label: "Other", tokens: 1_000 },
      ],
      103_900,
    );

    expect(occupancy.map((row) => [row.id, row.label, row.tokens])).toEqual([
      ["messages", "消息", 69_400],
      ["tool-calls", "工具调用", 4_000],
      ["mcp-tools", "MCP 工具", 13_000],
      ["system-tools", "系统工具", 12_800],
      ["skills", "技能", 2_400],
      ["system-prompt", "系统提示词", 1_300],
      ["other", "其他", 1_000],
    ]);
    expect(classifyContextOccupancy({ id: "input", label: "Input" })).toBe("messages");
    expect(
      resolveSessionCacheHitRate([
        { id: "input", label: "Input", tokens: 50 },
        { id: "cache-read", label: "Cache read", tokens: 50 },
      ]),
    ).toBe(50);
    expect(
      resolveSessionCacheHitRate([{ id: "input", label: "Input", tokens: 80 }]),
    ).toBe(0);
  });

  it("does not invent occupancy rows from a bare used-token total", () => {
    const summary = resolveThreadContextUsageSummary({
      thread: baseThread,
      agentStatus: baseAgent,
      reportedUsage: { usedTokens: 71_000 },
    });
    expect(
      summary.occupancy.every((row) => row.tokens === 0) || summary.occupancy.length === 0,
    ).toBe(true);
    expect(summary.cacheHitRate).toBeUndefined();
  });

  it("does not dump excluded cache tokens into 其他", () => {
    const occupancy = resolveContextOccupancy(
      [
        { id: "input", label: "Input", tokens: 2_400_000 },
        { id: "cache-read", label: "Cache read", tokens: 2_400_000 },
      ],
      4_800_000,
    );
    expect(occupancy.find((row) => row.id === "messages")?.tokens).toBe(2_400_000);
    expect(occupancy.find((row) => row.id === "other")?.tokens).toBe(0);
  });
});
