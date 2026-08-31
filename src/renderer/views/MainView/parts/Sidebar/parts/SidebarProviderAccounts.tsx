import { Settings2 } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { useShallow } from "zustand/shallow";
import {
  USAGE_PROVIDERS,
  type UsageProvider,
} from "@/renderer/components/providers/usageProviders";
import { useProviderUsageStore } from "@/renderer/state/providerUsageStore";
import { usePanelStore } from "@/renderer/state/panelStore";
import type { UsageStatus } from "@/shared/contracts";
import { ProviderBrandBadge, providerLabel } from "./providerBrands";

const PREFERRED_PROVIDER_ORDER = [
  "codex",
  "claude",
  "gemini",
  "copilot",
  "cursor",
  "grok",
  "kimi",
] as const;

const DEFAULT_AVATAR_PROVIDER_IDS = ["codex", "claude", "gemini"] as const;
const AUTHORIZED_USAGE_STATUSES = new Set<UsageStatus>([
  "ok",
  "app-not-running",
  "rate-limited",
  "quota-hit",
  "error",
]);

function isAuthorizedUsageStatus(status: UsageStatus | undefined): boolean {
  return status !== undefined && AUTHORIZED_USAGE_STATUSES.has(status);
}

function sortProviders(providers: ReadonlyArray<UsageProvider>): UsageProvider[] {
  const priority = new Map<string, number>(
    PREFERRED_PROVIDER_ORDER.map((id, index) => [id, index]),
  );
  return [...providers].sort((left, right) => {
    const leftPriority = priority.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priority.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.label.localeCompare(right.label);
  });
}

const SORTED_USAGE_PROVIDERS = sortProviders(USAGE_PROVIDERS);

function AuthorizedModelsAvatarGroup() {
  const authorizedProviderIds = useProviderUsageStore(
    useShallow((state) =>
      SORTED_USAGE_PROVIDERS.flatMap((provider) =>
        isAuthorizedUsageStatus(state.snapshots[provider.id]?.status) ? [provider.id] : [],
      ),
    ),
  );
  const providerIds =
    authorizedProviderIds.length > 0 ? authorizedProviderIds : [...DEFAULT_AVATAR_PROVIDER_IDS];
  const visibleProviderIds = providerIds.slice(0, 3);
  const overflowCount = providerIds.length - visibleProviderIds.length;

  return (
    <span className="flex shrink-0 items-center" aria-hidden="true">
      {visibleProviderIds.map((id, index) => (
        <ProviderBrandBadge
          key={id}
          id={id}
          label={providerLabel(
            id,
            SORTED_USAGE_PROVIDERS.find((provider) => provider.id === id)?.label,
          )}
          size="avatar"
          stackIndex={index}
        />
      ))}
      {overflowCount > 0 ? (
        <span
          className="-ml-1.5 flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-[#121214] bg-[#292A30] text-[8px] font-semibold text-neutral-300"
          title={`另有 ${overflowCount} 个已授权模型`}
          style={{ zIndex: 6 }}
        >
          +{overflowCount}
        </span>
      ) : null}
    </span>
  );
}

export function SidebarProviderAccounts() {
  const { t } = useLingui();

  return (
    <>
      <div className="shrink-0 border-t border-[var(--hairline)] px-1 pb-1 pt-1.5">
        <div className="flex items-center gap-1 rounded-xl py-1">
          <button
            type="button"
            onClick={() => usePanelStore.getState().openModelUsageDialog()}
            aria-label={t`Provider accounts`}
            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--row-hover)]"
          >
            <AuthorizedModelsAvatarGroup />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-neutral-200 transition-colors group-hover:text-white">
                模型与用量
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-neutral-400 transition-colors group-hover:text-neutral-200">
                ✨ 添加新模型
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label={t`Settings`}
            onClick={() => usePanelStore.getState().openSettings()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[11px] text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            <span>{t`Settings`}</span>
          </button>
        </div>
      </div>
    </>
  );
}
