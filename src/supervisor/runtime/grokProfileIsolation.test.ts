import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "./accountStore";
import { prepareGrokProfile, verifyProfileIdentity } from "./nativeProfile";
import { managedGrokProcessEnvironment, buildGrokLoginScript } from "./grokProfiles";
import { AccountControlError } from "@/shared/contracts";

function createTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "craftstation-grok-isolation-"));
}

describe("Grok Multi-Account Profile & Leader Isolation (T04/T05)", () => {
  it("isolates GROK_HOME and GROK_LEADER_SOCKET for two distinct accounts A and B", () => {
    const root = createTmpRoot();
    const store = new AccountStore(root);

    const accountA = store.add({
      provider: "grok",
      label: "Account A",
      maskedIdentity: "user-a@xai.com",
      providerAccountId: "user-a@xai.com",
    });

    const accountB = store.add({
      provider: "grok",
      label: "Account B",
      maskedIdentity: "user-b@xai.com",
      providerAccountId: "user-b@xai.com",
    });

    const rootA = store.credentialRoot(accountA.accountId);
    const rootB = store.credentialRoot(accountB.accountId);

    const specA = prepareGrokProfile({
      accountId: accountA.accountId,
      credentialRoot: rootA,
      credentialScopeRef: accountA.credentialScopeRef,
    });

    const specB = prepareGrokProfile({
      accountId: accountB.accountId,
      credentialRoot: rootB,
      credentialScopeRef: accountB.credentialScopeRef,
    });

    // 1. Distinct homes
    expect(specA.profilePath).not.toBe(specB.profilePath);
    expect(specA.env.GROK_HOME).toBe(rootA);
    expect(specB.env.GROK_HOME).toBe(rootB);

    // 2. Distinct Leader sockets (crucial for switch-acc-ai Leader isolation)
    expect(specA.env.GROK_LEADER_SOCKET).toBe(join(rootA, "leader.sock"));
    expect(specB.env.GROK_LEADER_SOCKET).toBe(join(rootB, "leader.sock"));
    expect(specA.env.GROK_LEADER_SOCKET).not.toBe(specB.env.GROK_LEADER_SOCKET);

    expect(specA.runtimeIsolation?.socketPath).toBe(join(rootA, "leader.sock"));
    expect(specB.runtimeIsolation?.socketPath).toBe(join(rootB, "leader.sock"));
  });

  it("ensures login script injects the account-specific GROK_LEADER_SOCKET", () => {
    const scriptWin = buildGrokLoginScript("windows", "lc_test_token");
    expect(scriptWin).toContain("$env:GROK_LEADER_SOCKET");
    expect(scriptWin).toContain("leader.sock");

    const scriptPosix = buildGrokLoginScript("posix", "lc_test_token");
    expect(scriptPosix).toContain("GROK_LEADER_SOCKET");
    expect(scriptPosix).toContain("leader.sock");
  });

  it("fails closed with PROFILE_IDENTITY_MISMATCH when profile contains wrong account credentials", () => {
    const root = createTmpRoot();
    const store = new AccountStore(root);

    const accountA = store.add({
      provider: "grok",
      label: "Account A",
      maskedIdentity: "user-a@xai.com",
      providerAccountId: "user-a@xai.com",
    });

    const rootA = store.credentialRoot(accountA.accountId);

    // Simulate account A profile accidentally having account B tokens
    writeFileSync(
      join(rootA, "auth.json"),
      JSON.stringify({ access_token: "fixture-token", user: { email: "user-b@xai.com" } }),
      "utf8",
    );

    expect(() => {
      verifyProfileIdentity("grok", rootA, accountA);
    }).toThrow(AccountControlError);

    expect(() => {
      verifyProfileIdentity("grok", rootA, accountA);
    }).toThrow(expect.objectContaining({ code: "PROFILE_IDENTITY_MISMATCH" }));
  });

  it("concurrent Leader processes do not collide or share sockets across accounts", () => {
    const root = createTmpRoot();
    const store = new AccountStore(root);

    const account1 = store.add({ provider: "grok", label: "Grok 1" });
    const account2 = store.add({ provider: "grok", label: "Grok 2" });

    const root1 = store.credentialRoot(account1.accountId);
    const root2 = store.credentialRoot(account2.accountId);

    const env1 = managedGrokProcessEnvironment(root1);
    const env2 = managedGrokProcessEnvironment(root2);

    expect(env1.GROK_LEADER_SOCKET).toBe(join(root1, "leader.sock"));
    expect(env2.GROK_LEADER_SOCKET).toBe(join(root2, "leader.sock"));
    expect(env1.GROK_LEADER_SOCKET).not.toBe(env2.GROK_LEADER_SOCKET);
  });
});
