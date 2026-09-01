import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostPort, HttpRequest, HttpResponse } from "@craftstation/agents-usage";
import { clearUsageSecret, getUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import { AccountStore } from "./accountStore";
import { OpenAiCompatibleProfileService } from "./openaiCompatibleProfiles";

const dirs: string[] = [];
function makeCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openai-compatible-profiles-"));
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

function seedStaging(cacheDir: string, providerName: string): void {
  setUsageSecret(cacheDir, "openai-compatible:pending", "baseUrl", "https://relay.example.com/v1");
  setUsageSecret(cacheDir, "openai-compatible:pending", "apiKey", "sk-test");
  setUsageSecret(cacheDir, "openai-compatible:pending", "providerName", providerName);
  setUsageSecret(cacheDir, "openai-compatible:pending", "model", "gpt-5.6-sol");
  setUsageSecret(cacheDir, "openai-compatible:pending", "displayName", "GPT-5.6");
}

function hostWith(responder: (url: string) => HttpResponse | undefined): HostPort {
  return {
    http: {
      request: vi.fn<(req: HttpRequest) => Promise<HttpResponse>>(async (req) => {
        const response = responder(req.url);
        if (response === undefined) throw new Error("unreachable");
        return response;
      }),
    },
    credentials: {
      getOAuthToken: vi.fn<HostPort["credentials"]["getOAuthToken"]>(async () => undefined),
      getSecret: vi.fn<HostPort["credentials"]["getSecret"]>(async () => undefined),
    },
    now: () => 1_700_000_000_000,
  };
}

describe("OpenAiCompatibleProfileService", () => {
  it("appends one pool row per validated provider instead of overwriting", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });

    seedStaging(cacheDir, "Relay A");
    const first = service.importStaging();
    expect(first.providerAccountId).toBe("Relay A");
    expect(first.plan).toBe("GPT-5.6");
    const firstBucket = service.bucketFor(first.accountId);
    expect(getUsageSecret(cacheDir, firstBucket, "apiKey")).toBe("sk-test");
    // 暂存桶随即清空：下一次导入必然追加，不会覆盖第一个提供商。
    expect(getUsageSecret(cacheDir, "openai-compatible:pending", "baseUrl")).toBeUndefined();

    seedStaging(cacheDir, "Relay B");
    const second = service.importStaging();
    expect(second.accountId).not.toBe(first.accountId);
    expect(service.list().map((row) => row.providerAccountId)).toEqual(["Relay A", "Relay B"]);
  });

  it("re-binds an existing row when an accountId is given (edit flow)", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });

    seedStaging(cacheDir, "Relay A");
    const first = service.importStaging();
    const bucket = service.bucketFor(first.accountId);

    seedStaging(cacheDir, "Relay A Renamed");
    const updated = service.importStaging(first.accountId);

    expect(updated.accountId).toBe(first.accountId);
    expect(getUsageSecret(cacheDir, bucket, "providerName")).toBe("Relay A Renamed");
    expect(service.list()).toHaveLength(1);
  });

  it("collectQuota folds relay billing endpoints into a quota window", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const account = service.importStaging();

    const host = hostWith((url) => {
      if (url.endsWith("/models")) {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      if (url.endsWith("/dashboard/billing/subscription")) {
        return { status: 200, headers: {}, body: JSON.stringify({ system_hard_limit_usd: 50 }) };
      }
      if (url.includes("/dashboard/billing/usage")) {
        return { status: 200, headers: {}, body: JSON.stringify({ total_usage: 1250 }) };
      }
      return { status: 404, headers: {}, body: "" };
    });

    const refreshed = await service.collectQuota(account.accountId, host);
    expect(refreshed.status).toBe("available");
    expect(refreshed.quotaWindows).toHaveLength(1);
    // 1250 美分 / (50 美元 × 100) = 25%。
    expect(refreshed.quotaWindows?.[0]).toMatchObject({ label: "额度", usedPercent: 25 });
  });

  it("keeps an empty quota window (token-usage fallback) when billing endpoints are absent", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const account = service.importStaging();

    const host = hostWith((url) => {
      if (url.endsWith("/models")) {
        return { status: 200, headers: {}, body: JSON.stringify({ data: [] }) };
      }
      return { status: 404, headers: {}, body: "" };
    });

    const refreshed = await service.collectQuota(account.accountId, host);
    expect(refreshed.status).toBe("available");
    expect(refreshed.quotaWindows).toEqual([]);
  });

  it("marks the row auth-expired when the relay rejects the key", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const account = service.importStaging();

    const host = hostWith(() => ({ status: 401, headers: {}, body: "" }));
    const refreshed = await service.collectQuota(account.accountId, host);
    expect(refreshed.status).toBe("auth-expired");
  });

  it("destroyCredentials removes only the deleted account's bundle", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const first = service.importStaging();
    seedStaging(cacheDir, "Relay B");
    const second = service.importStaging();

    service.destroyCredentials(first.accountId);
    expect(getUsageSecret(cacheDir, service.bucketFor(first.accountId), "apiKey")).toBeUndefined();
    expect(getUsageSecret(cacheDir, service.bucketFor(second.accountId), "apiKey")).toBe("sk-test");
    clearUsageSecret(cacheDir, `openai-compatible:${second.accountId}`);
  });

  it("prepares an account-isolated Codex Responses profile without writing the API key", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Chiral-API");
    const account = service.importStaging();

    const runtime = service.prepareCodexRuntime(account.accountId);
    const config = readFileSync(join(runtime.codexHome, "config.toml"), "utf8");

    expect(basename(runtime.codexHome)).not.toContain(":");
    expect(config).toContain('model_provider = "craftstation_openai_compatible"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain('base_url = "https://relay.example.com/v1"');
    expect(config).not.toContain("sk-test");
    expect(runtime.env).toEqual({ CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY: "sk-test" });
  });
});
