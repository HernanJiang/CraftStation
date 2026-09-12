/**
 * Eagerly load renderer provider modules for their icon, composer-control, and
 * utility-default registrations. Provider metadata is discovered separately
 * through lightweight `manifest.ts` files, so ordering code never imports UI.
 *
 * Eager stays deliberate (measured 2026-09-07): `getComposerControls()` is
 * called synchronously on the composer/model-picker render path
 * (`buildModelPickerControls.tsx`), so lazy `index.tsx` would trade startup
 * bytes for an async waterfall on first composer open. Per-module resolve
 * costs are attributed in `main.tsx` (`__craftstationBootstrapAttribution`);
 * revisit only when that data shows provider bootstrap dominating startup.
 */
const providerModules = import.meta.glob("./*/index.tsx", { eager: true });

export const RENDERER_PROVIDER_MODULE_PATHS = Object.keys(providerModules).toSorted();
