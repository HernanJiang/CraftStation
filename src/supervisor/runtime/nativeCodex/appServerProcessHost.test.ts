import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { AppServerProcessHost } from "./appServerProcessHost";
import {
  prepareCodexEndpointRuntime,
  prepareKimiEndpointRuntime,
} from "../compatibleEndpointRuntime";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn<typeof spawn>(),
}));
vi.mock("./codexBinaryResolver", () => ({
  CodexBinaryResolver: { assertAvailable: () => ({ path: "fixture-codex" }) },
}));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("provider endpoint survives actual process-host initialization", () => {
  it.each(["endpoint", "subscription"] as const)(
    "keeps %s routing isolated from host overlays",
    async (profileMode) => {
      const directory = mkdtempSync(join(tmpdir(), "cs-endpoint-"));
      roots.push(directory);
      const profile = prepareCodexEndpointRuntime({
        directory,
        baseUrl: "http://127.0.0.1:18317/v1",
        apiKey: "fixture-key",
      });
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stdin: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null,
        signalCode: null,
        killed: false,
        kill: () => {
          child.killed = true;
          child.emit("exit", 0, null);
          return true;
        },
      });
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
      vi.stubEnv("CODEX_MODEL_CATALOG", "host-router-catalog");
      vi.stubEnv("OPENAI_API_KEY", "unrelated-host-key");
      const host = new AppServerProcessHost({
        codexHome: directory,
        profileMode,
        env: { ...profile.env, CRAFTSTATION_MCP_FIXTURE: "injected" },
      });
      await host.start();
      const config = readFileSync(join(directory, "config.toml"), "utf8");
      expect(config).toContain(
        `model_provider = "${profileMode === "endpoint" ? "craftstation_openai_compatible" : "openai"}"`,
      );
      const env = vi.mocked(spawn).mock.calls.at(-1)?.[2]?.env;
      expect(env?.CODEX_HOME).toBe(directory);
      expect(env?.CRAFTSTATION_MCP_FIXTURE).toBe("injected");
      expect(env?.CODEX_MODEL_CATALOG || undefined).toBeUndefined();
      expect(env?.OPENAI_API_KEY || undefined).toBeUndefined();
      await host.stop();
    },
  );
  it("writes Kimi's provider/model contract with an exact slash-containing model alias", () => {
    const directory = mkdtempSync(join(tmpdir(), "cs-kimi-endpoint-"));
    roots.push(directory);
    const result = prepareKimiEndpointRuntime({
      directory,
      baseUrl: "http://127.0.0.1:18317/v1",
      apiKey: "fixture-key",
      model: "vendor/model",
      protocol: "responses",
    });
    expect(result.env.KIMI_CODE_HOME).toBe(directory);
    const config = readFileSync(join(directory, "config.toml"), "utf8");
    expect(config).toContain('[models."vendor/model"]');
    expect(config).toContain('type = "openai_responses"');
    expect(config).toContain('api_key = "fixture-key"');
    expect(config).toContain("max_context_size = 262144");
    expect(result.env.KIMI_MODEL_NAME).toBe("");
  });
});
