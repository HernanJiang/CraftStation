import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "./accountStore";
import {
  KimiProfileService,
  kimiCredentialIdentities,
  managedKimiProcessEnvironment,
} from "./kimiProfiles";

function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeCredential(root: string, value: unknown): string {
  const directory = join(root, "credentials");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "kimi-code.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return path;
}

describe("Kimi managed profile runtime", () => {
  it("extracts provider identity and isolates routing environment", () => {
    expect(
      kimiCredentialIdentities({ access_token: "SECRET", user: { email: "a@kimi.test" } }),
    ).toEqual(["a@kimi.test"]);
    const env = managedKimiProcessEnvironment("C:\\managed\\kimi", {
      KIMI_CODE_HOME: "C:\\global",
      KIMI_CODE_API_KEY: "SENTINEL_API_KEY",
      CLIPROXY_HOME: "SENTINEL_PROXY",
      PATH: "C:\\bin",
    });
    expect(env.KIMI_CODE_HOME).toBe("C:\\managed\\kimi");
    expect(env.KIMI_CODE_API_KEY).toBe("");
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.PATH).toBe("C:\\bin");
  });

  it("copies a valid global credential into an account-owned root", () => {
    const root = tempRoot("craftstation-kimi-service-");
    const globalRoot = tempRoot("craftstation-kimi-global-");
    writeCredential(globalRoot, {
      access_token: "SECRET_TOKEN",
      account: { email: "a@kimi.test" },
    });
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });

    const account = service.importCredential({ label: "Kimi A", profileRoot: globalRoot });
    expect(account.status).toBe("available");
    expect(account.providerAccountId).toBe("a@kimi.test");
    const managedPath = join(
      service.managedKimiHome(account.accountId),
      "credentials",
      "kimi-code.json",
    );
    expect(readFileSync(managedPath, "utf8")).toContain("SECRET_TOKEN");
    expect(existsSync(join(globalRoot, "credentials", "kimi-code.json"))).toBe(true);
    expect(account).not.toHaveProperty("credentialRoot");
  });

  it.each([
    ["missing", undefined, "ACCOUNT_PROJECTION_FAILED"],
    ["malformed", "not-json", "ACCOUNT_PROJECTION_FAILED"],
    ["identity absent", { access_token: "SECRET_TOKEN" }, "ACCOUNT_IDENTITY_UNAVAILABLE"],
  ])("fails closed for %s credentials", (_name, content, code) => {
    const root = tempRoot("craftstation-kimi-invalid-");
    const source = tempRoot("craftstation-kimi-source-");
    if (content !== undefined) writeCredential(source, content);
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    expect(() => service.importCredential({ label: "Invalid", profileRoot: source })).toThrow(
      expect.objectContaining({ code }),
    );
    expect(store.list()).toEqual([]);
  });

  it("rejects a re-login that changes the selected account identity", () => {
    const root = tempRoot("craftstation-kimi-mismatch-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = store.add({
      provider: "kimi",
      label: "Kimi A",
      providerAccountId: "a@kimi.test",
      maskedIdentity: "a@kimi.test",
    });
    writeCredential(service.managedKimiHome(account.accountId), {
      account: { email: "b@kimi.test" },
    });
    expect(() => service.completeLogin(account.accountId)).toThrow(
      expect.objectContaining({ code: "PROFILE_IDENTITY_MISMATCH" }),
    );
  });

  it("promotes a metadata-only row only after identity is present", () => {
    const root = tempRoot("craftstation-kimi-promote-");
    const store = new AccountStore(root);
    const service = new KimiProfileService({ store });
    const account = service.createEmpty("Kimi New");
    expect(account.status).toBe("unavailable");
    expect(() => service.completeLogin(account.accountId)).toThrow(
      expect.objectContaining({ code: "ACCOUNT_IDENTITY_UNAVAILABLE" }),
    );
    expect(store.list()).toHaveLength(1);
    writeCredential(service.managedKimiHome(account.accountId), {
      userId: "kimi-user-1",
      access_token: "SECRET",
    });
    expect(service.completeLogin(account.accountId)).toMatchObject({
      status: "available",
      providerAccountId: "kimi-user-1",
    });
  });
});
