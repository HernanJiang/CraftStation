import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // Real-probe outcome (Responses-first): importStaging rejects bundles
  // without it — unverified providers must never enter the catalog.
  setUsageSecret(cacheDir, "openai-compatible:pending", "validatedProtocol", "responses");
  setUsageSecret(cacheDir, "openai-compatible:pending", "validatedAt", "1700000000000");
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

  it("prepares CLI-readable isolated Kimi config and Grok/DeepSeek env", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Cavoti");
    const account = service.importStaging();

    const kimi = service.prepareVendorCompatRuntime(account.accountId, "kimi", "vendor/model");
    expect(readFileSync(join(kimi.env.KIMI_CODE_HOME!, "config.toml"), "utf8")).toContain(
      '[models."vendor/model"]',
    );
    expect(kimi.env.KIMI_MODEL_NAME).toBe("");
    expect(service.prepareVendorCompatRuntime(account.accountId, "grok").env).toMatchObject({
      GROK_API_KEY: "sk-test",
      GROK_API_BASE: "https://relay.example.com/v1",
    });
    expect(service.prepareVendorCompatRuntime(account.accountId, "deepseek").env).toMatchObject({
      DEEPSEEK_API_KEY: "sk-test",
      DEEPSEEK_BASE_URL: "https://relay.example.com/v1",
      OPENAI_BASE_URL: "https://relay.example.com/v1",
    });
  });

  it("prepares an isolated Muse child env without writing the API key to disk", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Chiral-API");
    const account = service.importStaging();

    const runtime = service.prepareMuseRuntime(account.accountId);
    expect(runtime.env.META_API_KEY).toBe("sk-test");
    expect(runtime.env.CRAFTSTATION_MUSE_BASE_URL).toBe("https://relay.example.com/v1");
    expect(runtime.isolationDir).toContain("openai-compatible-muse");
    expect(runtime.isolationDir).not.toContain("sk-test");
  });

  it("rejects import when the staging bundle was never really verified", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });

    seedStaging(cacheDir, "Relay A");
    clearUsageSecret(cacheDir, "openai-compatible:pending");
    setUsageSecret(
      cacheDir,
      "openai-compatible:pending",
      "baseUrl",
      "https://relay.example.com/v1",
    );
    setUsageSecret(cacheDir, "openai-compatible:pending", "apiKey", "sk-test");
    setUsageSecret(cacheDir, "openai-compatible:pending", "model", "gpt-5.6-sol");

    expect(() => service.importStaging()).toThrow(/验证/);
    expect(service.list()).toHaveLength(0);
  });

  it("exposes the verified protocol for routing without leaking the key", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const account = service.importStaging();

    expect(service.getConfig(account.accountId)).toMatchObject({ validatedProtocol: "responses" });
    const descriptor = service.getDescriptor(account.accountId)!;
    expect(descriptor.validatedProtocol).toBe("responses");
    expect(descriptor.baseUrl).toBe("https://relay.example.com/v1");
    expect("apiKey" in descriptor).toBe(false);
  });

  it("verifyModel probes the sealed key per model (responses wins, 401 never falls back)", async () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Relay A");
    const account = service.importStaging();

    const ok = await service.verifyModel(account.accountId, "gpt-5.6-sol", async (url) => {
      if (url.endsWith("/v1/responses")) {
        return { status: 200, bodyText: JSON.stringify({ id: "r", output: [{}] }) };
      }
      return { status: 200, bodyText: JSON.stringify({ data: [] }) };
    });
    expect(ok.validatedProtocol).toBe("responses");

    await expect(
      service.verifyModel(account.accountId, "gpt-5.6-sol", async () => ({
        status: 401,
        bodyText: JSON.stringify({ error: "bad key" }),
      })),
    ).rejects.toThrow(/API Key 无效/);
  });

  it("prepares an isolated OpenCode config for GLM without writing the key into CODEX_HOME", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const service = new OpenAiCompatibleProfileService({ store, cacheDir });
    seedStaging(cacheDir, "Cavoti");
    const account = service.importStaging();
    const runtime = service.prepareOpenCodeRuntime(account.accountId, "glm-5.3-flash");
    expect(runtime.env.OPENCODE_CONFIG_DIR).toBe(runtime.configDir);
    expect(runtime.env.CRAFTSTATION_OPENCODE_PROVIDER).toBe("craftstation");
    const written = JSON.parse(readFileSync(join(runtime.configDir, "opencode.json"), "utf8")) as {
      provider: Record<
        string,
        { options: { apiKey: string; baseURL: string }; models: Record<string, unknown> }
      >;
    };
    const provider = written.provider.craftstation;
    expect(provider).toBeDefined();
    expect(provider?.options.baseURL).toBe("https://relay.example.com/v1");
    expect(provider?.options.apiKey).toBe("sk-test");
    expect(provider?.models["glm-5.3-flash"]).toBeDefined();
  });

  it("merges every custom-model row bound to the account into the isolated opencode config", () => {
    const cacheDir = makeCacheDir();
    const store = new AccountStore(join(cacheDir, "accounts"));
    const settingsPath = join(cacheDir, "settings.json");
    const service = new OpenAiCompatibleProfileService({ store, cacheDir, settingsPath });
    seedStaging(cacheDir, "Cavoti");
    const account = service.importStaging();
    writeFileSync(
      settingsPath,
      JSON.stringify({
        customModels: [
          {
            id: `custom:opencode:${account.accountId}:glm-5.3-flash`,
            provider: "opencode",
            accountId: account.accountId,
            modelId: "glm-5.3-flash",
            displayName: "GLM Flash",
            contextSize: "",
          },
          {
            id: `custom:opencode:${account.accountId}:glm-5.4`,
            provider: "opencode",
            accountId: account.accountId,
            modelId: "glm-5.4",
            displayName: "GLM 5.4",
            contextSize: "",
          },
          {
            id: "custom:opencode:other:gpt-x",
            provider: "opencode",
            accountId: "other",
            modelId: "gpt-x",
            displayName: "GPT X",
            contextSize: "",
          },
        ],
      }),
    );

    const runtime = service.prepareOpenCodeRuntime(account.accountId, "glm-5.4");
    const written = JSON.parse(readFileSync(join(runtime.configDir, "opencode.json"), "utf8")) as {
      provider: Record<string, { models: Record<string, { name: string }> }>;
    };
    // The whole account catalog must be addressable: the pooled opencode serve
    // reuses idle servers without reloading config.
    expect(written.provider.craftstation?.models).toEqual({
      "gpt-5.6-sol": { name: "GPT-5.6" },
      "glm-5.3-flash": { name: "GLM Flash" },
      "glm-5.4": { name: "GLM 5.4" },
    });
  });

  describe("channelAccountsServingModel", () => {
    function seedChannel(
      service: OpenAiCompatibleProfileService,
      settingsPath: string,
      providerName: string,
      modelIds: string[],
      protocol: "responses" | "chat_completions" = "responses",
    ) {
      const cacheDir = (service as unknown as { options: { cacheDir: string } }).options.cacheDir;
      setUsageSecret(
        cacheDir,
        "openai-compatible:pending",
        "baseUrl",
        "https://relay.example.com/v1",
      );
      setUsageSecret(cacheDir, "openai-compatible:pending", "apiKey", "sk-test");
      setUsageSecret(cacheDir, "openai-compatible:pending", "providerName", providerName);
      setUsageSecret(cacheDir, "openai-compatible:pending", "model", modelIds[0] ?? "gpt-x");
      setUsageSecret(cacheDir, "openai-compatible:pending", "validatedProtocol", protocol);
      setUsageSecret(cacheDir, "openai-compatible:pending", "validatedAt", "1700000000000");
      const account = service.importStaging();
      const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        customModels: unknown[];
      };
      settings.customModels.push(
        ...modelIds.map((modelId) => ({
          id: `custom:codex:${account.accountId}:${modelId}`,
          provider: "codex",
          accountId: account.accountId,
          modelId,
          displayName: modelId,
          contextSize: "",
        })),
      );
      writeFileSync(settingsPath, JSON.stringify(settings));
      return account;
    }

    function makeService() {
      const cacheDir = makeCacheDir();
      const store = new AccountStore(join(cacheDir, "accounts"));
      const settingsPath = join(cacheDir, "settings.json");
      writeFileSync(settingsPath, JSON.stringify({ customModels: [] }));
      const service = new OpenAiCompatibleProfileService({ store, cacheDir, settingsPath });
      return { service, store, settingsPath };
    }

    it("returns channel rows serving the model in pool order", () => {
      const { service, store } = makeService();
      const settingsPath = (service as unknown as { options: { settingsPath: string } }).options
        .settingsPath;
      const a = seedChannel(service, settingsPath, "Relay A", ["gpt-5.6-sol"]);
      const b = seedChannel(service, settingsPath, "Relay B", ["gpt-5.6-sol", "glm-5.3-flash"]);
      seedChannel(service, settingsPath, "Relay C", ["other-model"]);

      expect(service.channelAccountsServingModel({ modelId: "gpt-5.6-sol" })).toEqual([
        a.accountId,
        b.accountId,
      ]);
      expect(service.channelAccountsServingModel({ modelId: "glm-5.3-flash" })).toEqual([
        b.accountId,
      ]);
      expect(service.channelAccountsServingModel({ modelId: "missing" })).toEqual([]);
      void store;
    });

    it("matches provider-prefixed model ids and skips excluded rows", () => {
      const { service } = makeService();
      const settingsPath = (service as unknown as { options: { settingsPath: string } }).options
        .settingsPath;
      const a = seedChannel(service, settingsPath, "Relay A", ["opencode-go/muse-spark-1.3"]);
      const b = seedChannel(service, settingsPath, "Relay B", ["muse-spark-1.3"]);

      expect(
        service.channelAccountsServingModel({ modelId: "opencode-go/muse-spark-1.3" }),
      ).toEqual([a.accountId, b.accountId]);
      expect(service.channelAccountsServingModel({ modelId: "muse-spark-1.3" })).toEqual([
        a.accountId,
        b.accountId,
      ]);
      expect(
        service.channelAccountsServingModel({
          modelId: "muse-spark-1.3",
          excludedAccountIds: [a.accountId],
        }),
      ).toEqual([b.accountId]);
    });

    it("enforces protocol agreement and skips unschedulable rows", () => {
      const { service, store } = makeService();
      const settingsPath = (service as unknown as { options: { settingsPath: string } }).options
        .settingsPath;
      const responses = seedChannel(service, settingsPath, "Relay R", ["gpt-5.6-sol"], "responses");
      const chat = seedChannel(
        service,
        settingsPath,
        "Relay C",
        ["gpt-5.6-sol"],
        "chat_completions",
      );
      const disabled = seedChannel(service, settingsPath, "Relay D", ["gpt-5.6-sol"]);
      store.setEnabled(disabled.accountId, false);
      const exhausted = seedChannel(service, settingsPath, "Relay E", ["gpt-5.6-sol"]);
      store.updateStatus(exhausted.accountId, "quota-exhausted");

      expect(
        service.channelAccountsServingModel({ modelId: "gpt-5.6-sol", protocol: "responses" }),
      ).toEqual([responses.accountId]);
      expect(
        service.channelAccountsServingModel({
          modelId: "gpt-5.6-sol",
          protocol: "chat_completions",
        }),
      ).toEqual([chat.accountId]);
      // Unknown protocol on the caller side never filters.
      expect(service.channelAccountsServingModel({ modelId: "gpt-5.6-sol" })).toEqual([
        responses.accountId,
        chat.accountId,
      ]);
    });

    it("rewrites the Kimi provider table to the override wire type", () => {
      const { service } = makeService();
      const settingsPath = (service as unknown as { options: { settingsPath: string } }).options
        .settingsPath;
      const account = seedChannel(service, settingsPath, "Relay A", ["k3-256k"], "responses");

      const cacheDir = (service as unknown as { options: { cacheDir: string } }).options.cacheDir;
      const homeFor = () => {
        const safeAccount = account.accountId.replace(/[^A-Za-z0-9._-]/g, "_");
        const scoped = Buffer.from("k3-256k", "utf8").toString("base64url");
        return join(cacheDir, "openai-compatible-kimi", safeAccount, scoped);
      };

      service.prepareVendorCompatRuntime(account.accountId, "kimi", "k3-256k");
      expect(readFileSync(join(homeFor(), "config.toml"), "utf8")).toContain(
        'type = "openai_responses"',
      );

      service.prepareVendorCompatRuntime(account.accountId, "kimi", "k3-256k", "chat_completions");
      expect(readFileSync(join(homeFor(), "config.toml"), "utf8")).toContain('type = "openai"');
      expect(readFileSync(join(homeFor(), "config.toml"), "utf8")).not.toContain(
        "openai_responses",
      );
    });
  });
});
