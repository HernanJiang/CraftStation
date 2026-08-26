import type { SVGProps } from "react";

// Lucide shield outline (shared across all states)
const SHIELD =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

/**
 * Shield icon with an interior symbol that reflects the current permission level.
 * Uses the real lucide shield path for consistent visual weight.
 *
 * Policies are ordered most-protected-first:
 *   - Most protected  → shield + plus
 *   - Protected        → shield + check
 *   - Permissive       → shield outline only
 *   - Least protected  → shield off (split outline + diagonal slash)
 *
 * For binary toggles pass `index={isProtected ? 0 : 1}` and `count={2}`.
 */
export function PermissionIcon(props: SVGProps<SVGSVGElement> & { index: number; count: number }) {
  const { index, count, ...svgProps } = props;

  // Map index → 1..4 level (4 = most protected, 1 = least)
  let level: number;
  if (count <= 1) {
    level = 4;
  } else {
    level = 4 - Math.min(3, Math.max(0, Math.round((index / (count - 1)) * 3)));
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...svgProps}
    >
      {level === 1 ? (
        <>
          {/* Shield-off: split outline + slash (matches lucide shield-off) */}
          <path d="m2 2 20 20" />
          <path d="M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71" />
          <path d="M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264" />
        </>
      ) : (
        <>
          {/* Full shield outline */}
          <path d={SHIELD} />

          {/* Level 4: plus (matches lucide shield-plus) */}
          {level === 4 && (
            <>
              <path d="M9 12h6" />
              <path d="M12 9v6" />
            </>
          )}

          {/* Level 3: checkmark (matches lucide shield-check) */}
          {level === 3 && <path d="m9 12 2 2 4-4" />}

          {/* Level 2: empty shield — no interior symbol */}
        </>
      )}
    </svg>
  );
}
