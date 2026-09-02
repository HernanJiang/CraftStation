import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseCodexAuth, resolveCodexToken } from "./codexCredentials";
import { AccountStore } from "./accountStore";
import type { AccountView } from "@/shared/contracts";
import { AccountControlError } from "@/shared/contracts";
import { collectCodex, type HostPort, type UsageSnapshot } from "@craftstation/agents-usage";

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
 * Isolate a managed Codex login/runtime from the host Codex-Router overlay.
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

const MANAGED_CODEX_CONFIG = [
  "# CraftStation managed Codex profile",
  "# Isolated from the host ~/.codex Codex-Router overlay.",
  'model_provider = "openai"',
  'sandbox_mode = "danger-full-access"',
  "",
  "[windows]",
  'sandbox = "unelevated"',
  "",
].join("\n");

export function ensureManagedCodexHome(managedCodexHome: string): string {
  mkdirSync(managedCodexHome, { recursive: true });
  const configPath = join(managedCodexHome, "config.toml");
  writeFileSync(configPath, MANAGED_CODEX_CONFIG, { encoding: "utf8" });
  return managedCodexHome;
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
      "Remove-Item Env:CODEX_CONFIG_DIR,Env:CODEX_CONFIG_PATH,Env:CODEX_MODEL_CATALOG,Env:CODEX_MODEL_CATALOG_PATH,Env:CODEX_ROUTER_HOME,Env:CODEX_ROUTER_USER_DATA -ErrorAction SilentlyContinue",
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
    "unset CODEX_CONFIG_DIR CODEX_CONFIG_PATH CODEX_MODEL_CATALOG CODEX_MODEL_CATALOG_PATH CODEX_ROUTER_HOME CODEX_ROUTER_USER_DATA",
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
      const credentialRoot = this.options.store.projectCredential({
        accountId: account.accountId,
        provider: this.provider,
        authJson,
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
        ? snapshot.windows.some((window) => window.usedPercent >= 90)
          ? "quota-low"
          : "available"
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
    const withMetadata = this.options.store.updateProviderMetadata(accountId, {
      ...(providerAccountId ? { providerAccountId } : {}),
      ...(maskedIdentity ? { maskedIdentity } : {}),
      ...(snapshot.plan ? { plan: snapshot.plan } : {}),
    });
    const updated = this.options.store.updateStatus(accountId, status, {
      ...(snapshot.error ? { lastError: snapshot.error } : {}),
      lastQuotaAt: snapshot.fetchedAt,
    });
    return (
      this.options.store.updateQuota(
        accountId,
        snapshot.windows.map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
        })),
      ) ??
      withMetadata ??
      updated
    );
  }
}
