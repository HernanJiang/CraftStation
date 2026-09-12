import { toast } from "@heroui/react";

/**
 * Window transient status toasts ("已切换至 X" / quota-exhausted and
 * friends). They share the default top-start toast queue with every other
 * task notification, so all notices render the identical opaque `lc-toast`
 * box and emerge from the same top-left region — never a separate
 * transparent overlay competing with chat content. Failures keep the
 * existing error toasts.
 */

export function showTopStatusToast(
  title: string,
  options?: { description?: string; timeout?: number },
): string {
  return toast(title, {
    ...(options?.description ? { description: options.description } : {}),
    variant: "default",
    timeout: options?.timeout ?? 3000,
  });
}
