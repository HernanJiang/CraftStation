import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { OAuthToken } from "@craftstation/agents-usage";
import {
  listKimiOAuthCredentialPaths,
  nativeKimiHomePath,
  nativeKimiOAuthCredentialPath,
} from "../agents/kimi/paths";

/**
 * Kimi For Coding credential resolution, mirroring CodexBar: an explicit API
 * key from `KIMI_CODE_API_KEY` wins (with an optional `KIMI_CODE_BASE_URL`
 * endpoint override carried on the token's `raw` bag), else the Kimi Code
 * CLI's access token is reused from `~/.kimi-code/credentials/kimi-code.json`
 * (honoring `KIMI_CODE_HOME`). A CLI credential is never combined with an
 * endpoint override — a custom base URL means a test proxy, and forwarding the
 * CLI token there would leak it.
 *
 * Beyond the host CLI home, resolution also reads the **managed** CraftStation
 * Kimi accounts — each `profile-<uuid>` directory under
 * `~/.craftstation/craftstation-accounts` stores `credentials/kimi-code.json`,
 * and the card must show its quota without a separate host login. A stale
 * managed access token is refreshed against the official Kimi OAuth
 * endpoint (same client id and JSON contract as the official CLI) and the
 * rotated tokens are written back atomically, exactly like the CLI does.
 * Users who have neither paste a key into the in-app sign-in. Secrets never log.
 */

export const KIMI_API_KEY_ENV = "KIMI_CODE_API_KEY";
export const KIMI_BASE_URL_ENV = "KIMI_CODE_BASE_URL";
export const KIMI_OAUTH_HOST_ENV = "KIMI_CODE_OAUTH_HOST";

/** The official Kimi Code CLI OAuth client (public PKCE client). */
const KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const KIMI_OAUTH_TOKEN_PATH = "/api/oauth/token";
/** Sent alongside a CLI-sourced token, matching the official client. */
const KIMI_CLI_PLATFORM = "kimi_code_cli";

/** Trim surrounding whitespace and a single layer of wrapping quotes. */
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

/** Pure: build the Kimi usage token from an explicit API key in the env. */
export function parseKimiEnv(env: Record<string, string | undefined>): OAuthToken | undefined {
  const accessToken = cleaned(env[KIMI_API_KEY_ENV]);
  if (!accessToken) return undefined;
  const baseUrl = cleaned(env[KIMI_BASE_URL_ENV]);
  return baseUrl ? { accessToken, raw: { baseUrl } } : { accessToken };
}

/** `expires_at` arrives as epoch seconds (or ms); normalize to epoch ms. */
function expiryEpochMs(value: unknown): number | undefined {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Pure: parse the CLI credential file. Returns a token only while the access
 * token is fresh (CodexBar's rule: at least 60s of validity left) — a stale
 * token must read as needing refresh rather than produce confusing 401s.
 */
export function parseKimiCliCredential(content: string, nowMs: number): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const rawToken = record["access_token"] ?? record["accessToken"];
  const accessToken = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!accessToken) return undefined;
  const expiresAt = expiryEpochMs(record["expires_at"] ?? record["expiresAt"]);
  if (expiresAt === undefined || expiresAt <= nowMs + 60_000) return undefined;
  return { accessToken, expiresAt };
}

function kimiOAuthHost(): string {
  return (
    cleaned(process.env[KIMI_OAUTH_HOST_ENV]) ??
    cleaned(process.env["KIMI_OAUTH_HOST"]) ??
    "https://auth.kimi.com"
  ).replace(/\/+$/, "");
}

/** The CLI's stable device id, when it exists. Read-only: never created here. */
async function readDeviceId(home: string = nativeKimiHomePath()): Promise<string | undefined> {
  try {
    const content = await readFile(join(home, "device_id"), "utf8");
    return cleaned(content);
  } catch {
    return undefined;
  }
}

async function identityHeadersFor(home?: string): Promise<Record<string, string>> {
  const identityHeaders: Record<string, string> = { "X-Msh-Platform": KIMI_CLI_PLATFORM };
  const deviceId = home ? await readDeviceId(home) : await readDeviceId();
  if (deviceId) identityHeaders["X-Msh-Device-Id"] = deviceId;
  return identityHeaders;
}

/** One managed (or host) Kimi credential file with its parsed refresh state. */
export interface ManagedKimiCredential {
  path: string;
  home: string;
  accessToken: string;
  refreshToken: string | undefined;
  /** Epoch ms, when parseable. */
  expiresAt: number | undefined;
}

/**
 * Every Kimi credential file that CraftStation knows about: the host CLI home
 * plus each managed account profile under the CraftStation accounts root.
 */
export async function listKimiCredentialPaths(): Promise<string[]> {
  return listKimiOAuthCredentialPaths();
}

async function readManagedKimiCredential(path: string): Promise<ManagedKimiCredential | undefined> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const rawToken = parsed["access_token"];
    if (typeof rawToken !== "string" || !rawToken.trim()) return undefined;
    const rawRefresh = parsed["refresh_token"];
    return {
      path,
      home: path.slice(0, path.indexOf("credentials")),
      accessToken: rawToken.trim(),
      refreshToken:
        typeof rawRefresh === "string" && rawRefresh.trim() ? rawRefresh.trim() : undefined,
      expiresAt: expiryEpochMs(parsed["expires_at"] ?? parsed["expiresAt"]),
    };
  } catch {
    return undefined;
  }
}

/**
 * Refresh a stale managed Kimi credential through the official OAuth endpoint
 * (the exact contract the kimi-code CLI uses) and write the rotated tokens
 * back to the same file atomically — the refresh token rotates per grant, so
 * skipping the write-back would sign the account out on the next use.
 */
export async function refreshKimiManagedCredential(
  credential: ManagedKimiCredential,
): Promise<OAuthToken | undefined> {
  if (!credential.refreshToken) return undefined;
  let payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  try {
    const res = await fetch(`${kimiOAuthHost()}${KIMI_OAUTH_TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credential.refreshToken,
        client_id: KIMI_OAUTH_CLIENT_ID,
      }).toString(),
    });
    if (!res.ok) return undefined;
    payload = (await res.json()) as typeof payload;
  } catch {
    return undefined;
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
  if (!accessToken) return undefined;
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 900;
  const rotatedRefresh =
    typeof payload.refresh_token === "string" && payload.refresh_token.trim()
      ? payload.refresh_token.trim()
      : credential.refreshToken;
  const expiresAt = Date.now() + expiresIn * 1000;

  try {
    const original = JSON.parse(await readFile(credential.path, "utf8")) as Record<string, unknown>;
    const updated = {
      ...original,
      access_token: accessToken,
      refresh_token: rotatedRefresh,
      expires_at: expiresAt,
      expires_in: expiresIn,
    };
    const tempPath = `${credential.path}.craftstation-refresh`;
    await writeFile(tempPath, JSON.stringify(updated, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, credential.path);
  } catch {
    // Refresh succeeded but the write-back failed; the in-memory token is
    // still usable for this one quota read.
  }
  return { accessToken, expiresAt };
}

/**
 * Resolve the usage token for ONE managed Kimi home (one pool account).
 * Reads only that home's `credentials/kimi-code.json`: fresh access token
 * wins, otherwise the stored refresh token is rotated in place. Returns
 * undefined when this home cannot supply a bearer — never falls back to the
 * host CLI home or another account, so per-account quota rows stay truthful
 * instead of flapping with whatever credential happens to be ambient.
 */
export async function resolveKimiManagedHomeToken(home: string): Promise<OAuthToken | undefined> {
  const record = await readManagedKimiCredential(join(home, "credentials", "kimi-code.json"));
  if (!record) return undefined;
  const now = Date.now();
  if (record.expiresAt !== undefined && record.expiresAt > now + 60_000) {
    return {
      accessToken: record.accessToken,
      expiresAt: record.expiresAt,
      raw: { identityHeaders: await identityHeadersFor(record.home) },
    };
  }
  if (record.refreshToken) {
    const refreshed = await refreshKimiManagedCredential(record);
    if (refreshed) {
      return {
        ...refreshed,
        raw: { identityHeaders: await identityHeadersFor(record.home) },
      };
    }
  }
  // Pasted API keys have no expiry and no refresh token. Reuse the bearer as-is
  // and skip CLI identity headers — those belong to OAuth tokens.
  if (record.expiresAt === undefined && !record.refreshToken) {
    return { accessToken: record.accessToken };
  }
  return undefined;
}

/**
 * Resolve the Kimi usage credential: explicit API key first, then the freshest
 * fresh access token across the host CLI home and every managed CraftStation
 * account; when all are stale, refresh the most recently valid managed one
 * (rotating tokens written back in place). Returns undefined when nothing can
 * be resolved so the collector reports `auth-missing` and the card can offer
 * the API-key sign-in.
 */
export async function resolveKimiToken(): Promise<OAuthToken | undefined> {
  const fromEnv = parseKimiEnv(process.env);
  if (fromEnv) return fromEnv;
  // An endpoint override without an explicit key disables CLI credential reuse.
  if (cleaned(process.env[KIMI_BASE_URL_ENV])) return undefined;

  const now = Date.now();
  let content: string | undefined;
  try {
    content = await readFile(nativeKimiOAuthCredentialPath(), "utf8");
  } catch {
    content = undefined;
  }
  const hostToken = content ? parseKimiCliCredential(content, now) : undefined;
  if (hostToken) {
    return { ...hostToken, raw: { identityHeaders: await identityHeadersFor() } };
  }

  const managed: ManagedKimiCredential[] = [];
  for (const path of await listKimiCredentialPaths()) {
    if (path === nativeKimiOAuthCredentialPath()) continue;
    const record = await readManagedKimiCredential(path);
    if (record) managed.push(record);
  }
  const freshEntries = managed
    .map((entry) => ({ entry, expiresAt: entry.expiresAt }))
    .filter(
      (item): item is { entry: ManagedKimiCredential; expiresAt: number } =>
        item.expiresAt !== undefined && item.expiresAt > now + 60_000,
    )
    .sort((a, b) => b.expiresAt - a.expiresAt);
  const fresh = freshEntries[0];
  if (fresh) {
    return {
      accessToken: fresh.entry.accessToken,
      expiresAt: fresh.expiresAt,
      raw: { identityHeaders: await identityHeadersFor(fresh.entry.home) },
    };
  }

  const staleEntries = managed
    .filter((entry) => entry.refreshToken !== undefined)
    .sort((a, b) => (b.expiresAt ?? 0) - (a.expiresAt ?? 0));
  const stale = staleEntries[0];
  if (stale) {
    const refreshed = await refreshKimiManagedCredential(stale);
    if (refreshed) {
      return {
        ...refreshed,
        raw: { identityHeaders: await identityHeadersFor(stale.home) },
      };
    }
  }
  return undefined;
}
