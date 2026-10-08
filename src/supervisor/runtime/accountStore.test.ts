import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountControlError, type AccountQuotaWindow } from "@/shared/contracts";
import { AccountResolver } from "./accountResolver";
import { CodexProfileService } from "./codexProfiles";
import { KimiProfileService } from "./kimiProfiles";
import {
  AccountStore,
  effectiveQuotaStatus,
  liveQuotaWindows,
  maskIdentity,
  mergeQuotaWindows,
  QUOTA_INFERENCE_MARK_TTL_MS,
  shouldPreserveInferenceExhaustion,
} from "./accountStore";

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
    rmSync(`${metadata}.last-good`, { force: true });
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

  it("recovers all accounts and pool settings when primary and previous backup are zero-filled", () => {
    const store = createStore();
    const first = store.add({ provider: "codex", label: "Personal" });
    const second = store.add({ provider: "kimi", label: "Work" });
    store.setPoolSchedulingMode("codex", "round-robin");
    store.advanceRoundRobinCursor("codex", first.accountId);
    const metadata = join(store.managedRoot, "accounts.json");
    const expected = readFileSync(metadata, "utf8");
    writeFileSync(metadata, Buffer.alloc(21057));
    writeFileSync(`${metadata}.bak`, Buffer.alloc(21057));

    const reopened = new AccountStore(store.managedRoot);
    expect(reopened.list().map((a) => a.accountId)).toEqual([first.accountId, second.accountId]);
    expect(reopened.poolConfig("codex")).toEqual({
      scheduling: "round-robin",
      roundRobinCursor: first.accountId,
    });
    expect(JSON.parse(readFileSync(metadata, "utf8"))).toEqual(JSON.parse(expected));
  });

  it("restores a missing primary from the last good snapshot instead of returning an empty pool", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Personal" });
    rmSync(join(store.managedRoot, "accounts.json"));
    const reopened = new AccountStore(store.managedRoot);
    expect(reopened.get(account.accountId)?.label).toBe("Personal");
  });

  it("keeps corruption scoped to account operations and never replaces lost accounts with defaults", () => {
    const store = createStore();
    store.add({ provider: "codex", label: "Personal" });
    const metadata = join(store.managedRoot, "accounts.json");
    for (const suffix of ["", ".bak", ".last-good"])
      writeFileSync(`${metadata}${suffix}`, "broken");
    let reopened!: AccountStore;
    expect(() => {
      reopened = new AccountStore(store.managedRoot);
    }).not.toThrow();
    expect(() => reopened.list()).toThrow(/ACCOUNT_CORRUPT|metadata is corrupt/);
    expect(() => reopened.add({ provider: "kimi", label: "new" })).toThrow(AccountControlError);
    expect(readFileSync(metadata, "utf8")).toBe("broken");
    // An external repair becomes visible without restarting the supervisor.
    writeFileSync(metadata, JSON.stringify({ version: 2, accounts: [], pools: {} }));
    expect(reopened.list()).toEqual([]);
  });

  it("allows actual profile services to start with unrecoverable metadata", () => {
    const store = createStore();
    store.add({ provider: "codex", label: "Personal" });
    const metadata = join(store.managedRoot, "accounts.json");
    for (const suffix of ["", ".bak", ".last-good"])
      writeFileSync(`${metadata}${suffix}`, Buffer.alloc(21057));
    const reopened = new AccountStore(store.managedRoot);
    expect(() => new CodexProfileService({ store: reopened })).not.toThrow();
    expect(() => new KimiProfileService({ store: reopened })).not.toThrow();
    expect(() => reopened.list()).toThrow(AccountControlError);
  });

  it("seeds redundancy on upgrade and does not let a contended startup lock kill the runtime", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Personal" });
    const metadata = join(store.managedRoot, "accounts.json");
    rmSync(`${metadata}.last-good`, { force: true });
    const reopened = new AccountStore(store.managedRoot);
    expect(reopened.get(account.accountId)).toBeDefined();
    expect(JSON.parse(readFileSync(`${metadata}.last-good`, "utf8")).accounts[0].accountId).toBe(
      account.accountId,
    );
    writeFileSync(join(store.managedRoot, "accounts.lock"), "other process");
    expect(() => new AccountStore(store.managedRoot)).not.toThrow();
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

  it("keeps the inference mark's lastError across degraded-state refreshes", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "codex one" });
    const markTime = Date.now();

    // The quota-inference write-back marks the dead account…
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "You've hit your usage limit.",
      lastQuotaAt: markTime,
    });
    // …then the quota poller re-marks the same degraded state without
    // lastError. The evidence must survive: `shouldPreserveInferenceExhaustion`
    // discriminates inference marks from window-derived rows by lastError, so
    // wiping it lets the next healthy-looking probe flip the dead account
    // back to `available` and re-elect it into the failover chain.
    store.updateStatus(account.accountId, "quota-exhausted", { lastQuotaAt: markTime + 1 });
    expect(store.get(account.accountId)).toMatchObject({
      status: "quota-exhausted",
      lastError: "You've hit your usage limit.",
      lastQuotaAt: markTime + 1,
    });
    // A healthy transition still clears it.
    store.updateStatus(account.accountId, "available");
    expect(store.get(account.accountId)).not.toHaveProperty("lastError");
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

  describe("sibling-store credential root repair (dev vs prod copy)", () => {
    function seedSiblingCopy(): {
      prodRoot: string;
      devRoot: string;
      accountId: string;
      profileDir: string;
    } {
      const prodRoot = mkdtempSync(join(tmpdir(), "craftstation-accounts-prod-"));
      const devRoot = mkdtempSync(join(tmpdir(), "craftstation-accounts-dev-"));
      roots.push(prodRoot, devRoot);
      const prod = new AccountStore(prodRoot);
      const account = prod.add({
        provider: "grok",
        label: "Grok 1",
        providerAccountId: "user@example.com",
      });
      const prodProfile = prod.credentialRoot(account.accountId);
      writeFileSync(join(prodProfile, "auth.json"), '{"access_token":"prod-token"}', "utf8");
      // Simulate a copied accounts.json that still points at the sibling root.
      writeFileSync(
        join(devRoot, "accounts.json"),
        readFileSync(join(prodRoot, "accounts.json"), "utf8"),
        "utf8",
      );
      return {
        prodRoot,
        devRoot,
        accountId: account.accountId,
        profileDir: prodProfile.slice(prodRoot.length + 1),
      };
    }

    it("rebases an escaped credential root when the profile directory exists in this root", () => {
      const { devRoot, accountId, profileDir } = seedSiblingCopy();
      mkdirSync(join(devRoot, profileDir), { recursive: true });
      writeFileSync(join(devRoot, profileDir, "auth.json"), '{"access_token":"dev-token"}', "utf8");

      const dev = new AccountStore(devRoot);
      const resolved = dev.credentialRoot(accountId);
      expect(resolved).toBe(join(devRoot, profileDir));
      expect(readFileSync(join(resolved, "auth.json"), "utf8")).toContain("dev-token");
      // The repair is persisted so the next session creation no longer fails.
      const persisted = JSON.parse(readFileSync(join(devRoot, "accounts.json"), "utf8")) as {
        accounts: Array<{ accountId: string; credentialRoot: string }>;
      };
      expect(
        persisted.accounts.find((entry) => entry.accountId === accountId)?.credentialRoot,
      ).toBe(join(devRoot, profileDir));
    });

    it("fails closed with account context when no matching profile directory exists", () => {
      const { devRoot, accountId } = seedSiblingCopy();
      const dev = new AccountStore(devRoot);
      let thrown: unknown;
      try {
        dev.credentialRoot(accountId);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AccountControlError);
      expect((thrown as AccountControlError).code).toBe("ACCOUNT_PATH_INVALID");
      expect((thrown as AccountControlError).details).toMatchObject({ accountId });
    });

    it("remove() deletes the rebased directory and never touches the outside path", () => {
      const { prodRoot, devRoot, accountId, profileDir } = seedSiblingCopy();
      mkdirSync(join(devRoot, profileDir), { recursive: true });
      writeFileSync(join(devRoot, profileDir, "auth.json"), '{"access_token":"dev-token"}', "utf8");
      const sentinel = join(prodRoot, profileDir, "sentinel.txt");
      writeFileSync(sentinel, "prod-data", "utf8");

      const dev = new AccountStore(devRoot);
      dev.remove(accountId);

      expect(dev.list("grok")).toEqual([]);
      expect(existsSync(join(devRoot, profileDir))).toBe(false);
      expect(readFileSync(sentinel, "utf8")).toBe("prod-data");
    });
  });

  describe("shouldPreserveInferenceExhaustion", () => {
    const mark = (overrides: object = {}) => ({
      status: "quota-exhausted" as const,
      lastError: "Grok 额度已耗尽",
      lastQuotaAt: 1_000_000,
      ...overrides,
    });

    it("preserves a fresh inference mark against healthy quota evidence", () => {
      expect(shouldPreserveInferenceExhaustion(mark(), 1_000_000 + 60_000)).toBe(true);
    });

    it("releases the mark after the TTL so rows recover", () => {
      expect(
        shouldPreserveInferenceExhaustion(mark(), 1_000_000 + QUOTA_INFERENCE_MARK_TTL_MS),
      ).toBe(false);
      expect(
        shouldPreserveInferenceExhaustion(mark(), 1_000_000 + QUOTA_INFERENCE_MARK_TTL_MS + 1),
      ).toBe(false);
    });

    it("ignores rows without an inference mark", () => {
      // Window-derived exhaustion carries no lastError: the poller owns it.
      expect(
        shouldPreserveInferenceExhaustion(
          { status: "quota-exhausted", lastQuotaAt: 1_000_000 },
          1_000_001,
        ),
      ).toBe(false);
      expect(shouldPreserveInferenceExhaustion(undefined, 1_000_001)).toBe(false);
      expect(
        shouldPreserveInferenceExhaustion(
          { status: "available", lastError: "stale", lastQuotaAt: 1_000_000 },
          1_000_001,
        ),
      ).toBe(false);
    });

    it("ignores marks with an unusable timestamp", () => {
      expect(
        shouldPreserveInferenceExhaustion(
          { status: "quota-exhausted", lastError: "x", lastQuotaAt: Number.NaN },
          1_000_001,
        ),
      ).toBe(false);
    });
  });
});

describe("dual-axis quota", () => {
  const HOUR = 3_600_000;

  function axisWindow(
    id: "session-5h" | "weekly",
    resetsAt: number,
    usedPercent = 100,
  ): AccountQuotaWindow {
    return {
      id,
      label: id === "weekly" ? "Weekly" : "Session (5h)",
      usedPercent,
      resetsAt,
      inferred: true,
    };
  }

  it("marks one axis exhausted without touching the other", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Plus" });
    store.updateStatus(account.accountId, "available");
    const recoversAt = Date.now() + 2 * HOUR;
    store.markQuotaAxisBlocked(account.accountId, {
      axisId: "session-5h",
      recoversAt,
      lastError: "You've hit your usage limit",
    });
    const record = store.getRecord(account.accountId)!;
    expect(record.status).toBe("quota-exhausted");
    const window = record.quotaWindows?.find((w) => w.id === "session-5h");
    expect(window?.inferred).toBe(true);
    expect(window?.usedPercent).toBe(100);
    expect(window?.resetsAt).toBe(recoversAt);
  });

  it("skips a 5h-blocked account at resolve time and re-elects it after reset", () => {
    const store = createStore();
    const plus = store.add({ provider: "codex", label: "Plus" });
    const pro = store.add({ provider: "codex", label: "Pro" });
    store.updateStatus(plus.accountId, "available");
    store.updateStatus(pro.accountId, "available");
    const resolver = new AccountResolver(store);

    store.markQuotaAxisBlocked(plus.accountId, {
      axisId: "session-5h",
      recoversAt: Date.now() + 2 * HOUR,
      lastError: "usage limit",
    });
    const first = resolver.resolve({ provider: "codex", mode: "auto" });
    expect(first.account.accountId).toBe(pro.accountId);
    expect(first.candidates.find((c) => c.accountId === plus.accountId)?.reason).toContain(
      "session-5h",
    );

    // The window resets: overwrite the mark with an expired inferred window
    // (what reconcile sees after the timestamp passes) and re-resolve.
    store.updateQuota(plus.accountId, [axisWindow("session-5h", Date.now() - 1)]);
    const second = resolver.resolve({ provider: "codex", mode: "auto" });
    expect(second.account.accountId).toBe(plus.accountId);
  });

  it("keeps a weekly block after the 5h window resets", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Codex" });
    const now = Date.now();
    store.updateQuota(account.accountId, [
      axisWindow("session-5h", now - 60_000),
      axisWindow("weekly", now + 3 * 24 * HOUR),
    ]);
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "weekly exhausted",
      lastQuotaAt: now - 60_000,
    });
    const healed = store.reconcileQuotaExpiry("codex");
    const record = store.getRecord(account.accountId)!;
    // 5h evidence dropped (windows changed → swept), weekly still blocks.
    expect(record.quotaWindows?.some((w) => w.id === "session-5h")).toBe(false);
    expect(record.status).toBe("quota-exhausted");
    expect(healed).toContain(account.accountId);
  });

  it("recovers a 5h-expired account even with a fresh legacy-style mark", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Codex" });
    const now = Date.now();
    store.updateQuota(account.accountId, [
      axisWindow("session-5h", now - 1),
      { id: "weekly", label: "Weekly", usedPercent: 42, resetsAt: now + 7 * 24 * HOUR },
    ]);
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "usage limit",
      lastQuotaAt: now,
    });
    const healed = store.reconcileQuotaExpiry("codex");
    expect(healed).toContain(account.accountId);
    const record = store.getRecord(account.accountId)!;
    expect(record.status).toBe("available");
    expect(record.lastError).toBeUndefined();
  });

  it("mergeQuotaWindows keeps a live inferred block when the poll omits the axis", () => {
    const now = Date.now();
    const merged = mergeQuotaWindows(
      [{ id: "weekly", label: "Weekly", usedPercent: 10, resetsAt: now + 5 * 24 * HOUR }],
      [axisWindow("session-5h", now + 2 * HOUR)],
      now,
    );
    expect(merged.find((w) => w.id === "session-5h")?.inferred).toBe(true);
    expect(merged.find((w) => w.id === "weekly")?.usedPercent).toBe(10);
  });

  it("mergeQuotaWindows: a same-window lagged reading cannot disprove a live mark", () => {
    const now = Date.now();
    const resetsAt = now + 2 * HOUR;
    const merged = mergeQuotaWindows(
      [{ id: "session-5h", label: "Session (5h)", usedPercent: 30, resetsAt }],
      [axisWindow("session-5h", resetsAt)],
      now,
    );
    const window = merged.find((w) => w.id === "session-5h");
    expect(window?.inferred).toBe(true);
    expect(window?.usedPercent).toBe(100);
  });

  it("mergeQuotaWindows: a different resetsAt proves a new period and supersedes", () => {
    const now = Date.now();
    const merged = mergeQuotaWindows(
      [{ id: "weekly", label: "Weekly", usedPercent: 8, resetsAt: now + 9 * 24 * HOUR }],
      [axisWindow("weekly", now + 2 * 24 * HOUR)],
      now,
    );
    const window = merged.find((w) => w.id === "weekly");
    expect(window?.inferred).toBeUndefined();
    expect(window?.usedPercent).toBe(8);
  });

  it("mergeQuotaWindows: a fresh >=100% observation supersedes the inferred mark", () => {
    const now = Date.now();
    const realReset = now + 4 * HOUR;
    const merged = mergeQuotaWindows(
      [{ id: "session-5h", label: "Session (5h)", usedPercent: 100, resetsAt: realReset }],
      [axisWindow("session-5h", now + 5 * HOUR)],
      now,
    );
    const window = merged.find((w) => w.id === "session-5h");
    expect(window?.inferred).toBeUndefined();
    expect(window?.resetsAt).toBe(realReset);
  });

  it("applyObservedQuotaWindows updates the pushed axis without clearing the other", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Codex" });
    const now = Date.now();
    store.updateQuota(account.accountId, [axisWindow("session-5h", now + 2 * HOUR)]);
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "5h exhausted",
      lastQuotaAt: now,
    });
    // Push carries only the healthy weekly axis: the 5h mark survives and the
    // row stays exhausted.
    store.applyObservedQuotaWindows(account.accountId, [
      { id: "weekly", label: "Weekly", usedPercent: 15, resetsAt: now + 6 * 24 * HOUR },
    ]);
    const record = store.getRecord(account.accountId)!;
    expect(record.status).toBe("quota-exhausted");
    expect(record.quotaWindows?.some((w) => w.id === "session-5h")).toBe(true);
    expect(record.quotaWindows?.find((w) => w.id === "weekly")?.usedPercent).toBe(15);
  });

  it("markQuotaAxisBlocked records axis provenance for recovery", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Plus" });
    const recoversAt = Date.now() + 2 * HOUR;
    store.markQuotaAxisBlocked(account.accountId, {
      axisId: "session-5h",
      recoversAt,
      lastError: "usage limit",
    });
    const record = store.getRecord(account.accountId)!;
    expect(record.lastQuotaAxis).toBe("session-5h");
    expect(record.lastQuotaResetsAt).toBe(recoversAt);
  });

  it("a pushed window that supersedes the last inferred block clears the spent mark", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Plus" });
    store.updateStatus(account.accountId, "available");
    const now = Date.now();
    store.markQuotaAxisBlocked(account.accountId, {
      axisId: "session-5h",
      recoversAt: now + 2 * HOUR,
      lastError: "usage limit",
    });
    // A rateLimits push reports the 5h lane rolled into a new period at 0%:
    // merge supersedes the inferred block, and the mark must die with it
    // instead of stretching the row out to the flat 6h TTL.
    store.applyObservedQuotaWindows(account.accountId, [
      { id: "session-5h", label: "Session (5h)", usedPercent: 0, resetsAt: now + 7 * HOUR },
      { id: "weekly", label: "Weekly", usedPercent: 68, resetsAt: now + 5 * 24 * HOUR },
    ]);
    const record = store.getRecord(account.accountId)!;
    expect(record.status).toBe("available");
    expect(record.lastError).toBeUndefined();
  });

  it("releases a legacy session mark once the marked axis shows a rolled-over window", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Plus" });
    const now = Date.now();
    // Legacy shape (pre-provenance rows): mark evidence but no axis fields.
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError: "You've hit your usage limit. Upgrade to Pro",
      lastQuotaAt: now - 4 * HOUR,
    });
    store.updateQuota(account.accountId, [
      { id: "session-5h", label: "Session (5h)", usedPercent: 0, resetsAt: now + 3 * HOUR },
      { id: "weekly", label: "Weekly", usedPercent: 68, resetsAt: now + 5 * 24 * HOUR },
    ]);
    const healed = store.reconcileQuotaExpiry("codex");
    expect(healed).toContain(account.accountId);
    expect(store.getRecord(account.accountId)!.status).toBe("available");
  });

  it("releases a legacy weekly mark when the weekly lane dropped below saturation (reset card)", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Pro" });
    const now = Date.now();
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
      lastQuotaAt: now - 2 * HOUR,
    });
    store.updateQuota(account.accountId, [
      { id: "weekly", label: "Weekly", usedPercent: 0, resetsAt: now + 5 * 24 * HOUR },
      { id: "codex:reset-credits", label: "重置卡", usedPercent: 0, unit: "credits" },
    ]);
    const healed = store.reconcileQuotaExpiry("codex");
    expect(healed).toContain(account.accountId);
    expect(store.getRecord(account.accountId)!.status).toBe("available");
  });

  it("keeps a fresh weekly mark while the weekly lane still reads saturated", () => {
    // A lagged same-period reading ≥95% corroborates the live block and must
    // not release the row just because the inferred window is gone.
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Pro" });
    const now = Date.now();
    store.updateStatus(account.accountId, "quota-exhausted", {
      lastError:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
      lastQuotaAt: now - 2 * HOUR,
    });
    store.updateQuota(account.accountId, [
      { id: "weekly", label: "Weekly", usedPercent: 99, resetsAt: now + 5 * 24 * HOUR },
    ]);
    store.reconcileQuotaExpiry("codex");
    expect(store.getRecord(account.accountId)!.status).toBe("quota-exhausted");
  });

  it("flat marks without axis provenance keep TTL semantics against sub-95 windows", () => {
    const now = Date.now();
    expect(
      effectiveQuotaStatus(
        {
          provider: "grok",
          status: "quota-exhausted",
          quotaWindows: [
            { id: "weekly", label: "Weekly", usedPercent: 10, resetsAt: now + 5 * 24 * HOUR },
          ],
          lastError: "usage balance exhausted",
          lastQuotaAt: now,
        },
        now,
      ),
    ).toBe("quota-exhausted");
  });

  it("resolve re-elects a recovered account whose mark a push superseded", () => {
    const store = createStore();
    const plus = store.add({ provider: "codex", label: "Plus" });
    const pro = store.add({ provider: "codex", label: "Pro" });
    store.updateStatus(plus.accountId, "available");
    store.updateStatus(pro.accountId, "available");
    const resolver = new AccountResolver(store);
    const now = Date.now();
    store.markQuotaAxisBlocked(plus.accountId, {
      axisId: "session-5h",
      recoversAt: now + 2 * HOUR,
      lastError: "usage limit",
    });
    store.applyObservedQuotaWindows(plus.accountId, [
      { id: "session-5h", label: "Session (5h)", usedPercent: 0, resetsAt: now + 7 * HOUR },
      { id: "weekly", label: "Weekly", usedPercent: 68, resetsAt: now + 5 * 24 * HOUR },
    ]);
    const pick = resolver.resolve({ provider: "codex", mode: "auto" });
    expect(pick.account.accountId).toBe(plus.accountId);
  });

  it("applyObservedQuotaWindows never resurrects auth-expired rows", () => {
    const store = createStore();
    const account = store.add({ provider: "codex", label: "Codex" });
    store.updateStatus(account.accountId, "auth-expired", { lastError: "401" });
    store.applyObservedQuotaWindows(account.accountId, [
      { id: "session-5h", label: "Session (5h)", usedPercent: 10 },
    ]);
    expect(store.getRecord(account.accountId)!.status).toBe("auth-expired");
  });

  it("effectiveQuotaStatus recovers expired windows and honors legacy marks", () => {
    const now = Date.now();
    // Expired 100% window drops from the live set.
    const expired = liveQuotaWindows(
      [{ id: "session-5h", label: "Session (5h)", usedPercent: 100, resetsAt: now - 1 }],
      now,
    );
    expect(expired).toEqual([]);
    // Legacy shape (no windows, fresh mark) stays exhausted until the TTL.
    expect(
      effectiveQuotaStatus(
        {
          provider: "grok",
          status: "quota-exhausted",
          quotaWindows: [],
          lastError: "usage balance exhausted",
          lastQuotaAt: now,
        },
        now,
      ),
    ).toBe("quota-exhausted");
  });
});
