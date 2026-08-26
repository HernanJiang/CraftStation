import type { SVGProps } from "react";

type BarCount = 1 | 2 | 3 | 4 | 5;

/**
 * Signal-bar icon using thin stroked lines. Active bars use `currentColor`,
 * inactive bars are drawn at low opacity so the full scale is always visible.
 *
 * Renders one bar per non-none effort level, capped at five. The effort's
 * position within the list determines how many bars are lit.
 */
export function EffortIcon(
  props: SVGProps<SVGSVGElement> & { effort: string; efforts: readonly string[] },
) {
  const { effort, efforts, ...svgProps } = props;
  const index = efforts.indexOf(effort);
  const count = efforts.length;
  const hasNone = efforts.includes("none");
  const scaleCount = hasNone ? count - 1 : count;
  const totalBars = Math.min(5, Math.max(1, scaleCount)) as BarCount;

  let active: number;
  if (index < 0 || effort === "none") {
    active = 0;
  } else if (count <= 1) {
    active = totalBars;
  } else {
    const offset = hasNone ? 1 : 0;
    const position = Math.max(0, index - offset);
    const steps = Math.max(1, count - 1 - offset);
    active = Math.min(totalBars, Math.max(1, Math.round((position / steps) * (totalBars - 1)) + 1));
  }

  const barsByCount = {
    1: [{ x: 12, y1: 20, y2: 8 }],
    2: [
      { x: 8, y1: 20, y2: 14 },
      { x: 16, y1: 20, y2: 6 },
    ],
    3: [
      { x: 6, y1: 20, y2: 16 },
      { x: 12, y1: 20, y2: 10 },
      { x: 18, y1: 20, y2: 4 },
    ],
    4: [
      { x: 5, y1: 20, y2: 16 },
      { x: 9.5, y1: 20, y2: 12 },
      { x: 14, y1: 20, y2: 8 },
      { x: 18.5, y1: 20, y2: 4 },
    ],
    5: [
      { x: 3.5, y1: 20, y2: 17 },
      { x: 7.25, y1: 20, y2: 14 },
      { x: 11, y1: 20, y2: 10 },
      { x: 14.75, y1: 20, y2: 6 },
      { x: 18.5, y1: 20, y2: 3 },
    ],
  } satisfies Record<number, { x: number; y1: number; y2: number }[]>;

  const bars = barsByCount[totalBars];

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      {...svgProps}
    >
      {bars.map((bar, i) => (
        <line
          key={i}
          x1={bar.x}
          y1={bar.y1}
          x2={bar.x}
          y2={bar.y2}
          opacity={i < active ? 1 : 0.2}
        />
      ))}
    </svg>
  );
}
