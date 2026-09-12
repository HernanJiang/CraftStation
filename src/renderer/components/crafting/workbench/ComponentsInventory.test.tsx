import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithI18n as render } from "@/renderer/testUtils/i18n";
import { ComponentsInventory } from "./ComponentsInventory";

const originalBridge = window.craftstation;

function stubBridge(status: { running: boolean; endpoint?: string }) {
  window.craftstation = {
    getCompatibilityBridgeStatus: vi.fn<() => Promise<typeof status>>().mockResolvedValue(status),
    startCompatibilityBridge: vi
      .fn<() => Promise<typeof status>>()
      .mockResolvedValue({ running: true, endpoint: "http://127.0.0.1:8317" }),
    stopCompatibilityBridge: vi.fn<() => Promise<typeof status>>().mockResolvedValue(status),
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

  it("shows a stopped bridge honestly", async () => {
    stubBridge({ running: false });
    render(<ComponentsInventory onSelect={() => undefined} />);

    expect(await screen.findByText("未运行")).toBeInTheDocument();
  });

  it("starts a stopped bridge from the one-click button", async () => {
    stubBridge({ running: false });
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
