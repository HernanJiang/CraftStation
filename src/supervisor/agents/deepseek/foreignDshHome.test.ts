import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENCODE_GO_DSH_BASE_URL,
  OPENCODE_GO_DSH_PROVIDER_ID,
  dshForeignCompatEnv,
  openCodeGoDshCompatEnv,
  writeDshForeignProviderHome,
  writeOpenCodeGoDshHome,
} from "./foreignDshHome";

describe("writeDshForeignProviderHome", () => {
  it("registers the channel as a pi-ai provider and repoints the official DeepSeek route", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-foreign-"));
    try {
      writeDshForeignProviderHome({
        isolationDir: dir,
        providerId: "relay",
        displayName: "Relay",
        apiKey: "sk-relay",
        baseUrl: "https://relay.example/v1",
        modelId: "relay-model-1",
      });
      const settings = readFileSync(join(dir, "settings.yaml"), "utf8");
      expect(settings).toContain("relay.example/v1");
      expect(settings).toContain("openai-completions");
      expect(settings).toContain("relay-model-1");
      expect(settings).toContain("provider: relay");
      expect(settings).not.toContain("sk-relay");
      const credentials = readFileSync(join(dir, ".credentials.yaml"), "utf8");
      expect(credentials).toContain("sk-relay");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeOpenCodeGoDshHome", () => {
  it("writes the opencode-go provider tuple the catalog id resolves to", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-go-"));
    try {
      writeOpenCodeGoDshHome({
        isolationDir: dir,
        apiKey: "sk-go",
        modelId: "opencode-go/deepseek-v4.1-flash",
        sessionId: "craftstation-t1",
      });
      const settings = readFileSync(join(dir, "settings.yaml"), "utf8");
      // Provider id + bare leaf: the advertised tuple ["opencode-go","deepseek-v4.1-flash"]
      // aliases to the catalog id opencode-go/deepseek-v4.1-flash.
      expect(settings).toContain(`${OPENCODE_GO_DSH_PROVIDER_ID}:`);
      expect(settings).toContain("'deepseek-v4.1-flash'");
      expect(settings).not.toContain("opencode-go/deepseek");
      expect(settings).toContain(OPENCODE_GO_DSH_BASE_URL);
      // Go rejects requests without its session-routing header.
      expect(settings).toContain("x-opencode-session: 'craftstation-t1'");
      expect(settings).toContain(`provider: ${OPENCODE_GO_DSH_PROVIDER_ID}`);
      expect(settings).not.toContain("deepseek-official");
      expect(settings).not.toContain("sk-go");
      expect(readFileSync(join(dir, ".credentials.yaml"), "utf8")).toContain("sk-go");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("openCodeGoDshCompatEnv", () => {
  it("projects the Go key and endpoint onto the vendor env names", () => {
    expect(openCodeGoDshCompatEnv("sk-go")).toEqual({
      DEEPSEEK_API_KEY: "sk-go",
      DEEPSEEK_BASE_URL: OPENCODE_GO_DSH_BASE_URL,
      OPENAI_API_KEY: "sk-go",
      OPENAI_BASE_URL: OPENCODE_GO_DSH_BASE_URL,
      DSH_TELEMETRY_DISABLED: "1",
    });
    expect(openCodeGoDshCompatEnv("sk-go", "C:\\tmp\\dsh-go")).toMatchObject({
      DSH_HOME: "C:\\tmp\\dsh-go",
    });
    expect(OPENCODE_GO_DSH_BASE_URL).toContain("opencode.ai/zen/go/v1");
  });
});

describe("dshForeignCompatEnv", () => {
  it("points the DeepSeek route env at the channel base URL", () => {
    expect(dshForeignCompatEnv("sk", "C:\\iso", "https://ep/v1")).toEqual({
      DEEPSEEK_API_KEY: "sk",
      DEEPSEEK_BASE_URL: "https://ep/v1",
      OPENAI_API_KEY: "sk",
      OPENAI_BASE_URL: "https://ep/v1",
      DSH_TELEMETRY_DISABLED: "1",
      DSH_HOME: "C:\\iso",
    });
  });
});
