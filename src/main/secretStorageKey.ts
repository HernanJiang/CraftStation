import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { safeStorage } from "electron";
import { writeFileAtomic } from "@/shared/atomicFile";

const SAFE_STORAGE_KEY_FILE = "secret-key.safe";
let sessionOnlyKey: string | undefined;

type KeyRecoveryReason = "decrypt_failed" | "invalid_key";

/**
 * Chromium's OS-backed encryption (DPAPI / App-Bound on Windows, Keychain on
 * macOS, secret-store on Linux) is scoped to the app's userData identity: a
 * key sealed by one identity cannot be decrypted by another. Multiple app
 * instances can share one baseDir (production Main and dev worktrees both
 * default to ~/.craftstation), so an unscoped key file made every launch
 * overwrite the previous instance's key and orphan all sealed provider
 * secrets. Scoping the file name by the userData path gives each identity its
 * own key and ends the rotation ping-pong.
 */
function scopedKeyFileName(userDataScope: string | undefined): string {
  if (!userDataScope) return SAFE_STORAGE_KEY_FILE;
  const hash = createHash("sha256").update(userDataScope).digest("hex").slice(0, 12);
  return `secret-key.${hash}.safe`;
}

function keyFilePath(baseDir: string, userDataScope?: string): string {
  return join(baseDir, scopedKeyFileName(userDataScope));
}

function legacyKeyFilePath(baseDir: string): string {
  return join(baseDir, SAFE_STORAGE_KEY_FILE);
}

function isValidKey(value: string): boolean {
  return Buffer.from(value, "base64").length === 32;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}

function reportKeyRecovery(reason: KeyRecoveryReason): void {
  console.warn(`[credential-storage] stored key recovery (${reason}); rotating encrypted key.`);
}

function throwSecretStorageError(message: string): never {
  throw new Error(message);
}

function persistKey(path: string, key: string): void {
  let encrypted: Buffer;
  try {
    encrypted = safeStorage.encryptString(key);
  } catch {
    throw new Error("Unable to encrypt the Poracode secret storage key.");
  }
  try {
    writeFileAtomic(path, encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
  } catch {
    throw new Error("Unable to persist the encrypted Poracode secret storage key.");
  }
}

function createPersistentKey(path: string): string {
  const key = randomBytes(32).toString("base64");
  persistKey(path, key);
  return key;
}

type KeyFileRead = { key: string } | { missing: true } | { failed: KeyRecoveryReason };

/** Read and unseal a key file, classifying miss versus undecryptable/invalid. */
function readKeyFromFile(path: string): KeyFileRead {
  let serialized: string;
  try {
    serialized = readFileSync(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return { missing: true };
    throwSecretStorageError("Unable to read the encrypted Poracode secret storage key.");
  }
  let key: string;
  try {
    key = safeStorage.decryptString(Buffer.from(serialized, "base64"));
  } catch {
    // Credential resets, OS keychain changes, or a key sealed by a different
    // userData identity make the stored blob undecryptable here.
    return { failed: "decrypt_failed" };
  }
  if (!isValidKey(key)) return { failed: "invalid_key" };
  return { key };
}

export function readOrCreateSafeStorageSecretKey(
  baseDir: string,
  platform: NodeJS.Platform = process.platform,
  userDataScope?: string,
): string {
  let encryptionAvailable: boolean;
  try {
    encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (
      encryptionAvailable &&
      platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    ) {
      encryptionAvailable = false;
    }
  } catch {
    throw new Error("Unable to inspect OS-backed secret storage.");
  }
  if (!encryptionAvailable) {
    console.warn(
      "[credential-storage] secure OS encryption is unavailable; credentials are session-only.",
    );
    sessionOnlyKey ??= randomBytes(32).toString("base64");
    return sessionOnlyKey;
  }

  const path = keyFilePath(baseDir, userDataScope);
  const stored = readKeyFromFile(path);
  if ("key" in stored) return stored.key;
  if ("failed" in stored) {
    // Report the typed recovery without including the key file path or contents,
    // then rotate ONLY this identity's scoped key file so the app remains usable.
    reportKeyRecovery(stored.failed);
    return createPersistentKey(path);
  }

  // No scoped key yet. A legacy unscoped `secret-key.safe` may hold a key
  // sealed by this same identity from before scoping existed: migrate it
  // verbatim so already-sealed provider secrets stay decryptable. A blob
  // sealed by a different identity fails decryption and is left untouched for
  // its owner.
  if (userDataScope) {
    const legacy = readKeyFromFile(legacyKeyFilePath(baseDir));
    if ("key" in legacy) {
      persistKey(path, legacy.key);
      return legacy.key;
    }
  }

  return createPersistentKey(path);
}
