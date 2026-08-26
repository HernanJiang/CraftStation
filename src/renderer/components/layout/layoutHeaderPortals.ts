import { useLayoutEffect, useState } from "react";

export const MAIN_THREAD_HEADER_PORTAL_ID = "craftstation-main-thread-header";

/**
 * Resolve one of the persistent workspace-header portal targets after the
 * shell commits. The target already exists on normal renders, while the
 * layout-effect retry also covers tests and the first deferred panel mount.
 */
export function useLayoutHeaderPortalTarget(id: string): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById(id),
  );

  useLayoutEffect(() => {
    const next = document.getElementById(id);
    setTarget((current) => (current === next ? current : next));
  }, [id]);

  return target;
}
