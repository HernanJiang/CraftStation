import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMANDCODE_DSH_PROVIDER_ID,
  COMMANDCODE_OPENAI_COMPAT_BASE_URL,
  commandCodeCompatEnv,
  commandCodeDshAcpModelId,
  parseCommandCodeApiKey,
  writeCommandCodeDshHome,
} from "./providerApi";

describe("commandcode provider API", () => {
  it("reads a non-empty apiKey from auth.json", () => {
    expect(parseCommandCodeApiKey(JSON.stringify({ apiKey: "cc-secret" }))).toBe("cc-secret");
    expect(parseCommandCodeApiKey(JSON.stringify({ apiKey: "  " }))).toBeUndefined();
    expect(parseCommandCodeApiKey("{")).toBeUndefined();
  });

  it("projects Command Code onto DeepSeek Harness env without rewriting the official DeepSeek host", () => {
    expect(commandCodeCompatEnv("cc-secret")).toEqual({
      DEEPSEEK_API_KEY: "cc-secret",
      DEEPSEEK_BASE_URL: COMMANDCODE_OPENAI_COMPAT_BASE_URL,
      OPENAI_API_KEY: "cc-secret",
      OPENAI_BASE_URL: COMMANDCODE_OPENAI_COMPAT_BASE_URL,
      DSH_TELEMETRY_DISABLED: "1",
    });
    expect(commandCodeCompatEnv("cc-secret", "C:\\tmp\\dsh-cc")).toMatchObject({
      DEEPSEEK_BASE_URL: COMMANDCODE_OPENAI_COMPAT_BASE_URL,
      DSH_HOME: "C:\\tmp\\dsh-cc",
    });
    expect(COMMANDCODE_OPENAI_COMPAT_BASE_URL).toContain("api.commandcode.ai");
  });

  it("addresses Command Code as a dsh ACP [provider, model] tuple, not deepseek-official", () => {
    expect(commandCodeDshAcpModelId("deepseek/deepseek-v4.1-flash")).toBe(
      JSON.stringify([COMMANDCODE_DSH_PROVIDER_ID, "deepseek/deepseek-v4.1-flash"]),
    );
    expect(commandCodeDshAcpModelId("commandcode/deepseek-v4-flash")).toBe(
      JSON.stringify([COMMANDCODE_DSH_PROVIDER_ID, "deepseek/deepseek-v4-flash"]),
    );
    expect(commandCodeDshAcpModelId("deepseek/deepseek-v4.1-flash")).not.toContain(
      "deepseek-official",
    );
  });

  it("rewrites commandcode/<leaf> catalog ids when writing the isolated dsh home", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-cc-"));
    try {
      writeCommandCodeDshHome({
        isolationDir: dir,
        apiKey: "cc-secret",
        modelId: "commandcode/deepseek-v4-flash",
      });
      const settings = readFileSync(join(dir, "settings.yaml"), "utf8");
      expect(settings).toContain("deepseek/deepseek-v4-flash");
      expect(settings).not.toContain("commandcode/deepseek-v4-flash");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes an isolated dsh home that registers Command Code instead of the official DeepSeek route", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-cc-"));
    try {
      writeCommandCodeDshHome({
        isolationDir: dir,
        apiKey: "cc-secret",
        modelId: "deepseek/deepseek-v4.1-flash",
      });
      const settings = readFileSync(join(dir, "settings.yaml"), "utf8");
      expect(settings).toContain("api.commandcode.ai/provider/v1");
      expect(settings).toContain("openai-completions");
      expect(settings).toContain("deepseek/deepseek-v4.1-flash");
      expect(settings).toContain(`provider: ${COMMANDCODE_DSH_PROVIDER_ID}`);
      expect(settings).not.toContain("deepseek-official");
      expect(settings).not.toContain("commandcode/deepseek");
      expect(settings).not.toContain("cc-secret");
      const credentials = readFileSync(join(dir, ".credentials.yaml"), "utf8");
      expect(credentials).toContain("cc-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can point the isolated dsh home at a local /alpha gateway", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-cc-"));
    try {
      writeCommandCodeDshHome({
        isolationDir: dir,
        apiKey: "user_2secret",
        modelId: "deepseek/deepseek-v4.1-flash",
        baseUrl: "http://127.0.0.1:9876/v1",
      });
      const settings = readFileSync(join(dir, "settings.yaml"), "utf8");
      expect(settings).toContain("http://127.0.0.1:9876/v1");
      expect(settings).not.toContain("api.commandcode.ai/provider/v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
