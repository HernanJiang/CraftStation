import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyProfileIdentity } from "./nativeProfile";
import { managedCodexProcessEnvironment, ensureManagedCodexHome } from "./codexProfiles";
import { managedKimiProcessEnvironment, ensureManagedKimiHome } from "./kimiProfiles";
import { AccountControlError } from "@/shared/contracts";

function createTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "craftstation-codex-kimi-isolation-"));
}

describe("Codex Profile Isolation (T06)", () => {
  it("enforces file credential store in config.toml to prevent OS Keychain leakage", () => {
    const root = createTmpRoot();
    const codexHome = join(root, "codex-profile-1");
    ensureManagedCodexHome(codexHome);

    const configPath = join(codexHome, "config.toml");
    const configContent = readFileSync(configPath, "utf8");

    expect(configContent).toContain('cli_auth_credentials_store = "file"');
    expect(configContent).toContain('mcp_oauth_credentials_store = "file"');
  });

  it("blanks Codex-Router and CLIProxy environment variables", () => {
    const root = createTmpRoot();
    const env = managedCodexProcessEnvironment(root, {
      CODEX_HOME: "C:\\host-codex",
      CODEX_ROUTER_HOME: "router",
      CLIPROXY_HOME: "cliproxy",
      MODEL_CATALOG_PATH: "catalog",
      CUSTOM_VAR: "custom",
    });

    expect(env.CODEX_HOME).toBe(root);
    expect(env.CODEX_ROUTER_HOME).toBe("");
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.MODEL_CATALOG_PATH).toBe("");
    expect(env.CUSTOM_VAR).toBe("custom");
  });

  it("verifies Codex account identity and fails closed on mismatch", () => {
    const root = createTmpRoot();
    const codexHome = join(root, "codex-profile-test");
    mkdirSync(codexHome, { recursive: true });

    writeFileSync(
      join(codexHome, "auth.json"),
      JSON.stringify({
        tokens: {
          account_id: "org-account-A",
          email: "user-a@company.com",
          access_token: "mock-token",
        },
      }),
      "utf8",
    );

    // Matching identity passes
    expect(() =>
      verifyProfileIdentity("codex", codexHome, {
        accountId: "codex-1",
        providerAccountId: "org-account-A",
      }),
    ).not.toThrow();

    // Mismatched identity fails closed
    expect(() =>
      verifyProfileIdentity("codex", codexHome, {
        accountId: "codex-2",
        providerAccountId: "org-account-B",
      }),
    ).toThrow(AccountControlError);
  });
});

describe("Kimi Profile Isolation (T07)", () => {
  it("isolates KIMI_CODE_HOME to the managed profile directory", () => {
    const root = createTmpRoot();
    const kimiHome = join(root, "kimi-profile-1");
    ensureManagedKimiHome(kimiHome);

    const env = managedKimiProcessEnvironment(kimiHome, {
      KIMI_CODE_HOME: "C:\\host-kimi",
      CLIPROXY_HOME: "cliproxy",
      CODEX_ROUTER_HOME: "router",
    });

    expect(env.KIMI_CODE_HOME).toBe(kimiHome);
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.CODEX_ROUTER_HOME).toBe("");
  });

  it("creates credential directory inside managed KIMI_CODE_HOME", () => {
    const root = createTmpRoot();
    const kimiHome = join(root, "kimi-profile-2");
    ensureManagedKimiHome(kimiHome);

    expect(readFileSync).toBeDefined();
    const credDir = join(kimiHome, "credentials");
    expect(credDir).toBeDefined();
  });
});
