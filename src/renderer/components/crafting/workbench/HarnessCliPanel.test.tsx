import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import type { NativeHarnessControlPlaneEntry } from "@/shared/crafting/nativeHarness";
import { useUpdateStore } from "@/renderer/state/updateStore";
import { HarnessCliPanel } from "./HarnessCliPanel";

function entry(harnessKind: string, status: NativeHarnessControlPlaneEntry["status"]) {
  return {
    descriptor: { id: harnessKind, harnessKind, vendor: harnessKind, label: harnessKind },
    status,
  } as unknown as NativeHarnessControlPlaneEntry;
}

function renderPanel(
  entries: NativeHarnessControlPlaneEntry[] = [entry("grok", "ready"), entry("kimi", "ready")],
  onShowDetail: (next: NativeHarnessControlPlaneEntry) => void = () => undefined,
) {
  return render(
    <HarnessCliPanel
      entries={entries}
      loading={false}
      onRefresh={() => undefined}
      onShowDetail={onShowDetail}
    />,
  );
}

describe("HarnessCliPanel update progress", () => {
  it("marks the row updating while its agent binary update is in flight", () => {
    useUpdateStore.setState({
      agentUpdates: { "grok:windows:": { label: "Grok", startedAt: Date.now() } },
    });
    renderPanel();

    expect(screen.getByText("更新中")).toBeInTheDocument();
    expect(screen.getAllByText("就绪")).toHaveLength(2);
    useUpdateStore.setState({ agentUpdates: {} });
  });

  it("shows no updating state when nothing is in flight", () => {
    useUpdateStore.setState({ agentUpdates: {} });
    renderPanel();

    expect(screen.queryByText("更新中")).not.toBeInTheDocument();
  });

  it("ignores in-flight keys from other harnesses", () => {
    useUpdateStore.setState({
      agentUpdates: { "codex:windows:": { label: "Codex", startedAt: Date.now() } },
    });
    renderPanel();

    expect(screen.queryByText("更新中")).not.toBeInTheDocument();
    useUpdateStore.setState({ agentUpdates: {} });
  });

  it("shows an update chip mirroring the titlebar CLI check", () => {
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
    renderPanel();

    expect(screen.getByText("Update")).toBeInTheDocument();
    useUpdateStore.setState({ availableCliUpdates: [] });
  });

  it("runs the CLI update when the update chip is clicked", async () => {
    const updateAgentBinary = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockResolvedValue({ ok: true });
    Object.assign(window, {
      craftstation: {
        ...(window.craftstation ?? {}),
        updateAgentBinary,
        refreshAgentStatuses: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
      },
    });
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
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Update grok now/u }));
    await waitFor(() =>
      expect(updateAgentBinary).toHaveBeenCalledWith({
        agentKind: "grok",
        envKind: "windows",
      }),
    );
    useUpdateStore.setState({ availableCliUpdates: [] });
  });

  it("hides the update chip while that harness is updating", () => {
    useUpdateStore.setState({
      agentUpdates: { "grok:windows:": { label: "Grok", startedAt: Date.now() } },
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
    renderPanel();

    expect(screen.queryByText("Update")).not.toBeInTheDocument();
    expect(screen.getByText("更新中")).toBeInTheDocument();
    useUpdateStore.setState({ agentUpdates: {}, availableCliUpdates: [] });
  });

  it("lets the user click a not-configured row to open configuration", () => {
    const onShowDetail = vi.fn<(entry: NativeHarnessControlPlaneEntry) => void>();
    renderPanel(
      [entry("kimi", "not-configured"), entry("deepseek-api", "not-configured")],
      onShowDetail,
    );

    const kimiRow = screen.getByTestId("harness-cli-row-kimi");
    expect(kimiRow).toHaveAttribute("title", "点击配置");
    fireEvent.click(kimiRow);
    expect(onShowDetail).toHaveBeenCalledTimes(1);
    expect(onShowDetail.mock.calls[0]?.[0].descriptor.harnessKind).toBe("kimi");
    expect(onShowDetail.mock.calls[0]?.[0].status).toBe("not-configured");
  });
});

describe("HarnessCliPanel one-click install", () => {
  it("offers a direct install action on an unavailable row and runs it once", () => {
    const onInstall = vi.fn<(entry: NativeHarnessControlPlaneEntry) => void>();
    const onShowDetail = vi.fn<(entry: NativeHarnessControlPlaneEntry) => void>();
    render(
      <HarnessCliPanel
        entries={[entry("antigravity", "unavailable"), entry("grok", "ready")]}
        loading={false}
        onRefresh={() => undefined}
        onInstall={onInstall}
        onShowDetail={onShowDetail}
      />,
    );

    const installChip = screen.getByTestId("harness-cli-install-antigravity");
    expect(installChip).toHaveTextContent("下载并安装");
    fireEvent.click(installChip);
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onInstall.mock.calls[0]?.[0].descriptor.harnessKind).toBe("antigravity");
    // The install chip must not fall through to the row's detail handler.
    expect(onShowDetail).not.toHaveBeenCalled();
  });

  it("installs an unavailable row in place instead of opening settings", () => {
    const onInstall = vi.fn<(entry: NativeHarnessControlPlaneEntry) => void>();
    const onShowDetail = vi.fn<(entry: NativeHarnessControlPlaneEntry) => void>();
    render(
      <HarnessCliPanel
        entries={[entry("devin", "unavailable"), entry("grok", "ready")]}
        loading={false}
        onRefresh={() => undefined}
        onInstall={onInstall}
        onShowDetail={onShowDetail}
      />,
    );

    fireEvent.click(screen.getByTestId("harness-cli-row-devin"));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onInstall.mock.calls[0]?.[0].descriptor.harnessKind).toBe("devin");
    expect(onShowDetail).not.toHaveBeenCalled();
  });

  it("shows an honest installing state and hides the install chip while in flight", () => {
    const installing = new Set(["antigravity"]);
    render(
      <HarnessCliPanel
        entries={[entry("antigravity", "unavailable")]}
        loading={false}
        installingKinds={installing}
        onRefresh={() => undefined}
        onInstall={() => undefined}
        onShowDetail={() => undefined}
      />,
    );

    expect(screen.getByText("Installing…")).toBeInTheDocument();
    expect(screen.queryByTestId("harness-cli-install-antigravity")).not.toBeInTheDocument();
  });

  it("never offers install for ready harnesses or when no handler is wired", () => {
    render(
      <HarnessCliPanel
        entries={[entry("grok", "ready")]}
        loading={false}
        onRefresh={() => undefined}
        onInstall={() => undefined}
        onShowDetail={() => undefined}
      />,
    );
    expect(screen.queryByTestId("harness-cli-install-grok")).not.toBeInTheDocument();

    render(
      <HarnessCliPanel
        entries={[entry("antigravity", "unavailable")]}
        loading={false}
        onRefresh={() => undefined}
        onShowDetail={() => undefined}
      />,
    );
    expect(screen.queryByTestId("harness-cli-install-antigravity")).not.toBeInTheDocument();
  });
});
