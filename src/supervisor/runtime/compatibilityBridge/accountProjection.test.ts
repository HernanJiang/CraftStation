import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { projectCompatibilityAccount } from "./accountProjection";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("CPA account projection", () => {
  it.each(["codex", "kimi", "grok"])(
    "projects %s without modifying original credentials",
    (provider) => {
      const root = mkdtempSync(join(tmpdir(), "cs-cpa-account-"));
      roots.push(root);
      mkdirSync(join(root, "credentials"));
      const tokens = {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        account_id: "fixture-id",
      };
      const source = join(root, provider === "kimi" ? "credentials/kimi-code.json" : "auth.json");
      const original = JSON.stringify(provider === "codex" ? { tokens } : tokens);
      writeFileSync(source, original);
      const dir = projectCompatibilityAccount(provider, root, join(root, "projection"));
      expect(JSON.parse(readFileSync(join(dir, "account.json"), "utf8"))).toMatchObject({
        type: provider === "grok" ? "xai" : provider,
        ...tokens,
      });
      expect(readFileSync(source, "utf8")).toBe(original);
    },
  );
  it("fails closed without leaking malformed credentials in its error", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-cpa-account-"));
    roots.push(root);
    writeFileSync(join(root, "auth.json"), "sensitive-malformed-value");
    expect(() => projectCompatibilityAccount("codex", root, join(root, "projection"))).toThrow(
      "CPA 无法读取 codex 账号凭据",
    );
  });
  it("preserves CPA refreshes until the source login changes", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-cpa-refresh-"));
    roots.push(root);
    const source = join(root, "auth.json");
    writeFileSync(
      source,
      JSON.stringify({ tokens: { access_token: "original", refresh_token: "original-refresh" } }),
    );
    const dir = projectCompatibilityAccount("codex", root, join(root, "projection"));
    const copy = join(dir, "account.json");
    const rotated = { type: "codex", access_token: "rotated", refresh_token: "rotated-refresh" };
    writeFileSync(copy, JSON.stringify(rotated));
    projectCompatibilityAccount("codex", root, dir);
    expect(JSON.parse(readFileSync(copy, "utf8"))).toEqual(rotated);
    writeFileSync(source, JSON.stringify({ tokens: { access_token: "new-login" } }));
    projectCompatibilityAccount("codex", root, dir);
    expect(JSON.parse(readFileSync(copy, "utf8")).access_token).toBe("new-login");
  });
  it("projects OIDC Grok identity, expiry and refresh metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-cpa-oidc-"));
    roots.push(root);
    writeFileSync(
      join(root, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::fixture-client": {
          key: "oidc-access",
          refreshToken: "oidc-refresh",
          expires_at: 1_800_000_000,
        },
      }),
    );
    const dir = projectCompatibilityAccount("grok", root, join(root, "projection"));
    expect(JSON.parse(readFileSync(join(dir, "account.json"), "utf8"))).toMatchObject({
      type: "xai",
      auth_kind: "oauth",
      access_token: "oidc-access",
      refresh_token: "oidc-refresh",
      client_id: "fixture-client",
      expired: new Date(1_800_000_000_000).toISOString(),
    });
  });
  it("does not overwrite a CPA file truncated during token refresh", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-cpa-race-"));
    roots.push(root);
    writeFileSync(join(root, "auth.json"), JSON.stringify({ tokens: { access_token: "old" } }));
    const dir = projectCompatibilityAccount("codex", root, join(root, "projection"));
    const copy = join(dir, "account.json");
    for (const partial of ["", '{"access_token":']) {
      writeFileSync(copy, partial);
      projectCompatibilityAccount("codex", root, dir);
      expect(readFileSync(copy, "utf8")).toBe(partial);
    }
  });
  it("preserves Kimi's separate device identity and numeric expiry", () => {
    const root = mkdtempSync(join(tmpdir(), "cs-cpa-kimi-"));
    roots.push(root);
    mkdirSync(join(root, "credentials"));
    writeFileSync(
      join(root, "credentials/kimi-code.json"),
      JSON.stringify({ access_token: "fixture", expires_at: 1800000000 }),
    );
    writeFileSync(join(root, "device_id"), "fixture-device\n");
    const dir = projectCompatibilityAccount("kimi", root, join(root, "projection"));
    expect(JSON.parse(readFileSync(join(dir, "account.json"), "utf8"))).toMatchObject({
      device_id: "fixture-device",
      expired: new Date(1800000000000).toISOString(),
    });
  });
});
