import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type OAuthToken, toEpochMs } from "@poracode/agents-usage";
import { readGrokAuthFromWsl } from "./wslCredentials";

/**
 * Grok (xAI) credential resolution from `~/.grok/auth.json` (field name varies).
 * The pure parser is exported separately for tests. Secrets are never logged.
 */

const GROK_TOKEN_KEYS = [
  "access_token",
  "accessToken",
  "token",
  "api_key",
  "apiKey",
  "session_token",
  "jwt",
  // The OIDC-era CLI stores the bearer under a bare `key`. Last, so an explicit
  // access-token field always wins when a file carries both.
  "key",
] as const;

export const GROK_REFRESH_TOKEN_KEYS = ["refresh_token", "refreshToken"] as const;
const GROK_CLIENT_ID_KEYS = ["oidc_client_id", "client_id", "clientId"] as const;
export const GROK_EXPIRY_KEYS = ["expires_at", "expiresAt", "expiry", "expires"] as const;
const GROK_EMAIL_KEYS = ["email", "user_email", "userEmail"] as const;
const GROK_ACCOUNT_ID_KEYS = ["principal_id", "user_id", "account_id", "accountId"] as const;

/** First non-empty string among `keys`, with the key that carried it. */
export function pickGrokField(
  source: Record<string, unknown>,
  keys: readonly string[],
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return { key, value: value.trim() };
  }
  return undefined;
}

/**
 * Normalize a loosely-specified stored expiry (epoch seconds, epoch millis, or
 * ISO) to epoch milliseconds; anything else is "no expiry known".
 */
function grokExpiryToMs(value: unknown): number | undefined {
  return typeof value === "string" || typeof value === "number" ? toEpochMs(value) : undefined;
}

/** First key in `keys` that is present, whatever its type. */
export function pickGrokRaw(
  source: Record<string, unknown>,
  keys: readonly string[],
): { key: string; value: unknown } | undefined {
  for (const key of keys) {
    if (source[key] !== undefined) return { key, value: source[key] };
  }
  return undefined;
}

/**
 * The object inside `auth.json` that actually carries the access token.
 *
 * The OIDC-era CLI keys each identity under a dynamic `"<issuer>::<client_id>"`
 * entry rather than a fixed field, so every object one level down is a candidate.
 * With several signed-in identities the freshest wins (latest `expires_at`, then
 * `create_time`), since the CLI itself uses the most recent login.
 */
export interface GrokAuthContainer {
  container: Record<string, unknown>;
  tokenKey: string;
  accessToken: string;
  name?: string;
}

export function grokAuthContainer(parsed: unknown): GrokAuthContainer | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const root = parsed as Record<string, unknown>;

  const rootToken = pickGrokField(root, GROK_TOKEN_KEYS);
  if (rootToken) {
    return { container: root, tokenKey: rootToken.key, accessToken: rootToken.value };
  }

  const freshness = (container: Record<string, unknown>): number =>
    grokExpiryToMs(pickGrokRaw(container, GROK_EXPIRY_KEYS)?.value) ??
    grokExpiryToMs(container.create_time) ??
    0;

  let best: { entry: GrokAuthContainer; freshness: number } | undefined;
  for (const [name, value] of Object.entries(root)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const container = value as Record<string, unknown>;
    const found = pickGrokField(container, GROK_TOKEN_KEYS);
    if (!found) continue;
    const entry: GrokAuthContainer = {
      container,
      tokenKey: found.key,
      accessToken: found.value,
      name,
    };
    const score = freshness(container);
    if (!best || score > best.freshness) best = { entry, freshness: score };
  }
  return best?.entry;
}

const GROK_COOKIE_KEYS = ["cookie", "cookie_header", "session_cookie", "cookies"] as const;

function normalizeGrokCookieValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
        const record = entry as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        const cookieValue = typeof record.value === "string" ? record.value.trim() : "";
        return name && cookieValue ? `${name}=${cookieValue}` : undefined;
      })
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join("; ") : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const cookieValue = typeof record.value === "string" ? record.value.trim() : "";
  if (name && cookieValue) return `${name}=${cookieValue}`;
  const entries = Object.entries(record)
    .filter(([, entry]) => typeof entry === "string" && entry.trim())
    .map(([key, entry]) => `${key}=${String(entry).trim()}`);
  return entries.length > 0 ? entries.join("; ") : undefined;
}

/**
 * Read an optional session-cookie header from an official Grok auth file.
 * This stays supervisor-side; renderer projections never contain the value.
 */
export function parseGrokCookie(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const root = parsed as Record<string, unknown>;
  const containers = [grokAuthContainer(parsed)?.container, root].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry),
  );
  for (const container of containers) {
    for (const key of GROK_COOKIE_KEYS) {
      const cookie = normalizeGrokCookieValue(container[key]);
      if (cookie) return cookie;
    }
  }
  return undefined;
}

/** `"https://auth.x.ai::<client_id>"` → the client id, for files that omit the field. */
function clientIdFromContainerName(name: string | undefined): string | undefined {
  if (!name?.includes("::")) return undefined;
  return name.slice(name.lastIndexOf("::") + 2).trim() || undefined;
}

/**
 * Parse `~/.grok/auth.json` into an OAuth token bundle (field names vary). The
 * refresh token, client id, and expiry ride along so the host can renew a
 * short-lived access token instead of falling back to the cookie path.
 */
export function parseGrokAuth(content: string): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const found = grokAuthContainer(parsed);
  if (!found) return undefined;
  const { container, accessToken } = found;
  const root = parsed as Record<string, unknown>;
  const refreshToken = pickGrokField(container, GROK_REFRESH_TOKEN_KEYS)?.value;
  // The client id is account-level metadata: on its own field, beside `tokens`,
  // or only in the container's `"<issuer>::<client_id>"` name.
  const clientId =
    pickGrokField(container, GROK_CLIENT_ID_KEYS)?.value ??
    pickGrokField(root, GROK_CLIENT_ID_KEYS)?.value ??
    clientIdFromContainerName(found.name);
  const expiresAt = grokExpiryToMs(
    (pickGrokRaw(container, GROK_EXPIRY_KEYS) ?? pickGrokRaw(root, GROK_EXPIRY_KEYS))?.value,
  );
  const email =
    pickGrokField(container, GROK_EMAIL_KEYS)?.value ?? pickGrokField(root, GROK_EMAIL_KEYS)?.value;
  const accountId =
    pickGrokField(container, GROK_ACCOUNT_ID_KEYS)?.value ??
    pickGrokField(root, GROK_ACCOUNT_ID_KEYS)?.value;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(email ? { email } : {}),
    ...(accountId ? { accountId } : {}),
    ...(clientId ? { raw: { clientId } } : {}),
  };
}

export function grokAuthFilePath(): string {
  const home = process.env.GROK_HOME?.trim();
  return home ? join(home, "auth.json") : join(homedir(), ".grok", "auth.json");
}

export async function resolveGrokToken(): Promise<OAuthToken | undefined> {
  const path = grokAuthFilePath();
  if (existsSync(path)) {
    try {
      const token = parseGrokAuth(readFileSync(path, "utf8"));
      if (token) return token;
    } catch {
      // fall through to the WSL fallback
    }
  }
  if (process.platform === "win32") {
    const blob = await readGrokAuthFromWsl();
    if (blob) {
      const token = parseGrokAuth(blob);
      if (token) return token;
    }
  }
  return undefined;
}
