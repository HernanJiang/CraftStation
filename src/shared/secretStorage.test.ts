import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  configureSecretStorageFallbackKeys,
  configureSecretStorageKey,
  decryptSecret,
  encryptSecret,
  parseSecretStorageFallbackKeys,
  resetSecretStorageKeysForTests,
  serializeSecretStorageFallbackKeys,
} from "./secretStorage";

const keyA = randomBytes(32).toString("base64");
const keyB = randomBytes(32).toString("base64");

beforeEach(() => {
  resetSecretStorageKeysForTests();
});

describe("secretStorage multi-identity fallback", () => {
  it("decrypts values sealed by an older identity key via fallbacks", () => {
    configureSecretStorageKey(keyA);
    const sealed = encryptSecret("", "refresh-token-value");

    // Simulate an identity switch: the active key changed, the old one is kept
    // for decryption only (what main hands the supervisor after a userData
    // identity change across packaged/unpackaged/update launches).
    configureSecretStorageKey(keyB);
    configureSecretStorageFallbackKeys([keyA]);

    expect(decryptSecret("", sealed)).toBe("refresh-token-value");
  });

  it("still seals with the primary key when fallbacks are configured", () => {
    configureSecretStorageKey(keyB);
    configureSecretStorageFallbackKeys([keyA]);
    const sealed = encryptSecret("", "v");

    // A fresh boot with only the primary key must read its own seals.
    resetSecretStorageKeysForTests();
    configureSecretStorageKey(keyB);
    expect(decryptSecret("", sealed)).toBe("v");
  });

  it("throws when neither the primary nor the fallbacks can unseal", () => {
    configureSecretStorageKey(keyA);
    const sealed = encryptSecret("", "v");

    resetSecretStorageKeysForTests();
    configureSecretStorageKey(keyB);
    configureSecretStorageFallbackKeys([randomBytes(32).toString("base64")]);
    expect(() => decryptSecret("", sealed)).toThrow("unable to authenticate data");
  });

  it("skips malformed fallback entries without breaking the primary path", () => {
    configureSecretStorageKey(keyA);
    const sealed = encryptSecret("", "v");

    configureSecretStorageFallbackKeys(["too-short", "", "!!!not-base64!!!", keyA]);
    expect(decryptSecret("", sealed)).toBe("v");
  });

  it("round-trips fallback keys through env serialization", () => {
    const raw = serializeSecretStorageFallbackKeys([keyA, keyB]);
    expect(raw).not.toContain(" ");
    expect(parseSecretStorageFallbackKeys(raw)).toEqual([keyA, keyB]);
    expect(parseSecretStorageFallbackKeys(undefined)).toEqual([]);
    expect(parseSecretStorageFallbackKeys("")).toEqual([]);
  });
});
