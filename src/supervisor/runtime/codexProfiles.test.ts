import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AccountStore } from "./accountStore";
import {
  CodexProfileService,
  buildCodexLoginScript,
  ensureManagedCodexHome,
  managedCodexProcessEnvironment,
} from "./codexProfiles";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("CodexProfileService", () => {
  it("imports auth metadata into a managed profile without exposing the token", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-profiles-"));
    roots.push(root);
    const source = join(root, "source");
    const managed = join(root, "managed");
    const sourceHome = join(source, ".codex");
    const store = new AccountStore(managed);
    const service = new CodexProfileService({ store });
    const authJson = JSON.stringify({ tokens: { access_token: "secret", account_id: "acct-1" } });
    require("node:fs").mkdirSync(sourceHome, { recursive: true });
    writeFileSync(join(sourceHome, "auth.json"), authJson);
    const view = service.importAuthJson({ label: "Work", profileRoot: sourceHome });
    expect(view.status).toBe("available");
    expect(view.providerAccountId).toBe("acct-1");
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(service.managedCodexHome(view.accountId).startsWith(managed)).toBe(true);
    const isolated = require("node:fs").readFileSync(
      join(service.managedCodexHome(view.accountId), "config.toml"),
      "utf8",
    );
    expect(isolated).toContain('model_provider = "openai"');
    expect(isolated).not.toContain("model_catalog_json");
  });
  it("does not create an account for an access token with no stable identity", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-profiles-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const managed = join(root, "managed");
    mkdirSync(sourceHome, { recursive: true });
    writeFileSync(
      join(sourceHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "secret" } }),
      "utf8",
    );
    const store = new AccountStore(managed);
    const service = new CodexProfileService({ store });

    expect(() => service.importAuthJson({ label: "Unknown", profileRoot: sourceHome })).toThrow(
      /no account identity/i,
    );
    expect(store.list("codex")).toEqual([]);
  });

  it("imports an email identity decoded from the id token", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-profiles-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    mkdirSync(sourceHome, { recursive: true });
    const payload = Buffer.from(JSON.stringify({ email: "person@example.com" })).toString(
      "base64url",
    );
    writeFileSync(
      join(sourceHome, "auth.json"),
      JSON.stringify({
        tokens: { access_token: "secret", id_token: `header.${payload}.signature` },
      }),
      "utf8",
    );
    const store = new AccountStore(join(root, "managed"));
    const view = new CodexProfileService({ store }).importAuthJson({
      label: "Email",
      profileRoot: sourceHome,
    });

    expect(view.providerAccountId).toBe("person@example.com");
    expect(view.maskedIdentity).toBe("per***son@example.com");
    expect(store.list("codex")).toHaveLength(1);
  });

  it("reuses an existing account when importing the same identity with different casing", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-profiles-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const managed = join(root, "managed");
    mkdirSync(sourceHome, { recursive: true });
    const store = new AccountStore(managed);
    const service = new CodexProfileService({ store });
    writeFileSync(
      join(sourceHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "secret", account_id: "Acct-1" } }),
      "utf8",
    );

    const first = service.importAuthJson({ label: "First", profileRoot: sourceHome });
    const second = service.importAuthJson({ label: "Renamed", profileRoot: sourceHome });

    expect(second.accountId).toBe(first.accountId);
    expect(second.label).toBe("First");
    expect(store.list("codex")).toHaveLength(1);
  });

  it("retains an existing account if a reused import fails projection", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-profiles-"));
    roots.push(root);
    const sourceHome = join(root, "source");
    const managed = join(root, "managed");
    mkdirSync(sourceHome, { recursive: true });
    const store = new AccountStore(managed);
    const service = new CodexProfileService({ store });
    writeFileSync(
      join(sourceHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "secret", account_id: "Acct-1" } }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Existing", profileRoot: sourceHome });
    const originalProject = store.projectCredential.bind(store);
    store.projectCredential = (() => {
      throw new Error("projection failed");
    }) as typeof store.projectCredential;

    writeFileSync(
      join(sourceHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "secret-2", account_id: "acct-1" } }),
      "utf8",
    );
    expect(() => service.importAuthJson({ label: "Retry", profileRoot: sourceHome })).toThrow(
      /projection failed/i,
    );
    expect(store.get(account.accountId)).toMatchObject({ providerAccountId: "acct-1" });
    expect(store.list("codex")).toHaveLength(1);
    store.projectCredential = originalProject;
  });

  it("builds PowerShell and POSIX login scripts without embedding managed CODEX_HOME", () => {
    const token = "lc_test_completion";

    const winScript = buildCodexLoginScript("windows", token);
    expect(winScript).toContain("CraftStation CODEX_HOME=");
    expect(winScript).toContain("CraftStation CODEX_HOME=");
    expect(winScript).toContain(
      "codex -c model_provider=openai -c sandbox_mode=danger-full-access login",
    );
    expect(winScript).toContain(`craftstation-login-complete=${token}`);

    const posixScript = buildCodexLoginScript("posix", token);
    expect(posixScript).toContain("CraftStation login cwd=");
    expect(posixScript).toContain("CraftStation CODEX_HOME=");
    expect(posixScript).toContain(
      "codex -c model_provider=openai -c sandbox_mode=danger-full-access login",
    );
    expect(posixScript).toContain(`craftstation-login-complete=${token}`);
  });
});

describe("managedCodexProcessEnvironment", () => {
  it("strips Codex-Router overlay variables and pins CODEX_HOME", () => {
    const env = managedCodexProcessEnvironment("D:\\managed\\codex-home", {
      PATH: "C:\\Windows",
      CODEX_HOME: "C:\\Users\\Haona\\.codex",
      CODEX_MODEL_CATALOG_PATH:
        "C:\\Users\\Haona\\AppData\\Local\\Codex-Router\\UserData\\model-catalog.json",
      CODEX_ROUTER_USER_DATA: "C:\\Users\\Haona\\AppData\\Local\\Codex-Router\\UserData",
      USERNAME: "Haona",
    });
    expect(env.CODEX_HOME).toBe("D:\\managed\\codex-home");
    expect(env.PATH).toBe("C:\\Windows");
    expect(env.USERNAME).toBe("Haona");
    expect(env.CODEX_MODEL_CATALOG_PATH).toBe("");
    expect(env.CODEX_ROUTER_USER_DATA).toBe("");
  });

  it("writes an isolated config.toml that does not reference Codex-Router catalogs", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-codex-home-"));
    roots.push(root);
    const home = join(root, "profile");
    ensureManagedCodexHome(home);
    const config = require("node:fs").readFileSync(join(home, "config.toml"), "utf8");
    expect(config).toContain('model_provider = "openai"');
    expect(config).toContain('sandbox_mode = "danger-full-access"');
    expect(config).not.toContain("model_catalog_json");
    expect(config).not.toMatch(/model_catalog_json\s*=/);
  });
});
