import { useLingui } from "@lingui/react/macro";
import mascotUrl from "@/renderer/assets/craftstation-mascot.png";

/**
 * v0.2.4 — CraftStation mascot.
 *
 * The brand logo slowly rotates (the "workbench surroundings") while the
 * centered `>_` face stays fixed and blinks every few seconds — the Codex
 * mascot blink recreated on CraftStation's own logo.
 */
export function CraftStationMascot({ sizeClass = "size-20" }: { sizeClass?: string }) {
  const { t } = useLingui();
  return (
    <div
      role="img"
      aria-label={t`CraftStation mascot`}
      className={`relative ${sizeClass} select-none`}
    >
      <img
        src={mascotUrl}
        alt=""
        draggable={false}
        className="absolute inset-0 size-full object-contain [animation:cs-mascot-spin_28s_linear_infinite]"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 flex -translate-y-[3%] items-center justify-center font-mono text-lg font-bold text-[#fab856] drop-shadow-[0_0_6px_rgba(250,184,86,0.45)] [animation:cs-mascot-blink_4.6s_ease-in-out_infinite]"
      >
        {">_"}
      </span>
    </div>
  );
}