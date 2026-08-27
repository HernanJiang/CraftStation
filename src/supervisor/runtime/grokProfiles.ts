import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import { collectGrok, type HostPort, type UsageSnapshot } from "@poracode/agents-usage";
import { AccountStore } from "./accountStore";
import { grokAuthContainer, parseGrokAuth } from "./grokCredentials";

/**
 * Managed Grok account control plane. Grok's official CLI honours `GROK_HOME`
 * as its config/auth root (the OIDC CLI reads `$GROK_HOME/auth.json`), so each
 * CraftStation account owns an opaque managed home under the account store and
 * a session is bound to exactly one account. We never overwrite the host
 * `~/.grok/auth.json` to switch accounts and never import Codex-Router's
 * `xai-*.oauth.json` pool.
 */

const GROK_IDENTITY_KEYS = ["email", "principal_id", "user_id"] as const;

export interface GrokAccountIdentity {
  maskedIdentity: string;
  providerAccountId?: string;
}

function isPlaceholderGrokLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === "" || normalized === "new grok" || normalized === "new account";
}

export function defaultGrokAccountLabel(identity: string): string {
  const local = identity.split("@", 1)[0]?.trim() ?? "";
  return local.slice(0, 3) || "Grok";
}

/** Extract a stable, displayable identity from a parsed Grok auth container. */
export function grokAccountIdentityFromContainer(
  container: Record<string, unknown>,
): GrokAccountIdentity | undefined {
  for (const key of GROK_IDENTITY_KEYS) {
    const value = container[key];
    if (typeof value === "string" && value.trim()) {
      return {
        maskedIdentity: value.trim(),
        ...(key === "email"
          ? { providerAccountId: value.trim() }
          : {
              providerAccountId:
                typeof container.principal_id === "string" && container.principal_id.trim()
                  ? container.principal_id.trim()
                  : value.trim(),
            }),
      };
    }
  }
  return undefined;
}

/**
 * Create the managed home directory for a pending Grok account. No AccountStore
 * entry is written here: a row is only inserted once {@link GrokProfileService
 * .importAuthJson} has verified an official identity, so an aborted login never
 * leaks a phantom account.
 */
export function createPendingGrokHome(managedRoot: string, label: string): string {
  const safe =
    label
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/gu, "-")
      .slice(0, 64) || "grok";
  const home = join(managedRoot, `grok-pending-${safe}-${Date.now().toString(36)}`);
  mkdirSync(home, { recursive: true });
  return home;
}

export interface GrokProfileImportInput {
  label: string;
  /** Absolute managed GROK_HOME written by the official login flow. */
  profileRoot: string;
}

export interface GrokProfileServiceOptions {
  store: AccountStore;
}

export class GrokProfileService {
  private readonly provider = "grok";

  constructor(private readonly options: GrokProfileServiceOptions) {}

  list(): AccountView[] {
    return this.options.store.list(this.provider);
  }

  /**
   * Project an official `auth.json` written into `profileRoot` into a managed
   * account. Requires a verified official identity (email / principal id /
   * user id) — without one the account is NOT inserted.
   */
  importAuthJson(input: GrokProfileImportInput): AccountView {
    const authPath = join(input.profileRoot, "auth.json");
    if (!existsSync(authPath)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Grok auth.json was not found in the managed profile root.",
      );
    }
    const content = readFileSync(authPath, "utf8");
    const parsed: unknown = safeParseJson(content);
    const found = grokAuthContainer(parsed);
    if (!found) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "The managed Grok auth.json is invalid or unauthenticated.",
      );
    }
    const identity = grokAccountIdentityFromContainer(found.container);
    if (!identity) {
      // No official email / principal / user id => do not create the row.
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "No official Grok identity was found; the account was not inserted.",
      );
    }
    const account = this.options.store.add({
      provider: this.provider,
      // v0.5 default alias contract: placeholder labels are rewritten by the
      // store to "<Provider> Account N". Explicit user labels are preserved.
      label: input.label.trim() && !isPlaceholderGrokLabel(input.label) ? input.label : "New Grok",
      maskedIdentity: identity.maskedIdentity,
      enabled: true,
      ...(identity.providerAccountId ? { providerAccountId: identity.providerAccountId } : {}),
    });
    try {
      const managedRoot = this.options.store.projectCredential({
        accountId: account.accountId,
        provider: this.provider,
        authJson: content,
        environment: { GROK_HOME: this.options.store.credentialRoot(account.accountId) },
      });
      ensureManagedGrokHome(managedRoot);
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      this.options.store.remove(account.accountId);
      throw error;
    }
  }

  /**
   * Account-scoped quota collection (v0.5 T07). Reads only the managed
   * GROK_HOME/auth.json for this account and maps snapshot status onto the
   * account row so A/B quota/reset/status stay isolated. Never touches the host
   * ~/.grok or Codex-Router oauth pool.
   */
  async collectQuota(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const grokHome = this.managedGrokHome(accountId);
    const authPath = join(grokHome, "auth.json");
    let token: ReturnType<typeof parseGrokAuth> | undefined;
    if (existsSync(authPath)) {
      token = parseGrokAuth(readFileSync(authPath, "utf8"));
    }
    const scopedHost: HostPort = {
      ...host,
      credentials: {
        ...host.credentials,
        getOAuthToken: async () =>
          token?.accessToken ? { accessToken: token.accessToken } : undefined,
        getSecret: async () => undefined,
      },
    };
    let snapshot: UsageSnapshot;
    try {
      snapshot = await collectGrok(scopedHost);
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
            : snapshot.status === "rate-limited"
              ? "quota-low"
              : "unavailable";
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
      ) ?? updated
    );
  }

  managedGrokHome(accountId: string): string {
    return this.options.store.credentialRoot(accountId);
  }
}

function safeParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/**
 * Isolate a managed Grok runtime from the host CLI/Router overlay: pin
 * `GROK_HOME` to the managed root and strip variables that could redirect the
 * official binary onto another account (CLIProxy / Router / catalog).
 */
export function managedGrokProcessEnvironment(
  managedGrokHome: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  // ACP spawn and the login shell both spread `process.env` first and then the
  // provided env on top (`{ ...process.env, ...command.env }`). Omitting a key
  // is therefore NOT enough to isolate: the host value would leak back. We
  // explicitly overwrite the offending keys with an empty value so the later
  // spread reliably blanks them regardless of host presence.
  const blankKeys = new Set<string>();
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      upper.includes("CLIPROXY") ||
      upper.includes("CODEX_ROUTER") ||
      upper.includes("MODEL_CATALOG") ||
      upper.includes("GROK_API_KEY") ||
      upper.includes("XAI_API_KEY")
    ) {
      blankKeys.add(key);
      continue;
    }
    env[key] = value;
  }
  for (const key of blankKeys) env[key] = "";
  env.GROK_HOME = managedGrokHome;
  ensureManagedGrokHome(managedGrokHome);
  return env;
}

export function ensureManagedGrokHome(managedGrokHome: string): string {
  mkdirSync(managedGrokHome, { recursive: true });
  return managedGrokHome;
}

/** Build a login script that runs the official device-auth flow inside the managed home. */
export function buildGrokLoginScript(
  shellKind: "windows" | "posix",
  completionToken: string,
): string {
  const loginCommand = "grok login --device-auth";
  if (shellKind === "windows") {
    return [
      "Clear-Host",
      "Remove-Item Env:GROK_API_KEY,Env:XAI_API_KEY -ErrorAction SilentlyContinue",
      "if (-not $env:GROK_HOME) { throw 'GROK_HOME is missing from the isolated login shell.' }",
      "Write-Host ('CraftStation GROK_HOME=' + $env:GROK_HOME)",
      loginCommand,
      "$lcExit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }",
      `Write-Host "$([char]27)]777;poracode-login-complete=${completionToken}:$lcExit$([char]7)" -NoNewline`,
    ].join("; ");
  }
  const bashCommand = [
    "clear",
    'if [ -z "$GROK_HOME" ]; then echo "GROK_HOME is missing from the isolated login shell." >&2; exit 1; fi',
    'echo "CraftStation GROK_HOME=$GROK_HOME"',
    loginCommand,
    "__lc_exit=$?",
    `printf '\\033]777;poracode-login-complete=${completionToken}:%s\\007' "$__lc_exit"`,
  ].join("; ");
  return `command bash -lc '${bashCommand.replaceAll("'", "'\\''")}'`;
}

/** Login cwd that never resolves into the host `~/.grok`. */
export function managedGrokLoginCwd(managedGrokHome: string): string {
  ensureManagedGrokHome(managedGrokHome);
  return managedGrokHome;
}
