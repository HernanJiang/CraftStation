import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostPort, HttpRequest, HttpResponse } from "@craftstation/agents-usage";
import { getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { AccountStore } from "./accountStore";
import { AntigravityProfileService } from "./antigravityProfiles";

const dirs: string[] = [];
function makeCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "antigravity-profiles-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { force: true, recursive: true });
    } catch {
      // ignore
    }
  }
});

function seedHostLogin(cacheDir: string, email: string): void {
  setUsageSecret(cacheDir, "antigravity", "accessToken", "access-1");
  setUsageSecret(cacheDir, "antigravity", "refreshToken", "refresh-1");
  setUsageSecret(cacheDir, "antigravity", "email", email);
  setUsageSecret(cacheDir, "antigravity", "projectId", "project-123");
}

function modelsBody(): string {
  return JSON.stringify({
    models: {
      "gemini-3-pro-high": {
        displayName: "Gemini 3.1 Pro (High)",
        quotaInfo: { remainingFraction: 0.8, resetTime: "2026-08-30T16:00:00Z" },
      },
    },
  });
}

function okHost(): HostPort {
  return {
    http: {
      request: vi.fn<(req: HttpRequest) => Promise<HttpResponse>>(async () => ({
        status: 200,
        headers: {},
        body: modelsBody(),
      })),
    },
    credentials: {
      getOAuthToken: vi.fn<() => Promise<undefined>>(async () => undefined),
      getSecret: vi.fn<() => Promise<undefined>>(async () => undefined),
    },
    now: () => 1_700_000_000_000,
  };
}

describe("AntigravityProfileService", () => {
  it("appends a pool row per host login instead of overwriting (Grok-style)", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });

    seedHostLogin(cacheDir, "a@example.com");
    const first = service.importHostLogin();
    expect(first.providerAccountId).toBe("a@example.com");
    expect(getUsageSecret(cacheDir, service.bucketFor(first.accountId), "email")).toBe(
      "a@example.com",
    );
    // The legacy bucket is drained: the next login cannot clobber account one.
    expect(getUsageSecret(cacheDir, "antigravity", "accessToken")).toBeUndefined();

    seedHostLogin(cacheDir, "b@example.com");
    const second = service.importHostLogin();
    expect(second.accountId).not.toBe(first.accountId);

    const rows = service.list();
    expect(rows.map((row) => row.providerAccountId)).toEqual(["a@example.com", "b@example.com"]);
    expect(rows.map((row) => row.status)).toEqual(["available", "available"]);
  });

  it("re-authorizes an existing row in place when an accountId is given", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });

    seedHostLogin(cacheDir, "a@example.com");
    const first = service.importHostLogin();
    const bucket = service.bucketFor(first.accountId);
    setUsageSecret(cacheDir, bucket, "accessToken", "stale");

    seedHostLogin(cacheDir, "a2@example.com");
    const updated = service.importHostLogin(first.accountId);

    expect(updated.accountId).toBe(first.accountId);
    expect(getUsageSecret(cacheDir, bucket, "accessToken")).toBe("access-1");
    expect(getUsageSecret(cacheDir, bucket, "email")).toBe("a2@example.com");
    // Re-auth must not spawn a duplicate row.
    expect(service.list()).toHaveLength(1);
  });

  it("collects per-account quota from the cloudcode models response", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    seedHostLogin(cacheDir, "a@example.com");
    const account = service.importHostLogin();

    const host = okHost();
    const refreshed = await service.collectQuota(account.accountId, host);
    expect(refreshed.status).toBe("available");
    expect(refreshed.quotaWindows).toHaveLength(1);
    expect(refreshed.quotaWindows?.[0]).toMatchObject({
      label: "Gemini Pro",
      usedPercent: 20,
    });
    expect(host.http.request).toHaveBeenCalledWith(
      expect.objectContaining({ body: JSON.stringify({ project: "project-123" }) }),
    );
  });
});
