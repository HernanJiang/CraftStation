import { useState } from "react";
import { Pencil, Share2 } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { isRemoteSession } from "@/renderer/bridge";
import { Button, PixelLoader } from "@/renderer/components/common";
import { useProfileData } from "@/renderer/views/ProfileOverlay/useProfileData";
import { ProfileHeader } from "@/renderer/views/ProfileOverlay/parts/ProfileHeader";
import { ProfileStatsBody } from "@/renderer/views/ProfileOverlay/parts/ProfileStatsBody";
import type { ActivityMetric } from "@/renderer/views/ProfileOverlay/parts/ActivitySection";
import { EditProfileDialog } from "@/renderer/views/ProfileOverlay/parts/EditProfileDialog";
import { ShareDialog } from "@/renderer/views/ProfileOverlay/parts/ShareDialog";

/** Profile + usage statistics, rendered as a Settings section. */
export function ProfileSettings() {
  const { t } = useLingui();
  const data = useProfileData();
  // Sharing takes a native clipboard screenshot of the page (copyShareImage),
  // which has no remote equivalent; hide the affordance rather than surface a
  // dead button. Editing identity still works remotely via setProfileIdentity.
  const remote = isRemoteSession();
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [pickedMetric, setPickedMetric] = useState<ActivityMetric | null>(null);
  const { core, coreLoading, tokens } = data;

  if (coreLoading && !core) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PixelLoader size="lg" />
      </div>
    );
  }
  if (!core) {
    return (
      <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted">
        {data.error ?? t`Couldn't load your profile stats.`}
      </div>
    );
  }

  const headerActions = (
    <>
      {!remote && (
        <Button size="sm" variant="ghost" onPress={() => setShareOpen(true)} className="gap-1.5">
          <Share2 className="size-4" />
          <Trans>Share</Trans>
        </Button>
      )}
      <Button size="sm" variant="ghost" onPress={() => setEditOpen(true)} className="gap-1.5">
        <Pencil className="size-4" />
        <Trans>Edit</Trans>
      </Button>
    </>
  );

  // The share snapshot reads the metric from the stats body; default to the
  // token view whenever token data exists (mirrors the body's own default).
  const tokensAvailable = Boolean(tokens?.available);
  const metric: ActivityMetric =
    pickedMetric === "tokens" && !tokensAvailable
      ? "prompts"
      : (pickedMetric ?? (tokensAvailable ? "tokens" : "prompts"));

  return (
    <div className="mx-auto w-full max-w-[760px] pb-8">
      <div className="flex flex-col gap-8">
        <ProfileHeader
          identity={core.identity}
          devices={data.devices}
          currentDeviceId={data.currentDeviceId}
          selection={data.selection}
          onSelect={data.setSelection}
          actions={headerActions}
        />
        <ProfileStatsBody
          data={data}
          pickedMetric={pickedMetric}
          onPickedMetricChange={setPickedMetric}
        />
      </div>

      <EditProfileDialog
        open={editOpen}
        identity={core.identity}
        onClose={() => setEditOpen(false)}
        onSave={data.saveIdentity}
      />
      <ShareDialog
        open={shareOpen}
        core={core}
        tokens={tokens}
        metric={metric}
        window={data.selection.window}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
