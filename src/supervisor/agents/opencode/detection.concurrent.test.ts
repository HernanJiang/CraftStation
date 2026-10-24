import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectLocation } from "@/shared/contracts";
import type { DetectProbeCtx } from "../base";
import type { OpenCodeSdkInventory } from "./sdkProbe";

const probeOpenCodeInventoryViaSdk = vi.hoisted(() =>
  vi.fn<
    (location: ProjectLocation, signal?: AbortSignal) => Promise<OpenCodeSdkInventory | undefined>
  >(),
);

vi.mock("./sdkProbe", () => ({ probeOpenCodeInventoryViaSdk }));
vi.mock("../base", async (importActual) => ({
  ...(await importActual<typeof import("../base")>()),
  readAgentCommandOutput: vi
    .fn<typeof import("../base").readAgentCommandOutput>()
    .mockResolvedValue({ ok: false, stdout: "", stderr: "" }),
}));

import { opencodeDetectionSpec } from "./detection";
import { readAgentCommandOutput } from "../base";

const inventory = { providers: [], connected: [], agents: [] };

function probeContext(location: ProjectLocation, signal: AbortSignal): DetectProbeCtx {
  return {
    location,
    executablePath: "opencode",
    version: "1.14.19",
    signal,
  };
}

beforeEach(() => {
  probeOpenCodeInventoryViaSdk.mockReset();
  vi.mocked(readAgentCommandOutput)
    .mockReset()
    .mockResolvedValue({ ok: false, stdout: "", stderr: "" });
});

describe("OpenCode detection probe sharing", () => {
  it("refreshes the official catalog and replaces a running server's stale model metadata", async () => {
    vi.mocked(readAgentCommandOutput).mockResolvedValue({
      ok: true,
      stderr: "",
      stdout: [
        "openai/renamed",
        JSON.stringify({
          name: "Current name",
          variants: { high: {} },
          limit: { context: 1000000 },
        }),
        "openai/future",
        JSON.stringify({ name: "Future model" }),
      ].join("\n"),
    });
    probeOpenCodeInventoryViaSdk.mockResolvedValue({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          models: [{ id: "renamed", name: "Old name", variants: [] }],
        },
      ],
      connected: ["openai"],
      agents: [],
    });
    const context = probeContext({ kind: "posix", path: "/refresh" }, new AbortController().signal);
    const result = await opencodeDetectionSpec.capabilitiesProbe?.(context);
    expect(readAgentCommandOutput).toHaveBeenCalledWith(
      context.location,
      "opencode",
      ["models", "--refresh", "--verbose"],
      expect.anything(),
    );
    expect(result?.models).toEqual([
      { id: "openai/renamed", label: "Current name" },
      { id: "openai/future", label: "Future model" },
    ]);
    expect(result?.modelEfforts?.["openai/renamed"]).toEqual(["high"]);
  });
  it("shares status and capability work only when callers share a cancellation signal", async () => {
    probeOpenCodeInventoryViaSdk.mockResolvedValue(inventory);
    const signal = new AbortController().signal;
    const ctx = probeContext({ kind: "posix", path: "/same-signal" }, signal);

    await Promise.all([
      opencodeDetectionSpec.statusProbe?.(ctx),
      opencodeDetectionSpec.capabilitiesProbe?.(ctx),
    ]);

    expect(probeOpenCodeInventoryViaSdk).toHaveBeenCalledOnce();
  });

  it("does not share pending work between independently cancellable detections", async () => {
    let resolveFirst: ((value: typeof inventory) => void) | undefined;
    probeOpenCodeInventoryViaSdk
      .mockImplementationOnce(
        () =>
          new Promise<typeof inventory>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(inventory);
    const location: ProjectLocation = { kind: "posix", path: "/different-signals" };
    const first = opencodeDetectionSpec.statusProbe?.(
      probeContext(location, new AbortController().signal),
    );
    await vi.waitFor(() => expect(probeOpenCodeInventoryViaSdk).toHaveBeenCalledOnce());

    const second = opencodeDetectionSpec.statusProbe?.(
      probeContext(location, new AbortController().signal),
    );
    await vi.waitFor(() => expect(probeOpenCodeInventoryViaSdk).toHaveBeenCalledTimes(2));
    resolveFirst?.(inventory);

    await Promise.all([first, second]);
  });
});
