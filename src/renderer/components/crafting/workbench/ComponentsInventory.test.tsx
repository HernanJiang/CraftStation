import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ComponentsInventory } from "./ComponentsInventory";

const originalBridge = window.craftstation;

function stubBridge(status: { running: boolean; endpoint?: string; installed?: boolean }) {
  const view = { installed: status.installed ?? status.running, ...status };
  window.craftstation = {
    getCompatibilityBridgeStatus: vi.fn<() => Promise<typeof view>>().mockResolvedValue(view),
    startCompatibilityBridge: vi
      .fn<() => Promise<typeof view>>()
      .mockResolvedValue({ running: true, installed: true, endpoint: "http://127.0.0.1:8317" }),
    stopCompatibilityBridge: vi.fn<() => Promise<typeof view>>().mockResolvedValue(view),
    ensureCompatibilityBridge: vi
      .fn<() => Promise<typeof view>>()
      .mockResolvedValue({ running: true, installed: true, endpoint: "http://127.0.0.1:8317" }),
  } as unknown as typeof window.craftstation;
}

describe("ComponentsInventory", () => {
  afterEach(() => {
    window.craftstation = originalBridge;
  });

  it("shows the CPA entry as unknown without a bridge", async () => {
    window.craftstation = undefined as unknown as typeof window.craftstation;
    render(<ComponentsInventory onSelect={() => undefined} />);

    expect(await screen.findByTestId("component-cpa")).toHaveTextContent("未知");
  });

  it("shows live bridge status from the supervisor, never hardcoded", async () => {
    stubBridge({ running: true, endpoint: "http://127.0.0.1:8317" });
    render(<ComponentsInventory onSelect={() => undefined} />);

    const card = await screen.findByTestId("component-cpa");
    expect(card).toHaveTextContent("CLIProxyAPI");
    expect(card).toHaveTextContent("运行中");
    expect(card.getAttribute("title")).toContain("http://127.0.0.1:8317");
  });

  it("shows a stopped but installed bridge honestly", async () => {
    stubBridge({ running: false, installed: true });
    render(<ComponentsInventory onSelect={() => undefined} />);

    expect(await screen.findByText("未运行")).toBeInTheDocument();
  });

  it("shows an install action when the sidecar binary is missing", async () => {
    stubBridge({ running: false, installed: false });
    render(<ComponentsInventory onSelect={() => undefined} />);

    expect(await screen.findByText("未安装")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("bridge-install"));
    expect(window.craftstation.ensureCompatibilityBridge).toHaveBeenCalledWith({});
    expect(await screen.findByText("运行中")).toBeInTheDocument();
  });

  it("starts a stopped bridge from the one-click button", async () => {
    stubBridge({ running: false, installed: true });
    render(<ComponentsInventory onSelect={() => undefined} />);

    fireEvent.click(await screen.findByTestId("bridge-start"));
    expect(window.craftstation.startCompatibilityBridge).toHaveBeenCalledWith({});
    expect(await screen.findByText("运行中")).toBeInTheDocument();
  });

  it("stops a running bridge from the one-click button", async () => {
    stubBridge({ running: true, endpoint: "http://127.0.0.1:8317" });
    render(<ComponentsInventory onSelect={() => undefined} />);

    fireEvent.click(await screen.findByTestId("bridge-stop"));
    expect(window.craftstation.stopCompatibilityBridge).toHaveBeenCalledWith({});
  });
});
