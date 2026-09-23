/**
 * Managed Kimi Code profile isolation.
 *
 * Based on subswap Kimi provider isolation:
 * MIT License, Copyright (c) 2026 subswap contributors
 *
 * Pins KIMI_CODE_HOME to the managed account credential root so each Kimi account
 * operates in an isolated filesystem and credential namespace.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AccountControlError, type AccountView } from "@/shared/contracts";
import { shouldPreserveInferenceExhaustion } from "./accountStore";
import {
  collectKimi,
  quotaStatusFromWindows,
  type HostPort,
  type UsageSnapshot,
} from "@craftstation/agents-usage";
import { writeFileAtomic } from "@/shared/atomicFile";
import { resolveKimiManagedHomeToken } from "./kimiCredentials";

const KIMI_ROUTER_ENV_KEYS = [
  "KIMI_CODE_HOME",
  "KIMI_ROUTER_HOME",
  "KIMI_CODE_API_KEY",
  "KIMI_CODE_BASE_URL",
  "CLIPROXY_HOME",
  "CODEX_ROUTER_HOME",
] as const;

/**
 * Compatibility-bridge endpoint keys. Native Kimi runs must never inherit
 * these: only a non-native model on the native vendor may go through CPA,
 * everything else runs the official CLI against the account pool.
 */
export const KIMI_COMPATIBILITY_ENV_KEYS = [
  "KIMI_BASE_URL",
  "KIMI_API_KEY",
  "KIMI_PROTOCOL",
] as const;

const KIMI_IDENTITY_KEYS = [
  "email",
  "user_email",
  "userId",
  "user_id",
  "accountId",
  "account_id",
  "subject",
  "sub",
] as const;

const KIMI_TOKEN_KEYS = [
  "access_token",
  "refresh_token",
  "id_token",
  "accessToken",
  "refreshToken",
  "idToken",
] as const;

/**
 * Isolate a managed Kimi runtime from the host environment:
 * pin `KIMI_CODE_HOME` to the managed root and blank routing/proxy keys.
 */
export function managedKimiProcessEnvironment(
  managedKimiHome: string,
  baseEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  const blankKeys = new Set<string>();
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (
      KIMI_ROUTER_ENV_KEYS.includes(key as (typeof KIMI_ROUTER_ENV_KEYS)[number]) ||
      (KIMI_COMPATIBILITY_ENV_KEYS as readonly string[]).includes(upper) ||
      upper.includes("CLIPROXY") ||
      upper.includes("CODEX_ROUTER") ||
      upper.includes("MODEL_CATALOG")
    ) {
      blankKeys.add(key);
      continue;
    }
    env[key] = value;
  }
  for (const key of blankKeys) env[key] = "";
  env.KIMI_CODE_HOME = managedKimiHome;
  ensureManagedKimiHome(managedKimiHome);
  ensureManagedKimiRuntimeConfig(managedKimiHome);
  return env;
}

function ensureManagedKimiRuntimeConfig(managedKimiHome: string): void {
  // Upgrade API-key profiles created by older CraftStation versions. Kimi
  // Code no longer consumes KIMI_CODE_API_KEY from the process environment;
  // the provider declaration must survive in config.toml instead.
  const managedApiKey = readManagedKimiApiKey(managedKimiHome);
  if (managedApiKey) {
    writeFileAtomic(join(managedKimiHome, "config.toml"), kimiApiKeyConfigToml(managedApiKey), {
      encoding: "utf8",
      mode: 0o600,
    });
    return;
  }
  // The CLI discovers OAuth through a provider declaration, not by scanning
  // credentials/. Repair old imported homes, but preserve configurations
  // written by an official login (including region and custom model settings).
  if (existsSync(join(managedKimiHome, "config.toml"))) return;
  let credential: unknown;
  try {
    credential = JSON.parse(readFileSync(credentialPath(managedKimiHome), "utf8"));
  } catch {
    return;
  }
  if (!hasKimiCredentialMaterial(credential)) return;
  writeFileAtomic(join(managedKimiHome, "config.toml"), kimiRuntimeConfigToml(), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function hasKimiCredentialMaterial(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  // A refreshable OAuth file remains usable even when its access token expired.
  // File presence or identity metadata alone is not a login credential.
  return [record.access_token, record.refresh_token].some(
    (token) => typeof token === "string" && token.trim().length > 0,
  );
}

/** Long-lived API key stored in a managed home (not an OAuth access token). */
export function readManagedKimiApiKey(managedKimiHome: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialPath(managedKimiHome), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const access = typeof record.access_token === "string" ? record.access_token.trim() : "";
    if (!access) return undefined;
    const tokenType =
      typeof record.token_type === "string" ? record.token_type.trim().toLowerCase() : "";
    if (tokenType === "api_key") return access;
    const refresh = typeof record.refresh_token === "string" ? record.refresh_token.trim() : "";
    const expires = record.expires_at ?? record.expiresAt;
    if (!refresh && expires == null) return access;
    return undefined;
  } catch {
    return undefined;
  }
}

export function ensureManagedKimiHome(managedKimiHome: string): string {
  mkdirSync(managedKimiHome, { recursive: true });
  mkdirSync(join(managedKimiHome, "credentials"), { recursive: true });
  return managedKimiHome;
}

export interface KimiProfileServiceOptions {
  store: import("./accountStore").AccountStore;
  /** Override the official CLI home used when recovering a leaked host login. */
  hostKimiHome?: string;
}

export interface KimiProfileImportInput {
  label: string;
  profileRoot?: string | undefined;
}

export interface KimiProfileApiKeyInput {
  accountId?: string | undefined;
  label: string;
  apiKey: string;
}

function isLikelyJwt(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 3 && (parts[0] ?? "").startsWith("eyJ") && (parts[1] ?? "").length > 0;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  if (!isLikelyJwt(token)) return undefined;
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function identityFromRecord(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const key of KIMI_IDENTITY_KEYS) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim() && !isLikelyJwt(candidate.trim())) {
      values.push(candidate.trim());
    }
  }
  return values;
}

/**
 * Official Kimi Code CLI credentials are OAuth token files: they often have no
 * email/user object, only `access_token` / `refresh_token` JWTs whose payload
 * carries `user_id` / `sub`. Accept those claims as provider identity. Never
 * treat the raw bearer string, JWT `type`, or issuer as an account id.
 */
export function kimiCredentialIdentities(value: unknown, depth = 0): string[] {
  if (depth > 5 || value == null) return [];
  if (typeof value === "string") {
    const payload = decodeJwtPayload(value);
    return payload ? kimiCredentialIdentities(payload, depth + 1) : [];
  }
  if (typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const values: string[] = [...identityFromRecord(record)];
  for (const key of KIMI_TOKEN_KEYS) {
    const token = record[key];
    if (typeof token === "string") values.push(...kimiCredentialIdentities(token, depth + 1));
  }
  const skip = new Set<string>([...KIMI_IDENTITY_KEYS, ...KIMI_TOKEN_KEYS]);
  for (const [key, child] of Object.entries(record)) {
    if (skip.has(key)) continue;
    values.push(...kimiCredentialIdentities(child, depth + 1));
  }
  const unique = [...new Set(values)];
  const emails = unique.filter((item) => item.includes("@"));
  const rest = unique.filter((item) => !item.includes("@"));
  return [...emails, ...rest];
}

function credentialPath(root: string): string {
  return join(root, "credentials", "kimi-code.json");
}

/**
 * Fallback provider identity for API-key-style Kimi credentials that carry no
 * JWT/email identity at all (only `providers.api_key` in config or a bare
 * token file). Importing must still succeed — the label plus a short content
 * hash keeps each distinct credential on its own account row instead of
 * failing with `ACCOUNT_IDENTITY_UNAVAILABLE`.
 */
export function kimiFallbackIdentity(label: string, content: string): string {
  const digest = createHash("sha256").update(content, "utf8").digest("hex").slice(0, 6);
  const base = label.trim() || "Kimi";
  return `${base} · ${digest}`;
}

function powershellSingleQuoted(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function posixSingleQuoted(value: string): string {
  // POSIX single-quote escaping: close the quote, insert an escaped quote
  // (\'), reopen — spelled via char codes so the literal needs no escapes.
  const quote = String.fromCharCode(39);
  const escaped = String.fromCharCode(92) + quote;
  return quote + value.replaceAll(quote, escaped) + quote;
}

export class KimiProfileService {
  private readonly provider = "kimi";

  constructor(private readonly options: KimiProfileServiceOptions) {
    this.options.store.cleanupOrphanedPendingAccounts(this.provider);
    this.options.store.dedupeProviderIdentities(this.provider);
  }

  managedKimiHome(accountId: string): string {
    return this.options.store.credentialRoot(accountId);
  }

  /**
   * Collect the Kimi For Coding quota for one managed account through the
   * official usages endpoint (host credential resolution includes the managed
   * homes and refreshes a stale token in place). The account row then carries
   * the same plan/windows shape as the Grok/OpenAI-compatible rows.
   */
  async collectQuota(accountId: string, host: HostPort): Promise<AccountView> {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    // Account-scoped credential: this row's quota must come from its own
    // managed kimi-code.json (refreshing it in place when stale), never from
    // whatever token happens to be ambient. The shared-host resolver mixes
    // accounts and flips rows between available and auth-expired.
    const kimiHome = this.managedKimiHome(accountId);
    const scopedHost: HostPort = {
      ...host,
      credentials: {
        ...host.credentials,
        getOAuthToken: () => resolveKimiManagedHomeToken(kimiHome),
      },
    };
    const snapshot = await collectKimi(scopedHost).catch(
      (error: unknown): UsageSnapshot => ({
        providerId: "kimi",
        status: "error",
        windows: [],
        fetchedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    if (snapshot.status === "auth-missing" || snapshot.status === "error") {
      const expired = snapshot.status === "auth-missing";
      return this.options.store.updateStatus(accountId, expired ? "auth-expired" : "unavailable", {
        lastError: snapshot.error ?? "Kimi Code 凭据不可用，请重新登录或填写 API Key。",
        lastQuotaAt: Date.now(),
      });
    }
    if (snapshot.status === "rate-limited") {
      const updated = this.options.store.updateStatus(accountId, "quota-exhausted", {
        lastQuotaAt: Date.now(),
      });
      return this.options.store.updateQuota(accountId, []) ?? updated;
    }

    const quotaWindows = snapshot.windows.map(({ id, label, usedPercent, resetsAt }) => ({
      id,
      label,
      usedPercent,
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    }));
    const quotaView = this.options.store.updateQuota(accountId, quotaWindows);
    const status = quotaStatusFromWindows("kimi", snapshot.windows);
    if (
      (status === "available" || status === "quota-low") &&
      shouldPreserveInferenceExhaustion(this.options.store.getRecord(accountId), Date.now())
    ) {
      // A fresh inference failure outranks % windows (different budget): keep
      // the row out of scheduling; the windows above stay truthful. The mark
      // expires via TTL; newer quota evidence after that recovers normally.
      return quotaView;
    }
    const updated = this.options.store.updateStatus(accountId, status, {
      lastQuotaAt: Date.now(),
    });
    if (snapshot.plan) {
      return (
        this.options.store.updateProviderMetadata(accountId, { plan: snapshot.plan }) ?? updated
      );
    }
    return updated;
  }

  createEmpty(label: string): AccountView {
    return this.options.store.add({ provider: this.provider, label });
  }

  /**
   * Create, reuse, or re-key a managed Kimi account. The official CLI reads
   * provider credentials from config.toml and deliberately ignores ordinary
   * shell API-key variables, so config.toml is the runtime source of truth.
   * The credential JSON remains an account-scoped copy for quota collection.
   */
  importApiKey(input: KimiProfileApiKeyInput): AccountView {
    const apiKey = input.apiKey.trim();
    if (!apiKey) {
      throw new AccountControlError("ACCOUNT_PROJECTION_FAILED", "Kimi API Key 不能为空。");
    }
    const content = JSON.stringify({ access_token: apiKey, token_type: "api_key" }, null, 2);
    const identity = kimiFallbackIdentity(input.label, content);
    const targeted = input.accountId ? this.options.store.getRecord(input.accountId) : undefined;
    if (input.accountId && !targeted) {
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${input.accountId}'.`);
    }
    if (targeted && targeted.provider !== this.provider) {
      throw new AccountControlError(
        "ACCOUNT_RUNTIME_UNSUPPORTED",
        "Kimi API Key can only target a Kimi account.",
      );
    }
    const existing = targeted ?? this.options.store.findByProviderIdentity(this.provider, identity);
    const account = existing
      ? this.options.store.get(existing.accountId)!
      : this.options.store.add({
          provider: this.provider,
          label: input.label,
          providerAccountId: identity,
          maskedIdentity: identity,
        });
    try {
      const root = this.options.store.credentialRoot(account.accountId);
      ensureManagedKimiHome(root);
      writeFileAtomic(credentialPath(root), content, { encoding: "utf8", mode: 0o600 });
      writeFileAtomic(join(root, "config.toml"), kimiApiKeyConfigToml(apiKey), {
        encoding: "utf8",
        mode: 0o600,
      });
      this.options.store.updateProviderMetadata(account.accountId, {
        providerAccountId: identity,
        maskedIdentity: identity,
      });
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      if (!existing) this.options.store.remove(account.accountId);
      throw error;
    }
  }

  /** Copy a global Kimi login into an account-owned root. The global home is
   * never used as a runtime home and the credential never crosses IPC. */
  importCredential(input: KimiProfileImportInput): AccountView {
    const sourceRoot = input.profileRoot?.trim() || join(homedir(), ".kimi-code");
    const source = credentialPath(sourceRoot);
    if (!existsSync(source)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code credential file was not found in the selected profile.",
      );
    }
    let content: string;
    let parsed: unknown;
    try {
      content = readFileSync(source, "utf8");
      parsed = JSON.parse(content);
    } catch {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "The selected Kimi Code credential is malformed.",
      );
    }
    // API-key-style credentials carry no JWT/email identity: fall back to a
    // label + content-hash identity so the import still succeeds on its own
    // account row instead of failing outright.
    if (!hasKimiCredentialMaterial(parsed)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code credential contains no access token or refresh token. Please sign in again.",
      );
    }
    const identity =
      kimiCredentialIdentities(parsed)[0] ?? kimiFallbackIdentity(input.label, content);
    const existing = this.options.store.findByProviderIdentity(this.provider, identity);
    const account = existing
      ? this.options.store.get(existing.accountId)!
      : this.options.store.add({
          provider: this.provider,
          label: input.label,
          providerAccountId: identity,
          maskedIdentity: identity,
        });
    try {
      const root = this.options.store.credentialRoot(account.accountId);
      ensureManagedKimiHome(root);
      writeFileAtomic(credentialPath(root), content, { encoding: "utf8", mode: 0o600 });
      ensureManagedKimiRuntimeConfig(root);
      return this.options.store.updateStatus(account.accountId, "available");
    } catch (error) {
      if (!existing) this.options.store.remove(account.accountId);
      throw error;
    }
  }

  /** Promote a login-created row only after the managed credential has an
   * actual identity. An empty or malformed login can never become runnable. */
  completeLogin(accountId: string): AccountView {
    const account = this.options.store.getRecord(accountId);
    if (!account)
      throw new AccountControlError("ACCOUNT_NOT_FOUND", `Unknown account '${accountId}'.`);
    const managedRoot = this.options.store.credentialRoot(accountId);
    const managedPath = credentialPath(managedRoot);
    const hostRoot = this.options.hostKimiHome?.trim() || join(homedir(), ".kimi-code");
    const hostPath = credentialPath(hostRoot);
    let path = managedPath;
    if (!existsSync(path) && existsSync(hostPath)) {
      // Isolated login sometimes still writes the official CLI home. Recover
      // the just-created host credential into the managed root instead of
      // failing a successful `kimi acp --login`.
      const content = readFileSync(hostPath, "utf8");
      ensureManagedKimiHome(managedRoot);
      writeFileAtomic(managedPath, content, { encoding: "utf8", mode: 0o600 });
      path = managedPath;
    }
    if (!existsSync(path)) {
      throw new AccountControlError(
        "ACCOUNT_IDENTITY_UNAVAILABLE",
        "Kimi Code login did not create a credential.",
        { accountId },
      );
    }
    let parsed: unknown;
    let raw = "";
    try {
      raw = readFileSync(path, "utf8");
      parsed = JSON.parse(raw);
    } catch {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code login produced a malformed credential.",
        { accountId },
      );
    }
    const identity =
      kimiCredentialIdentities(parsed)[0] ?? kimiFallbackIdentity(account.label, raw);
    const expected = account.providerAccountId?.trim() || account.maskedIdentity?.trim();
    if (expected && expected.toLowerCase() !== identity.toLowerCase()) {
      throw new AccountControlError(
        "PROFILE_IDENTITY_MISMATCH",
        "Kimi Code login produced credentials for a different account.",
        { accountId, expected, actual: identity },
      );
    }
    if (!hasKimiCredentialMaterial(parsed)) {
      throw new AccountControlError(
        "ACCOUNT_PROJECTION_FAILED",
        "Kimi Code login did not create a usable credential. Please sign in again.",
        { accountId },
      );
    }
    ensureManagedKimiRuntimeConfig(managedRoot);
    this.options.store.updateProviderMetadata(accountId, {
      providerAccountId: identity,
      maskedIdentity: identity,
    });
    return this.options.store.updateStatus(accountId, "available");
  }
}

export function buildKimiLoginScript(
  shellKind: "windows" | "posix",
  completionToken: string,
  managedKimiHome: string,
): string {
  const command = "kimi acp --login";
  if (shellKind === "windows") {
    const quotedHome = powershellSingleQuoted(managedKimiHome);
    return [
      "Clear-Host",
      "Remove-Item Env:KIMI_CODE_API_KEY,Env:KIMI_CODE_BASE_URL,Env:KIMI_ROUTER_HOME -ErrorAction SilentlyContinue",
      `$env:KIMI_CODE_HOME = ${quotedHome}`,
      "if (-not $env:KIMI_CODE_HOME) { throw 'KIMI_CODE_HOME is missing from the isolated login shell.' }",
      "Write-Host ('CraftStation KIMI_CODE_HOME=' + $env:KIMI_CODE_HOME)",
      command,
      "$lcExit = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }",
      `Write-Host "$([char]27)]777;craftstation-login-complete=${completionToken}:$lcExit$([char]7)" -NoNewline`,
    ].join("; ");
  }
  const bash = [
    "clear",
    "unset KIMI_CODE_API_KEY KIMI_CODE_BASE_URL KIMI_ROUTER_HOME",
    `export KIMI_CODE_HOME=${managedKimiHome}`,
    'if [ -z "$KIMI_CODE_HOME" ]; then echo "KIMI_CODE_HOME is missing from the isolated login shell." >&2; exit 1; fi',
    'echo "CraftStation KIMI_CODE_HOME=$KIMI_CODE_HOME"',
    command,
    "__lc_exit=$?",
    `printf '\\033]777;craftstation-login-complete=${completionToken}:%s\\007' "$__lc_exit"`,
  ].join("; ");
  return "command bash -lc " + posixSingleQuoted(bash);
}

export function managedKimiLoginCwd(managedKimiHome: string): string {
  return ensureManagedKimiHome(managedKimiHome);
}

function kimiApiKeyConfigToml(apiKey: string): string {
  return kimiRuntimeConfigToml(apiKey);
}

/** OAuth references the account-owned credential file; never embed its token. */
function kimiRuntimeConfigToml(apiKey?: string): string {
  const provider = apiKey === undefined ? "managed:kimi-code" : "kimi-code";
  const escaped = apiKey?.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const config = [
    'default_model = "kimi-code/kimi-for-coding"',
    "",
    apiKey === undefined ? '[providers."managed:kimi-code"]' : "[providers.kimi-code]",
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    ...(apiKey === undefined
      ? ['[providers."managed:kimi-code".oauth]', 'storage = "file"', 'key = "oauth/kimi-code"']
      : [`api_key = "${escaped}"`]),
    "",
    '[models."kimi-code/kimi-for-coding"]',
    `provider = "${provider}"`,
    'model = "kimi-for-coding"',
    "max_context_size = 262144",
    'capabilities = ["thinking", "always_thinking", "image_in", "video_in", "tool_use"]',
    'display_name = "K2.7 Coding"',
    "",
    '[models."kimi-code/kimi-for-coding-highspeed"]',
    `provider = "${provider}"`,
    'model = "kimi-for-coding-highspeed"',
    "max_context_size = 262144",
    'capabilities = ["thinking", "always_thinking", "image_in", "video_in", "tool_use"]',
    'display_name = "K2.7 Coding Highspeed"',
    "",
    '[models."kimi-code/k3"]',
    `provider = "${provider}"`,
    'model = "k3"',
    "max_context_size = 1048576",
    'capabilities = ["thinking", "always_thinking", "image_in", "video_in", "tool_use"]',
    'display_name = "K3"',
    'support_efforts = ["low", "high", "max"]',
    'default_effort = "high"',
    "",
    '[models."kimi-code/k3-256k"]',
    `provider = "${provider}"`,
    'model = "k3-256k"',
    "max_context_size = 262144",
    'capabilities = ["thinking", "always_thinking", "image_in", "tool_use"]',
    'display_name = "K3-256k"',
    'support_efforts = ["low", "high", "max"]',
    'default_effort = "high"',
    "",
  ];
  return config.join("\n");
}
