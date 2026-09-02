import { describe, expect, it } from "vitest";
import { isConfiguredComposerAgent, resolveConfiguredProviderIds } from "./configuredProviders";

describe("resolveConfiguredProviderIds", () => {
  it("ignores identity-less accounts and unconfigured installed CLIs", () => {
    expect(
      resolveConfiguredProviderIds({
        accounts: [
          { provider: "codex", providerAccountId: "user@example.com" },
          { provider: "codex" },
          { provider: "opencode" },
        ],
        storedLogin: { grok: true, opencode: false },
        usageSnapshots: {
          antigravity: { status: "ok", authenticatedAs: "agy@example.com" },
          opencode: { status: "unavailable" },
        },
      }).sort(),
    ).toEqual(["antigravity", "codex", "grok"]);
  });

  it("does not treat a plan-only OpenCode CLI snapshot as an added channel", () => {
    expect(
      resolveConfiguredProviderIds({
        accounts: [],
        storedLogin: {},
        usageSnapshots: {
          opencode: { status: "ok", plan: "Go", windows: [] },
        },
      }),
    ).toEqual([]);
  });

  it("matches composer agents by base kind", () => {
    const configured = new Set(["cursor"]);
    expect(isConfiguredComposerAgent("cursor:work", configured)).toBe(true);
    expect(isConfiguredComposerAgent("opencode", configured)).toBe(false);
  });
});
