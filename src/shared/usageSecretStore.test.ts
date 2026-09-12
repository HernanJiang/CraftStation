import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureSecretStorageFallbackKeys,
  configureSecretStorageKey,
  resetSecretStorageKeysForTests,
} from "./secretStorage";
import {
  clearUsageSecret,
  getUsageSecret,
  hasUsageSecret,
  setUsageSecret,
  usageDurableSecretsPath,
  usageSecretsPath,
} from "./usageSecretStore";

describe("usageSecretStore", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "lc-secrets-"));
  });
  afterEach(() => {
    resetSecretStorageKeysForTests();
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("seals on disk and round-trips the plaintext", () => {
    setUsageSecret(cacheDir, "grok", "cookie", "session=abc123");
    // On-disk value must be encrypted, never the plaintext.
    const raw = readFileSync(usageSecretsPath(cacheDir), "utf8");
    expect(raw).not.toContain("session=abc123");
    expect(raw).toContain("lc-safe:v1:");
    expect(getUsageSecret(cacheDir, "grok", "cookie")).toBe("session=abc123");
    const durable = readFileSync(usageDurableSecretsPath(cacheDir), "utf8");
    expect(durable).not.toContain("session=abc123");
    expect(durable).toContain("lc-safe:v1:");
  });

  it("recovers from the durable copy after the Electron-scoped key rotates", () => {
    const keyA = randomBytes(32).toString("base64");
    const keyB = randomBytes(32).toString("base64");
    configureSecretStorageKey(keyA);
    setUsageSecret(cacheDir, "volcengine", "apiKey", "ark-key-keep");
    setUsageSecret(cacheDir, "opencode", "cookie", "opencode-session=keep");

    // Rebuild / userData identity switch: the app key is new and no fallback
    // can open the primary vault. The file-backed durable copy must still
    // round-trip and re-seal the primary under the new key.
    configureSecretStorageKey(keyB);
    configureSecretStorageFallbackKeys([]);
    expect(getUsageSecret(cacheDir, "volcengine", "apiKey")).toBe("ark-key-keep");
    expect(getUsageSecret(cacheDir, "opencode", "cookie")).toBe("opencode-session=keep");

    resetSecretStorageKeysForTests();
    configureSecretStorageKey(keyB);
    expect(getUsageSecret(cacheDir, "volcengine", "apiKey")).toBe("ark-key-keep");
    expect(getUsageSecret(cacheDir, "opencode", "cookie")).toBe("opencode-session=keep");
  });

  it("does not report undecryptable when the durable copy still opens", () => {
    const keyA = randomBytes(32).toString("base64");
    const keyB = randomBytes(32).toString("base64");
    configureSecretStorageKey(keyA);
    setUsageSecret(cacheDir, "volcengine", "secretAccessKey", "sk-keep");
    configureSecretStorageKey(keyB);
    configureSecretStorageFallbackKeys([]);
    const reports: Array<{ providerId: string; key: string }> = [];
    expect(
      getUsageSecret(cacheDir, "volcengine", "secretAccessKey", (info) => reports.push(info)),
    ).toBe("sk-keep");
    expect(reports).toEqual([]);
  });

  it("returns undefined for absent provider/key", () => {
    expect(getUsageSecret(cacheDir, "grok", "cookie")).toBeUndefined();
    setUsageSecret(cacheDir, "grok", "cookie", "x");
    expect(getUsageSecret(cacheDir, "grok", "missing")).toBeUndefined();
  });

  it("clears a single key and the bucket when emptied", () => {
    setUsageSecret(cacheDir, "grok", "cookie", "x");
    clearUsageSecret(cacheDir, "grok", "cookie");
    expect(getUsageSecret(cacheDir, "grok", "cookie")).toBeUndefined();
  });

  it("keeps sibling keys when clearing one, and drops the bucket once empty", () => {
    setUsageSecret(cacheDir, "copilot", "cookie", "c");
    setUsageSecret(cacheDir, "copilot", "token", "t");

    // Clearing one key leaves the other intact and the bucket present.
    clearUsageSecret(cacheDir, "copilot", "cookie");
    expect(getUsageSecret(cacheDir, "copilot", "cookie")).toBeUndefined();
    expect(getUsageSecret(cacheDir, "copilot", "token")).toBe("t");
    expect(hasUsageSecret(cacheDir, "copilot")).toBe(true);

    // Clearing the last key removes the whole provider bucket from disk.
    clearUsageSecret(cacheDir, "copilot", "token");
    expect(hasUsageSecret(cacheDir, "copilot")).toBe(false);
    const raw = JSON.parse(readFileSync(usageSecretsPath(cacheDir), "utf8")) as Record<
      string,
      unknown
    >;
    expect(raw.copilot).toBeUndefined();
  });

  it("clears the whole bucket when no key is given", () => {
    setUsageSecret(cacheDir, "grok", "cookie", "c");
    setUsageSecret(cacheDir, "grok", "token", "t");
    clearUsageSecret(cacheDir, "grok");
    expect(hasUsageSecret(cacheDir, "grok")).toBe(false);
  });
});
