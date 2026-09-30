import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CRAFTING_SLOT_SIZE_CLASS } from "./CraftingSlot";

/**
 * Shared grid for every inventory/ingredients surface on the workbench:
 * square slots with the same footprint as the 3×3 crafting-grid slots.
 */
export const INVENTORY_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,4.5rem)] content-start gap-2";

const GLYPH_TONE_CLASSES = {
  mcp: "bg-sky-500/15 text-sky-300",
  custom: "bg-violet-500/15 text-violet-300",
  skill: "bg-amber-500/15 text-amber-300",
  reserved: "bg-white/5 text-neutral-500",
} as const;

/**
 * 32px tinted circular glyph — same shape as ProviderBrandBadge size="compact"
 * so ingredient slots line up visually with model/harness brand badges.
 */
export function IngredientGlyph(props: {
  icon: LucideIcon;
  tone: "mcp" | "custom" | "skill" | "reserved";
}) {
  const Icon = props.icon;
  return (
    <span
      className={`flex size-8 items-center justify-center rounded-full border border-white/8 ${GLYPH_TONE_CLASSES[props.tone]}`}
      aria-hidden="true"
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * One square inventory cell — model, harness, MCP server, skill, reserved
 * policy or "add" slot all render through this so the whole bench shares a
 * single slot shape. A button when clickable, a plain div when not.
 */
export function InventorySlot(props: {
  name: string;
  /** One muted line under the name (models: channelLabel). */
  subLabel?: string | undefined;
  /** ProviderBrandBadge size="compact" or <IngredientGlyph/>. */
  visual: ReactNode;
  /** aria-pressed + accent ring. */
  selected?: boolean | undefined;
  /** opacity-50 (disabled/abnormal). */
  muted?: boolean | undefined;
  /** warning = amber border (abnormal harness); dashed = reserved/add slot. */
  tone?: "default" | "warning" | "dashed";
  /** Tiny top-right status dot: on = emerald-400, off = neutral-600. */
  statusDot?: "on" | "off" | undefined;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  onClick?: (() => void) | undefined;
}) {
  const {
    name,
    subLabel,
    visual,
    selected = false,
    muted = false,
    tone = "default",
    statusDot,
    title,
    ariaLabel,
    testId,
    onClick,
  } = props;

  const toneClass = selected
    ? "border-accent/70 bg-accent/10 ring-1 ring-accent/40"
    : tone === "warning"
      ? "border-amber-500/30 bg-black/30"
      : tone === "dashed"
        ? "border-dashed border-white/15 bg-white/[0.02] text-neutral-500 hover:border-white/30 hover:text-white"
        : "border-white/10 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.07]";
  const className = `${CRAFTING_SLOT_SIZE_CLASS} relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center transition-colors ${toneClass}${muted ? " opacity-50" : ""}`;

  const body = (
    <>
      {statusDot ? (
        <span
          className={`absolute right-1 top-1 size-1.5 rounded-full ${
            statusDot === "on" ? "bg-emerald-400" : "bg-neutral-600"
          }`}
          aria-hidden="true"
        />
      ) : null}
      {visual}
      <span
        className={`w-full text-[9px] leading-tight text-neutral-200 ${
          subLabel ? "truncate" : "line-clamp-2 [overflow-wrap:anywhere]"
        }`}
      >
        {name}
      </span>
      {subLabel ? (
        <span className="w-full truncate text-[8px] leading-tight text-neutral-500">
          {subLabel}
        </span>
      ) : null}
    </>
  );

  if (!onClick) {
    return (
      <div className={className} title={title} aria-label={ariaLabel} data-testid={testId}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={className}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
