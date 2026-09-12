import { baseAgentKind } from "@/shared/contracts";

function isAuthorizedUsageStatus(status: string | undefined): boolean {
  return status === "ok" || status === "quota-hit" || status === "rate-limited";
}

/**
 * Provider ids that the user has actually added as a CraftStation channel.
 * Installed CLIs alone are not enough — this is the same gate as
 * 「模型与用量 → 管理模型」.
 */
export function resolveConfiguredProviderIds(input: {
  accounts: ReadonlyArray<{
    provider: string;
    providerAccountId?: string | undefined;
    maskedIdentity?: string | undefined;
  }>;
  storedLogin?: Readonly<Record<string, boolean | undefined>>;
  usageSnapshots?: Readonly<
    Record<
      string,
      | {
          status?: string | undefined;
          authenticatedAs?: string | null | undefined;
          plan?: string | null | undefined;
          windows?: ReadonlyArray<unknown> | undefined;
        }
      | undefined
    >
  >;
}): string[] {
  const ids = new Set<string>();
  for (const account of input.accounts) {
    if (account.providerAccountId?.trim() || account.maskedIdentity?.trim()) {
      ids.add(account.provider);
    }
  }
  for (const [id, stored] of Object.entries(input.storedLogin ?? {})) {
    if (stored) ids.add(id);
  }
  for (const [id, snapshot] of Object.entries(input.usageSnapshots ?? {})) {
    if (!snapshot) continue;
    // Same identity bar as the 「模型与用量」 workspace cards: an authorized
    // status or any plan label counts even when the provider exposes no quota
    // windows (OpenCode tracks spend without windows). Otherwise a channel
    // would be manageable in 管理模型 yet invisible in the composer picker.
    if (snapshot.authenticatedAs?.trim() || snapshot.plan?.trim()) ids.add(id);
    if (isAuthorizedUsageStatus(snapshot.status)) ids.add(id);
  }
  return [...ids];
}

export function isConfiguredComposerAgent(
  agentKind: string,
  configuredProviderIds: ReadonlySet<string>,
): boolean {
  return configuredProviderIds.has(baseAgentKind(agentKind));
}
