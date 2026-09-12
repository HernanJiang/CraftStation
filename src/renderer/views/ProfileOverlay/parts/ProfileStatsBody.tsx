import { useLingui } from "@lingui/react/macro";
import type {
  ProfileBreakdownEntry,
  ProfileStatsWindow,
  ProfileTokenProvider,
} from "@/shared/contracts";
import { LightballTabs, type LightballTab } from "@/renderer/components/common";
import type { ProfileData } from "../useProfileData";
import { StatStrip } from "./StatStrip";
import { ActivitySection, type ActivityMetric } from "./ActivitySection";
import { ActivityInsights } from "./ActivityInsights";
import { PluginUsage } from "./PluginUsage";
import { ModelUsage } from "./ModelUsage";
import { BreakdownBars } from "./BreakdownBars";
import { AccountFilter } from "./AccountFilter";
import { AiActions } from "./AiActions";
import { formatCompact } from "../format";

/** Token-weighted bars show compact counts (e.g. "2.8M"); spread when by-tokens. */
const tokenFormat = { formatValue: formatCompact };

/** Reshape a token-weighted provider/account into the generic breakdown entry. */
function toEntry(p: ProfileTokenProvider): ProfileBreakdownEntry {
  return { key: p.provider, label: p.label, count: p.tokens, percent: p.percent };
}

/**
 * The statistics content of the profile page (everything below the identity
 * header): window tabs, token strip, activity heatmap, insights, skills/MCP,
 * provider/model/account/mode breakdowns and AI actions. Shared by Settings →
 * 个人资料 and 模型与用量 → 用量统计 so both surfaces read the same stats
 * source without a second implementation.
 *
 * Layouts: `comfortable` keeps the roomy single/2-column settings page;
 * `compact` rearranges the same components into the denser 3-column
 * usage-stats grid ([insights A] [insights B] [models] / [providers]
 * [skills] [mcps] / [modes] [ai git]) with tighter typography.
 */
export function ProfileStatsBody({
  data,
  pickedMetric,
  onPickedMetricChange,
  layout = "comfortable",
}: {
  data: ProfileData;
  pickedMetric: ActivityMetric | null;
  onPickedMetricChange: (metric: ActivityMetric) => void;
  layout?: "comfortable" | "compact";
}) {
  const { t } = useLingui();
  const { core, tokens, tokensLoading } = data;
  if (!core) return null;

  // Resolve the active metric at render time (not via a post-paint effect) so the
  // breakdown sections never paint the prompt mix for a frame before flipping to
  // tokens. Default to Tokens once token data exists; a user pick wins, but a
  // "tokens" pick downgrades to prompts when the selected scope has no tokens.
  const tokensAvailable = Boolean(tokens?.available);
  const metric: ActivityMetric =
    pickedMetric === "tokens" && !tokensAvailable
      ? "prompts"
      : (pickedMetric ?? (tokensAvailable ? "tokens" : "prompts"));
  const handleMetricChange = (next: ActivityMetric) => onPickedMetricChange(next);
  const windowTabs: ReadonlyArray<LightballTab<ProfileStatsWindow>> = [
    { id: "7d", label: t`7d` },
    { id: "30d", label: t`30d` },
    { id: "all", label: t`All` },
  ];

  // Follow the Prompts/Tokens toggle for the breakdown sections: token-weighted
  // when "tokens" is active and token data exists, else prompt-weighted activity
  // (which also covers every provider incl. all ACP agents).
  const metricIsTokens = metric === "tokens" && Boolean(tokens?.available);

  const providersByTokens = metricIsTokens && tokens!.providers.length > 0;
  const providerEntries = providersByTokens ? tokens!.providers.map(toEntry) : core.providers;

  // Per-account (per-profile) usage - only worth showing when the user actually
  // has multiple accounts/profiles (an account key carries an instance suffix).
  const accountsByTokens = metricIsTokens && tokens!.accounts.length > 0;
  const accountEntries = accountsByTokens ? tokens!.accounts.map(toEntry) : core.accounts;
  // With a single account selected the breakdown collapses to one 100% bar for
  // the account already named in the filter, so only show it when unfiltered.
  const hasMultipleAccounts =
    !data.selection.provider && accountEntries.some((a) => a.key.includes(":"));

  // Per-account filter (whole page) - only when more than one account exists.
  const accountFilter =
    core.availableAccounts.length > 1 ? (
      <AccountFilter
        value={data.selection.provider}
        options={core.availableAccounts}
        onChange={(provider) =>
          data.setSelection({
            scope: data.selection.scope,
            window: data.selection.window,
            ...(data.selection.deviceId ? { deviceId: data.selection.deviceId } : {}),
            ...(provider ? { provider } : {}),
          })
        }
      />
    ) : null;

  const modelUsage = (
    <ModelUsage
      tokens={tokens}
      coreModels={core.models}
      tokensLoading={tokensLoading}
      metric={metric}
      compact={layout === "compact"}
    />
  );
  const providersBars = (
    <BreakdownBars
      title={t`Providers`}
      caption={providersByTokens ? t`by tokens` : t`by prompts`}
      entries={providerEntries}
      loading={tokensLoading && !tokens}
      loadingRows={Math.min(4, Math.max(1, core.providers.length || 4))}
      emptyText={t`No activity yet.`}
      compact={layout === "compact"}
      {...(providersByTokens ? tokenFormat : {})}
    />
  );
  const skillsUsage = (
    <PluginUsage
      items={core.skills}
      title={t`Skills`}
      emptyText={t`No skills used yet.`}
      compact={layout === "compact"}
    />
  );
  const mcpUsage = (
    <PluginUsage
      items={core.mcps}
      title={t`MCP servers`}
      emptyText={t`No MCP tools used yet.`}
      compact={layout === "compact"}
    />
  );
  // Modes only ever carry CraftStation's own auto/efficient/creative craft
  // modes (the backend ignores legacy chat/CLI presentation rows) with
  // per-prompt counts and shares.
  const modesBars = (
    <BreakdownBars
      title={t`Modes`}
      caption={t`per prompt`}
      entries={core.modes}
      emptyText={t`No mode usage yet.`}
      compact={layout === "compact"}
    />
  );
  const gitActions = <AiActions actions={core.aiActions} compact={layout === "compact"} />;
  const accountsBars = hasMultipleAccounts ? (
    <BreakdownBars
      title={t`Accounts`}
      caption={accountsByTokens ? t`by tokens` : t`by prompts`}
      entries={accountEntries}
      limit={12}
      compact={layout === "compact"}
      {...(accountsByTokens ? tokenFormat : {})}
    />
  ) : null;

  if (layout === "compact") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-3">
            {accountFilter}
            <LightballTabs
              tabs={windowTabs}
              active={data.selection.window}
              onChange={(window) => data.setSelection({ ...data.selection, window })}
              ariaLabel={t`Profile stats range`}
              className="w-[180px]"
              equalWidth
              shape="rounded"
            />
          </div>
          <StatStrip
            core={core}
            tokens={tokens}
            tokensLoading={tokensLoading}
            window={data.selection.window}
            compact
          />
        </div>
        <ActivitySection
          promptHeatmap={core.promptHeatmap}
          tokenHeatmap={tokens?.tokenHeatmap ?? null}
          tokensAvailable={tokens?.available ?? false}
          metric={metric}
          onMetricChange={handleMetricChange}
          compact
        />
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
          <ActivityInsights core={core} split compact />
          {modelUsage}
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-3">
          {providersBars}
          {skillsUsage}
          {mcpUsage}
        </div>
        {accountsBars}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {modesBars}
          {gitActions}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-center gap-3">
          {accountFilter}
          <LightballTabs
            tabs={windowTabs}
            active={data.selection.window}
            onChange={(window) => data.setSelection({ ...data.selection, window })}
            ariaLabel={t`Profile stats range`}
            className="w-[180px]"
            equalWidth
            shape="rounded"
          />
        </div>
        <StatStrip
          core={core}
          tokens={tokens}
          tokensLoading={tokensLoading}
          window={data.selection.window}
        />
      </div>
      <ActivitySection
        promptHeatmap={core.promptHeatmap}
        tokenHeatmap={tokens?.tokenHeatmap ?? null}
        tokensAvailable={tokens?.available ?? false}
        metric={metric}
        onMetricChange={handleMetricChange}
      />
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
        <ActivityInsights core={core} className="sm:col-span-2" />
        {skillsUsage}
        {mcpUsage}
      </div>
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
        {providersBars}
        {modelUsage}
      </div>
      {accountsBars}
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
        {modesBars}
        {gitActions}
      </div>
    </div>
  );
}
