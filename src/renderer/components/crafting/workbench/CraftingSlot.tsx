import type { ReactNode } from "react";
import { ProviderBrandBadge } from "@/renderer/views/MainView/parts/Sidebar/parts/providerBrands";

/** Inventory-card sized slot used by both 2×2 efficient and 3×3 creative grids. */
export const CRAFTING_SLOT_SIZE_CLASS = "size-[4.5rem]";

export function CraftingSlot(props: {
  label: string;
  filled?: boolean | undefined;
  focused?: boolean | undefined;
  brandId?: string | undefined;
  brandLabel?: string | undefined;
  name?: string | undefined;
  icon?: ReactNode | undefined;
  disabled?: boolean | undefined;
  testId?: string | undefined;
  onClick?: (() => void) | undefined;
}) {
  const {
    label,
    filled = false,
    focused = false,
    brandId,
    brandLabel,
    name,
    icon,
    disabled = false,
    testId,
    onClick,
  } = props;
  const className = `${CRAFTING_SLOT_SIZE_CLASS} relative flex flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center transition-colors ${
    filled
      ? "border-white/25 bg-white/[0.06] hover:border-white/40"
      : "border-dashed border-white/15 bg-white/[0.02]"
  } ${focused ? "ring-1 ring-accent/70" : ""}`;

  const body = (
    <>
      {brandId ? (
        <ProviderBrandBadge id={brandId} label={brandLabel ?? name ?? label} size="avatar" />
      ) : (
        (icon ?? <span className="text-[9px] text-neutral-600">{label}</span>)
      )}
      {name ? (
        <span className="w-full truncate text-[9px] leading-tight text-neutral-300">{name}</span>
      ) : null}
    </>
  );

  if (disabled || !onClick) {
    return (
      <div className={className} title={name ? `${label} · ${name}` : label} data-testid={testId}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      title={name ? `${label} · ${name}` : label}
      onClick={onClick}
      className={className}
      data-testid={testId}
    >
      {body}
    </button>
  );
}
