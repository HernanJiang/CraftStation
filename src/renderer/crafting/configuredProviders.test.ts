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

  it("treats a plan-only OpenCode snapshot as configured — same gate as 管理模型", () => {
    // The usage workspace counts a snapshot with a plan label as an added
    // channel (hasProviderIdentity). The composer must apply the identical bar,
    // otherwise a channel is selectable in 管理模型 yet invisible in the picker.
    expect(
      resolveConfiguredProviderIds({
        accounts: [],
        storedLogin: {},
        usageSnapshots: {
          opencode: { status: "ok", plan: "Go", windows: [] },
        },
      }),
    ).toEqual(["opencode"]);
    // An authorized status without quota windows counts too (spend-only
    // providers expose no windows).
    expect(
      resolveConfiguredProviderIds({
        accounts: [],
        storedLogin: {},
        usageSnapshots: {
          opencode: { status: "ok", windows: [] },
        },
      }),
    ).toEqual(["opencode"]);
  });

  it("treats a Devin CLI identity snapshot as a configured channel", () => {
    expect(
      resolveConfiguredProviderIds({
        accounts: [],
        storedLogin: {},
        usageSnapshots: {
          devin: { status: "ok", authenticatedAs: "me@devin.ai", windows: [] },
        },
      }),
    ).toEqual(["devin"]);
  });

  it("matches composer agents by base kind", () => {
    const configured = new Set(["cursor"]);
    expect(isConfiguredComposerAgent("cursor:work", configured)).toBe(true);
    expect(isConfiguredComposerAgent("opencode", configured)).toBe(false);
  });
});
