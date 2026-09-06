import { beforeEach, describe, expect, it } from "vitest";
import { selectSideChatThreadId, useSideChatStore } from "./sideChatStore";

function resetStore() {
  useSideChatStore.setState({ panelOpen: false, selection: null });
}

describe("side chat selection", () => {
  beforeEach(resetStore);

  it("opens the panel on the chooser without selecting a thread", () => {
    useSideChatStore.getState().openPanel();
    expect(useSideChatStore.getState().panelOpen).toBe(true);
    expect(useSideChatStore.getState().selection).toBeNull();
    expect(selectSideChatThreadId(useSideChatStore.getState())).toBeNull();
  });

  it("selects an ephemeral branch of the source thread", () => {
    useSideChatStore.getState().selectBranch("branch-1", "source-1");
    expect(useSideChatStore.getState().panelOpen).toBe(true);
    expect(useSideChatStore.getState().selection).toEqual({
      kind: "branch",
      threadId: "branch-1",
      sourceThreadId: "source-1",
    });
    expect(selectSideChatThreadId(useSideChatStore.getState())).toBe("branch-1");
  });

  it("selects an existing formal thread without copying it", () => {
    useSideChatStore.getState().selectExisting("formal-1");
    expect(useSideChatStore.getState().selection).toEqual({
      kind: "existing",
      threadId: "formal-1",
    });
    expect(selectSideChatThreadId(useSideChatStore.getState())).toBe("formal-1");
  });

  it("closes the panel and clears the selection", () => {
    useSideChatStore.getState().selectExisting("formal-1");
    useSideChatStore.getState().close();
    expect(useSideChatStore.getState().panelOpen).toBe(false);
    expect(useSideChatStore.getState().selection).toBeNull();
  });
});
