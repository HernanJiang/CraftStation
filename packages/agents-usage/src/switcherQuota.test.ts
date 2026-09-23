import { describe, expect, it } from "vitest";
import {
  blockingUsedPercent,
  blockingWindow,
  quotaStatusFromWindows,
  switcherDisplayWindow,
} from "./switcherQuota";

describe("switcher quota", () => {
  it("uses the fullest weekly lane and ignores a Claude carve-out", () => {
    const windows = [
      { id: "session-5h", usedPercent: 10 },
      { id: "weekly", usedPercent: 40 },
      { id: "weekly-opus", usedPercent: 100 },
    ];
    expect(switcherDisplayWindow("claude", windows)?.id).toBe("weekly");
    expect(quotaStatusFromWindows("claude", windows)).toBe("available");
  });

  it("still exhausts the account when the session window itself is full", () => {
    const windows = [
      { id: "session-5h", usedPercent: 100 },
      { id: "weekly", usedPercent: 20 },
    ];
    expect(blockingWindow("codex", windows)?.id).toBe("session-5h");
    expect(quotaStatusFromWindows("codex", windows)).toBe("quota-exhausted");
  });

  it("marks 90% on the blocking lane as low and ignores reset credits", () => {
    expect(
      quotaStatusFromWindows("codex", [
        { id: "codex:reset-credits", usedPercent: 100 },
        { id: "weekly", usedPercent: 95 },
      ]),
    ).toBe("quota-low");
    expect(blockingUsedPercent("grok", [{ id: "weekly", usedPercent: 95 }])).toBe(95);
  });

  it("does not treat dollar overage as the account being empty", () => {
    expect(
      quotaStatusFromWindows("claude", [
        { id: "weekly", usedPercent: 12 },
        { id: "extra-usage", usedPercent: 100, unit: "usd" },
      ]),
    ).toBe("available");
  });

  it("keeps a Cursor account alive on on-demand after the included plan is gone", () => {
    const windows = [
      { id: "monthly", usedPercent: 100 },
      { id: "cursor-auto", usedPercent: 100 },
      { id: "cursor-api", usedPercent: 40 },
    ];
    expect(blockingWindow("cursor", windows)?.id).toBe("cursor-api");
    expect(quotaStatusFromWindows("cursor", windows)).toBe("available");
  });

  it("uses a namespaced weekly pool for Antigravity", () => {
    expect(
      switcherDisplayWindow("antigravity", [
        { id: "antigravity:claude:weekly", usedPercent: 33.6 },
        { id: "antigravity:gemini:session-5h", usedPercent: 4 },
      ])?.id,
    ).toBe("antigravity:claude:weekly");
  });

  it("stays available when nothing was measured", () => {
    expect(quotaStatusFromWindows("kimi", [])).toBe("available");
    expect(blockingUsedPercent("opencode", undefined)).toBeUndefined();
  });
});
