import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { SECRET_PREFIX, isEncryptedSecret } from "./secretFormat";

// Re-exported so existing `@/shared/secretStorage` import sites stay stable;
// the prefix check itself is crypto-free (see `secretFormat.ts`).
export { isEncryptedSecret };

/**
 * Symmetric secret sealing shared by the main and supervisor processes. The key
 * is derived once in main from Electron `safeStorage` (see
 * `src/main/secretStorageKey.ts`) and handed to the supervisor over the
 * `CRAFTSTATION_SECRET_STORAGE_KEY` env var. Both processes call
 * `configureSecretStorageKey` at boot, then seal/unseal with the same AES-256-GCM
 * scheme — so a value encrypted in one process decrypts in the other without any
 * plaintext crossing the IPC channel. Pure `node:crypto`; no Electron import, so
 * it runs in either process (and under vitest with an ephemeral fallback key).
 *
 * Multi-identity fallback: the desktop may run under several userData identities
 * sharing one baseDir (packaged app, unpackaged `electron .` launches, update
 * restarts), each with its own scoped key file. Values sealed by an older
 * identity must stay readable — otherwise every identity switch silently
 * orphans the whole sealed provider vault (Antigravity pool, Volcengine, …)
 * while file-based credentials (Grok's auth.json) keep working. Main therefore
 * also passes every other readable scoped key via
 * `CRAFTSTATION_SECRET_STORAGE_KEY_FALLBACKS`, and `decryptSecret` tries the
 * primary key first, then each fallback. Encryption always uses the primary.
 */

let configuredSecretKey: Buffer | undefined;
let fallbackSecretKeys: Buffer[] = [];
let testFallbackSecretKey: Buffer | undefined;

export function configureSecretStorageKey(rawKey: string | undefined): void {
  if (!rawKey) return;
  const key = Buffer.from(rawKey, "base64");
  if (key.length !== 32) {
    throw new Error("Invalid CraftStation secret key.");
  }
  configuredSecretKey = key;
}

/**
 * Register older-identity keys for decryption only. Entries that are not
 * base64 32-byte keys are skipped so one corrupt entry cannot break boot.
 */
export function configureSecretStorageFallbackKeys(rawKeys: readonly string[] | undefined): void {
  fallbackSecretKeys = [];
  if (!rawKeys) return;
  for (const raw of rawKeys) {
    try {
      const key = Buffer.from(raw, "base64");
      if (key.length === 32) fallbackSecretKeys.push(key);
    } catch {
      // Skip undecodable entries; the primary key path is unaffected.
    }
  }
}

/** Test-only reset so fallback registrations never leak between cases. */
export function resetSecretStorageKeysForTests(): void {
  configuredSecretKey = undefined;
  fallbackSecretKeys = [];
  testFallbackSecretKey = undefined;
}

export const SECRET_STORAGE_KEY_FALLBACKS_ENV = "CRAFTSTATION_SECRET_STORAGE_KEY_FALLBACKS";

/** Serialize fallback keys for the supervisor env (comma never appears in base64). */
export function serializeSecretStorageFallbackKeys(keys: readonly string[]): string {
  return keys.join(",");
}

/** Parse the supervisor env back into candidate keys (invalid entries skipped). */
export function parseSecretStorageFallbackKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readSecretKey(): Buffer {
  if (configuredSecretKey) return configuredSecretKey;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    testFallbackSecretKey ??= randomBytes(32);
    return testFallbackSecretKey;
  }
  throw new Error("CraftStation secret storage key is not initialized.");
}

function sealWithKey(key: Buffer, value: string): string {
  if (key.length !== 32) throw new Error("Invalid CraftStation secret key.");
  if (isEncryptedSecret(value)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function unsealWithKeys(keys: readonly Buffer[], value: string): string {
  if (!isEncryptedSecret(value)) return value;
  const [ivPart, tagPart, ciphertextPart] = value.slice(SECRET_PREFIX.length).split(":");
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Invalid encrypted secret");
  }
  let lastError: unknown;
  for (const candidate of keys) {
    if (candidate.length !== 32) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", candidate, Buffer.from(ivPart, "base64"));
      decipher.setAuthTag(Buffer.from(tagPart, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Invalid encrypted secret");
}

export function encryptSecret(_baseDir: string, value: string): string {
  return sealWithKey(readSecretKey(), value);
}

export function decryptSecret(_baseDir: string, value: string): string {
  return unsealWithKeys([readSecretKey(), ...fallbackSecretKeys], value);
}

/** Seal with an explicit 32-byte key (durable file-backed copies, tests). */
export function encryptSecretWithKey(key: Buffer, value: string): string {
  return sealWithKey(key, value);
}

/** Unseal with an explicit 32-byte key. Throws when the key cannot open the blob. */
export function decryptSecretWithKey(key: Buffer, value: string): string {
  return unsealWithKeys([key], value);
}
