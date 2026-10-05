import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileAtomic } from "@/shared/atomicFile";
import {
  accountStatusSchema,
  AccountControlError,
  type AccountCredentialProjection,
  type AccountMutationInput,
  type AccountRecord,
  type AccountQuotaWindow,
  type AccountSchedulingMode,
  type AccountStatus,
  type AccountView,
  type ProviderPoolConfig,
} from "@/shared/contracts";
import { isOpenCodePrivateRuntimeEnvironmentKey } from "./privateRuntimeEnvironment";
import { blockingWindow } from "@craftstation/agents-usage";
import { classifyCodexPoolQuotaError } from "../agents/codex/sessionErrors";

interface AccountFile {
  version: 2;
  accounts: AccountRecord[];
  /** Provider pool scheduling state (v0.5). Missing pool = default priority. */
  pools?: Record<string, ProviderPoolConfig>;
}

const ACCOUNT_FILE_VERSION = 2 as const;
const LOCK_STALE_MS = 30_000;
interface LockHandle {
  fd: number;
  path: string;
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value)) {
    throw new AccountControlError(
      "ACCOUNT_PATH_INVALID",
      "Account identifier is not a safe path segment.",
      {
        accountId: value,
      },
    );
  }
  return value;
}

function assertInside(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new AccountControlError(
      "ACCOUNT_PATH_INVALID",
      "Account path escapes the managed root.",
      {
        root: resolvedRoot,
        candidate: resolvedCandidate,
      },
    );
  }
  return resolvedCandidate;
}

function isPlaceholderLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "new grok" ||
    normalized === "new codex" ||
    normalized === "new account"
  );
}

function defaultProviderAccountLabel(provider: string): string {
  const display = provider
    .split(/[-_:]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return display || "Account";
}

/** Normalize provider identities for stable matching across imports/probes. */
export function normalizeProviderIdentity(identity: string | undefined): string | undefined {
  const normalized = identity?.trim().toLowerCase();
  return normalized || undefined;
}

export function maskIdentity(identity: string | undefined): string | undefined {
  if (!identity) return undefined;
  if (identity.includes("@")) {
    const [local, domain] = identity.split("@", 2);
    const normalizedLocal = local ?? "";
    if (normalizedLocal.includes("***")) return identity;
    const visibleLocal =
      normalizedLocal.length < 6
        ? normalizedLocal
        : `${normalizedLocal.slice(0, 3)}***${normalizedLocal.slice(-3)}`;
    return `${visibleLocal}@${domain ?? ""}`;
  }
  return identity.length < 6 ? identity : `${identity.slice(0, 3)}***${identity.slice(-3)}`;
}

// User acceptance contract: Grok account rows must show the FULL email
// (邮箱全称), never a masked alias. Other providers keep the masked form.
const displayIdentity = (provider: string, identity: string | undefined) =>
  provider === "grok" ? identity : maskIdentity(identity);

function normalizeLegacyAccount(account: AccountRecord): boolean {
  const hasOfficialIdentity =
    account.provider === "grok" &&
    (Boolean(account.providerAccountId?.includes("@")) ||
      Boolean(account.maskedIdentity?.includes("@")));
  if (!hasOfficialIdentity) return false;
  let changed = false;
  const full = account.providerAccountId ?? account.maskedIdentity;
  const display = displayIdentity(account.provider, full);
  if (display && account.maskedIdentity !== display) {
    account.maskedIdentity = display;
    changed = true;
  }
  if (account.label === "New Grok" && account.providerAccountId?.includes("@")) {
    const local = account.providerAccountId.split("@", 1)[0] ?? "";
    const defaultLabel = local.slice(0, 3) || "Grok";
    if (account.label !== defaultLabel) {
      account.label = defaultLabel;
      changed = true;
    }
  }
  // Older builds treated selection as an exclusive enable switch. Recover
  // only that legacy marker when an official Grok identity is present. Keep
  // real quota/auth failure states untouched and never change selection.
  if (account.enabled === false && account.status === "disabled") {
    account.enabled = true;
    account.status = "available";
    changed = true;
  }
  return changed;
}

export class AccountStore {
  readonly managedRoot: string;
  private readonly metadataPath: string;
  private readonly lockPath: string;

  constructor(rootDir: string) {
    this.managedRoot = resolve(rootDir);
    this.metadataPath = join(this.managedRoot, "accounts.json");
    this.lockPath = join(this.managedRoot, "accounts.lock");
    mkdirSync(this.managedRoot, { recursive: true });
    this.migrateLegacyMetadata();
  }

  list(provider?: string): AccountView[] {
    this.sweepQuotaExpiryLazily(provider);
    this.scrubIdentityLessAccounts(provider);
    return this.read()
      .accounts.filter((account) => provider === undefined || account.provider === provider)
      .sort((left, right) => left.order - right.order)
      .map((account) => this.toView(account));
  }

  get(accountId: string): AccountView | undefined {
    this.sweepQuotaExpiryLazily();
    const account = this.read().accounts.find((entry) => entry.accountId === accountId);
    return account ? this.toView(account) : undefined;
  }

  getRecord(accountId: string): AccountRecord | undefined {
    this.sweepQuotaExpiryLazily();
    return this.read().accounts.find((entry) => entry.accountId === accountId);
  }

  records(provider?: string): AccountRecord[] {
    this.sweepQuotaExpiryLazily(provider);
    return this.read()
      .accounts.filter((account) => provider === undefined || account.provider === provider)
      .sort((left, right) => left.order - right.order);
  }

  /**
   * Read-path quota convergence. A contended lock means another mutation is
   * already in flight — serve the read from the last written state instead of
   * failing it; the next read sweeps again.
   */
  private sweepQuotaExpiryLazily(provider?: string): void {
    try {
      this.reconcileQuotaExpiry(provider);
    } catch (error) {
      if (error instanceof AccountControlError && error.code === "ACCOUNT_LOCKED") return;
      throw error;
    }
  }

  /** Effective pool scheduling config for a provider (defaults to priority). */
  poolConfig(provider: string): ProviderPoolConfig {
    const file = this.read();
    const pool = (file.pools ?? {})[provider];
    if (pool && pool.scheduling) return pool;
    return { scheduling: "priority" };
  }

  /** Persist a provider pool scheduling mode and reset the round-robin cursor. */
  setPoolSchedulingMode(provider: string, scheduling: AccountSchedulingMode): ProviderPoolConfig {
    return this.withMetadataMutation((file) => {
      file.pools ??= {};
      file.pools[provider] = { scheduling };
      return { scheduling };
    });
  }

  /** Persist the round-robin cursor after a pick (keeps scheduling mode). */
  advanceRoundRobinCursor(provider: string, accountId: string): void {
    this.withMetadataMutation((file) => {
      file.pools ??= {};
      const current = file.pools[provider];
      file.pools[provider] = {
        scheduling: current?.scheduling ?? "priority",
        roundRobinCursor: accountId,
      };
    });
  }

  /** Reset the persisted round-robin cursor for a provider. */
  resetRoundRobinCursor(provider: string): void {
    this.withMetadataMutation((file) => {
      file.pools ??= {};
      const current = file.pools[provider];
      if (current) {
        file.pools[provider] = { scheduling: current.scheduling ?? "priority" };
      }
    });
  }

  selectedAccount(provider: string): AccountRecord | undefined {
    return this.records(provider).find((account) => account.selected);
  }

  add(input: AccountMutationInput): AccountView {
    const provider = input.provider.trim();
    const rawLabel = input.label.trim();
    return this.withMetadataMutation((file) => {
      const providerAccounts = file.accounts.filter((account) => account.provider === provider);
      // v0.5 default alias contract: placeholder labels ("New Grok" etc.) are
      // rewritten to "<Provider> Account N" so every row shows a stable, editable
      // alias secondary to the real identity. Explicit user labels are kept.
      const label = isPlaceholderLabel(rawLabel)
        ? `${defaultProviderAccountLabel(provider)} ${providerAccounts.length + 1}`
        : rawLabel;
      if (!provider || !label)
        throw new AccountControlError("ACCOUNT_CORRUPT", "Provider and label are required.");
      const accountId = `${safeSegment(provider)}:${randomUUID()}`;
      // The logical identity may contain `:` but a physical Windows directory
      // must not. Keep the profile directory opaque and independently validated.
      const profileDirectory = `profile-${randomUUID()}`;
      const accountRoot = assertInside(this.managedRoot, join(this.managedRoot, profileDirectory));
      const record: AccountRecord = {
        accountId,
        provider,
        label,
        ...(input.maskedIdentity
          ? {
              maskedIdentity:
                displayIdentity(provider, input.maskedIdentity) ?? input.maskedIdentity,
            }
          : {}),
        ...(input.plan ? { plan: input.plan } : {}),
        ...(input.providerAccountId ? { providerAccountId: input.providerAccountId } : {}),
        createdAt: Date.now(),
        enabled: input.enabled ?? true,
        selected: providerAccounts.length === 0,
        order: providerAccounts.length,
        status: "unavailable",
        credentialScopeRef: input.credentialScopeRef ?? `managed:${accountId}`,
        credentialRoot: accountRoot,
      };
      mkdirSync(accountRoot, { recursive: true });
      file.accounts.push(record);
      return this.toView(record);
    });
  }

  remove(accountId: string): void {
    const removed = this.withMetadataMutation((file) => {
      const account = file.accounts.find((entry) => entry.accountId === accountId);
      if (!account)
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      file.accounts = file.accounts.filter((entry) => entry.accountId !== accountId);
      this.reindex(file, account.provider);
      if (account.selected) {
        const next = file.accounts
          .filter((entry) => entry.provider === account.provider && entry.enabled)
          .sort((left, right) => left.order - right.order)[0];
        if (next) next.selected = true;
      }
      return account;
    });
    const root = this.rebaseEscapedRoot(removed.credentialRoot);
    // The metadata row is already deleted. Only delete a directory inside the
    // managed root: a legacy absolute path that points elsewhere is never
    // touched, and a missing directory is simply gone.
    if (root) rmSync(root, { recursive: true, force: true });
  }

  setEnabled(accountId: string, enabled: boolean): AccountView {
    return this.withMetadataMutation((file) => {
      const account = file.accounts.find((entry) => entry.accountId === accountId);
      if (!account)
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      account.enabled = enabled;
      account.status = enabled
        ? account.status === "disabled"
          ? "available"
          : account.status
        : "disabled";
      if (!enabled && account.selected) {
        account.selected = false;
        const next = file.accounts
          .filter((entry) => entry.provider === account.provider && entry.enabled)
          .sort((left, right) => left.order - right.order)[0];
        if (next) next.selected = true;
      }
      return this.toView(account);
    });
  }

  rename(accountId: string, label: string): AccountView {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      throw new AccountControlError("ACCOUNT_CORRUPT", "Account name cannot be empty.");
    }
    if (normalizedLabel.length > 120) {
      throw new AccountControlError("ACCOUNT_CORRUPT", "Account name is too long.");
    }
    return this.update(accountId, (account) => {
      account.label = normalizedLabel;
    });
  }

  select(accountId: string): AccountView {
    return this.withMetadataMutation((file) => {
      const selected = file.accounts.find((account) => account.accountId === accountId);
      if (!selected)
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      for (const account of file.accounts) {
        if (account.provider === selected.provider)
          account.selected = account.accountId === accountId;
      }
      return this.toView(selected);
    });
  }

  reorder(provider: string, orderedAccountIds: string[]): AccountView[] {
    this.withMetadataMutation((file) => {
      const accounts = file.accounts.filter((account) => account.provider === provider);
      const known = new Set(accounts.map((account) => account.accountId));
      if (
        orderedAccountIds.length !== accounts.length ||
        orderedAccountIds.some((id) => !known.has(id))
      ) {
        throw new AccountControlError(
          "ACCOUNT_CORRUPT",
          "Account order must contain each provider account exactly once.",
        );
      }
      const order = new Map(orderedAccountIds.map((id, index) => [id, index]));
      for (const account of accounts) account.order = order.get(account.accountId)!;
    });
    return this.list(provider);
  }

  updateStatus(
    accountId: string,
    status: AccountStatus,
    details?: { lastError?: string; lastQuotaAt?: number },
  ): AccountView {
    accountStatusSchema.parse(status);
    return this.update(accountId, (account) => {
      account.status = status;
      if (details?.lastError !== undefined) {
        account.lastError = details.lastError;
        // A fresh flat error write is not axis evidence — stale axis
        // provenance must not describe a mark it did not produce.
        delete account.lastQuotaAxis;
        delete account.lastQuotaResetsAt;
      }
      if (details?.lastQuotaAt !== undefined) account.lastQuotaAt = details.lastQuotaAt;
      // Only a healthy transition clears the last observed error. A
      // degraded-state write that omits it (e.g. the quota poller refreshing
      // an inference-marked row) must not erase the evidence
      // `shouldPreserveInferenceExhaustion` discriminates on — losing
      // `lastError` turns a 6h-protected inference mark back into a
      // poller-owned row the next healthy-looking probe flips to `available`,
      // which then re-elects the dead account and burns the failover chain.
      if (details?.lastError === undefined && (status === "available" || status === "quota-low")) {
        delete account.lastError;
        delete account.lastQuotaAxis;
        delete account.lastQuotaResetsAt;
      }
    });
  }

  updateQuota(accountId: string, quotaWindows: AccountQuotaWindow[]): AccountView {
    return this.update(accountId, (account) => {
      this.clearSpentQuotaMark(account, quotaWindows);
      account.quotaWindows = quotaWindows.map((window) => ({ ...window }));
    });
  }

  /**
   * An inferred axis block owns its mark's evidence lifecycle: once the last
   * inferred window leaves the row — superseded by fresh axis data or elapsed
   * past its advertised reset — the mark is spent. Without this clear, a bare
   * `lastError`+`lastQuotaAt` pair stretches the dead mark back out to the
   * 6h TTL even though fresh axis data already proved recovery.
   */
  private clearSpentQuotaMark(
    account: AccountRecord,
    nextWindows: readonly AccountQuotaWindow[],
  ): void {
    const hadInferred = (account.quotaWindows ?? []).some((window) => window.inferred === true);
    if (!hadInferred) return;
    if (nextWindows.some((window) => window.inferred === true)) return;
    delete account.lastError;
    delete account.lastQuotaAxis;
    delete account.lastQuotaResetsAt;
  }

  /**
   * Mark one quota axis exhausted from a turn-time error. The block lands as
   * an `inferred` `quotaWindows` entry so a later usage poll can supersede
   * that same axis with real data while leaving the other axis untouched —
   * a 5h reset must never clear a weekly block, and a poll that omits an
   * axis (Codex Plus reports no `session-5h`) must not erase the inferred
   * evidence either. `recoversAt` falls back to the axis window duration
   * when the error carries no reset timestamp.
   */
  markQuotaAxisBlocked(
    accountId: string,
    input: {
      axisId: QuotaAxisId;
      recoversAt?: number | undefined;
      lastError?: string | undefined;
    },
  ): AccountView {
    return this.update(accountId, (account) => {
      const now = Date.now();
      // A parsed real reset time wins; the fallback only fills the gap when
      // the error carried none. A stale/past parsed time floors to +60s so
      // the mark still blocks briefly rather than healing instantly.
      const resetsAt =
        input.recoversAt !== undefined
          ? Math.max(input.recoversAt, now + 60_000)
          : now + QUOTA_AXIS_FALLBACK_MS[input.axisId];
      account.quotaWindows = upsertQuotaWindow(account.quotaWindows, {
        id: input.axisId,
        label: input.axisId === "weekly" ? "Weekly" : "Session (5h)",
        usedPercent: 100,
        resetsAt,
        inferred: true,
      });
      // Axis provenance rides with the mark so recovery can release it as
      // soon as the marked axis itself proves a rollover or refill — instead
      // of stretching a spent mark out to the flat 6h TTL.
      account.lastQuotaAxis = input.axisId;
      account.lastQuotaResetsAt = resetsAt;
      // Only quota-family and healthy statuses flip to exhausted — an
      // `auth-expired`/`error`/`disabled` row keeps its stronger state;
      // those already block scheduling and mean something different.
      if (
        account.status === "available" ||
        account.status === "quota-low" ||
        account.status === "quota-exhausted"
      ) {
        account.status = "quota-exhausted";
      }
      if (input.lastError !== undefined) {
        account.lastError = input.lastError;
      }
      account.lastQuotaAt = now;
    });
  }

  /**
   * Merge provider-pushed rate-limit windows (e.g. Codex
   * `account/rateLimits/updated`) into the row: same per-axis merge rules as
   * a usage poll — live inferred blocks beat lagged sub-100 readings of the
   * same axis, absent axes keep their stored evidence. Status is re-derived
   * only among the quota states, so a push can neither resurrect an
   * `auth-expired`/`disabled` row nor erase a fresh legacy inference mark.
   */
  applyObservedQuotaWindows(
    accountId: string,
    windows: readonly AccountQuotaWindow[],
  ): AccountView {
    return this.update(accountId, (account) => {
      const now = Date.now();
      const merged = mergeQuotaWindows(windows, account.quotaWindows, now);
      this.clearSpentQuotaMark(account, merged);
      account.quotaWindows = merged;
      if (
        account.status === "available" ||
        account.status === "quota-low" ||
        account.status === "quota-exhausted"
      ) {
        const next = effectiveQuotaStatus(account, now);
        if (next !== account.status) {
          account.status = next;
          if (next === "available" || next === "quota-low") {
            delete account.lastError;
          }
        }
      }
    });
  }

  /**
   * Converge stored quota state: drop 100% windows whose reset has passed
   * and recompute status from what remains. The scheduler and the accounts
   * surface call this on their existing read paths, so a recovered axis
   * returns the account to the pool without waiting for a quota poll.
   * Returns the accountIds whose stored state changed.
   */
  reconcileQuotaExpiry(provider?: string): string[] {
    const lock = this.acquireLock(this.lockPath);
    try {
      const file = this.read();
      const now = Date.now();
      const changed: string[] = [];
      for (const account of file.accounts) {
        if (provider !== undefined && account.provider !== provider) {
          continue;
        }
        // Disabled rows are already out of scheduling; their stored quota
        // status is display-only state and heals on re-enable, not silently.
        if (!account.enabled) {
          continue;
        }
        if (account.status !== "quota-exhausted" && account.status !== "quota-low") {
          continue;
        }
        const liveWindows = liveQuotaWindows(account.quotaWindows, now);
        const nextStatus = effectiveQuotaStatus(account, now);
        const windowsChanged = liveWindows.length !== (account.quotaWindows ?? []).length;
        if (!windowsChanged && nextStatus === account.status) {
          continue;
        }
        if (windowsChanged) {
          this.clearSpentQuotaMark(account, liveWindows);
          account.quotaWindows = liveWindows;
        }
        if (nextStatus !== account.status) {
          account.status = nextStatus;
        }
        if (nextStatus === "available" || nextStatus === "quota-low") {
          delete account.lastError;
          delete account.lastQuotaAxis;
          delete account.lastQuotaResetsAt;
        }
        changed.push(account.accountId);
      }
      if (changed.length > 0) {
        this.writeUnlocked(file);
      }
      return changed;
    } finally {
      this.releaseLock(lock);
    }
  }
  /**
   * Persist non-secret provider metadata learned during an identity/quota probe.
   * The renderer needs the provider's real identity and subscription tier on
   * the managed account row; the user-editable label remains independent.
   */
  updateProviderMetadata(
    accountId: string,
    metadata: { providerAccountId?: string; maskedIdentity?: string; plan?: string },
  ): AccountView {
    return this.update(accountId, (account) => {
      const providerAccountId = metadata.providerAccountId?.trim();
      const maskedIdentity = metadata.maskedIdentity?.trim();
      const plan = metadata.plan?.trim();
      if (providerAccountId) account.providerAccountId = providerAccountId;
      if (maskedIdentity)
        account.maskedIdentity = displayIdentity(account.provider, maskedIdentity);
      if (plan) account.plan = plan;
      if (providerAccountId && account.provider === "grok") {
        // 邮箱全称 contract: keep the full email on the Grok row.
        account.maskedIdentity = providerAccountId;
      }
    });
  }

  /** Find an account by one of its normalized provider-visible identities. */
  findByProviderIdentities(
    provider: string,
    identities: Iterable<string | undefined>,
  ): AccountRecord | undefined {
    const normalizedIdentities = new Set(
      [...identities]
        .map((identity) => normalizeProviderIdentity(identity))
        .filter((identity): identity is string => identity !== undefined),
    );
    if (normalizedIdentities.size === 0) return undefined;
    return this.records(provider).find((account) =>
      [account.providerAccountId, account.maskedIdentity].some((value) =>
        normalizedIdentities.has(normalizeProviderIdentity(value) ?? ""),
      ),
    );
  }

  /** Find an account by a normalized provider-visible identity. */
  findByProviderIdentity(provider: string, identity: string): AccountRecord | undefined {
    return this.findByProviderIdentities(provider, [identity]);
  }

  /**
   * Remove pending runtime homes not present in the active set. Restrict the
   * operation to the caller-provided prefix so unrelated provider data remains
   * untouched.
   */
  cleanupOrphanedPendingHomes(prefix: string, activeHomes: readonly string[]): number {
    const active = new Set(activeHomes.map((home) => resolve(home)));
    let removed = 0;
    for (const entry of readdirSync(this.managedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
      const home = resolve(join(this.managedRoot, entry.name));
      if (active.has(home)) continue;
      rmSync(home, { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  }

  /**
   * Remove an uncompleted pending account row. Any row without a resolvable
   * provider identity is treated as an interrupted login leftover — it cannot
   * select a working session and must not keep occupying the usage list.
   * Rows created in the last 10 minutes with no quota probe yet are kept so an
   * in-flight `createEmpty` + login is not deleted mid-browser-auth.
   */
  cleanupOrphanedPendingAccounts(provider: string): number {
    const now = Date.now();
    const orphaned = this.records(provider).filter((account) => {
      if (account.providerAccountId?.trim() || account.maskedIdentity?.trim()) return false;
      if (account.lastQuotaAt) return true;
      return now - account.createdAt > 10 * 60 * 1000;
    });
    for (const account of orphaned) this.remove(account.accountId);
    return orphaned.length;
  }

  private scrubIdentityLessAccounts(provider?: string): void {
    const providers = provider
      ? [provider]
      : [...new Set(this.read().accounts.map((account) => account.provider))];
    for (const id of providers) {
      this.cleanupOrphanedPendingAccounts(id);
      this.dedupeProviderIdentities(id);
    }
  }

  /** Collapse duplicate identities for one provider, keeping the selected/newest row. */
  dedupeProviderIdentities(provider: string): number {
    const groups = new Map<string, AccountRecord[]>();
    for (const account of this.records(provider)) {
      const identity = normalizeProviderIdentity(
        account.providerAccountId ?? account.maskedIdentity,
      );
      if (!identity) continue;
      const group = groups.get(identity) ?? [];
      group.push(account);
      groups.set(identity, group);
    }
    let removed = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const kept =
        group.find((account) => account.selected) ??
        [...group].sort((left, right) => right.createdAt - left.createdAt)[0];
      if (!kept) continue;
      for (const account of group) {
        if (account.accountId === kept.accountId) continue;
        this.remove(account.accountId);
        removed += 1;
      }
    }
    return removed;
  }

  projectCredential(projection: AccountCredentialProjection): string {
    const account = this.getRecord(projection.accountId);
    if (!account)
      throw new AccountControlError(
        "ACCOUNT_NOT_FOUND",
        `Unknown account '${projection.accountId}'.`,
      );
    if (account.provider !== projection.provider) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Credential provider does not match account provider.",
      );
    }
    const root = this.resolveAccountRoot(account);
    // Home-var projections (CODEX_HOME, GROK_HOME) must always point back at
    // this account's managed scope — a managed account never gets a home that
    // aliases the host profile or another account's root.
    for (const homeKey of ["CODEX_HOME", "GROK_HOME", "KIMI_CODE_HOME"] as const) {
      const requestedHome = projection.environment?.[homeKey];
      if (requestedHome !== undefined && resolve(requestedHome) !== root) {
        throw new AccountControlError(
          "ACCOUNT_PATH_INVALID",
          `${homeKey} must point at the account's managed credential scope.`,
          { accountId: projection.accountId },
        );
      }
    }
    for (const key of Object.keys(projection.environment ?? {})) {
      if (isOpenCodePrivateRuntimeEnvironmentKey(key)) {
        throw new AccountControlError(
          "ACCOUNT_PATH_INVALID",
          `${key} is reserved for the Supervisor-owned private runtime root.`,
          { accountId: projection.accountId },
        );
      }
    }
    mkdirSync(root, { recursive: true });
    const lock = this.acquireLock(join(root, "projection.lock"));
    try {
      const authPath = join(root, "auth.json");
      if (projection.authJson !== undefined) {
        if (existsSync(authPath)) renameSync(authPath, `${authPath}.bak`);
        writeFileAtomic(authPath, projection.authJson, { encoding: "utf8", mode: 0o600 });
      }
      if (projection.environment !== undefined) {
        const envPath = join(root, "environment.json");
        if (existsSync(envPath)) renameSync(envPath, `${envPath}.bak`);
        writeFileAtomic(envPath, JSON.stringify(projection.environment), {
          encoding: "utf8",
          mode: 0o600,
        });
      }
      return root;
    } catch (error) {
      throw new AccountControlError("ACCOUNT_PROJECTION_FAILED", "Credential projection failed.", {
        accountId: projection.accountId,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.releaseLock(lock);
    }
  }

  clearCredentialScope(accountId: string): void {
    const account = this.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const root = this.resolveAccountRoot(account);
    rmSync(root, { recursive: true, force: true });
  }

  credentialRoot(accountId: string): string {
    const account = this.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    return this.resolveAccountRoot(account);
  }

  /**
   * Resolve an account's managed credential directory, self-healing legacy
   * rows whose stored absolute path escapes this store's root.
   *
   * Dev (`~/.craftstation-dev`) and prod (`~/.craftstation`) stores are
   * separate roots, but a copied `accounts.json` keeps the other root's
   * absolute `credentialRoot`. When the same profile directory name exists
   * inside this root, the pointer is rebased and the repair persisted instead
   * of failing every session with ACCOUNT_PATH_INVALID ("Account path escapes
   * the managed root."). The security boundary still holds: the returned path
   * is always inside this store's managed root, and directories outside it
   * are never created, written, or deleted by this repair.
   */
  private resolveAccountRoot(account: AccountRecord): string {
    const resolved = this.rebaseEscapedRoot(account.credentialRoot);
    if (resolved === undefined) {
      throw new AccountControlError(
        "ACCOUNT_PATH_INVALID",
        "Account path escapes the managed root.",
        {
          accountId: account.accountId,
          provider: account.provider,
          root: resolve(this.managedRoot),
          candidate: resolve(account.credentialRoot),
          remediation: `Re-login the ${account.provider} account to recreate its managed profile.`,
        },
      );
    }
    if (resolve(account.credentialRoot) !== resolved) {
      const rebased = resolved;
      this.withMetadataMutation((file) => {
        const row = file.accounts.find((entry) => entry.accountId === account.accountId);
        if (row) row.credentialRoot = rebased;
      });
      console.warn(
        `[account] rebased escaped credential root: account=${account.accountId} provider=${account.provider} dir=${basename(account.credentialRoot)}`,
      );
    }
    return resolved;
  }

  /**
   * Return the safe managed-root directory for a stored credential root. A
   * path already inside the root passes through; a legacy absolute path from
   * a sibling store is rebased by profile directory name when that directory
   * exists here. Returns undefined when no safe directory exists inside this
   * root — callers must then fail closed without touching the outside path.
   */
  private rebaseEscapedRoot(storedRoot: string): string | undefined {
    try {
      return assertInside(this.managedRoot, storedRoot);
    } catch (error) {
      if (!(error instanceof AccountControlError) || error.code !== "ACCOUNT_PATH_INVALID") {
        throw error;
      }
    }
    const base = basename(storedRoot);
    if (!base || base === "." || base === "..") return undefined;
    const candidate = join(this.managedRoot, base);
    try {
      assertInside(this.managedRoot, candidate);
    } catch {
      return undefined;
    }
    try {
      if (!existsSync(candidate) || !statSync(candidate).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    return resolve(candidate);
  }

  /**
   * Read a supervisor-only process environment previously projected for an
   * account. The values must never be returned over IPC or copied into plans.
   */
  readCredentialEnvironment(accountId: string): Record<string, string> {
    const root = this.credentialRoot(accountId);
    const environmentPath = join(root, "environment.json");
    if (!existsSync(environmentPath)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(environmentPath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Credential environment must be an object.");
      }
      const environment: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!/^[A-Z_][A-Z0-9_]{0,127}$/u.test(key) || typeof value !== "string") {
          throw new Error("Credential environment contains an invalid entry.");
        }
        if (isOpenCodePrivateRuntimeEnvironmentKey(key)) {
          throw new Error(`${key} is reserved for the private runtime root.`);
        }
        environment[key] = value;
      }
      return environment;
    } catch (error) {
      throw new AccountControlError(
        "ACCOUNT_CORRUPT",
        "Managed credential environment is invalid.",
        { accountId, cause: error instanceof Error ? error.message : String(error) },
      );
    }
  }

  /**
   * Install a managed OpenCode auth store into this account's private XDG data
   * root. Only a boolean crosses the resolver seam; raw auth material remains
   * inside the Supervisor-owned account directory.
   */
  prepareOpenCodeRuntimeRoot(accountId: string): {
    runtimeRoot: string;
    authConfigured: boolean;
  } {
    const runtimeRoot = this.credentialRoot(accountId);
    const source = join(runtimeRoot, "auth.json");
    const target = join(runtimeRoot, "data", "opencode", "auth.json");
    if (!existsSync(source)) {
      rmSync(target, { force: true });
      return { runtimeRoot, authConfigured: false };
    }
    try {
      const raw = readFileSync(source, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("OpenCode auth store must be an object.");
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileAtomic(target, raw, { encoding: "utf8", mode: 0o600 });
      return { runtimeRoot, authConfigured: true };
    } catch (error) {
      throw new AccountControlError("ACCOUNT_CORRUPT", "Managed OpenCode auth store is invalid.", {
        accountId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  recoverCredential(accountId: string): boolean {
    const account = this.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const root = this.resolveAccountRoot(account);
    let recovered = false;
    for (const name of ["auth.json", "environment.json"]) {
      const target = join(root, name);
      const backup = `${target}.bak`;
      if (!existsSync(target) && existsSync(backup)) {
        renameSync(backup, target);
        recovered = true;
      }
    }
    return recovered;
  }

  private update(accountId: string, mutate: (account: AccountRecord) => void): AccountView {
    return this.withMetadataMutation((file) => {
      const account = file.accounts.find((entry) => entry.accountId === accountId);
      if (!account)
        throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
      mutate(account);
      return this.toView(account);
    });
  }

  /**
   * Serialize every metadata read-modify-write operation under the same
   * exclusive lock. Reading before acquiring the lock lets two CraftStation
   * instances both write a stale snapshot and silently lose one mutation.
   */
  private withMetadataMutation<T>(mutate: (file: AccountFile) => T): T {
    const lock = this.acquireLock(this.lockPath);
    try {
      const file = this.read();
      const result = mutate(file);
      this.writeUnlocked(file);
      return result;
    } finally {
      this.releaseLock(lock);
    }
  }

  private read(): AccountFile {
    if (!existsSync(this.metadataPath)) return { version: ACCOUNT_FILE_VERSION, accounts: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.metadataPath, "utf8")) as AccountFile;
      if (!parsed || !Array.isArray(parsed.accounts)) throw new Error("invalid account file");
      // v0.5 migration: v1 files carry accounts only; promote to v2 with empty pools.
      const migrated: AccountFile = {
        version: ACCOUNT_FILE_VERSION,
        accounts: parsed.accounts,
        pools: parsed.pools ?? {},
      };
      return migrated;
    } catch {
      const backup = `${this.metadataPath}.bak`;
      if (existsSync(backup)) {
        try {
          const recovered = JSON.parse(readFileSync(backup, "utf8")) as AccountFile;
          if (recovered && Array.isArray(recovered.accounts)) {
            const migrated: AccountFile = {
              version: ACCOUNT_FILE_VERSION,
              accounts: recovered.accounts,
              pools: recovered.pools ?? {},
            };
            writeFileAtomic(this.metadataPath, JSON.stringify(migrated), {
              encoding: "utf8",
              mode: 0o600,
            });
            return migrated;
          }
        } catch {
          // Report the stable corruption error below.
        }
      }
      throw new AccountControlError(
        "ACCOUNT_CORRUPT",
        "Managed account metadata is corrupt and recovery failed.",
      );
    }
  }

  private writeUnlocked(file: AccountFile): void {
    // Keep a backup without creating a window where readers see no metadata.
    // `rename(metadata, metadata.bak)` is also not replace-safe on Windows
    // when a previous backup exists.
    if (existsSync(this.metadataPath)) {
      copyFileSync(this.metadataPath, `${this.metadataPath}.bak`);
    }
    writeFileAtomic(
      this.metadataPath,
      JSON.stringify({ ...file, version: ACCOUNT_FILE_VERSION, pools: file.pools ?? {} }, null, 2),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  }

  private migrateLegacyMetadata(): void {
    if (!existsSync(this.metadataPath)) return;
    const lock = this.acquireLock(this.lockPath);
    try {
      // v0.5: promote v1 files to v2 and persist the pool map on disk so the
      // provider-pool scheduling contract survives a restart. read() already
      // normalizes the in-memory shape, so inspect the raw disk version here.
      let diskVersion: number = ACCOUNT_FILE_VERSION;
      let diskHasPools = false;
      try {
        const raw = JSON.parse(readFileSync(this.metadataPath, "utf8")) as {
          version?: number;
          pools?: unknown;
        };
        diskVersion = raw.version ?? 0;
        diskHasPools = Object.prototype.hasOwnProperty.call(raw, "pools");
      } catch {
        // Fall back to the normalized shape below.
      }
      const file = this.read();
      let changed = false;
      if (diskVersion !== ACCOUNT_FILE_VERSION || !diskHasPools) {
        file.pools ??= {};
        changed = true;
      }
      for (const account of file.accounts) {
        if (normalizeLegacyAccount(account)) changed = true;
      }
      if (changed) this.writeUnlocked(file);
    } finally {
      this.releaseLock(lock);
    }
  }

  private acquireLock(path: string): LockHandle {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) rmSync(path, { force: true });
      } catch {
        throw new AccountControlError("ACCOUNT_LOCKED", "Unable to inspect the account lock.");
      }
    }
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, `${process.pid}\n`, "utf8");
      return { fd, path };
    } catch {
      throw new AccountControlError(
        "ACCOUNT_LOCKED",
        "Another CraftStation instance is updating accounts.",
      );
    }
  }

  private releaseLock(lock: LockHandle): void {
    try {
      closeSync(lock.fd);
      rmSync(lock.path, { force: true });
    } catch {
      // Best effort; stale-lock recovery handles abnormal termination.
    }
  }

  private reindex(file: AccountFile, provider: string): void {
    file.accounts
      .filter((account) => account.provider === provider)
      .sort((left, right) => left.order - right.order)
      .forEach((account, index) => (account.order = index));
  }

  private toView(account: AccountRecord): AccountView {
    const { credentialRoot: _credentialRoot, ...view } = account;
    return view;
  }
}

/**
 * How long an inference-proven `quota-exhausted` mark survives healthy quota
 * polls. A real 402 means the inference budget (not the % windows) is empty,
 * so the poller must not downgrade the row back to schedulable on %. Every
 * fresh quota failure re-marks (refreshing the clock); recovery otherwise
 * happens via newer quota evidence after the TTL. Six hours covers an evening
 * of retries without bricking a row for a whole weekly period on a transient.
 */
export const QUOTA_INFERENCE_MARK_TTL_MS = 6 * 3_600_000;

/**
 * Whether a quota poll that derived a healthy status must keep a stored
 * inference-exhaustion mark instead of recovering the row.
 *
 * The mark shape is exactly what the prompt-error write-back writes
 * (`status: quota-exhausted` + `lastError` + `lastQuotaAt = mark time`): the
 * healthy quota-poll path never sets `lastError`, so a present message means
 * a real inference failure, not a window estimate. Callers still persist the
 * fresh windows (bars stay truthful) and only skip the status downgrade.
 */
export function shouldPreserveInferenceExhaustion(
  stored: Pick<AccountRecord, "status" | "lastError" | "lastQuotaAt"> | undefined,
  now: number,
): boolean {
  if (!stored || stored.status !== "quota-exhausted") return false;
  if (!stored.lastError) return false;
  const markTime = stored.lastQuotaAt;
  if (typeof markTime !== "number" || !Number.isFinite(markTime)) return false;
  return now - markTime < QUOTA_INFERENCE_MARK_TTL_MS;
}

/**
 * The legacy-mark rule above, minus records carrying axis evidence. An
 * inferred window owns its own lifecycle: while live it already keeps the
 * derived status exhausted; once expired the mark is over and a lingering
 * `lastError` must NOT stretch it back out to the 6h TTL.
 */
export function shouldPreserveQuotaMark(
  record:
    | Pick<
        AccountRecord,
        | "provider"
        | "status"
        | "lastError"
        | "lastQuotaAt"
        | "lastQuotaAxis"
        | "lastQuotaResetsAt"
        | "quotaWindows"
      >
    | undefined,
  now: number,
): boolean {
  if (!record) return false;
  if ((record.quotaWindows ?? []).some((window) => window.inferred === true)) {
    return false;
  }
  return inferenceMarkBlocks(record, now);
}

/**
 * How far apart two `resetsAt` readings must be to describe different
 * periods. The window's own resets and the error's retry timestamp come from
 * different clocks inside the provider and routinely disagree by seconds or
 * a few minutes for the SAME period — treat sub-quarter-hour deltas as
 * jitter, not rollover.
 */
const QUOTA_PERIOD_JITTER_MS = 15 * 60_000;

/** The observed window usage must stay at least this high to corroborate a still-live block. */
const QUOTA_MARK_SATURATION_PERCENT = 95;

/**
 * The axis a stored mark was scoped to, plus the reset time it advertised.
 * Persisted provenance (`lastQuotaAxis`/`lastQuotaResetsAt`) is preferred;
 * records marked before those fields existed recover the axis by re-running
 * the provider classifier on the stored `lastError` — Codex retry text
 * carries the axis's own reset timestamp. Flat marks (Grok 402s, manual
 * writes) yield no axis and keep legacy TTL semantics.
 */
function quotaMarkAxis(
  record: Pick<
    AccountRecord,
    | "provider"
    | "lastError"
    | "lastQuotaAt"
    | "lastQuotaAxis"
    | "lastQuotaResetsAt"
    | "quotaWindows"
  >,
  now: number,
): { axisId: QuotaAxisId; resetsAt?: number | undefined } | undefined {
  if (record.lastQuotaAxis !== undefined) {
    return { axisId: record.lastQuotaAxis, resetsAt: record.lastQuotaResetsAt };
  }
  if (record.provider === "codex" && record.lastError) {
    const classification = classifyCodexPoolQuotaError(record.lastError, record.quotaWindows, now);
    if (classification) {
      return { axisId: classification.axisId, resetsAt: classification.recoversAt };
    }
  }
  return undefined;
}

/**
 * Whether a turn-level quota mark still outranks healthy-looking windows.
 *
 * Flat marks (no axis provenance) keep the legacy TTL semantics: % windows
 * cannot disprove a real inference failure. Axis-scoped marks release early
 * on affirmative recovery of the MARKED axis alone:
 *
 * - the advertised/estimated reset has elapsed; or
 * - the axis's primary lane reports a `resetsAt` past the mark's period —
 *   a rolled-over new period; or
 * - the primary lane reads below the saturation threshold the mark needed —
 *   a within-period refill (reset card). Usage is monotonic inside a period,
 *   so a stale lagged reading can only corroborate, never drop below it.
 */
export function inferenceMarkBlocks(
  record: Pick<
    AccountRecord,
    | "provider"
    | "status"
    | "lastError"
    | "lastQuotaAt"
    | "lastQuotaAxis"
    | "lastQuotaResetsAt"
    | "quotaWindows"
  >,
  now: number,
): boolean {
  if (!shouldPreserveInferenceExhaustion(record, now)) return false;
  const marked = quotaMarkAxis(record, now);
  if (marked === undefined) return true;
  const markEnd =
    marked.resetsAt ?? (record.lastQuotaAt ?? now) + QUOTA_AXIS_FALLBACK_MS[marked.axisId];
  if (now >= markEnd) return false;
  for (const window of record.quotaWindows ?? []) {
    if (window.inferred === true) continue;
    if (window.id !== marked.axisId) continue;
    if (window.resetsAt !== undefined && window.resetsAt > markEnd + QUOTA_PERIOD_JITTER_MS) {
      return false;
    }
    if (window.usedPercent < QUOTA_MARK_SATURATION_PERCENT) {
      return false;
    }
  }
  return true;
}

/**
 * The two independent budget axes a pooled account can be blocked on.
 * Aligned with the collector window ids (`session-5h`, `weekly`); a window
 * id ending in one of these (e.g. `codex:{family}:weekly`) belongs to that
 * axis, so provider-specific secondary windows share the axis lifecycle.
 */
export type QuotaAxisId = "session-5h" | "weekly";

/** Reset-time fallback when a quota error carries no absolute reset timestamp. */
export const QUOTA_AXIS_FALLBACK_MS: Record<QuotaAxisId, number> = {
  "session-5h": 5 * 3_600_000,
  weekly: 7 * 24 * 3_600_000,
};

/** The quota axis a stored window id belongs to, or undefined for non-axis windows. */
export function quotaAxisForWindowId(id: string): QuotaAxisId | undefined {
  if (id === "session-5h" || id.endsWith(":session-5h")) return "session-5h";
  if (id === "weekly" || id.endsWith(":weekly")) return "weekly";
  return undefined;
}

/** A saturated window keeps blocking only until its advertised reset. */
export function isQuotaWindowBlocking(
  window: Pick<AccountQuotaWindow, "usedPercent" | "resetsAt">,
  now: number,
): boolean {
  return window.usedPercent >= 100 && (window.resetsAt === undefined || window.resetsAt > now);
}

/**
 * Windows with elapsed resets no longer describe reality: a saturated window
 * past `resetsAt` is a recovered axis, not a blocker. Sub-100 windows keep
 * their stale percentage for display; the scheduler never blocks on them.
 */
export function liveQuotaWindows(
  windows: readonly AccountQuotaWindow[] | undefined,
  now: number,
): AccountQuotaWindow[] {
  return (windows ?? []).filter(
    (window) =>
      !(window.usedPercent >= 100 && window.resetsAt !== undefined && window.resetsAt <= now),
  );
}

function upsertQuotaWindow(
  windows: readonly AccountQuotaWindow[] | undefined,
  window: AccountQuotaWindow,
): AccountQuotaWindow[] {
  const next = (windows ?? []).filter((existing) => existing.id !== window.id);
  next.push({ ...window });
  return next;
}

/**
 * Merge freshly observed windows into stored ones on a per-axis basis:
 *
 * - A live inferred block (saturated, `resetsAt` in the future) beats a fresh
 *   sub-100% observation of the same axis — the usage probe can lag the
 *   rate-limit engine, so a just-failed turn is fresher evidence than a
 *   lagged percentage.
 * - EXCEPTION: a sub-100% observation carrying a DIFFERENT `resetsAt` proves
 *   the window rolled into a new period — the axis genuinely reset — so the
 *   fresh window supersedes (this is how a weekly-blocked account recovers
 *   on schedule, and how a guessed fallback `resetsAt` corrects early).
 * - A fresh ≥100% observation supersedes the inferred mark (same verdict,
 *   better `resetsAt`).
 * - An axis the poll did not report keeps whatever stored evidence exists;
 *   "not observed" is never "recovered".
 * - Expired inferred blocks drop out; their axis is governed by fresh data.
 */
export function mergeQuotaWindows(
  fresh: readonly AccountQuotaWindow[],
  stored: readonly AccountQuotaWindow[] | undefined,
  now: number,
): AccountQuotaWindow[] {
  const freshClean = fresh.map((window) => {
    const clean = { ...window };
    delete clean.inferred;
    return clean;
  });
  const freshIds = new Set(freshClean.map((window) => window.id));
  const merged: AccountQuotaWindow[] = [...freshClean];
  for (const window of liveQuotaWindows(stored, now)) {
    const axis = quotaAxisForWindowId(window.id);
    const sameAxisFresh =
      axis === undefined
        ? []
        : freshClean.filter((entry) => quotaAxisForWindowId(entry.id) === axis);
    const coveredByFresh = freshIds.has(window.id) || sameAxisFresh.length > 0;
    if (window.inferred === true && isQuotaWindowBlocking(window, now) && coveredByFresh) {
      const sameLaneFresh =
        axis === undefined ? freshClean.filter((entry) => entry.id === window.id) : sameAxisFresh;
      const superseded =
        sameLaneFresh.some((entry) => entry.usedPercent >= 100) ||
        sameLaneFresh.some(
          (entry) => entry.resetsAt !== undefined && entry.resetsAt !== window.resetsAt,
        );
      if (!superseded) {
        // A lagged sub-100 reading of the same period cannot disprove a live
        // turn-level inference mark — and the fresh copy of the same lane
        // must not sit next to it in the merged list.
        for (let index = merged.length - 1; index >= 0; index--) {
          if (merged[index]!.id === window.id) merged.splice(index, 1);
        }
        merged.push({ ...window });
      }
      continue;
    }
    if (!coveredByFresh) {
      // The observation says nothing about this lane — "not observed" is
      // never "recovered", so live stored evidence survives the merge.
      merged.push({ ...window });
    }
    // Otherwise the fresh observation governs this axis and the stale stored
    // window drops out.
  }
  return merged;
}

/**
 * Scheduling-time truth for quota statuses: re-derive `quota-exhausted` /
 * `quota-low` against `now` so an elapsed axis block never keeps an account
 * out of the pool. Non-quota statuses (`auth-expired`, `disabled`, `error`,
 * `unavailable`, `available`) pass through unchanged — credentials and
 * user intent are authoritative.
 *
 * A stored `quota-exhausted` with no surviving axis evidence still honors
 * the legacy inference mark (`lastError` + fresh `lastQuotaAt`), preserving
 * the pre-axis semantics for providers without window data (Grok 402s).
 */
export function effectiveQuotaStatus(
  record: Pick<
    AccountRecord,
    | "provider"
    | "status"
    | "quotaWindows"
    | "lastError"
    | "lastQuotaAt"
    | "lastQuotaAxis"
    | "lastQuotaResetsAt"
  >,
  now: number,
): AccountStatus {
  if (record.status !== "quota-exhausted" && record.status !== "quota-low") {
    return record.status;
  }
  const stored = record.quotaWindows ?? [];
  if (stored.length === 0) {
    // No axis evidence at all: the stored status is authoritative. A bare or
    // legacy-marked `quota-exhausted` (Grok 402s, manual writes) keeps
    // blocking — an empty window set proves nothing about recovery.
    return record.status;
  }
  const live = liveQuotaWindows(stored, now);
  if (live.length === 0) {
    // Axis evidence existed and every saturated window's reset has elapsed:
    // affirmative recovery, independent of any lingering legacy mark.
    return "available";
  }
  const blocking = blockingWindow(record.provider, live);
  if (!blocking) {
    // Live windows that never drive the blocking lane (usd overage, reset
    // credits, model carve-outs) cannot prove a recovery either.
    return record.status;
  }
  const derived =
    blocking.usedPercent >= 100
      ? "quota-exhausted"
      : blocking.usedPercent >= 90
        ? "quota-low"
        : "available";
  if (
    record.status === "quota-exhausted" &&
    derived !== "quota-exhausted" &&
    !stored.some((window) => window.inferred === true) &&
    inferenceMarkBlocks(record, now)
  ) {
    // Pure observed windows that read healthy cannot disprove a fresh
    // turn-level inference mark — the % probe lags the rate-limit engine.
    // Once the mark's TTL lapses (or inferred axis evidence takes over the
    // lifecycle, or the marked axis itself proves recovery), the derived
    // status wins and the row heals normally.
    return "quota-exhausted";
  }
  return derived;
}
