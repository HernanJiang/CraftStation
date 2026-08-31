import {
  clearUsageSecret,
  getUsageSecret,
  hasUsageSecret,
  mergeUsageSecretBuckets,
  setUsageSecret,
} from "@/shared/usageSecretStore";

/** Canonical sealed-bucket name for one CraftStation managed account. */
export function providerCredentialBucket(provider: string, accountId: string): string {
  const prefix = `${provider}:`;
  return accountId.startsWith(prefix) ? accountId : `${prefix}${accountId}`;
}

/**
 * CraftStation's credential authority under ~/.craftstation/cache.
 *
 * Official CLI homes remain independent import/projection sources. Managed
 * provider adapters use this small seam for account-isolated encrypted values,
 * legacy bucket migration, and durable account deletion. Renderer callers
 * never cross this seam and therefore never receive plaintext credentials.
 */
export class CraftStationCredentialVault {
  constructor(private readonly cacheDir: string) {}

  stagingBucket(provider: string): string {
    return provider;
  }

  accountBucket(provider: string, accountId: string): string {
    this.migrateLegacyBucket(provider, accountId);
    return providerCredentialBucket(provider, accountId);
  }

  hasAccount(provider: string, accountId: string): boolean {
    return hasUsageSecret(this.cacheDir, this.accountBucket(provider, accountId));
  }

  getAccountSecret(provider: string, accountId: string, key: string): string | undefined {
    return getUsageSecret(this.cacheDir, this.accountBucket(provider, accountId), key);
  }

  setAccountSecret(provider: string, accountId: string, key: string, value: string): void {
    setUsageSecret(this.cacheDir, this.accountBucket(provider, accountId), key, value);
  }

  importStaging(provider: string, accountId: string): string {
    const destination = this.accountBucket(provider, accountId);
    mergeUsageSecretBuckets(this.cacheDir, this.stagingBucket(provider), destination);
    return destination;
  }

  removeAccount(provider: string, accountId: string): void {
    const canonical = providerCredentialBucket(provider, accountId);
    clearUsageSecret(this.cacheDir, canonical);
    const legacy = `${provider}:${accountId}`;
    if (legacy !== canonical) clearUsageSecret(this.cacheDir, legacy);
  }

  private migrateLegacyBucket(provider: string, accountId: string): void {
    const canonical = providerCredentialBucket(provider, accountId);
    const legacy = `${provider}:${accountId}`;
    if (legacy !== canonical) mergeUsageSecretBuckets(this.cacheDir, legacy, canonical);
  }
}
