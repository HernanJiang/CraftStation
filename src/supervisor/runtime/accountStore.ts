import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
    return this.read()
      .accounts.filter((account) => provider === undefined || account.provider === provider)
      .sort((left, right) => left.order - right.order)
      .map((account) => this.toView(account));
  }

  get(accountId: string): AccountView | undefined {
    const account = this.read().accounts.find((entry) => entry.accountId === accountId);
    return account ? this.toView(account) : undefined;
  }

  getRecord(accountId: string): AccountRecord | undefined {
    return this.read().accounts.find((entry) => entry.accountId === accountId);
  }

  records(provider?: string): AccountRecord[] {
    return this.read()
      .accounts.filter((account) => provider === undefined || account.provider === provider)
      .sort((left, right) => left.order - right.order);
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
    const root = assertInside(this.managedRoot, removed.credentialRoot);
    rmSync(root, { recursive: true, force: true });
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
      if (details?.lastError !== undefined) account.lastError = details.lastError;
      if (details?.lastQuotaAt !== undefined) account.lastQuotaAt = details.lastQuotaAt;
      if (status !== "error" && details?.lastError === undefined) delete account.lastError;
    });
  }

  updateQuota(accountId: string, quotaWindows: AccountQuotaWindow[]): AccountView {
    return this.update(accountId, (account) => {
      account.quotaWindows = quotaWindows.map((window) => ({ ...window }));
    });
  }

  /**
   * Persist non-secret provider metadata learned during an identity/quota probe.
   * The renderer needs the provider's real identity and subscription tier on
   * the managed account row; the user-editable label remains independent.
   */
  updateProviderMetadata(
    accountId: string,
    metadata: { providerAccountId?: string; plan?: string },
  ): AccountView {
    return this.update(accountId, (account) => {
      const providerAccountId = metadata.providerAccountId?.trim();
      const plan = metadata.plan?.trim();
      if (providerAccountId) account.providerAccountId = providerAccountId;
      if (plan) account.plan = plan;
      if (providerAccountId && account.provider === "grok") {
        // 邮箱全称 contract: keep the full email on the Grok row.
        account.maskedIdentity = providerAccountId;
      }
    });
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
    const root = assertInside(this.managedRoot, account.credentialRoot);
    // Home-var projections (CODEX_HOME, GROK_HOME) must always point back at
    // this account's managed scope — a managed account never gets a home that
    // aliases the host profile or another account's root.
    for (const homeKey of ["CODEX_HOME", "GROK_HOME"] as const) {
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
    const root = assertInside(this.managedRoot, account.credentialRoot);
    rmSync(root, { recursive: true, force: true });
  }

  credentialRoot(accountId: string): string {
    const account = this.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    return assertInside(this.managedRoot, account.credentialRoot);
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
    const root = assertInside(this.managedRoot, account.credentialRoot);
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
