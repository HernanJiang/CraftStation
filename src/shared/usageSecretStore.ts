import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import {
  decryptSecret,
  decryptSecretWithKey,
  encryptSecret,
  encryptSecretWithKey,
} from "./secretStorage";

/**
 * On-disk store for captured provider session secrets (e.g. a browser-login
 * cookie), shared by the main and supervisor processes. Values are sealed with
 * the shared `safeStorage`-derived key (see `src/shared/secretStorage.ts`) so the
 * file never holds plaintext. Main writes on capture; the supervisor's usage
 * `CredentialStore.getSecret` reads. Shape: `{ [providerId]: { [key]: sealed } }`.
 *
 * Rebuilds / userData identity switches orphan the Electron-scoped key, which
 * used to drop Volcengine AK/SK, OpenCode cookies, Antigravity pool rows, and
 * every other sealed usage secret. A second copy is therefore sealed with a
 * file-backed key that lives next to the secrets and is not tied to the app
 * identity. Decryption tries the Electron key (plus fallbacks) first, then
 * the durable copy; a durable hit re-seals the primary under the current key.
 */

const SECRETS_FILE = "provider-secrets.json";
const DURABLE_SECRETS_FILE = "provider-secrets.durable.json";
const DURABLE_KEY_FILE = "secret-key.durable";

/**
 * `encryptSecret`/`decryptSecret` accept a `baseDir` for the agent-settings code
 * path, but the global safeStorage-derived key ignores it; this store keys solely
 * by file path, so we pass none. Named for clarity at the call sites below.
 */
const NO_BASE_DIR = "";

type SecretsFile = Record<string, Record<string, string>>;

export function usageSecretsPath(cacheDir: string): string {
  return join(cacheDir, SECRETS_FILE);
}

export function usageDurableSecretsPath(cacheDir: string): string {
  return join(cacheDir, DURABLE_SECRETS_FILE);
}

function durableKeyPath(cacheDir: string): string {
  return join(cacheDir, DURABLE_KEY_FILE);
}

function readAll(path: string): SecretsFile {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SecretsFile) : {};
  } catch {
    return {};
  }
}

function writeAll(path: string, data: SecretsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

function readOrCreateDurableKey(cacheDir: string): Buffer {
  const path = durableKeyPath(cacheDir);
  if (existsSync(path)) {
    try {
      const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
      if (key.length === 32) return key;
    } catch {
      // Fall through and rotate a fresh file-backed key.
    }
  }
  const key = randomBytes(32);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, key.toString("base64"), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  return key;
}

function writeDurableSecret(cacheDir: string, providerId: string, key: string, plaintext: string): void {
  const path = usageDurableSecretsPath(cacheDir);
  const data = readAll(path);
  const bucket = { ...(data[providerId] ?? {}) };
  bucket[key] = encryptSecretWithKey(readOrCreateDurableKey(cacheDir), plaintext);
  data[providerId] = bucket;
  writeAll(path, data);
}

function readDurableSecret(cacheDir: string, providerId: string, key: string): string | undefined {
  const sealed = readAll(usageDurableSecretsPath(cacheDir))[providerId]?.[key];
  if (!sealed) return undefined;
  try {
    return decryptSecretWithKey(readOrCreateDurableKey(cacheDir), sealed);
  } catch {
    return undefined;
  }
}

function writePrimarySecret(cacheDir: string, providerId: string, key: string, plaintext: string): void {
  const path = usageSecretsPath(cacheDir);
  const data = readAll(path);
  const bucket = { ...(data[providerId] ?? {}) };
  bucket[key] = encryptSecret(NO_BASE_DIR, plaintext);
  data[providerId] = bucket;
  writeAll(path, data);
}

function mergeOneSecretsFile(
  path: string,
  sourceProviderId: string,
  destinationProviderId: string,
): void {
  if (sourceProviderId === destinationProviderId) return;
  if (!existsSync(path)) return;
  const data = readAll(path);
  const source = data[sourceProviderId];
  if (!source) return;
  data[destinationProviderId] = {
    ...source,
    ...(data[destinationProviderId] ?? {}),
  };
  delete data[sourceProviderId];
  writeAll(path, data);
}

/**
 * Atomically merge one sealed bucket into another without decrypting values.
 * Existing destination keys win so a legacy snapshot can never overwrite a
 * newer canonical credential. The source bucket is removed only after the
 * merged file has been written successfully.
 */
export function mergeUsageSecretBuckets(
  cacheDir: string,
  sourceProviderId: string,
  destinationProviderId: string,
): void {
  mergeOneSecretsFile(usageSecretsPath(cacheDir), sourceProviderId, destinationProviderId);
  mergeOneSecretsFile(usageDurableSecretsPath(cacheDir), sourceProviderId, destinationProviderId);
}

/** Seal and persist a provider secret (Electron-scoped copy + durable copy). */
export function setUsageSecret(
  cacheDir: string,
  providerId: string,
  key: string,
  plaintext: string,
): void {
  writePrimarySecret(cacheDir, providerId, key, plaintext);
  writeDurableSecret(cacheDir, providerId, key, plaintext);
}

function clearOneSecretsFile(path: string, providerId: string, key?: string): void {
  if (!existsSync(path)) return;
  const data = readAll(path);
  if (!data[providerId]) return;
  if (key === undefined) {
    delete data[providerId];
  } else {
    const bucket = { ...data[providerId] };
    delete bucket[key];
    if (Object.keys(bucket).length === 0) delete data[providerId];
    else data[providerId] = bucket;
  }
  writeAll(path, data);
}

/** Remove a single secret (or the whole provider bucket when `key` is omitted). */
export function clearUsageSecret(cacheDir: string, providerId: string, key?: string): void {
  clearOneSecretsFile(usageSecretsPath(cacheDir), providerId, key);
  clearOneSecretsFile(usageDurableSecretsPath(cacheDir), providerId, key);
}

/**
 * True when any secret is stored for the provider, i.e. a login was captured.
 * This is the persistent "signed in" signal — independent of whether the latest
 * usage fetch succeeded — so a transient/empty fetch never reads as signed out.
 * Does not unseal (presence, not validity).
 */
export function hasUsageSecret(cacheDir: string, providerId: string): boolean {
  const primary = readAll(usageSecretsPath(cacheDir))[providerId];
  if (primary !== undefined && Object.keys(primary).length > 0) return true;
  const durable = readAll(usageDurableSecretsPath(cacheDir))[providerId];
  return durable !== undefined && Object.keys(durable).length > 0;
}

/**
 * Key-level presence check without unsealing. Lets rescue paths distinguish
 * "no value was ever stored" from "a sealed value exists". Presence in either
 * the Electron-scoped file or the durable sidecar counts.
 */
export function hasUsageSecretKey(cacheDir: string, providerId: string, key: string): boolean {
  return (
    readAll(usageSecretsPath(cacheDir))[providerId]?.[key] !== undefined ||
    readAll(usageDurableSecretsPath(cacheDir))[providerId]?.[key] !== undefined
  );
}

/**
 * Read and unseal a provider secret, or undefined when absent/undecryptable.
 *
 * Tries the Electron-scoped vault first (current key plus older-identity
 * fallbacks), then the file-backed durable copy that survives rebuilds. A
 * durable hit re-seals the primary under the current app key so subsequent
 * reads do not depend on the sidecar. `onUndecryptable` fires only when
 * neither copy can be opened.
 */
export function getUsageSecret(
  cacheDir: string,
  providerId: string,
  key: string,
  onUndecryptable?: (info: { providerId: string; key: string }) => void,
): string | undefined {
  const primarySealed = readAll(usageSecretsPath(cacheDir))[providerId]?.[key];
  if (primarySealed) {
    try {
      const plaintext = decryptSecret(NO_BASE_DIR, primarySealed);
      if (!readDurableSecret(cacheDir, providerId, key)) {
        writeDurableSecret(cacheDir, providerId, key, plaintext);
      }
      return plaintext;
    } catch {
      // Fall through to the durable copy before declaring the blob garbage.
    }
  }
  const durable = readDurableSecret(cacheDir, providerId, key);
  if (durable !== undefined) {
    writePrimarySecret(cacheDir, providerId, key, durable);
    return durable;
  }
  if (primarySealed) onUndecryptable?.({ providerId, key });
  return undefined;
}

/**
 * Shared `onUndecryptable` reporter for direct `getUsageSecret` callers (pool
 * profile services, credential materializers). Logs once per provider/key for
 * the process lifetime so a vault full of unreadable buckets produces one
 * actionable line per bucket instead of silence or a log storm.
 */
const undecryptableReported = new Set<string>();

export function reportUndecryptableSecret(info: { providerId: string; key: string }): void {
  const id = `${info.providerId}:${info.key}`;
  if (undecryptableReported.has(id)) return;
  undecryptableReported.add(id);
  console.warn(
    `[usage] stored ${info.providerId} credential "${info.key}" cannot be decrypted with any known app key — re-save it in 添加渠道 to restore usage data.`,
  );
}
