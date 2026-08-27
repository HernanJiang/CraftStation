import type { AccountStatus, AccountView } from "@/shared/contracts";

export interface ProviderIdentity {
  providerAccountId?: string;
  maskedIdentity?: string;
  plan?: string;
}

export interface ProviderAccountAdapter {
  readonly provider: string;
  inspectIdentity(account: AccountView): Promise<ProviderIdentity>;
  projectCredential(account: AccountView, input: unknown): Promise<string>;
  collectQuota(account: AccountView): Promise<{
    status: AccountStatus;
    lastQuotaAt: number;
    lastError?: string;
  }>;
  launchEnvironment(account: AccountView): Record<string, string>;
}

export class ProviderAccountAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAccountAdapter>();

  register(adapter: ProviderAccountAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: string): ProviderAccountAdapter | undefined {
    return this.adapters.get(provider);
  }
}
