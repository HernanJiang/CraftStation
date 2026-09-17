import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import type { OAuthToken } from "@craftstation/agents-usage";

const execFileAsync = promisify(execFile);

export const DEVIN_API_KEY_ENVS = ["DEVIN_API_KEY", "WINDSURF_API_KEY"] as const;

function cleaned(raw: string | undefined): string | undefined {
  let value = raw?.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value || undefined;
}

/** Paths `devin auth login` writes, matching the CLI detection probe. */
export function nativeDevinCredentialPaths(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    return [
      ...(appData ? [join(appData, "devin", "credentials.toml")] : []),
      join(home, ".devin", "credentials.toml"),
    ];
  }
  const xdg = process.env.XDG_DATA_HOME?.trim();
  const linux = xdg
    ? join(xdg, "devin", "credentials.toml")
    : join(home, ".local", "share", "devin", "credentials.toml");
  const mac = join(home, "Library", "Application Support", "devin", "credentials.toml");
  const legacy = join(home, ".devin", "credentials.toml");
  return process.platform === "darwin" ? [mac, linux, legacy] : [linux, legacy];
}

export function parseDevinEnv(env: Record<string, string | undefined>): OAuthToken | undefined {
  for (const name of DEVIN_API_KEY_ENVS) {
    const accessToken = cleaned(env[name]);
    if (accessToken) return { accessToken };
  }
  return undefined;
}

// `devin auth login` (current CLI) writes the credential under
// `windsurf_api_key` (the Windsurf-legacy key name); older builds used
// `devin_api_key` / `token`. Without these, a perfectly valid persisted
// login parses as "no token" and every usage/account surface demands a
// re-login even though the CLI itself stays authenticated.
const TOKEN_KEYS = new Set([
  "token",
  "api_token",
  "api_key",
  "apikey",
  "access_token",
  "pat",
  "windsurf_api_key",
  "devin_api_key",
]);
const EMAIL_KEYS = new Set(["email", "user_email", "username", "user", "login"]);
const PLAN_KEYS = new Set(["plan", "plan_name", "tier", "subscription"]);

function walkToml(value: unknown, found: { token?: string; email?: string; plan?: string }): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) walkToml(entry, found);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (!found.token && TOKEN_KEYS.has(normalized)) found.token = trimmed;
      else if (!found.email && EMAIL_KEYS.has(normalized)) found.email = trimmed;
      else if (!found.plan && PLAN_KEYS.has(normalized)) found.plan = trimmed;
      continue;
    }
    walkToml(entry, found);
  }
}

/** Pure: parse `credentials.toml` written by `devin auth login`. */
export function parseDevinCredentialsToml(content: string): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch {
    return undefined;
  }
  const found: { token?: string; email?: string; plan?: string } = {};
  walkToml(parsed, found);
  if (!found.token) return undefined;
  return {
    accessToken: found.token,
    ...(found.email ? { email: found.email, accountId: found.email } : {}),
    ...(found.plan ? { subscriptionType: found.plan } : {}),
  };
}

export async function resolveDevinToken(
  opts: DevinTokenResolveOpts = {},
): Promise<OAuthToken | undefined> {
  const envToken = parseDevinEnv(process.env);
  // A pasted/env API key is used as-is: `devin auth status` describes the CLI
  // login, which may belong to a different account, so it must never supply
  // identity for an env bearer.
  if (envToken) return envToken;
  for (const path of nativeDevinCredentialPaths()) {
    if (!existsSync(path)) continue;
    try {
      const token = parseDevinCredentialsToml(await readFile(path, "utf8"));
      if (token) return withDevinCliIdentity(token, opts.authStatusRunner);
    } catch {
      // try the next known location
    }
  }
  return undefined;
}

/** Pure: does this `credentials.toml` body carry a usable Devin token? */
export function hasDevinCredentialContent(content: string): boolean {
  return parseDevinCredentialsToml(content) !== undefined;
}

/**
 * Identity reported by the Devin CLI itself (`devin auth status`), the same
 * role `~/.codex/auth.json` / `~/.grok/auth.json` play for Codex/Grok: the
 * CLI home is the source of truth, because `credentials.toml` carries no
 * identity fields and `api.devin.ai/v3/*` answers 404 for CLI session tokens.
 *
 * Sample:
 * ```
 * Logged in (via Devin).
 * ...
 * User:
 *   Name:              Hernan Jiang
 *   Email:             poise.johnson@gmail.com
 *   User ID:           user-8ca18c90d361460aa5f4c5381faaf02a
 * Account:
 *   Tier:              Devin Pro
 *   Plan:              Pro
 * ```
 */
export interface DevinCliIdentity {
  email?: string;
  name?: string;
  userId?: string;
  /** Prefer `Plan`, fall back to `Tier` (e.g. `Pro` / `Devin Pro`). */
  plan?: string;
}

export function parseDevinAuthStatus(output: string): DevinCliIdentity | undefined {
  const lines = output.split(/\r?\n/);
  if (!lines.some((line) => /^\s*logged in\b/i.test(line))) return undefined;
  const pick = (key: string): string | undefined => {
    const pattern = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "i");
    for (const line of lines) {
      const match = pattern.exec(line);
      const value = match?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const email = pick("Email");
  const name = pick("Name");
  const userId = pick("User ID");
  const plan = pick("Plan") ?? pick("Tier");
  if (!email && !name && !userId && !plan) return undefined;
  return {
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(userId ? { userId } : {}),
    ...(plan ? { plan } : {}),
  };
}

/** Injectable `devin auth status` runner; production shells out to the CLI. */
export type DevinAuthStatusRunner = () => Promise<string>;

async function defaultDevinAuthStatusRunner(): Promise<string> {
  const { stdout } = await execFileAsync("devin", ["auth", "status"], {
    timeout: 10_000,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 256 * 1024,
  });
  return stdout;
}

/** `devin auth status` is near-static; cache it so usage refreshes stay cheap. */
const DEVIN_IDENTITY_TTL_MS = 10 * 60_000;
let cachedDevinIdentity: { at: number; identity: DevinCliIdentity | undefined } | undefined;
let devinIdentityInFlight: Promise<DevinCliIdentity | undefined> | undefined;

/** Test seam: forget the cached `devin auth status` identity. */
export function resetDevinIdentityCache(): void {
  cachedDevinIdentity = undefined;
  devinIdentityInFlight = undefined;
}

export async function resolveDevinIdentity(
  runner: DevinAuthStatusRunner = defaultDevinAuthStatusRunner,
): Promise<DevinCliIdentity | undefined> {
  const now = Date.now();
  if (cachedDevinIdentity && now - cachedDevinIdentity.at < DEVIN_IDENTITY_TTL_MS) {
    return cachedDevinIdentity.identity;
  }
  devinIdentityInFlight ??= (async () => {
    try {
      return parseDevinAuthStatus(await runner());
    } catch {
      // Logged out, CLI missing, or timed out: the bare token still resolves
      // and the collector reports whatever the API answers.
      return undefined;
    }
  })();
  try {
    const identity = await devinIdentityInFlight;
    cachedDevinIdentity = { at: Date.now(), identity };
    return identity;
  } finally {
    devinIdentityInFlight = undefined;
  }
}

export interface DevinTokenResolveOpts {
  /** Override the `devin auth status` runner (tests). */
  authStatusRunner?: DevinAuthStatusRunner;
}

/** Attach CLI identity to a file-backed token so usage keeps its login state. */
async function withDevinCliIdentity(
  token: OAuthToken,
  runner?: DevinAuthStatusRunner,
): Promise<OAuthToken> {
  const identity = await (runner ? resolveDevinIdentity(runner) : resolveDevinIdentity());
  if (!identity) return token;
  const accountId = identity.userId ?? identity.email ?? token.accountId;
  return {
    ...token,
    ...(identity.email && !token.email ? { email: identity.email } : {}),
    ...(accountId && !token.accountId ? { accountId } : {}),
    ...(identity.plan && !token.subscriptionType ? { subscriptionType: identity.plan } : {}),
  };
}
