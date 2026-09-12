import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostPort, HttpRequest, HttpResponse } from "@craftstation/agents-usage";
import {
  clearUsageSecret,
  getUsageSecret,
  setUsageSecret,
  usageDurableSecretsPath,
} from "@/shared/usageSecretStore";
import {
  configureSecretStorageFallbackKeys,
  configureSecretStorageKey,
  resetSecretStorageKeysForTests,
} from "@/shared/secretStorage";
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

  it("writes a durable ADC file at import so a restart can self-heal", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    seedHostLogin(cacheDir, "a@example.com");
    const account = service.importHostLogin();
    const adcPath = join(store.credentialRoot(account.accountId), "adc", "authorized_user.json");
    expect(JSON.parse(readFileSync(adcPath, "utf8"))).toMatchObject({
      type: "authorized_user",
      refresh_token: "refresh-1",
    });
    const bucket = service.bucketFor(account.accountId);
    clearUsageSecret(cacheDir, bucket);
    expect(service.hasRefreshToken(account.accountId)).toBe(true);
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

  it("applies a pool row as the host agy login via the injected writer", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });

    seedHostLogin(cacheDir, "a@example.com");
    const account = service.importHostLogin();

    const written: string[] = [];
    const result = await service.applyAccountToHostLogin(account.accountId, async (payload) => {
      written.push(payload);
    });

    expect(result).toEqual({ email: "a@example.com" });
    expect(written).toHaveLength(1);
    const blob = JSON.parse(written[0]!) as {
      token: Record<string, string>;
      auth_method: string;
    };
    expect(blob.auth_method).toBe("consumer");
    expect(blob.token.access_token).toBe("access-1");
    expect(blob.token.refresh_token).toBe("refresh-1");
    expect(blob.token.token_type).toBe("Bearer");
  });

  it("rejects host-apply for unknown rows and token-less rows", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const writer = vi.fn<(payload: string) => Promise<void>>(async () => undefined);

    await expect(
      service.applyAccountToHostLogin("antigravity:missing", writer),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

    seedHostLogin(cacheDir, "b@example.com");
    const account = service.importHostLogin();
    // Drop the sealed bundle: no tokens left to publish.
    service.destroyCredentials(account.accountId);
    await expect(service.applyAccountToHostLogin(account.accountId, writer)).rejects.toMatchObject({
      code: "ACCOUNT_UNAVAILABLE",
    });
    expect(writer).not.toHaveBeenCalled();
  });

  function seedPoolRow(
    service: AntigravityProfileService,
    cacheDir: string,
    email: string,
  ): string {
    seedHostLogin(cacheDir, email);
    const account = service.importHostLogin();
    return account.accountId;
  }

  function hostBlob(refreshToken: string): string {
    return JSON.stringify({ token: { access_token: "x", refresh_token: refreshToken } });
  }

  it("rotates the host login to the next row when the failed row is what the host holds", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const failedId = seedPoolRow(service, cacheDir, "failed@example.com");
    const nextId = seedPoolRow(service, cacheDir, "next@example.com");
    setUsageSecret(cacheDir, service.bucketFor(failedId), "refreshToken", "refresh-FAILED");
    setUsageSecret(cacheDir, service.bucketFor(nextId), "refreshToken", "refresh-NEXT");

    const written: string[] = [];
    const result = await service.rotateHostAfterFailure(
      failedId,
      () => ({ accountId: nextId }),
      async (payload) => {
        written.push(payload);
      },
      async () => hostBlob("refresh-FAILED"),
    );

    // The NEXT row's bundle is published, not the failed one.
    expect(result).toEqual({ rotated: true, accountId: nextId });
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!).token.refresh_token).toBe("refresh-NEXT");
  });

  it("leaves the host login alone when it holds a different row", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const failedId = seedPoolRow(service, cacheDir, "failed@example.com");
    const nextId = seedPoolRow(service, cacheDir, "next@example.com");
    const writer = vi.fn<(payload: string) => Promise<void>>(async () => undefined);

    const result = await service.rotateHostAfterFailure(
      failedId,
      () => ({ accountId: nextId }),
      writer,
      async () => hostBlob("some-other-refresh"),
    );

    expect(result).toEqual({ rotated: false });
    expect(writer).not.toHaveBeenCalled();
  });

  it("does not rotate without a next candidate or a failed-row secret", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const failedId = seedPoolRow(service, cacheDir, "failed@example.com");
    const writer = vi.fn<(payload: string) => Promise<void>>(async () => undefined);

    expect(
      await service.rotateHostAfterFailure(
        failedId,
        () => undefined,
        writer,
        async () => hostBlob("refresh-1"),
      ),
    ).toEqual({ rotated: false });

    service.destroyCredentials(failedId);
    expect(
      await service.rotateHostAfterFailure(
        failedId,
        () => ({ accountId: "antigravity:other" }),
        writer,
        async () => hostBlob("refresh-1"),
      ),
    ).toEqual({ rotated: false });
    expect(writer).not.toHaveBeenCalled();
  });

  it("leaves the host login alone when it already follows the row", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const id = seedPoolRow(service, cacheDir, "same@example.com");
    setUsageSecret(cacheDir, service.bucketFor(id), "refreshToken", "refresh-SAME");
    const writer = vi.fn<(payload: string) => Promise<void>>(async () => undefined);

    const result = await service.ensureHostFollowsAccount(id, writer, async () =>
      hostBlob("refresh-SAME"),
    );

    expect(result).toEqual({ applied: false, accountId: id });
    expect(writer).not.toHaveBeenCalled();
  });

  it("applies the row when the host holds something else", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const id = seedPoolRow(service, cacheDir, "new@example.com");
    setUsageSecret(cacheDir, service.bucketFor(id), "refreshToken", "refresh-NEW");
    setUsageSecret(cacheDir, service.bucketFor(id), "accessToken", "access-NEW");
    const written: string[] = [];

    const result = await service.ensureHostFollowsAccount(
      id,
      async (payload) => {
        written.push(payload);
      },
      async () => hostBlob("refresh-OLD"),
    );

    expect(result).toEqual({ applied: true, accountId: id });
    expect(JSON.parse(written[0]!).token.refresh_token).toBe("refresh-NEW");
  });

  function plantAdcFile(store: AccountStore, accountId: string, refreshToken: string): void {
    const adcPath = join(store.credentialRoot(accountId), "adc", "authorized_user.json");
    mkdirSync(dirname(adcPath), { recursive: true });
    writeFileSync(
      adcPath,
      JSON.stringify({ type: "authorized_user", refresh_token: refreshToken }),
      "utf8",
    );
  }

  function quotaHostWithRefresh(refreshStatus: number): HostPort {
    const host = okHost();
    vi.mocked(host.http.request).mockImplementation(async (req: HttpRequest) => {
      if (req.url.includes("oauth2.googleapis.com")) {
        return {
          status: refreshStatus,
          headers: {},
          body:
            refreshStatus >= 200 && refreshStatus < 300
              ? JSON.stringify({
                  access_token: "fresh-access",
                  expires_in: 3600,
                  token_type: "Bearer",
                })
              : JSON.stringify({ error: "invalid_grant" }),
        };
      }
      return { status: 200, headers: {}, body: modelsBody() };
    });
    return host;
  }

  it("self-heals an emptied sealed bundle from the account ADC file", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const id = seedPoolRow(service, cacheDir, "rescue@example.com");
    const bucket = service.bucketFor(id);
    // Simulate a post-update orphaned vault: the sealed bundle is gone, but the
    // Grok-style per-account ADC file (written at session spawn) survives.
    clearUsageSecret(cacheDir, bucket);
    plantAdcFile(store, id, "adc-refresh");

    const updated = await service.collectQuota(id, quotaHostWithRefresh(200));

    expect(updated.status).toBe("available");
    // The bundle is re-sealed under the current app key for subsequent ticks.
    expect(getUsageSecret(cacheDir, bucket, "accessToken")).toBe("fresh-access");
    expect(getUsageSecret(cacheDir, bucket, "refreshToken")).toBe("adc-refresh");
  });

  it("leaves a clean auth-missing row when the ADC rescue token is dead", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const id = seedPoolRow(service, cacheDir, "dead@example.com");
    const bucket = service.bucketFor(id);
    clearUsageSecret(cacheDir, bucket);
    plantAdcFile(store, id, "dead-refresh");

    const updated = await service.collectQuota(id, quotaHostWithRefresh(400));

    expect(updated.status).toBe("auth-expired");
    // The dead planted token is removed again: no doomed refresh every tick.
    expect(getUsageSecret(cacheDir, bucket, "refreshToken")).toBeUndefined();
    expect(existsSync(join(store.credentialRoot(id), "adc", "authorized_user.json"))).toBe(false);
  });

  it("re-seals from the ADC file when the sealed value is unreadable", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new AntigravityProfileService({ store, cacheDir });
    const id = seedPoolRow(service, cacheDir, "kept@example.com");
    const bucket = service.bucketFor(id);
    // Seal the bundle under a FOREIGN key so this identity cannot open it
    // (simulates a stale userData identity after an update). The durable ADC
    // file still holds a live refresh token: rescue must re-seal under the
    // current key instead of leaving the account stuck on "解不开".
    const foreignKey = randomBytes(32).toString("base64");
    configureSecretStorageKey(foreignKey);
    setUsageSecret(cacheDir, bucket, "refreshToken", "foreign-refresh");
    setUsageSecret(cacheDir, bucket, "accessToken", "foreign-access");
    configureSecretStorageKey(randomBytes(32).toString("base64"));
    configureSecretStorageFallbackKeys([]);
    // Isolate the ADC last-resort path: drop the file-backed durable sidecar
    // that setUsageSecret now writes (that copy is covered by usageSecretStore
    // tests). Pre-durable installs only have the ADC file after a login.
    rmSync(usageDurableSecretsPath(cacheDir), { force: true });
    plantAdcFile(store, id, "adc-refresh");

    const updated = await service.collectQuota(id, quotaHostWithRefresh(200));

    expect(updated.status).toBe("available");
    expect(getUsageSecret(cacheDir, bucket, "refreshToken")).toBe("adc-refresh");
    expect(getUsageSecret(cacheDir, bucket, "accessToken")).toBe("fresh-access");
    resetSecretStorageKeysForTests();
  });
});
