import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { runCliUpdateBinary } from "./runCliUpdate";

const updateAgentBinary = vi.fn<() => Promise<{ ok: boolean; output?: string }>>();
const refreshAgentStatuses = vi.fn<() => Promise<unknown>>();

describe("runCliUpdateBinary", () => {
  beforeEach(() => {
    updateAgentBinary.mockReset().mockResolvedValue({ ok: true });
    refreshAgentStatuses.mockReset().mockResolvedValue({});
    Object.assign(window, {
      craftstation: {
        ...(window.craftstation ?? {}),
        updateAgentBinary,
        refreshAgentStatuses,
      },
    });
    useUpdateStore.setState({ agentUpdates: {}, availableCliUpdates: [] });
  });

  it("updates through the bridge and drops the entry on success", async () => {
    useUpdateStore.setState({
      availableCliUpdates: [
        {
          key: "grok:windows:",
          agentKind: "grok",
          label: "Grok Build",
          version: "v1.0.13",
          latest: "v1.0.25",
        },
      ],
    });

    const ok = await runCliUpdateBinary({
      key: "grok:windows:",
      agentKind: "grok",
      label: "Grok Build",
      latest: "v1.0.25",
    });

    expect(ok).toBe(true);
    expect(updateAgentBinary).toHaveBeenCalledWith({ agentKind: "grok", envKind: "windows" });
    expect(refreshAgentStatuses).toHaveBeenCalled();
    expect(useUpdateStore.getState().availableCliUpdates).toEqual([]);
    expect(useUpdateStore.getState().agentUpdates).toEqual({});
  });

  it("keeps the entry when the update fails", async () => {
    updateAgentBinary.mockResolvedValueOnce({ ok: false, output: "nope" });
    useUpdateStore.setState({
      availableCliUpdates: [
        {
          key: "grok:windows:",
          agentKind: "grok",
          label: "Grok Build",
          version: "v1.0.13",
          latest: "v1.0.25",
        },
      ],
    });

    const ok = await runCliUpdateBinary({
      key: "grok:windows:",
      agentKind: "grok",
      label: "Grok Build",
      latest: "v1.0.25",
    });

    expect(ok).toBe(false);
    expect(useUpdateStore.getState().availableCliUpdates).toHaveLength(1);
  });
});
