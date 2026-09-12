import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  OPENCODE_GO_RESPONSES_BASE_URL,
  applyMuseForeignLaunchArgs,
  buildMuseForeignChildEnv,
  museForeignProviderFromModel,
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

  it("injects --provider meta --base-url and strips the catalog prefix from --model", () => {
    const args = applyMuseForeignLaunchArgs(
      ["--trust-workspace", "--model", "opencode-go/muse-spark-1.3-contributor"],
      { CRAFTSTATION_MUSE_BASE_URL: OPENCODE_GO_RESPONSES_BASE_URL },
    );
    expect(args).toEqual([
      "--trust-workspace",
      "--provider",
      "meta",
      "--base-url",
      OPENCODE_GO_RESPONSES_BASE_URL,
      "--model",
      "muse-spark-1.3-contributor",
    ]);
  });

  it("does not duplicate --base-url when already present", () => {
    const args = applyMuseForeignLaunchArgs(
      ["--trust-workspace", "--provider", "meta", "--base-url", "https://example.test/v1", "--model", "m"],
      { CRAFTSTATION_MUSE_BASE_URL: OPENCODE_GO_RESPONSES_BASE_URL },
    );
    expect(args.filter((token) => token === "--base-url")).toHaveLength(1);
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
  });
});
