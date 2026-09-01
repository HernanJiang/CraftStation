import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasUnseenChangelog } from "@/shared/changelog";

function setAppVersion(version: string): void {
  Object.defineProperty(window, "craftstation", {
    configurable: true,
    value: { appVersion: version },
  });
}

describe("changelogStore upgrade behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    setAppVersion("1.5.1");
  });

  it("keeps a fresh install caught up without opening What's New", async () => {
    const { useChangelogStore } = await import("./changelogStore");

    useChangelogStore.getState().bootstrapSeenState();

    expect(useChangelogStore.getState()).toMatchObject({
      lastSeenVersion: "1.5.1",
      acknowledgedVersion: "1.5.1",
      whatsNewOpen: false,
    });
  });

  it("migrates CraftStation changelog state and surfaces What's New in the sidebar", async () => {
    localStorage.setItem("craftstation-changelog-seen-version", "1.4.3");
    localStorage.setItem("craftstation-changelog-ack-version", "1.4.3");
    localStorage.setItem("craftstation-whatsnew-hidden", "true");
    localStorage.setItem(
      "craftstation-changelog-cache",
      JSON.stringify({
        releases: [
          { version: "1.4.3", date: "2026-07-01", title: "Old", summary: "Old", changes: [] },
        ],
      }),
    );

    const { useChangelogStore } = await import("./changelogStore");
    useChangelogStore.getState().bootstrapSeenState();

    expect(localStorage.getItem("craftstation-changelog-seen-version")).toBe("1.4.3");
    expect(localStorage.getItem("craftstation-changelog-ack-version")).toBe("1.4.3");
    expect(localStorage.getItem("craftstation-whatsnew-hidden")).toBe("true");
    const state = useChangelogStore.getState();
    expect(state.whatsNewOpen).toBe(false);
    expect(state.whatsNewHidden).toBe(true);
    expect(
      hasUnseenChangelog(state.releases, "1.5.1", state.lastSeenVersion, state.acknowledgedVersion),
    ).toBe(true);
  });

  it("surfaces What's New in the sidebar without opening it on later version bumps", async () => {
    localStorage.setItem("craftstation-changelog-seen-version", "1.5.0");
    localStorage.setItem("craftstation-changelog-ack-version", "1.5.0");

    const { useChangelogStore } = await import("./changelogStore");
    useChangelogStore.getState().bootstrapSeenState();

    const state = useChangelogStore.getState();
    expect(state.whatsNewOpen).toBe(false);
    expect(
      hasUnseenChangelog(state.releases, "1.5.1", state.lastSeenVersion, state.acknowledgedVersion),
    ).toBe(true);
  });

  it("does not reopen What's New after the running version was acknowledged", async () => {
    localStorage.setItem("craftstation-changelog-seen-version", "1.5.1");
    localStorage.setItem("craftstation-changelog-ack-version", "1.5.1");

    const { useChangelogStore } = await import("./changelogStore");
    useChangelogStore.getState().bootstrapSeenState();

    expect(useChangelogStore.getState().whatsNewOpen).toBe(false);
  });
});
