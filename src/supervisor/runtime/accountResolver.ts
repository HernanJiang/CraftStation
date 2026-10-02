import { randomInt } from "node:crypto";
import { blockingUsedPercent } from "@craftstation/agents-usage/switcherQuota";
import {
  AccountControlError,
  type AccountRecord,
  type AccountResolution,
  type AccountResolutionCandidate,
  type AccountResolutionRequest,
  type AccountSchedulingMode,
  type AccountStatus,
} from "@/shared/contracts";
import {
  AccountStore,
  effectiveQuotaStatus,
  isQuotaWindowBlocking,
  liveQuotaWindows,
  quotaAxisForWindowId,
} from "./accountStore";

function candidate(
  accountId: string,
  status: AccountStatus,
  eligible: boolean,
  reason: string,
): AccountResolutionCandidate {
  return { accountId, status, eligible, reason };
}

function isUsable(account: AccountRecord, now: number = Date.now()): boolean {
  if (!account.enabled) return false;
  const status = effectiveQuotaStatus(account, now);
  return status === "available" || status === "quota-low";
}

/**
 * Human-readable explanation for a quota-skipped row: name the blocking axis
 * and its reset so pool diagnostics can tell a 5h cooldown from a weekly
 * exhaustion instead of a bare "skipped".
 */
function quotaBlockReason(account: AccountRecord, now: number): string | undefined {
  const blocked = (account.quotaWindows ?? []).filter((window) =>
    isQuotaWindowBlocking(window, now),
  );
  if (blocked.length === 0) return undefined;
  const weekly = blocked.find((window) => quotaAxisForWindowId(window.id) === "weekly");
  const session = blocked.find((window) => quotaAxisForWindowId(window.id) === "session-5h");
  const blocking = weekly ?? session ?? blocked[0]!;
  const name = weekly ? "weekly" : session ? "session-5h" : blocking.id;
  const until =
    blocking.resetsAt !== undefined ? ` until ${new Date(blocking.resetsAt).toLocaleString()}` : "";
  return `quota ${name} exhausted${until}`;
}

function usableRecords(accounts: AccountRecord[]): AccountRecord[] {
  return accounts.filter(isUsable);
}

function pickPriorityAccount(usable: AccountRecord[]): AccountRecord | undefined {
  const now = Date.now();
  const ranked = [...usable].sort((left, right) => {
    const leftLow = effectiveQuotaStatus(left, now) === "quota-low" ? 1 : 0;
    const rightLow = effectiveQuotaStatus(right, now) === "quota-low" ? 1 : 0;
    if (leftLow !== rightLow) return leftLow - rightLow;
    if (leftLow === 1) {
      const leftUsed =
        blockingUsedPercent(left.provider, liveQuotaWindows(left.quotaWindows, now)) ??
        Number.POSITIVE_INFINITY;
      const rightUsed =
        blockingUsedPercent(right.provider, liveQuotaWindows(right.quotaWindows, now)) ??
        Number.POSITIVE_INFINITY;
      if (leftUsed !== rightUsed) return leftUsed - rightUsed;
    }
    return left.order - right.order;
  });
  return ranked[0];
}

/**
 * Actionable pool-exhaustion error: instead of a bare "No usable X account",
 * name every account with its state and reason so the caller (agent or user)
 * can act — wait for quota reset, re-enable, or add an account in 渠道与额度.
 */
function poolExhaustedError(
  provider: string,
  accounts: AccountRecord[],
  candidates: AccountResolutionCandidate[],
  suffix?: string,
): AccountControlError {
  const labels = new Map(accounts.map((account) => [account.accountId, account.label]));
  const detail =
    candidates.length > 0
      ? candidates
          .map(
            (entry) =>
              `${labels.get(entry.accountId) ?? entry.accountId}（${entry.status}：${entry.reason}）`,
          )
          .join("；")
      : "该厂商尚无账号";
  return new AccountControlError(
    "ACCOUNT_POOL_EXHAUSTED",
    `No usable ${provider} account in the provider pool.（${detail}）` +
      "去「渠道与额度」添加账号或等待额度恢复后再试。" +
      (suffix ? ` ${suffix}` : ""),
    { provider, candidates },
  );
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
    const excluded = new Set(request.excludedAccountIds ?? []);

    // Explicit per-session override: never silently falls back.
    if (request.mode === "explicit") {
      return this.resolveExplicit(request, byId, candidates, accounts);
    }

    // Preferred override (new-session launches): honour the user's pick while
    // it is usable, but fall back to the provider pool when it is exhausted,
    // disabled or missing credentials instead of failing the launch.
    if (request.mode === "preferred" && request.explicitAccountId) {
      const preferred = byId.get(request.explicitAccountId);
      if (preferred && this.isUsable(preferred)) {
        candidates.push(
          candidate(preferred.accountId, preferred.status, true, "preferred account usable"),
        );
        return {
          account: this.store.get(preferred.accountId)!,
          reason: "explicit",
          scheduling: this.poolMode(request, accounts),
          candidates,
        };
      }
      if (preferred) {
        candidates.push(
          candidate(
            preferred.accountId,
            preferred.status,
            false,
            "preferred account unavailable — falling back to the pool",
          ),
        );
      }
      // Fall through to pool scheduling below.
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
    const usable = usableRecords(accounts).filter(
      (account) => this.credentialAvailable(account) && !excluded.has(account.accountId),
    );
    for (const account of usable) {
      candidates.push(candidate(account.accountId, account.status, true, `${mode} eligible`));
    }
    for (const account of accounts) {
      if (excluded.has(account.accountId)) {
        candidates.push(
          candidate(account.accountId, account.status, false, `${mode} excluded (tried this turn)`),
        );
      } else if (!this.isUsable(account)) {
        candidates.push(
          candidate(
            account.accountId,
            effectiveQuotaStatus(account, Date.now()),
            false,
            quotaBlockReason(account, Date.now()) ?? `${mode} skipped`,
          ),
        );
      }
    }

    if (mode === "round-robin")
      return this.resolveRoundRobin(request, usable, accounts, candidates, excluded);
    if (mode === "random") return this.resolveRandom(request, usable, accounts, candidates);

    // Priority (default): Account Row order, except a later account that still
    // has a healthy blocking window beats one already marked quota-low. Among
    // quota-low accounts, the one with the most remaining on that window wins.
    const first = pickPriorityAccount(usable);
    if (!first) {
      throw poolExhaustedError(request.provider, accounts, candidates);
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
    excluded: ReadonlySet<string>,
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
        if (this.isUsable(candidateAccount) && !excluded.has(candidateAccount.accountId)) {
          picked = candidateAccount;
          break;
        }
      }
    } else {
      picked = usable[0];
    }
    if (!picked) {
      throw poolExhaustedError(
        request.provider,
        accounts,
        candidates,
        `（round-robin 游标：${cursor ?? "无"}）`,
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
    accounts: AccountRecord[],
    candidates: AccountResolutionCandidate[],
  ): AccountResolution {
    if (usable.length === 0) {
      throw poolExhaustedError(request.provider, accounts, candidates);
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
