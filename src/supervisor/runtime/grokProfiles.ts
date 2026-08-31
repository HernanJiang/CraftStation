import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import {
  collectGrok,
  fetchGrokSettings,
  planFromSettings,
  type HostPort,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
  type UsageSnapshot,
} from "@poracode/agents-usage";
import { AccountStore } from "./accountStore";
import { grokAuthContainer, parseGrokAuth, parseGrokCookie } from "./grokCredentials";
import { refreshRejectedGrokToken } from "./grokTokenRefresh";
import { UsageHttpError } from "./usageHttpClient";
import {
  NativeGrokQuotaRpcError,
  nativeGrokQuotaProbeOptions,
  probeNativeGrokBilling,
} from "./grokQuotaNative";
import { collectManagedGrokTokenQuota } from "./grokQuotaTokenFallback";

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
  const nestedCandidates: Record<string, unknown>[] = [container];
  for (const key of ["user", "account", "profile", "identity"]) {
    const value = container[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      nestedCandidates.push(value as Record<string, unknown>);
    }
  }
  // Nested user objects first: a container like { user: { email } } must yield
  // the real email instead of "账号身份未知".
  for (const candidate of [...nestedCandidates.slice(1), ...nestedCandidates]) {
    for (const key of GROK_IDENTITY_KEYS) {
      const value = candidate[key];
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
  nativeQuotaProbe?: typeof probeNativeGrokBilling;
  tokenQuotaProbe?: typeof collectManagedGrokTokenQuota;
}

type GrokQuotaTransportIssue =
  | { kind: "timeout" | "abort" | "network" | "unsupported-method" }
  | { kind: "http"; status: number };

interface GrokQuotaTransportState {
  issue?: GrokQuotaTransportIssue;
}

function classifyGrokQuotaTransportError(error: unknown): GrokQuotaTransportIssue {
  const rawCode =
    error && typeof error === "object"
      ? ((error as { code?: unknown; rpcCode?: unknown }).rpcCode ??
        (error as { code?: unknown }).code)
      : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (
    (error instanceof NativeGrokQuotaRpcError || rawCode === -32601 || rawCode === "-32601") &&
    (rawCode === -32601 ||
      rawCode === "-32601" ||
      /method\s+not\s+found|unsupported\s+method/iu.test(rawMessage))
  ) {
    return { kind: "unsupported-method" };
  }
  if (error instanceof UsageHttpError && error.kind === "timeout") {
    return { kind: "timeout" };
  }
  const candidate =
    error && typeof error === "object"
      ? (error as { code?: unknown; name?: unknown; message?: unknown })
      : undefined;
  const code = typeof candidate?.code === "string" ? candidate.code.toLowerCase() : "";
  const name = typeof candidate?.name === "string" ? candidate.name.toLowerCase() : "";
  const message = typeof candidate?.message === "string" ? candidate.message : String(error);
  if (
    name === "timeouterror" ||
    code === "etimedout" ||
    /\b(?:timed?\s*out|timeout|deadline exceeded)\b/i.test(message)
  ) {
    return { kind: "timeout" };
  }
  if (name === "aborterror" || code === "abort_err" || /\babort(?:ed|ing)?\b/i.test(message)) {
    return { kind: "abort" };
  }
  return { kind: "network" };
}

function observeGrokQuotaHttp(host: HostPort, state: GrokQuotaTransportState): HttpClient {
  return {
    request: async (request: HttpRequest): Promise<HttpResponse> => {
      try {
        const response = await host.http.request(request);
        if (response.status < 200 || response.status >= 300) {
          state.issue = { kind: "http", status: response.status };
        }
        return response;
      } catch (error) {
        state.issue = classifyGrokQuotaTransportError(error);
        throw error;
      }
    },
  };
}

function grokQuotaFailureMessage(
  snapshot: UsageSnapshot,
  issue: GrokQuotaTransportIssue | undefined,
): string | undefined {
  const original = snapshot.error?.trim();
  let prefix: string | undefined;
  if (snapshot.status === "auth-missing") {
    prefix = "Grok authentication required";
  } else if (issue?.kind === "timeout") {
    prefix = "Grok quota request timed out";
  } else if (issue?.kind === "abort") {
    prefix = "Grok quota request aborted";
  } else if (issue?.kind === "http") {
    prefix = `Grok quota request failed (HTTP ${issue.status})`;
  } else if (issue?.kind === "network") {
    prefix = "Grok quota request failed (network)";
  } else if (issue?.kind === "unsupported-method") {
    prefix = "Grok billing RPC unsupported; token billing fallback failed";
  }
  if (!prefix) return original || undefined;
  if (!original) return prefix;
  if (
    (issue?.kind === "http" && original.includes(`HTTP ${issue.status}`)) ||
    original.toLowerCase().includes(prefix.toLowerCase())
  ) {
    return original;
  }
  return `${prefix}: ${original}`;
}

export class GrokProfileService {
  private readonly provider = "grok";
  private readonly nativeQuotaProbe: typeof probeNativeGrokBilling;
  private readonly tokenQuotaProbe: typeof collectManagedGrokTokenQuota;

  constructor(private readonly options: GrokProfileServiceOptions) {
    this.nativeQuotaProbe = options.nativeQuotaProbe ?? probeNativeGrokBilling;
    this.tokenQuotaProbe = options.tokenQuotaProbe ?? collectManagedGrokTokenQuota;
  }

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
    let cookie: string | undefined;
    if (existsSync(authPath)) {
      const content = readFileSync(authPath, "utf8");
      token = parseGrokAuth(content);
      cookie = parseGrokCookie(content);
    }
    const transport: GrokQuotaTransportState = {};
    let nativeIssue: GrokQuotaTransportIssue | undefined;
    let tokenFallbackError: string | undefined;
    const managedEnv = managedGrokProcessEnvironment(grokHome);
    const persistPlan = async (existingPlan?: string): Promise<void> => {
      if (existingPlan?.trim()) {
        this.options.store.updateProviderMetadata(accountId, { plan: existingPlan });
        return;
      }
      if (!token?.accessToken) return;
      try {
        const settings = await fetchGrokSettings(host, token.accessToken);
        const plan = planFromSettings(settings);
        if (plan) this.options.store.updateProviderMetadata(accountId, { plan });
      } catch {
        // Plan is supplementary; never turn a successful quota read into a
        // failed account refresh when the settings endpoint is unavailable.
      }
    };
    try {
      const native = await this.nativeQuotaProbe(
        nativeGrokQuotaProbeOptions(grokHome, grokHome, managedEnv),
      );
      const nativeStatus = native.windows.some((window) => window.usedPercent >= 90)
        ? "quota-low"
        : "available";
      const updated = this.options.store.updateStatus(accountId, nativeStatus, {
        lastQuotaAt: native.fetchedAt,
      });
      await persistPlan();
      return this.options.store.updateQuota(accountId, native.windows) ?? updated;
    } catch (nativeError) {
      // The official runtime is authoritative when it returns a real window;
      // a transient/unsupported native billing call falls back to the existing
      // provider collector, which retains its honest transport diagnostics.
      nativeIssue = classifyGrokQuotaTransportError(nativeError);
      transport.issue = nativeIssue;
    }
    if (token?.accessToken && host.http) {
      const tokenQuota = await this.tokenQuotaProbe({
        http: host.http,
        token,
        now: host.now,
        refreshToken: async (rejectedToken) =>
          refreshRejectedGrokToken(rejectedToken, undefined, authPath),
      });
      if (tokenQuota.ok) {
        const tokenStatus = tokenQuota.windows.some((window) => window.usedPercent >= 90)
          ? "quota-low"
          : "available";
        const updated = this.options.store.updateStatus(accountId, tokenStatus, {
          lastQuotaAt: tokenQuota.fetchedAt,
        });
        await persistPlan();
        return this.options.store.updateQuota(accountId, tokenQuota.windows) ?? updated;
      }
      tokenFallbackError = `${tokenQuota.errorClass}: ${tokenQuota.error}`;
    }
    // A managed bearer is the complete token billing path. If it did not
    // produce a window and the account has no actual Grok web cookie, do not
    // invoke the legacy collector again: that would repeat the same bearer
    // requests and turn the useful token-billing diagnosis into a generic
    // network error. Cookie fallback is allowed only when a cookie was really
    // found in this account's managed auth.json.
    if (token?.accessToken && !cookie) {
      const tokenErrorClass = tokenFallbackError?.split(":", 1)[0];
      const tokenStatus = tokenErrorClass === "auth" ? "auth-expired" : "unavailable";
      const lastError =
        nativeIssue?.kind === "unsupported-method" && tokenFallbackError
          ? `Grok billing RPC unsupported; token billing fallback failed: ${tokenFallbackError}`
          : (tokenFallbackError ?? "Grok token billing returned no quota window.");
      return this.options.store.updateStatus(accountId, tokenStatus, {
        lastError,
        lastQuotaAt: Date.now(),
      });
    }
    const scopedHost: HostPort = {
      ...host,
      http: observeGrokQuotaHttp(host, transport),
      credentials: {
        getOAuthToken: async () =>
          token?.accessToken ? { accessToken: token.accessToken } : undefined,
        refreshOAuthToken: async (providerId, rejectedToken) =>
          providerId === "grok"
            ? refreshRejectedGrokToken(rejectedToken, undefined, authPath)
            : undefined,
        getSecret: async (providerId, key) =>
          providerId === "grok" && key === "cookie" ? cookie : undefined,
      },
    };
    let snapshot: UsageSnapshot;
    try {
      snapshot = await collectGrok(scopedHost);
    } catch (error) {
      const baseError = error instanceof Error ? error.message : String(error);
      const issue = transport.issue ?? classifyGrokQuotaTransportError(error);
      const lastError = grokQuotaFailureMessage(
        {
          providerId: "grok",
          status: "error",
          windows: [],
          fetchedAt: Date.now(),
          error: baseError,
        },
        issue,
      )!;
      return this.options.store.updateStatus(accountId, "error", {
        lastError,
        lastQuotaAt: Date.now(),
      });
    }
    const snapshotError =
      snapshot.status === "auth-missing"
        ? grokQuotaFailureMessage(snapshot, transport.issue)
        : nativeIssue?.kind === "unsupported-method"
          ? tokenFallbackError
            ? `Grok billing RPC unsupported; token billing fallback failed: ${tokenFallbackError}`
            : `Grok billing RPC unsupported; legacy Grok fallback failed: ${
                grokQuotaFailureMessage(snapshot, transport.issue) ??
                snapshot.error ??
                "no quota window was returned"
              }`
          : snapshot.status === "ok"
            ? snapshot.error
            : grokQuotaFailureMessage(snapshot, transport.issue);
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
    const withMetadata = this.options.store.updateProviderMetadata(accountId, {
      ...(snapshot.authenticatedAs ? { providerAccountId: snapshot.authenticatedAs } : {}),
      ...(snapshot.plan ? { plan: snapshot.plan } : {}),
    });
    const updated = this.options.store.updateStatus(accountId, status, {
      ...(snapshotError ? { lastError: snapshotError } : {}),
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
