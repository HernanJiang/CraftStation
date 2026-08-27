import {
  AccountControlError,
  type AccountResolution,
  type AccountResolutionCandidate,
  type AccountResolutionRequest,
  type AccountStatus,
} from "@/shared/contracts";
import { AccountStore } from "./accountStore";

const AUTO_FALLBACK_STATUSES = new Set<AccountStatus>([
  "disabled",
  "quota-exhausted",
  "auth-expired",
  "unavailable",
]);

function candidate(
  accountId: string,
  status: AccountStatus,
  eligible: boolean,
  reason: string,
): AccountResolutionCandidate {
  return { accountId, status, eligible, reason };
}

export class AccountResolver {
  constructor(private readonly store: AccountStore) {}

  resolve(request: AccountResolutionRequest): AccountResolution {
    const accounts = this.store.records(request.provider);
    const byId = new Map(accounts.map((account) => [account.accountId, account]));
    const candidates: AccountResolutionCandidate[] = [];

    if (request.mode === "explicit") {
      const account = request.explicitAccountId ? byId.get(request.explicitAccountId) : undefined;
      const usable =
        account !== undefined &&
        account.enabled &&
        (account.status === "available" || account.status === "quota-low");
      if (!usable) {
        if (account)
          candidates.push(
            candidate(
              account.accountId,
              account.status,
              false,
              "explicit account is disabled or unavailable",
            ),
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
      return { account: this.store.get(account.accountId)!, reason: "explicit", candidates };
    }

    if ((request.mode === "selected" || request.mode === "auto") && request.selectedAccountId) {
      const account = byId.get(request.selectedAccountId);
      if (account?.enabled && (account.status === "available" || account.status === "quota-low")) {
        candidates.push(candidate(account.accountId, account.status, true, "selected account"));
        return { account: this.store.get(account.accountId)!, reason: "selected", candidates };
      }
      if (account)
        candidates.push(
          candidate(
            account.accountId,
            account.status,
            false,
            "selected account is disabled or unavailable",
          ),
        );
      if (request.mode === "auto" && account && !AUTO_FALLBACK_STATUSES.has(account.status)) {
        throw new AccountControlError(
          "ACCOUNT_UNAVAILABLE",
          "Account resolution stopped on a non-fallback selected account status.",
          {
            provider: request.provider,
            accountId: account.accountId,
            status: account.status,
            candidates,
          },
        );
      }
    }

    if (request.mode !== "auto") {
      throw new AccountControlError("ACCOUNT_UNAVAILABLE", "The selected account is unavailable.", {
        provider: request.provider,
        candidates,
      });
    }

    for (const account of accounts) {
      if (account.accountId === request.selectedAccountId) continue;
      if (!account.enabled || account.status === "disabled") {
        candidates.push(candidate(account.accountId, account.status, false, "disabled account"));
        continue;
      }
      const eligible = account.status === "available" || account.status === "quota-low";
      candidates.push(
        candidate(
          account.accountId,
          account.status,
          eligible,
          eligible ? "highest priority available account" : "fallback-eligible failure status",
        ),
      );
      if (eligible) {
        return {
          account: this.store.get(account.accountId)!,
          reason: "priority-fallback",
          candidates,
        };
      }
      if (!AUTO_FALLBACK_STATUSES.has(account.status)) {
        throw new AccountControlError(
          "ACCOUNT_UNAVAILABLE",
          "Account resolution stopped on a non-fallback error status.",
          {
            provider: request.provider,
            accountId: account.accountId,
            status: account.status,
            candidates,
          },
        );
      }
    }
    throw new AccountControlError(
      "ACCOUNT_UNAVAILABLE",
      "No enabled account is available for this provider.",
      {
        provider: request.provider,
        candidates,
      },
    );
  }
}
