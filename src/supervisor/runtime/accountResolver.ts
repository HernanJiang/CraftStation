import { randomInt } from "node:crypto";
import {
  AccountControlError,
  type AccountRecord,
  type AccountResolution,
  type AccountResolutionCandidate,
  type AccountResolutionRequest,
  type AccountSchedulingMode,
  type AccountStatus,
} from "@/shared/contracts";
import { AccountStore } from "./accountStore";

function candidate(
  accountId: string,
  status: AccountStatus,
  eligible: boolean,
  reason: string,
): AccountResolutionCandidate {
  return { accountId, status, eligible, reason };
}

function isUsable(account: AccountRecord): boolean {
  return account.enabled && (account.status === "available" || account.status === "quota-low");
}

function usableRecords(accounts: AccountRecord[]): AccountRecord[] {
  return accounts.filter(isUsable);
}

export class AccountResolver {
  constructor(
    private readonly store: AccountStore,
    private readonly credentialAvailable: (account: AccountRecord) => boolean = () => true,
  ) {}

  private isUsable(account: AccountRecord): boolean {
    return isUsable(account) && this.credentialAvailable(account);
  }

  resolve(request: AccountResolutionRequest): AccountResolution {
    const accounts = this.store.records(request.provider).sort((a, b) => a.order - b.order);
    const byId = new Map(accounts.map((account) => [account.accountId, account]));
    const candidates: AccountResolutionCandidate[] = [];

    // Explicit per-session override: never silently falls back.
    if (request.mode === "explicit") {
      return this.resolveExplicit(request, byId, candidates, accounts);
    }

    // Legacy "selected" mode: migrated to provider-pool scheduling. A legacy
    // selectedAccountId is honoured only while it is still usable, otherwise we
    // fall through to the provider pool (compatible with old craftAgent calls).
    if (request.mode === "selected" && request.selectedAccountId) {
      const account = byId.get(request.selectedAccountId);
      if (account && this.isUsable(account)) {
        candidates.push(candidate(account.accountId, account.status, true, "legacy selected"));
        return {
          account: this.store.get(account.accountId)!,
          reason: "selected",
          scheduling: this.poolMode(request, accounts),
          candidates,
        };
      }
      if (account)
        candidates.push(
          candidate(account.accountId, account.status, false, "legacy selected unavailable"),
        );
    }

    const mode = this.poolMode(request, accounts);
    const usable = usableRecords(accounts).filter((account) => this.credentialAvailable(account));
    for (const account of usable) {
      candidates.push(candidate(account.accountId, account.status, true, `${mode} eligible`));
    }
    for (const account of accounts) {
      if (!this.isUsable(account)) {
        candidates.push(candidate(account.accountId, account.status, false, `${mode} skipped`));
      }
    }

    if (mode === "round-robin")
      return this.resolveRoundRobin(request, usable, accounts, candidates);
    if (mode === "random") return this.resolveRandom(request, usable, candidates);

    // Priority (default): first usable account in Account Row order.
    const first = usable[0];
    if (!first) {
      throw new AccountControlError(
        "ACCOUNT_POOL_EXHAUSTED",
        `No usable ${request.provider} account in the provider pool.`,
        { provider: request.provider, candidates },
      );
    }
    return {
      account: this.store.get(first.accountId)!,
      reason: "priority",
      scheduling: "priority",
      candidates,
    };
  }

  private poolMode(
    request: AccountResolutionRequest,
    _accounts: AccountRecord[],
  ): AccountSchedulingMode {
    if (request.scheduling) return request.scheduling;
    const persisted = this.store.poolConfig(request.provider);
    return persisted.scheduling ?? "priority";
  }

  private resolveExplicit(
    request: AccountResolutionRequest,
    byId: Map<string, AccountRecord>,
    candidates: AccountResolutionCandidate[],
    accounts: AccountRecord[],
  ): AccountResolution {
    const account = request.explicitAccountId ? byId.get(request.explicitAccountId) : undefined;
    const usable = account !== undefined && this.isUsable(account);
    if (!usable) {
      if (account)
        candidates.push(
          candidate(account.accountId, account.status, false, "explicit account unavailable"),
        );
      throw new AccountControlError(
        "ACCOUNT_UNAVAILABLE",
        "The explicitly requested account is unavailable; automatic fallback is disabled.",
        {
          accountId: request.explicitAccountId,
          provider: request.provider,
          candidates,
        },
      );
    }
    candidates.push(
      candidate(account.accountId, account.status, true, "explicit account override"),
    );
    return {
      account: this.store.get(account.accountId)!,
      reason: "explicit",
      scheduling: this.poolMode(request, accounts),
      candidates,
    };
  }

  private resolveRoundRobin(
    request: AccountResolutionRequest,
    usable: AccountRecord[],
    accounts: AccountRecord[],
    candidates: AccountResolutionCandidate[],
  ): AccountResolution {
    if (usable.length === 0) {
      throw new AccountControlError(
        "ACCOUNT_POOL_EXHAUSTED",
        `No usable ${request.provider} account in the provider pool.`,
        { provider: request.provider, candidates },
      );
    }
    const cursor = this.store.poolConfig(request.provider).roundRobinCursor;
    const cursorIndex = cursor ? accounts.findIndex((account) => account.accountId === cursor) : -1;
    let picked: AccountRecord | undefined;
    if (cursorIndex >= 0) {
      // Walk forward from the cursor (excluding the cursor itself) wrapping around.
      for (let offset = 1; offset <= accounts.length; offset++) {
        const candidateAccount = accounts[(cursorIndex + offset) % accounts.length]!;
        if (this.isUsable(candidateAccount)) {
          picked = candidateAccount;
          break;
        }
      }
    } else {
      picked = usable[0];
    }
    if (!picked) {
      throw new AccountControlError(
        "ACCOUNT_POOL_EXHAUSTED",
        `No usable ${request.provider} account after the round-robin cursor.`,
        { provider: request.provider, cursor, candidates },
      );
    }
    this.store.advanceRoundRobinCursor(request.provider, picked.accountId);
    return {
      account: this.store.get(picked.accountId)!,
      reason: "round-robin",
      scheduling: "round-robin",
      candidates,
    };
  }

  private resolveRandom(
    request: AccountResolutionRequest,
    usable: AccountRecord[],
    candidates: AccountResolutionCandidate[],
  ): AccountResolution {
    if (usable.length === 0) {
      throw new AccountControlError(
        "ACCOUNT_POOL_EXHAUSTED",
        `No usable ${request.provider} account in the provider pool.`,
        { provider: request.provider, candidates },
      );
    }
    const picked = usable[randomInt(usable.length)]!;
    return {
      account: this.store.get(picked.accountId)!,
      reason: "random",
      scheduling: "random",
      candidates,
    };
  }
}
