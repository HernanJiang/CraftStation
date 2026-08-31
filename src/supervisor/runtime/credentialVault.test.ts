import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { CraftStationCredentialVault, providerCredentialBucket } from "./credentialVault";

const dirs: string[] = [];

function makeCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-credential-vault-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CraftStationCredentialVault", () => {
  it("uses the managed account id as the canonical bucket without a double provider prefix", () => {
    expect(providerCredentialBucket("antigravity", "antigravity:account-1")).toBe(
      "antigravity:account-1",
    );
    expect(providerCredentialBucket("openai-compatible", "account-2")).toBe(
      "openai-compatible:account-2",
    );
  });

  it("migrates a legacy double-prefixed bucket without exposing or losing secrets", () => {
    const cacheDir = makeCacheDir();
    const vault = new CraftStationCredentialVault(cacheDir);
    const accountId = "antigravity:account-1";
    const legacy = "antigravity:antigravity:account-1";
    setUsageSecret(cacheDir, legacy, "refreshToken", "refresh-secret");

    expect(vault.getAccountSecret("antigravity", accountId, "refreshToken")).toBe("refresh-secret");
    expect(getUsageSecret(cacheDir, accountId, "refreshToken")).toBe("refresh-secret");
    expect(getUsageSecret(cacheDir, legacy, "refreshToken")).toBeUndefined();
  });

  it("keeps canonical values when both canonical and legacy buckets exist", () => {
    const cacheDir = makeCacheDir();
    const vault = new CraftStationCredentialVault(cacheDir);
    const accountId = "antigravity:account-1";
    setUsageSecret(cacheDir, accountId, "accessToken", "canonical-access");
    setUsageSecret(cacheDir, "antigravity:antigravity:account-1", "accessToken", "legacy-access");
    setUsageSecret(cacheDir, "antigravity:antigravity:account-1", "refreshToken", "legacy-refresh");

    expect(vault.getAccountSecret("antigravity", accountId, "accessToken")).toBe(
      "canonical-access",
    );
    expect(vault.getAccountSecret("antigravity", accountId, "refreshToken")).toBe("legacy-refresh");
  });

  it("removes both canonical and legacy buckets for one managed account only", () => {
    const cacheDir = makeCacheDir();
    const vault = new CraftStationCredentialVault(cacheDir);
    setUsageSecret(cacheDir, "antigravity:one", "accessToken", "one");
    setUsageSecret(cacheDir, "antigravity:antigravity:one", "refreshToken", "legacy-one");
    setUsageSecret(cacheDir, "antigravity:two", "accessToken", "two");

    vault.removeAccount("antigravity", "antigravity:one");

    expect(getUsageSecret(cacheDir, "antigravity:one", "accessToken")).toBeUndefined();
    expect(getUsageSecret(cacheDir, "antigravity:antigravity:one", "refreshToken")).toBeUndefined();
    expect(getUsageSecret(cacheDir, "antigravity:two", "accessToken")).toBe("two");
  });
});
