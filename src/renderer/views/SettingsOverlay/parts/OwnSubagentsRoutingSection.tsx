import { useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { toast } from "@heroui/react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { OWN_SUBAGENTS_NATIVE_ROUTE_ID } from "@/shared/settings";
import { isRemoteSession, readBridge } from "@/renderer/bridge";
import { Button, TextArea } from "@/renderer/components/common";
import { distinctSubProviderLabel } from "@/renderer/components/common/ProviderModelMenu";
import { useAgentStatusesStore } from "@/renderer/state/agentStatusesStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import type {
  CrossagentRoutingSnapshotEntry,
  CrossagentRoutingState,
} from "@/shared/crossagentRanking";
import { presentedCrossagentCapabilities } from "@/shared/crossagentVisibility";
import { formatReasoningLabel } from "@/shared/modelLabels";
import { OwnSubagentsMemorySection } from "./ownSubagents/OwnSubagentsMemorySection";
import { OwnSubagentsProviderModelFilter } from "./ownSubagents/OwnSubagentsProviderModelFilter";
import { OwnSubagentsRankedRow } from "./ownSubagents/OwnSubagentsRankedRow";

/**
 * Own Subagents routing settings: the user-ordered route (native-harness
 * lane first by default) with the live ranked (provider, model) order, one
 * global provider/model checklist (unchecked providers and models are
 * skipped by Own Subagents), the editable learned routing memory,
 * user-pinned task routes, and the free-text routing guide appended to the
 * Own Subagents MCP instructions.
 */
export function OwnSubagentsRoutingSection() {
  const { t } = useLingui();
  const ownSubagentRoutingGuide = useSharedSettings((s) => s.ownSubagentRoutingGuide);
  const ownSubagentSelectionUsage = useSharedSettings((s) => s.ownSubagentSelectionUsage);
  const ownSubagentRoutingOverrides = useSharedSettings((s) => s.ownSubagentRoutingOverrides);
  const ownSubagentPausedProviders = useSharedSettings((s) => s.ownSubagentPausedProviders);
  const ownSubagentHiddenModels = useSharedSettings((s) => s.ownSubagentHiddenModels);
  const ownSubagentsRouteOrder = useSharedSettings((s) => s.ownSubagentsRouteOrder);
  const setOwnSubagentsRouteOrder = useSharedSettings((s) => s.setOwnSubagentsRouteOrder);
  const agentSelectionUsage = useSharedSettings((s) => s.agentSelectionUsage);
  const favoriteModels = useSharedSettings((s) => s.favoriteModels);
  const disabledAgents = useSharedSettings((s) => s.disabledAgents);
  const hiddenModels = useSharedSettings((s) => s.hiddenModels);
  const statuses = useAgentStatusesStore((s) => s.agentStatuses);
  const setOwnSubagentRoutingGuide = useSharedSettings((s) => s.setOwnSubagentRoutingGuide);
  const [draft, setDraft] = useState(ownSubagentRoutingGuide);
  const [routing, setRouting] = useState<CrossagentRoutingState>({ ranked: [], providers: [] });
  const [removingRoute, setRemovingRoute] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Eligible providers missing from the ranked order were excluded by the
  // user's checklist (paused, or every model unchecked) — keep them glanceable
  // while the popover is closed.
  const rankedProviderKinds = new Set(routing.ranked.map((entry) => entry.provider));
  const skippedProviderNames = routing.providers
    .filter((provider) => !rankedProviderKinds.has(provider.kind))
    .map((provider) => provider.label);

  // Ranked rows are per-model, so resolve each provider's presented capability
  // once instead of rebuilding it for every row.
  const capabilitiesByKind = new Map(
    routing.providers.flatMap((provider) => {
      const status = statuses.find((candidate) => candidate.kind === provider.kind);
      if (!status) return [];
      return [
        [
          provider.kind,
          presentedCrossagentCapabilities(provider.execution, status.capabilities),
        ] as const,
      ];
    }),
  );

  // Aggregator providers (OpenCode, Command Code, …) expose same-label models
  // from different sub-providers; surface the sub-provider to tell them apart.
  function subProviderLabelFor(entry: CrossagentRoutingSnapshotEntry): string | undefined {
    const capabilities = capabilitiesByKind.get(entry.provider);
    if (!capabilities) return undefined;
    return distinctSubProviderLabel(entry.model.id, capabilities, entry.label);
  }

  function providerLabelFor(kind: string): string {
    return (
      routing.providers.find((provider) => provider.kind === kind)?.label ??
      statuses.find((status) => status.kind === kind)?.label ??
      kind
    );
  }
  useEffect(() => {
    let active = true;
    void readBridge()
      .getOwnSubagentsRouting()
      .then((state) => {
        if (active) setRouting(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    statuses,
    disabledAgents,
    hiddenModels,
    ownSubagentPausedProviders,
    ownSubagentHiddenModels,
    ownSubagentSelectionUsage,
    ownSubagentRoutingOverrides,
    ownSubagentsRouteOrder,
    agentSelectionUsage,
    favoriteModels,
  ]);

  async function removePinnedRoute(tags: string[]) {
    const key = tags.join(" ");
    setRemovingRoute(key);
    try {
      const nextOverrides = await readBridge().removeOwnSubagentsRoutingOverride({
        tags,
      });
      useSharedSettings.setState({ ownSubagentRoutingOverrides: nextOverrides });
    } catch {
      toast.danger(t`Unable to remove pinned route.`);
    } finally {
      setRemovingRoute(null);
    }
  }

  // Provider-level display order: unique provider kinds in ranked order (the
  // snapshot already applies the persisted user order), with the
  // non-removable native lane spliced at its persisted position.
  const providerSequence: string[] = [];
  for (const entry of routing.ranked) {
    if (!providerSequence.includes(entry.provider)) providerSequence.push(entry.provider);
  }
  const nativeStoredIndex = ownSubagentsRouteOrder.findIndex(
    (entry) => entry === OWN_SUBAGENTS_NATIVE_ROUTE_ID,
  );
  const nativePosition =
    nativeStoredIndex < 0
      ? 0
      : Math.min(nativeStoredIndex, providerSequence.length);
  const displaySlots: Array<{ id: string; kind: "native" | "provider" }> = [
    ...providerSequence.slice(0, nativePosition).map((id) => ({ id, kind: "provider" as const })),
    { id: OWN_SUBAGENTS_NATIVE_ROUTE_ID, kind: "native" as const },
    ...providerSequence.slice(nativePosition).map((id) => ({ id, kind: "provider" as const })),
  ];

  function persistSlots(slots: Array<{ id: string }>): void {
    // Keep persisted entries for temporarily unavailable providers appended
    // (stable), so a quota-paused provider does not lose its position.
    const ordered = slots.map((slot) => slot.id);
    for (const stored of ownSubagentsRouteOrder) {
      if (!ordered.includes(stored)) ordered.push(stored);
    }
    setOwnSubagentsRouteOrder(ordered);
  }

  function moveSlot(id: string, direction: -1 | 1): void {
    const index = displaySlots.findIndex((slot) => slot.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= displaySlots.length) return;
    const slots = [...displaySlots];
    const [moved] = slots.splice(index, 1);
    slots.splice(next, 0, moved!);
    persistSlots(slots);
  }

  function moveSlotTo(id: string, toIndex: number): void {
    const index = displaySlots.findIndex((slot) => slot.id === id);
    if (index < 0 || index === toIndex) return;
    const slots = [...displaySlots];
    const [moved] = slots.splice(index, 1);
    slots.splice(Math.max(0, Math.min(toIndex, slots.length)), 0, moved!);
    persistSlots(slots);
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">
            <Trans>Sub-agent route order</Trans>
          </p>
          <OwnSubagentsProviderModelFilter providers={routing.providers} />
        </div>
        <p className="text-xs text-muted">
          <Trans>
            Agents classify delegated work with task tags. Explicit per-call values and manual
            task routes rank first, followed by this order, then matching learned routes, global
            usage, normal agent usage and favorites, and built-in order. Drag rows or use the
            arrows to reorder; the native lane cannot be removed.
          </Trans>
        </p>
        {displaySlots.length > 0 ? (
          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {displaySlots.map((slot, slotIndex) =>
              slot.kind === "native" ? (
                <div
                  key={OWN_SUBAGENTS_NATIVE_ROUTE_ID}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", OWN_SUBAGENTS_NATIVE_ROUTE_ID);
                    event.dataTransfer.effectAllowed = "move";
                    setDragId(OWN_SUBAGENTS_NATIVE_ROUTE_ID);
                  }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(event) => {
                    if (dragId && dragId !== OWN_SUBAGENTS_NATIVE_ROUTE_ID) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = event.dataTransfer.getData("text/plain") || dragId;
                    if (source) moveSlotTo(source, slotIndex);
                    setDragId(null);
                  }}
                  className={`flex items-center gap-2 border-b border-border bg-accent-soft/40 px-3 py-2 last:border-b-0 ${
                    dragId === OWN_SUBAGENTS_NATIVE_ROUTE_ID ? "opacity-50" : ""
                  }`}
                >
                  <GripVertical
                    aria-hidden="true"
                    className="size-3.5 shrink-0 cursor-grab text-muted"
                  />
                  <span className="w-7 shrink-0 text-xs font-medium tabular-nums text-muted">
                    #{slotIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">
                      <Trans>Current harness native subagent</Trans>
                    </p>
                    <p className="truncate text-xs text-muted">
                      <Trans>Native · Default — hands back to this harness's own subagent loop</Trans>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={t`Move native lane up`}
                      isDisabled={slotIndex === 0}
                      onPress={() => moveSlot(OWN_SUBAGENTS_NATIVE_ROUTE_ID, -1)}
                    >
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={t`Move native lane down`}
                      isDisabled={slotIndex === displaySlots.length - 1}
                      onPress={() => moveSlot(OWN_SUBAGENTS_NATIVE_ROUTE_ID, 1)}
                    >
                      <ArrowDown className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div key={`provider:${slot.id}`}>
                  <div className="flex items-center gap-2 border-b border-border bg-surface-secondary/40 px-3 py-1.5">
                    <GripVertical
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                      {providerLabelFor(slot.id)}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={t`Move ${providerLabelFor(slot.id)} up`}
                        isDisabled={slotIndex === 0}
                        onPress={() => moveSlot(slot.id, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={t`Move ${providerLabelFor(slot.id)} down`}
                        isDisabled={slotIndex === displaySlots.length - 1}
                        onPress={() => moveSlot(slot.id, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {routing.ranked
                    .filter((entry) => entry.provider === slot.id)
                    .map((entry) => {
                      const subProviderLabel = subProviderLabelFor(entry);
                      return (
                        <div
                          key={`${entry.provider}:${entry.model.id}`}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/plain", slot.id);
                            event.dataTransfer.effectAllowed = "move";
                            setDragId(slot.id);
                          }}
                          onDragEnd={() => setDragId(null)}
                          onDragOver={(event) => {
                            if (dragId && dragId !== slot.id) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const source = event.dataTransfer.getData("text/plain") || dragId;
                            if (source) moveSlotTo(source, slotIndex);
                            setDragId(null);
                          }}
                          className={dragId === slot.id ? "opacity-50" : ""}
                        >
                          <OwnSubagentsRankedRow
                            entry={entry}
                            rank={slotIndex + 1}
                            {...(subProviderLabel ? { subProviderLabel } : {})}
                          />
                        </div>
                      );
                    })}
                </div>
              ),
            )}
          </div>
        ) : null}
        {routing.ranked.length > 0 ? null : (
          <p className="text-xs text-muted">
            <Trans>No spawnable providers right now — the native lane still applies.</Trans>
          </p>
        )}
        {skippedProviderNames.length > 0 ? (
          <p className="text-xs text-muted">
            {t`Skipped by Own Subagents: ${skippedProviderNames.join(", ")}`}
          </p>
        ) : null}
        <p className="text-xs text-muted">
          <Trans>
            Anything currently unavailable — a provider, model, reasoning level, or Fast mode — is
            skipped automatically. Unchecked providers and models are skipped until re-checked.
          </Trans>
        </p>
        {ownSubagentRoutingOverrides.length > 0 ? (
          <div className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">
                <Trans>Pinned task routes</Trans>
              </p>
              <p className="text-xs text-muted">
                <Trans>
                  Manual routes override learned routing whenever all of their task tags match.
                </Trans>
              </p>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              {ownSubagentRoutingOverrides.map((override) => {
                const key = override.tags.join(" ");
                const routeDetail = [
                  override.agentKind,
                  override.modelId,
                  ...(override.effort ? [formatReasoningLabel(override.effort)] : []),
                  ...(override.fast === true ? [t`Fast`] : []),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const providerAvailable = rankedProviderKinds.has(override.agentKind);
                const tagLabel = override.tags.map((tag) => `#${tag}`).join(" + ");
                return (
                  <div
                    key={key}
                    className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-foreground">{tagLabel}</p>
                      <p className="truncate text-xs text-muted">
                        {routeDetail}
                        {!providerAvailable ? ` · ${t`Unavailable provider`}` : null}
                      </p>
                    </div>
                    {!isRemoteSession() ? (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        aria-label={t`Remove pinned route for ${tagLabel}`}
                        isPending={removingRoute === key}
                        onPress={() => void removePinnedRoute(override.tags)}
                      >
                        <Trash2 className="size-3.5 text-danger" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
      <OwnSubagentsMemorySection />
      <section className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          <Trans>Own Subagents routing guide</Trans>
        </p>
        <p className="text-xs text-muted">
          <Trans>
            Instructions agents follow when choosing which agent or model to delegate to.
          </Trans>
        </p>
        <TextArea
          aria-label={t`Own Subagents routing guide`}
          className="w-full text-xs"
          rows={4}
          placeholder={t`e.g. Codex GPT-5.5 fast for quick lookups, OpenCode GLM for bulk refactors, Claude Opus for anything subtle.`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setOwnSubagentRoutingGuide(draft.trim())}
        />
      </section>
    </div>
  );
}
