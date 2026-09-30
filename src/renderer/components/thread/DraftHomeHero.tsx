import { Trans } from "@lingui/react/macro";
import { CraftStationMascot } from "@/renderer/components/common/CraftStationMascot";

/**
 * Home hero for the merged draft home screen: mascot + greeting. The old
 * quick-action card row was replaced by the projects/recent-threads lists
 * (HomeBrowseSections) rendered below this hero.
 *
 * Mascot motion assets are extracted from the installed Codex desktop app.
 */
export function DraftHomeHero() {
  return (
    <div className="flex w-full flex-col items-center">
      {/* CraftStation mascot: rotating logo + blinking `>_` face. */}
      <CraftStationMascot />

      <h1 className="mt-4 text-center text-[24px] font-semibold tracking-tight text-white">
        <Trans>What shall we build in CraftStation?</Trans>
      </h1>
    </div>
  );
}
