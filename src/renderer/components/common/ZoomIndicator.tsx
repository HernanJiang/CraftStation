import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { adjustAppZoom } from "@/renderer/actions/zoomActions";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import { normalizeZoomFactor, ZOOM_DEFAULT } from "@/shared/zoom";

const AUTO_HIDE_MS = 2000;

/**
 * Transient pill shown top-right whenever the whole-app zoom changes
 * (Ctrl +/-/0, or a BrowserPanel relay). Fades out after a couple seconds;
 * pressing its own controls re-triggers the effect, so interacting with the
 * pill keeps it alive.
 */
export function ZoomIndicator() {
  const { t } = useLingui();
  const zoomFactor = useSharedSettings((state) => state.zoomFactor);
  const [visible, setVisible] = useState(false);
  const previousZoom = useRef(zoomFactor);
  const hideTimer = useRef(0);

  useEffect(() => {
    if (zoomFactor === previousZoom.current) return;
    previousZoom.current = zoomFactor;
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    return () => window.clearTimeout(hideTimer.current);
  }, [zoomFactor]);

  const percent = Math.round(normalizeZoomFactor(zoomFactor) * 100);
  const buttonClass =
    "flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground";

  return (
    <div
      aria-hidden={!visible}
      className={`fixed right-3 top-[46px] z-[100] flex items-center gap-0.5 rounded-full border border-[var(--hairline)] bg-[var(--composer-surface)] py-1 pl-3 pr-1 text-xs font-medium text-foreground shadow-lg transition-opacity duration-200 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <span className="tabular-nums">{percent}%</span>
      <button
        type="button"
        aria-label={t`Zoom out`}
        title={t`Zoom out`}
        className={buttonClass}
        onClick={() => adjustAppZoom("out")}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={t`Zoom in`}
        title={t`Zoom in`}
        className={buttonClass}
        onClick={() => adjustAppZoom("in")}
      >
        <Plus className="size-3.5" />
      </button>
      {percent !== ZOOM_DEFAULT * 100 ? (
        <button
          type="button"
          aria-label={t`Reset zoom`}
          className={`${buttonClass} h-6 w-auto px-2 text-[11px]`}
          onClick={() => adjustAppZoom("reset")}
        >
          {t`重置`}
        </button>
      ) : null}
    </div>
  );
}
