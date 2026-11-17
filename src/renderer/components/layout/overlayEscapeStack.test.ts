import { describe, expect, it, vi } from "vitest";
import { pushEscapeHandler } from "./overlayEscapeStack";

describe("overlayEscapeStack", () => {
  it("closes the top overlay when Escape targets the document itself", () => {
    const handler = vi.fn<() => void>();
    const pop = pushEscapeHandler(handler);
    try {
      // Synthetic keydowns dispatched on `document` have no Element target.
      expect(() =>
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
      ).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      pop();
    }
  });

  it("lets a focused terminal keep its Escape", () => {
    const handler = vi.fn<() => void>();
    const pop = pushEscapeHandler(handler);
    const terminal = document.createElement("div");
    terminal.className = "xterm";
    document.body.append(terminal);
    try {
      terminal.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(handler).not.toHaveBeenCalled();
    } finally {
      pop();
      terminal.remove();
    }
  });
});
