import { beforeEach, describe, expect, it } from "vitest";
import type { AccountView } from "@/shared/contracts";
import { setAccountsUnlessEmptyWipe, useUsageAccountsStore } from "./usageAccountsStore";

function account(id: string): AccountView {
  return {
    accountId: id,
    provider: "grok",
    label: id,
    status: "available",
    enabled: true,
    selected: true,
    order: 0,
  } as AccountView;
}

describe("setAccountsUnlessEmptyWipe", () => {
  beforeEach(() => {
    useUsageAccountsStore.getState().reset();
  });

  it("replaces the store with a non-empty listing", () => {
    setAccountsUnlessEmptyWipe([account("grok:1")]);

    expect(useUsageAccountsStore.getState().accounts.map((a) => a.accountId)).toEqual(["grok:1"]);
  });

  it("ignores an empty listing while rows are shown instead of blanking authorizations", () => {
    setAccountsUnlessEmptyWipe([account("grok:1"), account("kimi:2")]);

    setAccountsUnlessEmptyWipe([]);

    expect(useUsageAccountsStore.getState().accounts.map((a) => a.accountId)).toEqual([
      "grok:1",
      "kimi:2",
    ]);
  });

  it("accepts an empty listing when the store is already empty", () => {
    setAccountsUnlessEmptyWipe([]);

    expect(useUsageAccountsStore.getState().accounts).toEqual([]);
  });
});
