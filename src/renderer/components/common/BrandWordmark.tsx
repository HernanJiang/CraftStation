/**
 * CraftStation brand wordmark.
 *
 * Two-tone identity: neutral "Craft" + amber "Station" — the amber is the
 * product's crafting accent, kept constant across theme presets so the brand
 * reads the same on any surface. Size/weight are inherited from the parent.
 */
export function BrandWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={className} aria-label="CraftStation">
      <span className="font-bold" aria-hidden="true">
        Craft<span className="text-amber-500">Station</span>
      </span>
    </span>
  );
}