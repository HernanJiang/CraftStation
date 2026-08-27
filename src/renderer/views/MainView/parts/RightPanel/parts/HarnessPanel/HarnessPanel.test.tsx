import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting";

const bridgeMock = vi.hoisted(() => ({
  getNativeHarnessControlPlane: vi.fn<() => Promise<NativeHarnessControlPlaneEntry[]>>(),
  onSupervisorEvent: vi.fn<(listener: (event: unknown) => void) => () => void>(() => () => undefined),
}));

vi.mock("@/renderer/bridge", () => ({ readBridge: () => bridgeMock }));
vi.mock("@/renderer/components/crafting/CraftingGrid", () => ({
  CraftingGrid: () => <div data-testid="crafting-grid-placeholder" />,
}));
vi.mock("@/renderer/components/crafting/CraftingRegistrySections", () => ({
  CraftingRegistrySections: () => <div data-testid="crafting-registry-placeholder" />,
}));

import { HarnessPanel } from "./HarnessPanel";

function entry(
  harnessKind: string,
  label: string,
  status: NativeHarnessControlPlaneEntry["status"],
): NativeHarnessControlPlaneEntry {
  return {
    descriptor: {
      id: `native-harness:${harnessKind}`,
      harnessKind,
      label,
      vendor: harnessKind,
      official: true,
      transport: harnessKind === "deepseek" ? "unavailable" : "acp-stdio",
      machineFacingBoundary: "native runtime boundary",
      capabilities: { start: "implementation missing" },
    },
    status,
    profileConfigured: status === "ready",
    environmentKind: "windows",
    diagnostics: [
      {
        code: status === "unavailable" ? "RUNTIME_UNAVAILABLE" : "RUNTIME_NOT_CONFIGURED",
        harnessKind,
        phase: "readiness",
        operation: "control-plane-status",
        message: `${harnessKind} safe diagnostic`,
      },
    ],
  };
}

describe("HarnessPanel native control-plane surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridgeMock.onSupervisorEvent.mockReturnValue(() => undefined);
    bridgeMock.getNativeHarnessControlPlane.mockResolvedValue([
      entry("codex", "Codex Native Harness", "ready"),
      entry("grok", "Grok Build Native Harness", "not-configured"),
      entry("kimi", "Kimi Code Native Harness", "ready"),
      entry("antigravity", "Antigravity Native Harness", "error"),
      entry("deepseek", "DeepSeek / DSH Native Harness", "unavailable"),
    ]);
  });

  it("loads all five safe status rows through the typed IPC procedure", async () => {
    render(<HarnessPanel />);

    await waitFor(() => {
      expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledWith({});
    });
    expect(screen.getByTestId("native-harness-status")).toBeInTheDocument();
    expect(screen.getByTestId("native-harness-codex")).toHaveTextContent("就绪");
    expect(screen.getByTestId("native-harness-grok")).toHaveTextContent("未配置");
    expect(screen.getByTestId("native-harness-kimi")).toHaveTextContent("就绪");
    expect(screen.getByTestId("native-harness-antigravity")).toHaveTextContent("错误");
    expect(screen.getByTestId("native-harness-deepseek")).toHaveTextContent("不可用");
    expect(screen.getByTestId("native-harness-deepseek")).toHaveTextContent("RUNTIME_UNAVAILABLE");
  });

  it("refreshes after supervisor agent status events without exposing private runtime fields", async () => {
    let listener: ((event: { type: "agent-status-updated" }) => void) | undefined;
    bridgeMock.onSupervisorEvent.mockImplementation((next: (event: unknown) => void) => {
      listener = next as (event: { type: "agent-status-updated" }) => void;
      return () => undefined;
    });
    render(<HarnessPanel />);
    await waitFor(() => expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(1));

    listener?.({ type: "agent-status-updated" });
    await waitFor(() => expect(bridgeMock.getNativeHarnessControlPlane).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/CODEX_HOME|executablePath|token|C:\\Users/u)).not.toBeInTheDocument();
  });
});
