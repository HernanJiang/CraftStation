import { toast } from "@heroui/react";

/**
 * HeroUI 3.2.2's toast builder (`createToastFunction` in toast-queue.js)
 * rebuilds the queued content from a fixed key list — `title`, `description`,
 * `indicator`, `variant`, `actionProps`, `isLoading` — and silently DROPS every
 * extra option. CraftStation toasts rely on `context` (the status line on
 * thread-completion toasts), `onPress` (click a toast to open its thread) and
 * `ledgerLogged` (bell-list dedupe), none of which ever reached the provider.
 *
 * This module wraps the shared toast object's variant methods in place so
 * extra options are forwarded into the queued content verbatim. Every caller
 * imports the same object, so mutating its methods fixes all call sites
 * without touching them. Installed once from the app shell (provider.tsx).
 */

const DEFAULT_TOAST_TIMEOUT_MS = 4000;

type ToastOptions = Record<string, any> | undefined;
type ToastFn = (message: any, options?: ToastOptions) => unknown;

function forwardableExtras(options: ToastOptions): Record<string, any> | undefined {
  if (!options) return undefined;
  const extras: Record<string, any> = {};
  for (const key of ["context", "onPress", "ledgerLogged"] as const) {
    if (options[key] !== undefined) extras[key] = options[key];
  }
  return Object.keys(extras).length > 0 ? extras : undefined;
}

let installed = false;

export function installToastExtrasForwarding(): void {
  if (installed) return;
  installed = true;

  const queue = toast.getQueue();
  const wrap =
    (original: ToastFn, variant: string): ToastFn =>
    (message, options) => {
      const extras = forwardableExtras(options);
      if (!extras) return original(message, options);
      return queue.add(
        {
          title: message,
          description: options?.description,
          indicator: options?.indicator,
          variant: options?.variant ?? variant,
          actionProps: options?.actionProps,
          isLoading: options?.isLoading,
          ...extras,
        },
        {
          timeout: options?.timeout !== undefined ? options.timeout : DEFAULT_TOAST_TIMEOUT_MS,
          onClose: () => {
            requestAnimationFrame(() => {
              options?.onClose?.();
            });
          },
        },
      );
    };

  // Variant mapping mirrors HeroUI: info renders as "accent".
  const variants = { success: "success", danger: "danger", warning: "warning", info: "accent" };
  const target = toast as unknown as Record<string, unknown>;
  for (const [key, variant] of Object.entries(variants)) {
    const original = target[key];
    if (typeof original === "function") {
      target[key] = wrap(original as ToastFn, variant);
    }
  }
}
