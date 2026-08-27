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

describe("AccountResolver", () => {
  it("uses explicit > selected > ordered resolution and never falls back for explicit", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-resolver-"));
    roots.push(root);
    const store = new AccountStore(root);
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });
    store.updateStatus(first.accountId, "quota-exhausted");
    store.updateStatus(second.accountId, "available");
    const resolver = new AccountResolver(store);

    expect(
      resolver.resolve({ provider: "codex", mode: "explicit", explicitAccountId: second.accountId })
        .account.accountId,
    ).toBe(second.accountId);
    expect(resolver.resolve({ provider: "codex", mode: "auto" }).account.accountId).toBe(
      second.accountId,
    );
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

  it("does not fall back for quota-low and stops on transient error", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-resolver-"));
    roots.push(root);
    const store = new AccountStore(root);
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });
    store.updateStatus(first.accountId, "quota-low");
    store.updateStatus(second.accountId, "available");
    expect(
      new AccountResolver(store).resolve({ provider: "codex", mode: "auto" }).account.accountId,
    ).toBe(first.accountId);
    store.updateStatus(first.accountId, "error");
    expect(() => new AccountResolver(store).resolve({ provider: "codex", mode: "auto" })).toThrow(
      /non-fallback/,
    );
    expect(store.get(second.accountId)?.status).toBe("available");
  });

  it("reports ordered auto selection as a priority fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-resolver-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({ provider: "codex", label: "first" });
    store.updateStatus(account.accountId, "available");

    expect(new AccountResolver(store).resolve({ provider: "codex", mode: "auto" })).toMatchObject({
      reason: "priority-fallback",
      account: { accountId: account.accountId },
    });
  });

  it("does not fall back past a selected account with a non-fallback error", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-resolver-"));
    roots.push(root);
    const store = new AccountStore(root);
    const selected = store.add({ provider: "codex", label: "selected" });
    const fallback = store.add({ provider: "codex", label: "fallback" });
    store.updateStatus(selected.accountId, "error");
    store.updateStatus(fallback.accountId, "available");

    expect(() =>
      new AccountResolver(store).resolve({
        provider: "codex",
        mode: "auto",
        selectedAccountId: selected.accountId,
      }),
    ).toThrow(/non-fallback/);
  });
});
