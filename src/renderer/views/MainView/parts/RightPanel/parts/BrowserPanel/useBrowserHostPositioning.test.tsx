import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserDockStore } from "@/renderer/state/browserDockStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { useBrowserHostPositioning } from "./useBrowserHostPositioning";

function Harness({ conversation = false }: { conversation?: boolean }) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useBrowserHostPositioning({
    wrapperRef,
    mode: conversation ? "conversation" : "docked",
    drawerWidth: 480,
    dockedVisible: !conversation,
  });
  return <div data-testid="wrapper" ref={wrapperRef} />;
}

function mountSlot(rect: { top: number; left: number; width: number; height: number }) {
  const slot = document.createElement("div");
  slot.getBoundingClientRect = () =>
    ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(slot);
  useBrowserDockStore.setState({ slotEl: slot });
  return slot;
}

describe("useBrowserHostPositioning", () => {
  beforeEach(() => {
    useSharedSettings.setState({ zoomFactor: 1 });
  });

  afterEach(() => {
    cleanup();
    useSharedSettings.setState({ zoomFactor: 1 });
    useBrowserDockStore.setState({
      slotEl: null,
      conversationSlotEl: null,
      conversationTabId: undefined,
    });
    document.body.innerHTML = "";
  });

  it("applies the slot rect unchanged at zoom factor 1", () => {
    mountSlot({ top: 100, left: 200, width: 1000, height: 500 });
    const { getByTestId } = render(<Harness />);
    const wrapper = getByTestId("wrapper");
    expect(wrapper.style.top).toBe("100px");
    expect(wrapper.style.left).toBe("200px");
    expect(wrapper.style.width).toBe("1000px");
    expect(wrapper.style.height).toBe("500px");
  });

  it("uses the conversation slot when the sidebar browser is closed", () => {
    mountSlot({ top: 0, left: 1000, width: 200, height: 600 });
    const card = mountSlot({ top: 100, left: 200, width: 700, height: 500 });
    useBrowserDockStore.getState().setConversationSlot(card, "tab-1");
    const { getByTestId } = render(<Harness conversation />);
    expect(getByTestId("wrapper").style.left).toBe("200px");
    expect(getByTestId("wrapper").style.width).toBe("700px");
  });

  it("normalizes the zoom-scaled slot rect back to layout pixels", () => {
    // getBoundingClientRect() at zoom 1.25 returns visual (scaled) pixels; the
    // body-portaled wrapper must be positioned in layout pixels or it drifts
    // by (zoom-1)×distance.
    useSharedSettings.setState({ zoomFactor: 1.25 });
    mountSlot({ top: 125, left: 250, width: 1250, height: 625 });
    const { getByTestId } = render(<Harness />);
    const wrapper = getByTestId("wrapper");
    expect(wrapper.style.top).toBe("100px");
    expect(wrapper.style.left).toBe("200px");
    expect(wrapper.style.width).toBe("1000px");
    expect(wrapper.style.height).toBe("500px");
  });

  it("re-measures when the zoom factor changes", () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
    try {
      const slot = mountSlot({ top: 100, left: 200, width: 1000, height: 500 });
      const { getByTestId } = render(<Harness />);
      const wrapper = getByTestId("wrapper");
      expect(wrapper.style.top).toBe("100px");

      // After the zoom change the slot re-lays out (narrower column) and its
      // visual rect scales up; the wrapper must land on the new layout pixels.
      slot.getBoundingClientRect = () =>
        ({
          top: 150,
          left: 300,
          width: 1500,
          height: 750,
          right: 1800,
          bottom: 900,
          x: 300,
          y: 150,
          toJSON: () => ({}),
        }) as DOMRect;
      act(() => {
        useSharedSettings.setState({ zoomFactor: 1.25 });
      });

      expect(wrapper.style.top).toBe("120px");
      expect(wrapper.style.left).toBe("240px");
      expect(wrapper.style.width).toBe("1200px");
      expect(wrapper.style.height).toBe("600px");
    } finally {
      raf.mockRestore();
    }
  });
});
