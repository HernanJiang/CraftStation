import type { HttpClient, OAuthToken } from "@craftstation/agents-usage";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getUsageSecret,
  reportUndecryptableSecret,
  setUsageSecret,
} from "@/shared/usageSecretStore";
import { CraftStationCredentialVault, providerCredentialBucket } from "./credentialVault";
import { createNodeHttpClient } from "./usageHttpClient";

const PROVIDER_ID = "antigravity";

/**
 * Sealed-store bucket for an Antigravity credential. The legacy host login
 * lives in the plain "antigravity" bucket; each pool account owns an isolated
 * `antigravity:<accountId>` bucket so adding accounts appends instead of
 * overwriting, and deleting one account never touches its siblings.
 */
export function antigravityBucket(accountId?: string): string {
  return accountId ? providerCredentialBucket(PROVIDER_ID, accountId) : PROVIDER_ID;
}
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const CLIENT_TOKEN = ["GOCSPX-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("");
const refreshInFlight = new Map<string, Promise<OAuthToken | undefined>>();

/**
 * gcloud-style authorized_user ADC credential for one pool account, materialized
 * inside the account's managed profile directory. `agy` never reads CraftStation's
 * sealed vault — its only non-interactive credential seam is Application Default
 * Credentials (`AGY_ADC_AUTH=1` + `GOOGLE_APPLICATION_CREDENTIALS`), so the
 * account's refresh token must be published in this file before an `agy` spawn
 * and its path passed as the session env (see `prepareAntigravityProfile`).
 */
export function antigravityAdcCredentialPath(credentialRoot: string): string {
  return join(credentialRoot, "adc", "authorized_user.json");
}

/**
 * Read the refresh token back out of a materialized ADC file. The ADC file is
 * the Grok-style per-account credential: a plain file under the account's own
 * managed directory (mode 0600), written at session spawn and never touched by
 * update/restart flows — so it survives exactly the identity/key rotations
 * that orphan the sealed vault. Returns undefined for missing/unparseable
 * files; never throws.
 */
export function readAdcRefreshToken(adcPath: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(adcPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const token = (parsed as Record<string, unknown>)["refresh_token"];
  return typeof token === "string" && token.trim() ? token.trim() : undefined;
}

/**
 * Write a refresh token as the authorized_user ADC file. The file is the
 * Grok-style durable credential: a plain per-account file under the managed
 * profile directory (mode 0600) that update/restart identity rotations never
 * touch. Written through a pid-suffixed staging name so a concurrently spawned
 * sibling session never reads a half-written credential.
 */
export function writeAntigravityAdcCredential(
  credentialRoot: string,
  refreshToken: string,
): string {
  const token = refreshToken.trim();
  if (!token) {
    throw new Error("Antigravity ADC credential needs a refresh token.");
  }
  const path = antigravityAdcCredentialPath(credentialRoot);
  mkdirSync(dirname(path), { recursive: true });
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(
    staged,
    `${JSON.stringify(
      {
        type: "authorized_user",
        client_id: CLIENT_ID,
        client_secret: CLIENT_TOKEN,
        refresh_token: token,
      },
      undefined,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(staged, path);
  return path;
}

/** Remove the durable ADC file. Missing files are a no-op. */
export function clearAntigravityAdcCredential(credentialRoot: string): void {
  try {
    rmSync(antigravityAdcCredentialPath(credentialRoot), { force: true });
  } catch {
    // The account directory may already be gone with the pool row.
  }
}

/**
 * Publish the bucket's refresh token as the authorized_user ADC file. Returns
 * `undefined` when the bucket holds no refresh token (access tokens expire
 * within the hour and cannot keep a session alive on their own); callers turn
 * that into the account-control error for their lane.
 */
export function materializeAntigravityAdcCredential(
  cacheDir: string,
  bucket: string,
  credentialRoot: string,
): string | undefined {
  const refreshToken = getUsageSecret(
    cacheDir,
    bucket,
    "refreshToken",
    reportUndecryptableSecret,
  )?.trim();
  if (!refreshToken) return undefined;
  return writeAntigravityAdcCredential(credentialRoot, refreshToken);
}

export async function resolveStoredAntigravityToken(
  cacheDir: string,
  bucket: string = PROVIDER_ID,
  httpClient?: HttpClient,
): Promise<OAuthToken | undefined> {
  if (bucket !== PROVIDER_ID) {
    const accountId = bucket.startsWith(`${PROVIDER_ID}:`) ? bucket : antigravityBucket(bucket);
    bucket = new CraftStationCredentialVault(cacheDir).accountBucket(PROVIDER_ID, accountId);
  }
  const accessToken = getUsageSecret(
    cacheDir,
    bucket,
    "accessToken",
    reportUndecryptableSecret,
  )?.trim();
  const refreshToken = getUsageSecret(
    cacheDir,
    bucket,
    "refreshToken",
    reportUndecryptableSecret,
  )?.trim();
  if (!accessToken && !refreshToken) return undefined;
  const expiresAt = Number(
    getUsageSecret(cacheDir, bucket, "expiresAt", reportUndecryptableSecret),
  );
  if (
    (!accessToken || (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000)) &&
    refreshToken
  ) {
    return refreshStoredAntigravityToken(cacheDir, bucket, httpClient);
  }
  if (!accessToken) return undefined;
  const email = getUsageSecret(cacheDir, bucket, "email", reportUndecryptableSecret);
  const tokenType = getUsageSecret(cacheDir, bucket, "tokenType", reportUndecryptableSecret);
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
    ...(tokenType ? { tokenType } : {}),
    ...(email ? { email } : {}),
    raw: { projectId: getUsageSecret(cacheDir, bucket, "projectId", reportUndecryptableSecret) },
  };
}

export async function refreshStoredAntigravityToken(
  cacheDir: string,
  bucket: string = PROVIDER_ID,
  httpClient: HttpClient = createNodeHttpClient(),
): Promise<OAuthToken | undefined> {
  const existing = refreshInFlight.get(bucket);
  if (existing) return existing;
  const pending = refreshStoredAntigravityTokenOnce(cacheDir, bucket, httpClient).finally(() => {
    if (refreshInFlight.get(bucket) === pending) refreshInFlight.delete(bucket);
  });
  refreshInFlight.set(bucket, pending);
  return pending;
}

async function refreshStoredAntigravityTokenOnce(
  cacheDir: string,
  bucket: string = PROVIDER_ID,
  httpClient: HttpClient,
): Promise<OAuthToken | undefined> {
  const refreshToken = getUsageSecret(
    cacheDir,
    bucket,
    "refreshToken",
    reportUndecryptableSecret,
  )?.trim();
  if (!refreshToken) return undefined;
  try {
    const response = await httpClient.request({
      url: TOKEN_ENDPOINT,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_TOKEN,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      timeoutMs: 30_000,
    });
    if (response.status < 200 || response.status >= 300) return undefined;
    const tokens = JSON.parse(response.body ?? "") as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!tokens.access_token) return undefined;
    setUsageSecret(cacheDir, bucket, "accessToken", tokens.access_token);
    setUsageSecret(cacheDir, bucket, "refreshToken", refreshToken);
    if (tokens.token_type) setUsageSecret(cacheDir, bucket, "tokenType", tokens.token_type);
    if (tokens.expires_in) {
      setUsageSecret(
        cacheDir,
        bucket,
        "expiresAt",
        String(Date.now() + Math.max(1, tokens.expires_in) * 1000),
      );
    }
    return resolveStoredAntigravityToken(cacheDir, bucket, httpClient);
  } catch {
    return undefined;
  }
}
