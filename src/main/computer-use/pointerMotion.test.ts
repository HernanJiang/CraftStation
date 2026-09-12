import { describe, expect, it } from "vitest";
import {
  pointerMotionForTool,
  pointerMoveDurationMs,
  POINTER_MOVE_MS_MAX,
  POINTER_MOVE_MS_MIN,
} from "./pointerMotion";

const window = { app: "notepad", id: 1, x: 100, y: 200, width: 800, height: 600 };

describe("pointerMotionForTool", () => {
  it("maps click and scroll to window-relative screen coordinates", () => {
    expect(pointerMotionForTool("click", { window, x: 10, y: 20 })).toEqual({
      kind: "click",
      x: 110,
      y: 220,
    });
    expect(pointerMotionForTool("scroll", { window, x: 40, y: 50, scrollX: 0, scrollY: 120 })).toEqual({
      kind: "scroll",
      x: 140,
      y: 250,
    });
  });

  it("maps drag from/to into a motion with a start point", () => {
    expect(
      pointerMotionForTool("drag", { window, from_x: 10, from_y: 20, to_x: 80, to_y: 90 }),
    ).toEqual({
      kind: "drag",
      x: 180,
      y: 290,
      fromX: 110,
      fromY: 220,
    });
  });

  it("returns null when geometry is missing or the tool has no pointer", () => {
    expect(pointerMotionForTool("click", { window: { app: "notepad", id: 1 }, x: 10, y: 20 })).toBeNull();
    expect(pointerMotionForTool("type_text", { window, text: "hi" })).toBeNull();
    expect(pointerMotionForTool("enable", {})).toBeNull();
  });

  it("accepts the screenshot alias as a non-pointer tool", () => {
    expect(pointerMotionForTool("screenshot", { window })).toBeNull();
  });
});

describe("pointerMoveDurationMs", () => {
  it("clamps short hops and long flights", () => {
    expect(pointerMoveDurationMs(0, 0, 1, 0)).toBe(POINTER_MOVE_MS_MIN);
    expect(pointerMoveDurationMs(0, 0, 10000, 0)).toBe(POINTER_MOVE_MS_MAX);
    expect(pointerMoveDurationMs(0, 0, 400, 300)).toBeGreaterThan(POINTER_MOVE_MS_MIN);
    expect(pointerMoveDurationMs(0, 0, 400, 300)).toBeLessThan(POINTER_MOVE_MS_MAX);
  });
});
