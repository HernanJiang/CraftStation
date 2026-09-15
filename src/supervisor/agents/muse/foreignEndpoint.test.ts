import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OPENCODE_GO_RESPONSES_BASE_URL,
  applyMuseForeignLaunchArgs,
  buildMuseForeignChildEnv,
  museForeignProviderFromModel,
  museForeignWslBootstrap,
  museForeignWslSettingsWrite,
  normalizeMuseResponsesBaseUrl,
  readOpenCodeGoApiKey,
} from "./foreignEndpoint";

describe("muse foreignEndpoint", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    delete process.env.XDG_DATA_HOME;
  });

  it("strips a trailing /responses so Muse does not double the path", () => {
    expect(normalizeMuseResponsesBaseUrl("https://opencode.ai/zen/go/v1/responses")).toBe(
      OPENCODE_GO_RESPONSES_BASE_URL,
    );
    expect(normalizeMuseResponsesBaseUrl("https://opencode.ai/zen/go/v1/")).toBe(
      OPENCODE_GO_RESPONSES_BASE_URL,
    );
  });

  it("recognizes OpenCode Go catalog prefixes", () => {
    expect(museForeignProviderFromModel("opencode-go/muse-spark-1.3-contributor")).toBe(
      "opencode-go",
    );
    expect(museForeignProviderFromModel("muse-spark-1.3-contributor")).toBeUndefined();
  });

  it("injects --provider meta, strips the catalog prefix, and does not pass --base-url", () => {
    const args = applyMuseForeignLaunchArgs(
      ["--trust-workspace", "--model", "opencode-go/muse-spark-1.3-contributor"],
      { CRAFTSTATION_MUSE_BASE_URL: OPENCODE_GO_RESPONSES_BASE_URL },
    );
    expect(args).toEqual([
      "--trust-workspace",
      "--provider",
      "meta",
      "--model",
      "muse-spark-1.3-contributor",
    ]);
    expect(args).not.toContain("--base-url");
  });

  it("does not duplicate --provider when already present", () => {
    const args = applyMuseForeignLaunchArgs(
      ["--trust-workspace", "--provider", "meta", "--model", "m"],
      { CRAFTSTATION_MUSE_BASE_URL: OPENCODE_GO_RESPONSES_BASE_URL },
    );
    expect(args.filter((token) => token === "--provider")).toHaveLength(1);
  });

  it("reads the OpenCode Go key from auth.json without requiring other entries", () => {
    const dataHome = mkdtempSync(join(tmpdir(), "muse-go-auth-"));
    roots.push(dataHome);
    process.env.XDG_DATA_HOME = dataHome;
    mkdirSync(join(dataHome, "opencode"), { recursive: true });
    writeFileSync(
      join(dataHome, "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { key: "sk-test-go" }, other: { name: "keep" } }),
      "utf8",
    );
    expect(readOpenCodeGoApiKey()).toBe("sk-test-go");
  });

  it("puts the API key only in child env, never in the isolation directory name", () => {
    const isolationDir = mkdtempSync(join(tmpdir(), "muse-iso-"));
    roots.push(isolationDir);
    const env = buildMuseForeignChildEnv({
      apiKey: "sk-secret-key",
      baseUrl: "https://opencode.ai/zen/go/v1/responses",
      isolationDir,
    });
    expect(env.META_API_KEY).toBe("sk-secret-key");
    expect(env.CRAFTSTATION_MUSE_BASE_URL).toBe(OPENCODE_GO_RESPONSES_BASE_URL);
    expect(env.XDG_CONFIG_HOME).toBe(isolationDir);
    expect(JSON.stringify(env)).toContain("sk-secret-key");
    expect(isolationDir).not.toContain("sk-secret-key");
    const settings = JSON.parse(
      readFileSync(join(isolationDir, "muse", "settings.json"), "utf8"),
    ) as {
      endpoint_transport: { base_url: string; auth: string };
      model_catalog: unknown;
      provider: string;
    };
    expect(settings.provider).toBe("meta");
    expect(settings.endpoint_transport.auth).toBe("bearer");
    expect(Array.isArray(settings.model_catalog)).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("sk-secret-key");
    expect(env.CRAFTSTATION_MUSE_SHIM_UPSTREAM).toBe(OPENCODE_GO_RESPONSES_BASE_URL);
    expect(env.CRAFTSTATION_MUSE_SHIM_PYTHON).toContain("muse-code/models");
    const bootstrap = museForeignWslBootstrap(env);
    expect(bootstrap).toContain("python3");
    expect(bootstrap).toContain("shim.py");
    expect(bootstrap).not.toContain("sk-secret-key");
  });

  it("writes settings.json without launching the python shim", () => {
    const script = museForeignWslSettingsWrite({
      XDG_CONFIG_HOME: "/tmp/muse-iso",
      CRAFTSTATION_MUSE_SETTINGS_JSON: "{\"provider\":\"meta\"}",
    });
    expect(script).toContain("settings.json");
    expect(script).toContain("mkdir -p");
    expect(script).not.toContain("python3");
  });
});
