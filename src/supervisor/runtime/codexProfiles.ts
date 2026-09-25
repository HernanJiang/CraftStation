import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { writeFileAtomic } from "@/shared/atomicFile";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseCodexAuth, resolveCodexToken, sanitizeCodexAuthJson } from "./codexCredentials";
import { isCodexRouterOverlayHome } from "../agents/codex/codexRouterOverlay";
import { AccountStore, shouldPreserveInferenceExhaustion } from "./accountStore";
import type { AccountView } from "@/shared/contracts";
import { AccountControlError } from "@/shared/contracts";
import {
  CODEX_RESET_CREDIT_WINDOW_ID,
  collectCodex,
  quotaStatusFromWindows,
  consumeCodexResetCredit,
  type HostPort,
  type UsageSnapshot,
} from "@craftstation/agents-usage";

const CODEX_ROUTER_ENV_KEYS = [
  "CODEX_HOME",
  "CODEX_CONFIG_DIR",
  "CODEX_CONFIG_PATH",
  "CODEX_MODEL_CATALOG",
  "CODEX_MODEL_CATALOG_PATH",
  "CODEX_ROUTER_HOME",
  "CODEX_ROUTER_USER_DATA",
  "OPENAI_CODEX_HOME",
] as const;

/**
 * Compatibility-bridge endpoint keys. Native Codex runs must never inherit
 * these: only a non-native model on the native vendor may go through CPA,
 * everything else runs the official CLI against the account pool.
 */
export const CODEX_COMPATIBILITY_ENV_KEYS = [
  "CODEX_BASE_URL",
  "CODEX_MODEL_PROVIDER",
  "OPENAI_API_KEY",
  // Codex's own auth env overrides: a stray `CODEX_API_KEY`/`CODEX_ACCESS_TOKEN`
  // (router tooling, `setx`, the desktop app) hijacks the managed profile's
  // auth mode and sends the platform key to the ChatGPT subscription backend.
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
] as const;

/**
 * Isolate a managed Codex login/runtime from the host Codex-Router overlay.
 *
 * Includes file credential store isolation based on subswap and official codex config:
 * MIT License, Copyright (c) 2026 subswap contributors
 *
 * Router catalogs are not official Codex config and will crash `codex login`.
 */
export function managedCodexProcessEnvironment(
  managedCodexHome: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  // Spawn spreads `process.env` then this map. Omitting a key is not enough:
  // the host Codex-Router / CLIProxy values would leak back. Blank them.
  const blankKeys = new Set<string>();
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      CODEX_ROUTER_ENV_KEYS.includes(key as (typeof CODEX_ROUTER_ENV_KEYS)[number]) ||
      (CODEX_COMPATIBILITY_ENV_KEYS as readonly string[]).includes(upper) ||
      upper.includes("CODEX_ROUTER") ||
      upper.includes("MODEL_CATALOG") ||
      upper.includes("CLIPROXY")
    ) {
      blankKeys.add(key);
      continue;
    }
    env[key] = value;
  }
  for (const key of blankKeys) env[key] = "";
  env.CODEX_HOME = managedCodexHome;
  ensureManagedCodexHome(managedCodexHome);
  return env;
}

/**
 * Router/CLIProxy routing keys removed from probe spawn environments (without
 * redirecting CODEX_HOME). Probes must not inherit the host Codex-Router
 * overlay's catalog: its per-instance `cr_<instance>_…` model ids leak into
 * CraftStation's model list and later fail with `unknown provider for model`.
 * Unlike {@link managedCodexProcessEnvironment} this OMITS the keys instead of
 * blanking them, so the result is a complete environment on its own.
 */
export function stripCodexRouterEnv(
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      CODEX_ROUTER_ENV_KEYS.includes(key as (typeof CODEX_ROUTER_ENV_KEYS)[number]) ||
      (CODEX_COMPATIBILITY_ENV_KEYS as readonly string[]).includes(upper) ||
      upper.includes("CODEX_ROUTER") ||
      upper.includes("MODEL_CATALOG") ||
      upper.includes("CLIPROXY")
    ) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

const MANAGED_CODEX_CONFIG = [
  "# CraftStation managed Codex profile",
  "# Isolated from the host ~/.codex overlay (official provider only).",
  'cli_auth_credentials_store = "file"',
  'mcp_oauth_credentials_store = "file"',
  'model_provider = "openai"',
  'sandbox_mode = "danger-full-access"',
  "",
  "[windows]",
  'sandbox = "unelevated"',
  "",
].join("\n");

/**
 * Map quota windows onto an account status. A fully-consumed window must mark
 * the account `quota-exhausted` (unusable for new sessions) — capping at
 * `quota-low` kept a 100%-used account eligible and silently defeated pool
 * fallback.
 */
function quotaStatusForWindows(
  windows: ReadonlyArray<{ id: string; usedPercent: number; unit?: string | undefined }>,
): "available" | "quota-low" | "quota-exhausted" {
  return quotaStatusFromWindows("codex", windows);
}

export function ensureManagedCodexHome(managedCodexHome: string): string {
  mkdirSync(managedCodexHome, { recursive: true });
  const configPath = join(managedCodexHome, "config.toml");
  // Never write through a leftover symlink/hardlink into another home.
  // Startup used to link a private home at host ~/.codex/config.toml; an
  // unconditional write would follow that link and replace the Router overlay.
  breakManagedStateSymlink(configPath);
  writeFileSync(configPath, MANAGED_CODEX_CONFIG, { encoding: "utf8" });
  sanitizeManagedCodexAuth(managedCodexHome);
  return managedCodexHome;
}

/**
 * Scrub alternate-credential fields out of a managed `auth.json`.
 *
 * `codex login` inside a managed home persists a minted `sk-svcacct` key and
 * can leave a key-shaped `tokens.access_token` behind; either makes the spawned
 * app-server hit chatgpt.com/backend-api with a platform key ("Incorrect API
 * key provided" 401 loop that never self-refreshes — a non-JWT access_token
 * falls back to the stale last_refresh heuristic). Managed profiles are
 * ChatGPT-OAuth-only, so the file is rewritten to the canonical subscription
 * shape whenever it drifts. Rewrites happen only on a real difference, before
 * the new codex process opens the file.
 */
export function sanitizeManagedCodexAuth(managedCodexHome: string): boolean {
  const authPath = join(managedCodexHome, "auth.json");
  if (!existsSync(authPath)) return false;
  let current: string;
  try {
    current = readFileSync(authPath, "utf8");
  } catch {
    return false;
  }
  const sanitized = sanitizeCodexAuthJson(current);
  if (sanitized === undefined || sanitized === current) return false;
  // Best-effort: a locked/unwritable auth.json must not block spawning — the
  // scrub just runs again on the next spawn.
  try {
    breakManagedStateSymlink(authPath);
    writeFileAtomic(authPath, sanitized, { encoding: "utf8", mode: 0o600 });
  } catch {
    return false;
  }
  console.warn(
    "[account] scrubbed non-subscription credential fields from managed Codex auth.json: " +
      "phase=runtime operation=sanitizeManagedCodexAuth status=repaired " +
      `code=CODEX_AUTH_SANITIZED home=${managedCodexHome}`,
  );
  return true;
}

/**
 * Remove `targetPath` when it is a symlink or hardlink so managed writes land
 * in the managed home itself, never in a linked host/Router home. Returns true
 * when a link was removed. Exported for unit tests.
 */
export function breakManagedStateSymlink(targetPath: string): boolean {
  let st;
  try {
    st = lstatSync(targetPath);
  } catch {
    return false;
  }
  if (!st.isSymbolicLink() && st.nlink <= 1) return false;
  unlinkSync(targetPath);
  return true;
}

/**
 * Scrub a Codex-Router overlay out of a CraftStation-managed Codex home.
 *
 * Managed homes are CraftStation-owned: Router keys (`model_catalog_json`
 * pointing at the Router catalog, `codex-router` providers, local gateway
 * ports) are never legitimate there, and official `codex login` dies parsing
 * a stale Router catalog (e.g. missing `supports_reasoning_summaries`).
 * Returns true when a polluted config was rewritten to the canonical managed
 * config. A missing config needs no scrub: codex falls back to defaults.
 */
export function scrubManagedCodexConfig(managedCodexHome: string): boolean {
  if (!isCodexRouterOverlayHome(managedCodexHome)) return false;
  const configPath = join(managedCodexHome, "config.toml");
  breakManagedStateSymlink(configPath);
  writeFileSync(configPath, MANAGED_CODEX_CONFIG, { encoding: "utf8" });
  console.warn(
    "[account] scrubbed Codex-Router overlay from managed Codex home: " +
      "phase=login operation=scrubManagedCodexConfig status=repaired " +
      `code=ROUTER_OVERLAY_SCRUBBED home=${managedCodexHome}`,
  );
  return true;
}

/**
 * Official `codex login` walks ancestors of cwd looking for `.codex/config.toml`.
 * A managed profile under %USERPROFILE% therefore still loads
 * `%USERPROFILE%\.codex` (Codex-Router overlay). Keep the login cwd on the
 * CraftStation drive, with a local `.codex` stopper that has no catalog.
 */
export function managedCodexLoginCwd(managedCodexHome: string): string {
  const cwd = join("D:\\Work\\CraftStation", ".local", "codex-login");
  mkdirSync(join(cwd, ".codex"), { recursive: true });
  writeFileSync(join(cwd, ".codex", "config.toml"), MANAGED_CODEX_CONFIG, { encoding: "utf8" });
  ensureManagedCodexHome(managedCodexHome);
  return cwd;
}

/** Build a login script without embedding any credential/profile path. */
export function buildCodexLoginScript(
  shellKind: "windows" | "posix",
  completionToken: string,
): string {
  // `codex login` parses provider configuration before opening the browser.
  // The host app may legitimately use a Codex-Router model catalog in its own
  // ~/.codex/config.toml, but that catalog is unrelated to a managed ChatGPT
  // account and may target a different Codex schema. Pin the official provider
  // at the CLI boundary so profile login cannot be poisoned by host defaults.
  const loginCommand = "codex -c model_provider=openai -c sandbox_mode=danger-full-access login";
  if (shellKind === "windows") {
    return [
      "Clear-Host",
      "Remove-Item Env:CODEX_CONFIG_DIR,Env:CODEX_CONFIG_PATH,Env:CODEX_MODEL_CATALOG,Env:CODEX_MODEL_CATALOG_PATH,Env:CODEX_ROUTER_HOME,Env:CODEX_ROUTER_USER_DATA,Env:OPENAI_CODEX_HOME,Env:CODEX_API_KEY,Env:CODEX_ACCESS_TOKEN,Env:OPENAI_API_KEY,Env:CODEX_BASE_URL,Env:CODEX_MODEL_PROVIDER -ErrorAction SilentlyContinue",
      "if (-not $env:CODEX_HOME) { throw 'CODEX_HOME is missing from the isolated login shell.' }",
      "Write-Host ('CraftStation CODEX_HOME=' + $env:CODEX_HOME)",
      "Write-Host ('CraftStation login cwd=' + (Get-Location).Path)",
      loginCommand,
      "$lcExit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }",
      `Write-Host "$([char]27)]777;craftstation-login-complete=${completionToken}:$lcExit$([char]7)" -NoNewline`,
    ].join("; ");
  }
  const bashCommand = [
    "clear",
    "unset CODEX_CONFIG_DIR CODEX_CONFIG_PATH CODEX_MODEL_CATALOG CODEX_MODEL_CATALOG_PATH CODEX_ROUTER_HOME CODEX_ROUTER_USER_DATA OPENAI_CODEX_HOME CODEX_API_KEY CODEX_ACCESS_TOKEN OPENAI_API_KEY CODEX_BASE_URL CODEX_MODEL_PROVIDER",
    'if [ -z "$CODEX_HOME" ]; then echo "CODEX_HOME is missing from the isolated login shell." >&2; exit 1; fi',
    'echo "CraftStation CODEX_HOME=$CODEX_HOME"',
    'echo "CraftStation login cwd=$(pwd)"',
    loginCommand,
    "__lc_exit=$?",
    `printf '\\033]777;craftstation-login-complete=${completionToken}:%s\\007' "$__lc_exit"`,
  ].join("; ");
  return `command bash -lc '${bashCommand.replaceAll("'", "'\\''")}'`;
}
export interface CodexProfileImport {
  label: string;
  profileRoot?: string | undefined;
  providerAccountId?: string;
}

export interface CodexProfileServiceOptions {
  store: AccountStore;
  provider?: string;
}

export class CodexProfileService {
  private readonly provider: string;

  constructor(private readonly options: CodexProfileServiceOptions) {
    this.provider = options.provider ?? "codex";
    // Remove interrupted never-identified pending rows and collapse duplicate
    // ChatGPT identities so the usage list cannot accumulate "账号身份未知".
    this.options.store.cleanupOrphanedPendingAccounts(this.provider);
    this.options.store.dedupeProviderIdentities(this.provider);
  }

  list(): AccountView[] {
    this.options.store.cleanupOrphanedPendingAccounts(this.provider);
    this.options.store.dedupeProviderIdentities(this.provider);
    return this.options.store.list(this.provider);
  }

  importAuthJson(input: CodexProfileImport): AccountView {
    const profileRoot = input.profileRoot?.trim() || join(homedir(), ".codex");
    const authPath = join(profileRoot, "auth.json");
    if (!existsSync(authPath)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Codex auth.json was not found in the selected profile.",
      );
    }
    const authJson = readFileSync(authPath, "utf8");
    const token = parseCodexAuth(authJson);
    if (!token) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "The selected Codex auth.json is invalid or unauthenticated.",
      );
    }
    const email = token.email?.trim();
    // Email is the stable provider identity when Codex omits account_id. Keep
    // it in providerAccountId for future deduplication and use maskedIdentity
    // only for its renderer-safe presentation.
    const providerAccountId = token.accountId?.trim() || email;
    // A valid access token without either stable identity is not importable: it
    // would create a row which cannot be displayed or reliably deduplicated.
    if (!providerAccountId && !email) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "The selected Codex auth.json has no account identity.",
      );
    }
    const existing = this.options.store.findByProviderIdentities(this.provider, [
      providerAccountId,
      email,
    ]);
    const account = existing
      ? this.options.store.get(existing.accountId)!
      : this.options.store.add({
          provider: this.provider,
          label: input.label,
          ...(providerAccountId ? { providerAccountId } : {}),
          ...(email ? { maskedIdentity: email } : {}),
        });
    if (existing) {
      this.options.store.updateProviderMetadata(account.accountId, {
        ...(providerAccountId ? { providerAccountId } : {}),
        ...(email ? { maskedIdentity: email } : {}),
      });
    }
    try {
      // A managed subscription profile is OAuth-only. Codex login can persist a
      // minted `sk-svcacct` key (`OPENAI_API_KEY`) or PAT/agent-identity fields;
      // imported verbatim, they flip the managed runtime into key-auth and hit
      // the ChatGPT backend with a platform key. Project the sanitized blob.
      const managedAuthJson = sanitizeCodexAuthJson(authJson) ?? authJson;
      const credentialRoot = this.options.store.projectCredential({
        accountId: account.accountId,
        provider: this.provider,
        authJson: managedAuthJson,
      });
      ensureManagedCodexHome(credentialRoot);
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      // Reused accounts retain their row and diagnostics on projection failure;
      // only a row created by this import must be removed.
      if (!existing) this.options.store.remove(account.accountId);
      throw error;
    }
  }

  createEmpty(label: string): AccountView {
    return this.options.store.add({ provider: this.provider, label });
  }

  managedCodexHome(accountId: string): string {
    return this.options.store.credentialRoot(accountId);
  }

  private readManagedAuthIdentity(codexHome: string): {
    accountId?: string;
    email?: string;
  } {
    const authPath = join(codexHome, "auth.json");
    if (!existsSync(authPath)) return {};
    try {
      const token = parseCodexAuth(readFileSync(authPath, "utf8"));
      if (!token) return {};
      return {
        ...(token.accountId?.trim() ? { accountId: token.accountId.trim() } : {}),
        ...(token.email?.trim() ? { email: token.email.trim() } : {}),
      };
    } catch {
      return {};
    }
  }

  /**
   * Redeem one deposited reset card, then re-read usage. The card sitting on
   * the account does not lower `used_percent` until this call succeeds.
   */
  async redeemResetCredit(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const codexHome = this.managedCodexHome(accountId);
    const scopedHost: HostPort = {
      ...host,
      credentials: {
        ...host.credentials,
        getOAuthToken: () => resolveCodexToken({ codexHome, allowWslFallback: false }),
      },
    };
    try {
      await consumeCodexResetCredit(scopedHost);
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      throw new AccountControlError("ACCOUNT_PROJECTION_FAILED", lastError);
    }
    return this.collectQuota(accountId, host);
  }

  async collectQuota(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const codexHome = this.managedCodexHome(accountId);
    const scopedHost: HostPort = {
      ...host,
      credentials: {
        ...host.credentials,
        getOAuthToken: () => resolveCodexToken({ codexHome, allowWslFallback: false }),
      },
    };
    let snapshot: UsageSnapshot;
    try {
      snapshot = await collectCodex(scopedHost);
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      return this.options.store.updateStatus(accountId, "error", {
        lastError,
        lastQuotaAt: Date.now(),
      });
    }
    const status =
      snapshot.status === "ok"
        ? quotaStatusForWindows(
            snapshot.windows.filter((window) => window.id !== CODEX_RESET_CREDIT_WINDOW_ID),
          )
        : snapshot.status === "quota-hit"
          ? "quota-exhausted"
          : snapshot.status === "auth-missing"
            ? "auth-expired"
            : "unavailable";
    const authIdentity = this.readManagedAuthIdentity(codexHome);
    const providerAccountId =
      snapshot.authenticatedAs?.trim() ||
      authIdentity.accountId ||
      authIdentity.email ||
      account.providerAccountId;
    const maskedIdentity = authIdentity.email || account.maskedIdentity;
    if (providerAccountId) {
      const duplicate = this.options.store.findByProviderIdentities(this.provider, [
        providerAccountId,
        authIdentity.email,
      ]);
      if (duplicate && duplicate.accountId !== accountId) {
        this.options.store.remove(accountId);
        return this.options.store.get(duplicate.accountId)!;
      }
    }
    if (!providerAccountId) {
      // A probe that cannot name the ChatGPT user is an interrupted/empty
      // profile. Keep it in the store and it becomes another "账号身份未知" row.
      this.options.store.remove(accountId);
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Codex quota probe returned no account identity.",
      );
    }
    const withMetadata = this.options.store.updateProviderMetadata(accountId, {
      providerAccountId,
      ...(maskedIdentity ? { maskedIdentity } : {}),
      ...(snapshot.plan ? { plan: snapshot.plan } : {}),
    });
    const quotaWindows = snapshot.windows.map((window) => ({
      id: window.id,
      label: window.label,
      usedPercent: window.usedPercent,
      ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
      ...(window.limit !== undefined ? { limit: window.limit } : {}),
    }));
    if (
      (status === "available" || status === "quota-low") &&
      shouldPreserveInferenceExhaustion(this.options.store.getRecord(accountId), Date.now())
    ) {
      // A real inference failure outranks % windows (different budget): keep
      // the row out of scheduling, but persist the fresh windows so the bars
      // stay truthful. The mark expires via TTL; newer quota evidence after
      // that recovers the row normally.
      return this.options.store.updateQuota(accountId, quotaWindows) ?? withMetadata;
    }
    const updated = this.options.store.updateStatus(accountId, status, {
      ...(snapshot.error ? { lastError: snapshot.error } : {}),
      lastQuotaAt: snapshot.fetchedAt,
    });
    return this.options.store.updateQuota(accountId, quotaWindows) ?? withMetadata ?? updated;
  }
}
