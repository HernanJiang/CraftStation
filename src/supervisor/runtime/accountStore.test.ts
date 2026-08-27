import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { AccountResolver } from "./accountResolver";
import { AccountStore, maskIdentity } from "./accountStore";

const roots: string[] = [];
function createStore(): AccountStore {
  const root = mkdtempSync(join(tmpdir(), "craftstation-accounts-"));
  roots.push(root);
  return new AccountStore(root);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AccountStore", () => {
  it("supports 0/1/N accounts with selected and priority order", () => {
    const store = createStore();
    expect(store.list("codex")).toEqual([]);
    const first = store.add({
      provider: "codex",
      label: "Personal",
      maskedIdentity: "user@example.com",
    });
    const second = store.add({
      provider: "codex",
      label: "Work",
      maskedIdentity: "work@example.com",
    });
    expect(first.selected).toBe(true);
    expect(second.selected).toBe(false);
    store.select(second.accountId);
    expect(store.list("codex").map((account) => [account.label, account.selected])).toEqual([
      ["Personal", false],
      ["Work", true],
    ]);
    store.reorder("codex", [second.accountId, first.accountId]);
    expect(store.list("codex").map((account) => account.label)).toEqual(["Work", "Personal"]);
  });

  it("selects the next account when the selected account is removed", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });
    store.remove(first.accountId);

    expect(store.list("codex")).toEqual([
      expect.objectContaining({ accountId: second.accountId, selected: true, order: 0 }),
    ]);
  });

  it("selects the next enabled account when the selected account is disabled", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "first" });
    const second = store.add({ provider: "codex", label: "second" });

    store.setEnabled(first.accountId, false);

    expect(store.list("codex")).toEqual([
      expect.objectContaining({ accountId: first.accountId, enabled: false, selected: false }),
      expect.objectContaining({ accountId: second.accountId, enabled: true, selected: true }),
    ]);
  });

  it("keeps secrets out of AccountView and projects credentials inside the managed root", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Personal" });
    const view = store.get(account.accountId)!;
    expect(view).not.toHaveProperty("credentialRoot");
    const projected = store.projectCredential({
      accountId: account.accountId,
      provider: "codex",
      authJson: '{"tokens":{"access_token":"secret-token"}}',
    });
    expect(projected.startsWith(store.managedRoot)).toBe(true);
    expect(readFileSync(join(projected, "auth.json"), "utf8")).toContain("secret-token");
    expect(JSON.stringify(view)).not.toContain("secret-token");
  });

  it("recovers metadata from backup and rejects path escape", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-accounts-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({ provider: "codex", label: "Personal" });
    const metadata = join(root, "accounts.json");
    writeFileSync(`${metadata}.bak`, readFileSync(metadata));
    writeFileSync(metadata, "not-json");
    expect(store.get(account.accountId)?.label).toBe("Personal");
    const projected = store.projectCredential({
      accountId: account.accountId,
      provider: "codex",
      environment: { CODEX_HOME: store.credentialRoot(account.accountId) },
    });
    expect(projected.startsWith(store.managedRoot)).toBe(true);
    expect(JSON.parse(readFileSync(join(projected, "environment.json"), "utf8"))).toEqual({
      CODEX_HOME: projected,
    });
    expect(() =>
      store.projectCredential({
        accountId: account.accountId,
        provider: "codex",
        environment: { CODEX_HOME: "../../outside" },
      }),
    ).toThrow(/CODEX_HOME/);
  });

  it("fails closed on unknown account operations", () => {
    const store = createStore();
    expect(() => store.select("codex:missing")).toThrow(AccountControlError);
    expect(() => store.remove("codex:missing")).toThrow(AccountControlError);
  });

  it("masks email identities with the first and last three local-part characters", () => {
    expect(maskIdentity("alicebob@x.com")).toBe("ali***bob@x.com");
    expect(maskIdentity("alice@x.com")).toBe("alice@x.com");
    expect(maskIdentity("a@x.com")).toBe("a@x.com");
  });

  it("re-enables a disabled account without disabling other accounts and supports rename", () => {
    const store = createStore();
    const first = store.add({ provider: "grok", label: "first" });
    const second = store.add({ provider: "grok", label: "second" });
    store.setEnabled(first.accountId, false);

    expect(store.rename(second.accountId, "  renamed  ").label).toBe("renamed");
    expect(store.get(second.accountId)?.label).toBe("renamed");
    expect(store.setEnabled(first.accountId, true)).toMatchObject({
      accountId: first.accountId,
      enabled: true,
      status: "available",
    });
    expect(store.list("grok")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: first.accountId, enabled: true }),
        expect.objectContaining({ accountId: second.accountId, enabled: true }),
      ]),
    );
    expect(() => store.rename(second.accountId, "   ")).toThrow(/cannot be empty/i);
  });

  it("migrates legacy Grok labels and masks when the store is reopened", () => {
    const store = createStore();
    const account = store.add({
      provider: "grok",
      label: "New Grok",
      providerAccountId: "hernanjiang@example.com",
      maskedIdentity: "he***@example.com",
    });
    const metadataPath = join(store.managedRoot, "accounts.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      accounts: Array<Record<string, unknown>>;
    };
    metadata.accounts[0]!.label = "New Grok";
    metadata.accounts[0]!.maskedIdentity = "he***@example.com";
    writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");

    const reopened = new AccountStore(store.managedRoot);
    expect(reopened.get(account.accountId)).toMatchObject({
      label: "her",
      maskedIdentity: "her***ang@example.com",
    });
  });

  it("re-enables legacy disabled Grok accounts with official identity without changing selection", () => {
    const store = createStore();
    const accounts = Array.from({ length: 6 }, (_, index) =>
      store.add({
        provider: "grok",
        label: `grok-${index}`,
        providerAccountId: `user-${index}@example.com`,
      }),
    );
    store.select(accounts[5]!.accountId);

    const metadataPath = join(store.managedRoot, "accounts.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      accounts: Array<Record<string, unknown>>;
    };
    for (const account of metadata.accounts.slice(0, 5)) {
      account.enabled = false;
      account.status = "disabled";
    }
    metadata.accounts[5]!.status = "available";
    writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");

    const reopened = new AccountStore(store.managedRoot);
    const migrated = reopened.list("grok");
    expect(migrated.slice(0, 5)).toEqual(
      expect.arrayContaining(
        accounts.slice(0, 5).map((account) =>
          expect.objectContaining({
            accountId: account.accountId,
            enabled: true,
            status: "available",
          }),
        ),
      ),
    );
    expect(reopened.get(accounts[5]!.accountId)).toMatchObject({
      enabled: true,
      selected: true,
      status: "available",
    });

    reopened.updateStatus(accounts[5]!.accountId, "quota-exhausted");
    expect(
      new AccountResolver(reopened).resolve({
        provider: "grok",
        mode: "auto",
        selectedAccountId: accounts[5]!.accountId,
      }),
    ).toMatchObject({
      account: { accountId: accounts[0]!.accountId },
      reason: "priority-fallback",
    });
  });

  it("does not revive a Grok account whose disabled state is an explicit quota or auth state", () => {
    const store = createStore();
    const quota = store.add({
      provider: "grok",
      label: "quota",
      providerAccountId: "quota@example.com",
    });
    const auth = store.add({
      provider: "grok",
      label: "auth",
      providerAccountId: "auth@example.com",
    });
    const metadataPath = join(store.managedRoot, "accounts.json");
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
      accounts: Array<Record<string, unknown>>;
    };
    const quotaRecord = metadata.accounts.find((account) => account.accountId === quota.accountId)!;
    quotaRecord.enabled = false;
    quotaRecord.status = "quota-exhausted";
    const authRecord = metadata.accounts.find((account) => account.accountId === auth.accountId)!;
    authRecord.enabled = false;
    authRecord.status = "auth-expired";
    writeFileSync(metadataPath, JSON.stringify(metadata), "utf8");

    const reopened = new AccountStore(store.managedRoot);
    expect(reopened.get(quota.accountId)).toMatchObject({
      enabled: false,
      status: "quota-exhausted",
    });
    expect(reopened.get(auth.accountId)).toMatchObject({ enabled: false, status: "auth-expired" });
  });
});
