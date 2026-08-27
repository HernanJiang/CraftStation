import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { AccountStore } from "./accountStore";
import { collectGrok } from "@poracode/agents-usage";

vi.mock("@poracode/agents-usage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poracode/agents-usage")>();
  return {
    ...actual,
    collectGrok: vi
      .fn<
        () => Promise<{
          providerId: string;
          status: string;
          windows: Array<{ id: string; usedPercent: number }>;
          fetchedAt: number;
        }>
      >()
      .mockResolvedValue({
        providerId: "grok",
        status: "ok",
        windows: [{ id: "weekly", usedPercent: 95 }],
        fetchedAt: 1234,
      }),
  };
});
import {
  buildGrokLoginScript,
  defaultGrokAccountLabel,
  GrokProfileService,
  managedGrokLoginCwd,
  managedGrokProcessEnvironment,
} from "./grokProfiles";

const roots: string[] = [];
function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "craftstation-grok-"));
  roots.push(root);
  return root;
}

function officialAuthJson(identity: Record<string, string>): string {
  return JSON.stringify({
    "https://auth.x.ai::test-client": {
      key: "access-token",
      refresh_token: "refresh-token",
      expires_at: "9999999999999",
      ...identity,
    },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("GrokProfileService", () => {
  it("uses the first three local-part characters as the default label", () => {
    expect(defaultGrokAccountLabel("hernanjiang@example.com")).toBe("her");
    expect(defaultGrokAccountLabel("a@example.com")).toBe("a");
  });

  it("does not insert an account without an official identity", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingHome = createRoot();
    writeFileSync(join(pendingHome, "auth.json"), officialAuthJson({}), "utf8");

    expect(() =>
      service.importAuthJson({ label: "No identity", profileRoot: pendingHome }),
    ).toThrow(AccountControlError);
    expect(store.list("grok")).toEqual([]);
  });

  it("imports an official identity and projects GROK_HOME inside the managed root", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "person@example.com", principal_id: "principal-42" }),
      "utf8",
    );

    const account = service.importAuthJson({ label: "New Grok", profileRoot: pendingHome });
    expect(account.provider).toBe("grok");
    expect(account.status).toBe("available");
    expect(account.maskedIdentity).toBe("per***son@example.com");
    // v0.5 default alias contract: placeholder labels become "<Provider> Account N".
    expect(account.label).toBe("Grok 1");
    expect(account).not.toHaveProperty("credentialRoot");

    const managedHome = service.managedGrokHome(account.accountId);
    expect(managedHome.startsWith(store.managedRoot)).toBe(true);
    const envPath = join(managedHome, "environment.json");
    expect(JSON.parse(readFileSync(envPath, "utf8"))).toEqual({ GROK_HOME: managedHome });
    expect(JSON.parse(readFileSync(join(managedHome, "auth.json"), "utf8"))).toEqual(
      JSON.parse(officialAuthJson({ email: "person@example.com", principal_id: "principal-42" })),
    );
  });

  it("keeps A and B GROK_HOME roots independent and rejects cross-home projection", () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingA = createRoot();
    const pendingB = createRoot();
    writeFileSync(join(pendingA, "auth.json"), officialAuthJson({ email: "a@example.com" }));
    writeFileSync(join(pendingB, "auth.json"), officialAuthJson({ email: "b@example.com" }));

    const a = service.importAuthJson({ label: "A", profileRoot: pendingA });
    const b = service.importAuthJson({ label: "B", profileRoot: pendingB });
    const homeA = service.managedGrokHome(a.accountId);
    const homeB = service.managedGrokHome(b.accountId);

    expect(homeA).not.toBe(homeB);
    expect(() =>
      store.projectCredential({
        accountId: a.accountId,
        provider: "grok",
        environment: { GROK_HOME: homeB },
      }),
    ).toThrow(/GROK_HOME/);
  });
});

describe("managedGrokProcessEnvironment", () => {
  it("pins GROK_HOME and blanks CLIProxy/Router/API-key overrides", () => {
    const root = createRoot();
    const env = managedGrokProcessEnvironment(root, {
      GROK_HOME: "C:\\old-grok",
      GROK_API_KEY: "secret",
      XAI_API_KEY: "secret",
      CLIPROXY_HOME: "router",
      CODEX_ROUTER_HOME: "router",
      MODEL_CATALOG_PATH: "catalog",
      KEEP_ME: "value",
    });

    expect(env.GROK_HOME).toBe(root);
    expect(env.GROK_API_KEY).toBe("");
    expect(env.XAI_API_KEY).toBe("");
    expect(env.CLIPROXY_HOME).toBe("");
    expect(env.CODEX_ROUTER_HOME).toBe("");
    expect(env.MODEL_CATALOG_PATH).toBe("");
    expect(env.KEEP_ME).toBe("value");
  });

  it("overwrites seeded host API-key / Router vars after the ACP process.env merge", () => {
    const root = createRoot();
    const hostEnv = {
      GROK_API_KEY: "host-leak",
      XAI_API_KEY: "host-xai",
      CLIPROXY_HOME: "host-cli",
      CODEX_ROUTER_HOME: "host-router",
      MODEL_CATALOG_PATH: "host-catalog",
      GROK_HOME: "C:\\host-grok",
      OTHER: "kept",
    };
    const isolated = managedGrokProcessEnvironment(root, hostEnv);

    // ACP spawn does `{ ...process.env, ...command.env }`; blanking wins.
    const merged = { ...hostEnv, ...isolated };
    expect(merged.GROK_HOME).toBe(root);
    expect(merged.GROK_API_KEY).toBe("");
    expect(merged.XAI_API_KEY).toBe("");
    expect(merged.CLIPROXY_HOME).toBe("");
    expect(merged.CODEX_ROUTER_HOME).toBe("");
    expect(merged.MODEL_CATALOG_PATH).toBe("");
    expect(merged.OTHER).toBe("kept");
  });
});

describe("buildGrokLoginScript", () => {
  it("runs the official device-auth flow inside the managed GROK_HOME", () => {
    const posix = buildGrokLoginScript("posix", "lc_grok_test");
    expect(posix).toContain("grok login --device-auth");
    expect(posix).toContain('"$GROK_HOME"');
    expect(posix).toContain("lc_grok_test");

    const windows = buildGrokLoginScript("windows", "lc_grok_test");
    expect(windows).toContain("grok login --device-auth");
    expect(windows).toContain("$env:GROK_HOME");
    expect(windows).toContain("lc_grok_test");
  });

  it("ensures the managed login cwd exists", () => {
    const root = createRoot();
    const cwd = managedGrokLoginCwd(root);
    expect(cwd).toBe(root);
    mkdirSync(root, { recursive: true });
  });

  it("collects account-scoped Grok quota from the managed GROK_HOME only (v0.5 T07)", async () => {
    const root = createRoot();
    const store = new AccountStore(root);
    const service = new GrokProfileService({ store });
    const pendingHome = createRoot();
    writeFileSync(
      join(pendingHome, "auth.json"),
      officialAuthJson({ email: "quota@example.com", principal_id: "principal-quota" }),
      "utf8",
    );
    const account = service.importAuthJson({ label: "Grok quota", profileRoot: pendingHome });
    vi.mocked(collectGrok).mockClear();

    const host = {
      now: () => 0,
      credentials: { getOAuthToken: async () => undefined, getSecret: async () => undefined },
    };
    const result = await service.collectQuota(account.accountId, host as never);
    expect(result).toMatchObject({ accountId: account.accountId, status: "quota-low" });
    expect(collectGrok).toHaveBeenCalled();
    // The scoped host carries the managed credential seam.
    expect(collectGrok).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.anything() }),
    );
  });
});
