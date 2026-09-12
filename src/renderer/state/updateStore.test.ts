import { beforeEach, describe, expect, it } from "vitest";
import { trackAgentBinaryUpdate, useUpdateStore } from "./updateStore";

describe("updateStore agent update tracking", () => {
  beforeEach(() => {
    useUpdateStore.setState({ agentUpdates: {} });
  });

  it("tracks an in-flight agent update and settles it", async () => {
    await trackAgentBinaryUpdate("grok:windows:", "Grok", async () => {
      expect(useUpdateStore.getState().agentUpdates).toEqual({
        "grok:windows:": expect.objectContaining({ label: "Grok" }),
      });
      return "done";
    });
    expect(useUpdateStore.getState().agentUpdates).toEqual({});
  });

  it("settles the entry even when the update throws", async () => {
    await expect(
      trackAgentBinaryUpdate("kimi:windows:", "Kimi", async () => {
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
    expect(useUpdateStore.getState().agentUpdates).toEqual({});
  });

  it("begin/finish are idempotent per key", () => {
    const store = useUpdateStore.getState();
    store.beginAgentUpdate("grok:windows:", "Grok");
    store.beginAgentUpdate("grok:windows:", "Grok");
    expect(Object.keys(useUpdateStore.getState().agentUpdates)).toEqual(["grok:windows:"]);
    store.finishAgentUpdate("missing-key");
    expect(Object.keys(useUpdateStore.getState().agentUpdates)).toEqual(["grok:windows:"]);
    store.finishAgentUpdate("grok:windows:");
    expect(useUpdateStore.getState().agentUpdates).toEqual({});
  });
});
