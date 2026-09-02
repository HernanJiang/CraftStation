import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it.each([
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "OPENCODE_CONFIG_DIR",
  ])("rejects reserved OpenCode private-root environment key %s", (reservedKey) => {
    const store = createStore();
    const account = store.add({ provider: "openai", label: "OpenCode" });

    expect(() =>
      store.projectCredential({
        accountId: account.accountId,
        provider: "openai",
        environment: { OPENAI_API_KEY: "selected-secret", [reservedKey]: "C:/escape" },
      }),
    ).toThrow(/reserved|private runtime root/i);
  });

  it("fails closed when a persisted credential environment contains a reserved private-root key", () => {
    const store = createStore();
    const account = store.add({ provider: "deepseek", label: "OpenCode" });
    const root = store.projectCredential({
      accountId: account.accountId,
      provider: "deepseek",
      environment: { DEEPSEEK_API_KEY: "selected-secret" },
    });
    writeFileSync(
      join(root, "environment.json"),
      JSON.stringify({ DEEPSEEK_API_KEY: "selected-secret", HOME: "C:/escape" }),
      "utf8",
    );

    expect(() => store.readCredentialEnvironment(account.accountId)).toThrow(
      /invalid|reserved|private runtime root/i,
    );
  });

  it("fails closed on unknown account operations", () => {
    const store = createStore();
    expect(() => store.select("codex:missing")).toThrow(AccountControlError);
    expect(() => store.remove("codex:missing")).toThrow(AccountControlError);
  });

  it("purges identity-less rows regardless of status and dedupes matching identities", () => {
    const store = createStore();
    const unknown = store.add({ provider: "codex", label: "ghost" });
    store.updateStatus(unknown.accountId, "available", { lastQuotaAt: Date.now() });
    store.updateQuota(unknown.accountId, [{ id: "weekly", label: "Weekly", usedPercent: 10 }]);
    expect(store.cleanupOrphanedPendingAccounts("codex")).toBe(1);
    expect(store.list("codex")).toEqual([]);

    const first = store.add({
      provider: "codex",
      label: "one",
      providerAccountId: "User@Example.com",
    });
    store.add({
      provider: "codex",
      label: "two",
      providerAccountId: "user@example.com",
    });
    expect(store.dedupeProviderIdentities("codex")).toBe(1);
    expect(store.list("codex").map((account) => account.accountId)).toEqual([first.accountId]);
  });

  it("keeps a brand-new identity-less row during login, then list() drops probed ghosts", () => {
    const store = createStore();
    const pending = store.add({ provider: "codex", label: "A" });
    expect(store.list("codex").map((account) => account.accountId)).toEqual([pending.accountId]);
    store.updateStatus(pending.accountId, "available", { lastQuotaAt: Date.now() });
    expect(store.list("codex")).toEqual([]);
  });

  it("matches provider identities case-insensitively and cleans only orphaned pending homes", () => {
    const store = createStore();
    const account = store.add({
      provider: "codex",
      label: "Personal",
      providerAccountId: "User@Example.com",
    });
    expect(store.findByProviderIdentity("codex", " user@example.COM ")?.accountId).toBe(
      account.accountId,
    );

    const activeHome = join(store.managedRoot, "grok-pending-active");
    const orphanHome = join(store.managedRoot, "grok-pending-orphan");
    const unrelated = join(store.managedRoot, "other-provider-pending");
    mkdirSync(activeHome, { recursive: true });
    mkdirSync(orphanHome, { recursive: true });
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(activeHome, "keep"), "active", { encoding: "utf8", flag: "w" });
    writeFileSync(join(orphanHome, "remove"), "orphan", { encoding: "utf8", flag: "w" });
    writeFileSync(join(unrelated, "keep"), "unrelated", { encoding: "utf8", flag: "w" });

    expect(store.cleanupOrphanedPendingHomes("grok-pending-", [activeHome])).toBe(1);
    expect(readFileSync(join(activeHome, "keep"), "utf8")).toBe("active");
    expect(() => readFileSync(join(orphanHome, "remove"), "utf8")).toThrow(/ENOENT/);
    expect(readFileSync(join(unrelated, "keep"), "utf8")).toBe("unrelated");
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

  it("clears a prior quota error when an account recovers", () => {
    const store = createStore();
    const account = store.add({ provider: "grok", label: "recovering" });

    store.updateStatus(account.accountId, "error", {
      lastError: "temporary network failure",
      lastQuotaAt: 1,
    });
    expect(store.get(account.accountId)).toMatchObject({
      status: "error",
      lastError: "temporary network failure",
    });

    expect(store.updateStatus(account.accountId, "available")).not.toHaveProperty("lastError");
  });

  it("migrates legacy Grok labels and keeps the full email when the store is reopened", () => {
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
      // 邮箱全称 contract: Grok rows surface the unmasked email.
      maskedIdentity: "hernanjiang@example.com",
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
    // v0.5: legacy selected markers no longer route auto sessions; the provider
    // pool scheduling (priority) picks the first usable account.
    expect(
      new AccountResolver(reopened).resolve({
        provider: "grok",
        mode: "auto",
      }),
    ).toMatchObject({
      account: { accountId: accounts[0]!.accountId },
      reason: "priority",
    });
  });

  it("promotes a legacy v1 metadata file to v2 with default pool scheduling", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-accounts-"));
    roots.push(root);
    const first = new AccountStore(root).add({ provider: "grok", label: "legacy" });
    expect(first.label).toBe("legacy");
    const metadataPath = join(root, "accounts.json");
    const raw = JSON.parse(readFileSync(metadataPath, "utf8"));
    // Simulate the pre-v0.5 on-disk shape (version 1, no pools).
    const v1 = { version: 1, accounts: raw.accounts };
    writeFileSync(metadataPath, JSON.stringify(v1));

    const reopened = new AccountStore(root);
    expect(reopened.list("grok")).toHaveLength(1);
    expect(reopened.list("grok")[0]!.label).toBe("legacy");
    expect(reopened.poolConfig("grok")).toEqual({ scheduling: "priority" });
    // The on-disk file is upgraded to version 2 with pools present.
    const persisted = JSON.parse(readFileSync(metadataPath, "utf8"));
    expect(persisted.version).toBe(2);
    expect(persisted.pools).toEqual({});
  });

  it("persists provider scheduling mode and round-robin cursor across reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-accounts-"));
    roots.push(root);
    const store = new AccountStore(root);
    const first = store.add({ provider: "grok", label: "first" });
    const second = store.add({ provider: "grok", label: "second" });

    expect(store.setPoolSchedulingMode("grok", "round-robin")).toEqual({
      scheduling: "round-robin",
    });
    store.advanceRoundRobinCursor("grok", first.accountId);

    const reopened = new AccountStore(root);
    expect(reopened.poolConfig("grok")).toEqual({
      scheduling: "round-robin",
      roundRobinCursor: first.accountId,
    });
    expect(reopened.get(second.accountId)).toBeDefined();
  });

  it("never projects secrets into AccountView across reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-accounts-"));
    roots.push(root);
    const store = new AccountStore(root);
    const account = store.add({
      provider: "grok",
      label: "secret-holder",
      providerAccountId: "user@example.com",
    });
    const projected = store.projectCredential({
      accountId: account.accountId,
      provider: "grok",
      authJson: '{"access_token":"super-secret","refresh_token":"also-secret"}',
    });
    const serialized = JSON.stringify({
      view: store.get(account.accountId),
      projectedPath: projected,
    });
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("also-secret");

    const reopened = new AccountStore(root);
    expect(JSON.stringify(reopened.get(account.accountId))).not.toContain("super-secret");
    expect(reopened.get(account.accountId)).not.toHaveProperty("credentialRoot");
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
