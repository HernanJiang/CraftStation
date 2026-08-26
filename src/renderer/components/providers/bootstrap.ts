/**
 * Eagerly load renderer provider modules for their icon, composer-control, and
 * utility-default registrations. Provider metadata is discovered separately
 * through lightweight `manifest.ts` files, so ordering code never imports UI.
 */
const providerModules = import.meta.glob("./*/index.tsx", { eager: true });

export const RENDERER_PROVIDER_MODULE_PATHS = Object.keys(providerModules).toSorted();
