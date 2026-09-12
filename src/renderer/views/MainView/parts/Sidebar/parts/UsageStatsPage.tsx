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

/**
 * 模型与用量 → 用量统计：个人资料 Header（与设置 → 个人资料同一组件）+
 * 紧凑三列统计主体（与个人资料页同一数据源、同一套统计组件，
 * `ProfileStatsBody layout="compact"`，不另起一套统计逻辑）。
 */
export function UsageStatsPage() {
  const { t } = useLingui();
  const data = useProfileData();
  const [pickedMetric, setPickedMetric] = useState<ActivityMetric | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { core, coreLoading, tokens } = data;
  // Sharing takes a native clipboard screenshot of the page
  // (copyShareImage), which has no remote equivalent; hide the affordance
  // rather than surface a dead button (mirrors ProfileSettings).
  const remote = isRemoteSession();

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
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="usage-stats-page">
      <div className="mx-auto w-full max-w-[1024px] px-4 py-4 pb-8">
        {coreLoading && !core ? (
          <div className="flex h-64 items-center justify-center">
            <PixelLoader size="lg" />
          </div>
        ) : !core ? (
          <div className="flex h-64 items-center justify-center px-6 text-center text-sm text-muted">
            {data.error ?? t`Couldn't load your usage stats.`}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
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
              layout="compact"
            />
          </div>
        )}
      </div>

      {core ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
