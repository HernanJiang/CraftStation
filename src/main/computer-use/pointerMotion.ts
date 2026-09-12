import { normalizeToolName } from "./mcp/toolRegistry";

export type ComputerUsePointerKind = "click" | "scroll" | "drag";

export interface ComputerUsePointerMotion {
  kind: ComputerUsePointerKind;
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
}

export const POINTER_MOVE_MS_MIN = 80;
export const POINTER_MOVE_MS_MAX = 280;
export const POINTER_MOVE_MS_PER_PIXEL = 0.22;

export function pointerMoveDurationMs(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  return Math.round(
    Math.min(POINTER_MOVE_MS_MAX, Math.max(POINTER_MOVE_MS_MIN, dist * POINTER_MOVE_MS_PER_PIXEL)),
  );
}

function readFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function screenPoint(
  window: Record<string, unknown> | undefined,
  offsetX: unknown,
  offsetY: unknown,
): { x: number; y: number } | null {
  if (!window) return null;
  const originX = readFinite(window.x);
  const originY = readFinite(window.y);
  const x = readFinite(offsetX);
  const y = readFinite(offsetY);
  if (originX === undefined || originY === undefined || x === undefined || y === undefined) {
    return null;
  }
  return { x: originX + x, y: originY + y };
}

/** Screen-space pointer motion for overlay animation. Null when the tool has no mouse target. */
export function pointerMotionForTool(
  name: string,
  args: Record<string, unknown>,
): ComputerUsePointerMotion | null {
  const tool = normalizeToolName(name);
  const window =
    args.window && typeof args.window === "object"
      ? (args.window as Record<string, unknown>)
      : undefined;

  if (tool === "click" || tool === "scroll") {
    const point = screenPoint(window, args.x, args.y);
    if (!point) return null;
    return { kind: tool, x: point.x, y: point.y };
  }

  if (tool === "drag") {
    const from = screenPoint(window, args.from_x, args.from_y);
    const to = screenPoint(window, args.to_x, args.to_y);
    if (!from || !to) return null;
    return { kind: "drag", x: to.x, y: to.y, fromX: from.x, fromY: from.y };
  }

  return null;
}
