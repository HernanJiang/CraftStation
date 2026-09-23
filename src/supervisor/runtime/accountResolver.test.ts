import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { AccountResolver } from "./accountResolver";
import { AccountStore } from "./accountStore";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createStore(): AccountStore {
  const root = mkdtempSync(join(tmpdir(), "craftstation-resolver-"));
  roots.push(root);
  return new AccountStore(root);
}

function seed(store: AccountStore, provider: string, count: number) {
  const accounts = [];
  for (let index = 0; index < count; index++) {
    const account = store.add({ provider, label: `${provider}-${index}` });
    store.updateStatus(account.accountId, "available");
    accounts.push(account);
  }
  return accounts;
}

describe("AccountResolver", () => {
  it("uses explicit override and never silently falls back", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });
    store.updateStatus(first.accountId, "quota-exhausted");
    store.updateStatus(second.accountId, "available");
    const resolver = new AccountResolver(store);

    expect(
      resolver.resolve({ provider: "codex", mode: "explicit", explicitAccountId: second.accountId })
        .account.accountId,
    ).toBe(second.accountId);
    expect(
      resolver.resolve({ provider: "codex", mode: "explicit", explicitAccountId: second.accountId })
        .reason,
    ).toBe("explicit");
    expect(() =>
      resolver.resolve({
        provider: "codex",
        mode: "explicit",
        explicitAccountId: first.accountId,
      }),
    ).toThrow(AccountControlError);
    expect(() =>
      resolver.resolve({
        provider: "codex",
        mode: "explicit",
        explicitAccountId: "codex:missing",
      }),
    ).toThrow(AccountControlError);
  });

  it("preferred honours a usable pick but falls back to the pool when exhausted", () => {
    const store = createStore();
    const first = store.add({ provider: "grok", label: "first" });
    const second = store.add({ provider: "grok", label: "second" });
    store.updateStatus(first.accountId, "quota-exhausted");
    store.updateStatus(second.accountId, "available");
    const resolver = new AccountResolver(store);

    // Usable pick wins.
    expect(
      resolver.resolve({
        provider: "grok",
        mode: "preferred",
        explicitAccountId: second.accountId,
      }).account.accountId,
    ).toBe(second.accountId);
    // Exhausted pick falls back to the pool instead of failing the launch.
    const fallback = resolver.resolve({
      provider: "grok",
      mode: "preferred",
      explicitAccountId: first.accountId,
    });
    expect(fallback.account.accountId).toBe(second.accountId);
    expect(fallback.reason).toBe("priority");
    // An all-exhausted pool still surfaces the pool error.
    store.updateStatus(second.accountId, "quota-exhausted");
    expect(() =>
      resolver.resolve({
        provider: "grok",
        mode: "preferred",
        explicitAccountId: first.accountId,
      }),
    ).toThrow(AccountControlError);
  });

  it("keeps quota-low usable and skips hard error while preserving diagnostics", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });
    store.updateStatus(first.accountId, "quota-low");
    store.updateStatus(second.accountId, "available");
    const resolver = new AccountResolver(store);
    // A later healthy account beats one already marked quota-low.
    expect(resolver.resolve({ provider: "codex", mode: "auto" }).account.accountId).toBe(
      second.accountId,
    );
    // quota-low stays usable when it is the only account left.
    store.updateStatus(second.accountId, "disabled");
    expect(resolver.resolve({ provider: "codex", mode: "auto" }).account.accountId).toBe(
      first.accountId,
    );
    store.updateStatus(second.accountId, "available");

    // hard error is skipped, next usable account is used, diagnostics retained.
    store.updateStatus(first.accountId, "error");
    const resolution = resolver.resolve({ provider: "codex", mode: "auto" });
    expect(resolution.account.accountId).toBe(second.accountId);
    expect(
      resolution.candidates.find((candidate) => candidate.accountId === first.accountId),
    ).toMatchObject({ eligible: false, status: "error" });
  });

  it("among quota-low accounts picks the one with the most remaining", () => {
    const store = createStore();
    const tight = store.add({ provider: "codex", label: "tight" });
    const room = store.add({ provider: "codex", label: "room" });
    store.updateStatus(tight.accountId, "quota-low");
    store.updateStatus(room.accountId, "quota-low");
    store.updateQuota(tight.accountId, [{ id: "weekly", label: "Weekly", usedPercent: 98 }]);
    store.updateQuota(room.accountId, [{ id: "weekly", label: "Weekly", usedPercent: 91 }]);
    expect(
      new AccountResolver(store).resolve({ provider: "codex", mode: "auto" }).account.accountId,
    ).toBe(room.accountId);
  });

  it("selects priority order by default and reports the mode", () => {
    const store = createStore();
    const [first] = seed(store, "codex", 3);
    const resolution = new AccountResolver(store).resolve({ provider: "codex", mode: "auto" });
    expect(resolution).toMatchObject({
      reason: "priority",
      scheduling: "priority",
      account: { accountId: first!.accountId },
    });
  });

  it("skips excluded accounts and reports them in candidates", () => {
    const store = createStore();
    const [first, second] = seed(store, "grok", 2);
    const resolver = new AccountResolver(store);

    const resolution = resolver.resolve({
      provider: "grok",
      mode: "auto",
      excludedAccountIds: [first!.accountId],
    });
    expect(resolution.account.accountId).toBe(second!.accountId);
    expect(
      resolution.candidates.find((candidate) => candidate.accountId === first!.accountId),
    ).toMatchObject({ eligible: false });
  });

  it("reports pool exhausted when every usable account is excluded", () => {
    const store = createStore();
    const accounts = seed(store, "grok", 2);
    const resolver = new AccountResolver(store);

    expect(() =>
      resolver.resolve({
        provider: "grok",
        mode: "auto",
        excludedAccountIds: accounts.map((account) => account.accountId),
      }),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_POOL_EXHAUSTED" }));
  });

  it("never reroutes an explicit pin through exclusions", () => {
    const store = createStore();
    const [first] = seed(store, "grok", 2);
    const resolver = new AccountResolver(store);

    expect(
      resolver.resolve({
        provider: "grok",
        mode: "explicit",
        explicitAccountId: first!.accountId,
        excludedAccountIds: [first!.accountId],
      }).account.accountId,
    ).toBe(first!.accountId);
  });

  it("round-robin walks past excluded accounts", () => {
    const store = createStore();
    const accounts = seed(store, "grok", 3);
    const resolver = new AccountResolver(store);
    // Prime the cursor to the first account: the next pick must skip the
    // excluded second account and land on the third.
    resolver.resolve({ provider: "grok", mode: "auto", scheduling: "round-robin" });
    const resolution = resolver.resolve({
      provider: "grok",
      mode: "auto",
      scheduling: "round-robin",
      excludedAccountIds: [accounts[1]!.accountId],
    });
    expect(resolution.account.accountId).toBe(accounts[2]!.accountId);
  });

  it("round-robins across usable accounts and persists the cursor", () => {
    const store = createStore();
    const accounts = seed(store, "codex", 3);
    const resolver = new AccountResolver(store);

    const picks = [0, 1, 2, 0].map(() => {
      const resolution = resolver.resolve({
        provider: "codex",
        mode: "auto",
        scheduling: "round-robin",
      });
      return resolution.account.accountId;
    });
    expect(picks).toEqual([
      accounts[0]!.accountId,
      accounts[1]!.accountId,
      accounts[2]!.accountId,
      accounts[0]!.accountId,
    ]);
    expect(store.poolConfig("codex").roundRobinCursor).toBe(accounts[0]!.accountId);
  });

  it("round-robin skips non-usable accounts without breaking the ring", () => {
    const store = createStore();
    const accounts = seed(store, "codex", 3);
    store.updateStatus(accounts[1]!.accountId, "quota-exhausted");
    const resolver = new AccountResolver(store);
    const picks = [0, 2, 0, 2].map(
      () =>
        resolver.resolve({
          provider: "codex",
          mode: "auto",
          scheduling: "round-robin",
        }).account.accountId,
    );
    expect(picks).toEqual([
      accounts[0]!.accountId,
      accounts[2]!.accountId,
      accounts[0]!.accountId,
      accounts[2]!.accountId,
    ]);
  });

  it("random picks only from the usable pool", () => {
    const store = createStore();
    const accounts = seed(store, "codex", 4);
    store.updateStatus(accounts[0]!.accountId, "disabled");
    store.updateStatus(accounts[1]!.accountId, "quota-exhausted");
    const resolver = new AccountResolver(store);
    for (let index = 0; index < 20; index++) {
      const accountId = resolver.resolve({
        provider: "codex",
        mode: "auto",
        scheduling: "random",
      }).account.accountId;
      expect(accountId).not.toBe(accounts[0]!.accountId);
      expect(accountId).not.toBe(accounts[1]!.accountId);
    }
  });

  it("reports a stable pool exhausted error when no account is usable", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "first" });
    store.updateStatus(first.accountId, "quota-exhausted");
    const error = (() => {
      try {
        new AccountResolver(store).resolve({ provider: "codex", mode: "auto" });
      } catch (caught) {
        return caught as AccountControlError;
      }
      throw new Error("expected to throw");
    })();
    expect(error).toBeInstanceOf(AccountControlError);
    expect(error.code).toBe("ACCOUNT_POOL_EXHAUSTED");
    // Actionable: names the account + state and tells where to recover.
    expect(error.message).toContain("first");
    expect(error.message).toContain("quota-exhausted");
    expect(error.message).toContain("渠道与额度");
  });

  it("treats an account without its required credential as ineligible", () => {
    const store = createStore();
    const missing = store.add({ provider: "grok", label: "missing credential" });
    const ready = store.add({ provider: "grok", label: "ready" });
    store.updateStatus(missing.accountId, "available");
    store.updateStatus(ready.accountId, "available");
    const resolver = new AccountResolver(store, (account) => account.accountId === ready.accountId);

    const resolution = resolver.resolve({ provider: "grok", mode: "auto" });
    expect(resolution.account.accountId).toBe(ready.accountId);
    expect(resolution.candidates).toContainEqual(
      expect.objectContaining({ accountId: missing.accountId, eligible: false }),
    );
    expect(() =>
      resolver.resolve({
        provider: "grok",
        mode: "explicit",
        explicitAccountId: missing.accountId,
      }),
    ).toThrowError(expect.objectContaining({ code: "ACCOUNT_UNAVAILABLE" }));
  });

  it("persists the provider scheduling mode and reuses it on the next resolve", () => {
    const store = createStore();
    seed(store, "grok", 2);
    store.setPoolSchedulingMode("grok", "round-robin");
    expect(store.poolConfig("grok").scheduling).toBe("round-robin");
    expect(new AccountResolver(store).resolve({ provider: "grok", mode: "auto" }).scheduling).toBe(
      "round-robin",
    );
    // Per-call override beats the persisted mode.
    expect(
      new AccountResolver(store).resolve({ provider: "grok", mode: "auto", scheduling: "priority" })
        .scheduling,
    ).toBe("priority");
  });

  it("keeps an explicit override sticky even after a later UI change", () => {
    const store = createStore();
    const [first, second] = seed(store, "grok", 2);
    const resolver = new AccountResolver(store);
    const resolution = resolver.resolve({
      provider: "grok",
      mode: "explicit",
      explicitAccountId: second!.accountId,
    });
    // Explicit is a per-session override; a later auto resolution does not
    // mutate the already-bound session.
    expect(resolution.account.accountId).toBe(second!.accountId);
    expect(store.poolConfig("grok").scheduling).toBe("priority");
    expect(resolver.resolve({ provider: "grok", mode: "auto" }).account.accountId).toBe(
      first!.accountId,
    );
  });
});
