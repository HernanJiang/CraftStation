import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { CompatibilityBridgeService } from "./bridge";
import {
  exportOpenCodeCompatibility,
  exportCodexCompatibility,
  exportKimiCompatibility,
  exportGrokCompatibility,
  exportAntigravityCompatibility,
  exportMuseCompatibility,
  exportDeepseekCompatibility,
  exportCompatibilityForHarness,
} from "./exporters";
import type { SpawnFunction, FetchFunction } from "./types";

describe("CompatibilityBridgeService & Exporters", () => {
  afterEach(() => vi.unstubAllEnvs());
  function createMockProcess(): ChildProcess {
    const proc = new EventEmitter() as any;
    proc.pid = 12345;
    proc.exitCode = null;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn<(signal?: NodeJS.Signals | number) => boolean>((signal) => {
      proc.exitCode = 0;
      proc.emit("exit", 0, signal);
      return true;
    });
    return proc as unknown as ChildProcess;
  }

  it("manages loopback bridge status, mock process lifecycle, and account pinning", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn<SpawnFunction>(
      (_cmd: string, _args: string[], _opts: SpawnOptions) => mockProc,
    );
    const mockFetch = vi.fn<FetchFunction>(async (_url: string | URL, _init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
      } as Response;
    });

    const service = new CompatibilityBridgeService({
      port: 8319,
      resolveBinaryFn: () => "C:/bundled/cliproxyapi.exe",
      spawnFn: mockSpawn,
      fetchFn: mockFetch,
    });
    expect(service.getStatus().running).toBe(false);

    service.pinAccount({
      accountId: "acc-test-1",
      credentialNamespace: "openai_personal",
      authDir: "D:/Work/CraftStation/.craftstation/accounts/acc-test-1",
    });

    expect(service.getPinnedAccount()?.accountId).toBe("acc-test-1");

    const started = await service.start();
    expect(started.running).toBe(true);
    expect(started.endpoint).toBe("http://127.0.0.1:8319");
    expect(started.pinnedAccountId).toBe("acc-test-1");
    expect(started.pid).toBe(12345);
    expect(mockSpawn).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();

    await service.stop();
    expect(service.getStatus().running).toBe(false);
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });
  it.each([undefined, "socks5://127.0.0.1:29002"])(
    "projects the app proxy into CPA YAML with explicit override %s",
    async (override) => {
      vi.stubEnv("https_proxy", "http://127.0.0.1:29001");
      vi.stubEnv("CLIPROXY_PROXY_URL", undefined);
      const spawn = vi.fn<SpawnFunction>(() => createMockProcess());
      const bridge = new CompatibilityBridgeService({
        port: 18392,
        proxyUrl: override,
        spawnFn: spawn,
        resolveBinaryFn: () => "fixture",
        fetchFn: async () => ({ status: 200 }) as Response,
      });
      await bridge.start();
      const config = readFileSync(spawn.mock.calls[0]![1]![1]!, "utf8");
      expect(config).toContain(
        `proxy-url: ${JSON.stringify(override ?? "http://127.0.0.1:29001")}`,
      );
      await bridge.stop();
    },
  );
  it("shares startup, refuses account changes mid-start, and stops after the last borrower", async () => {
    const proc = createMockProcess();
    const spawn = vi.fn<SpawnFunction>(() => proc);
    const bridge = new CompatibilityBridgeService({
      port: 18391,
      spawnFn: spawn,
      resolveBinaryFn: () => "fixture-cpa",
      fetchFn: async () => ({ status: 200 }) as Response,
    });
    const a = {};
    const b = {};
    bridge.pinAccount({ accountId: "one", credentialNamespace: "fixture", authDir: "fixture-one" });
    bridge.configure({ binaryPath: "fixture-cpa", authDir: "fixture-one" });
    bridge.retain(a);
    bridge.retain(b);
    const starting = bridge.start();
    expect(() =>
      bridge.configure({ binaryPath: "fixture-cpa", authDir: "fixture-one" }),
    ).not.toThrow();
    expect(() => bridge.configure({ authDir: "fixture-two" })).toThrow("Cannot reconfigure");
    expect(() =>
      bridge.pinAccount({
        accountId: "two",
        credentialNamespace: "fixture",
        authDir: "fixture-two",
      }),
    ).toThrow("Cannot re-pin");
    await Promise.all([starting, bridge.start()]);
    expect(spawn).toHaveBeenCalledOnce();
    await bridge.release(a);
    expect(bridge.getStatus().running).toBe(true);
    await bridge.release(b);
    expect(bridge.getStatus().running).toBe(false);
    expect(() =>
      bridge.pinAccount({
        accountId: "two",
        credentialNamespace: "fixture",
        authDir: "fixture-two",
      }),
    ).not.toThrow();
  });

  it("fails closed when readiness probe times out or process exits early", async () => {
    const mockProc = createMockProcess();
    (mockProc as any).exitCode = 1; // already exited
    const mockSpawn = vi.fn<SpawnFunction>(
      (_cmd: string, _args: string[], _opts: SpawnOptions) => mockProc,
    );
    const mockFetch = vi.fn<FetchFunction>(async (_url: string | URL, _init?: RequestInit) => {
      throw new Error("ECONNREFUSED");
    });

    const service = new CompatibilityBridgeService({
      port: 8320,
      probeTimeoutMs: 150,
      resolveBinaryFn: () => "C:/bundled/cliproxyapi.exe",
      spawnFn: mockSpawn,
      fetchFn: mockFetch,
    });

    await expect(service.start()).rejects.toThrow(/exited prematurely/);
    expect(service.getStatus().running).toBe(false);
  });

  it("exports configuration for OpenCode, Codex, Kimi, Grok, and Antigravity without secret leakage", () => {
    const status = {
      running: true,
      host: "127.0.0.1",
      port: 8317,
      endpoint: "http://127.0.0.1:8317",
      pinnedAccountId: "acc-1",
      apiKey: "cs-key-123",
    };

    const opencode = exportOpenCodeCompatibility(status, "gpt-5.3-codex");
    expect(opencode.harnessKind).toBe("opencode");
    expect(opencode.baseUrl).toBe("http://127.0.0.1:8317/v1");
    expect(opencode.apiKey).toBe("cs-key-123");

    const codex = exportCodexCompatibility(status, "grok-3");
    expect(codex.harnessKind).toBe("codex");
    expect(codex.protocol).toBe("responses");
    expect(codex.customEnv.CODEX_BASE_URL).toBe("http://127.0.0.1:8317/v1");

    const kimi = exportKimiCompatibility(status, "gpt-5");
    expect(kimi.harnessKind).toBe("kimi");
    expect(kimi.protocol).toBe("openai_responses");

    const grok = exportGrokCompatibility(status, "claude-3-7-sonnet");
    expect(grok.harnessKind).toBe("grok");

    const antigravity = exportAntigravityCompatibility(status, "gpt-5");
    expect(antigravity.harnessKind).toBe("antigravity");
    expect(antigravity.baseUrl).toBe("http://127.0.0.1:8317/v1beta");

    const generic = exportCompatibilityForHarness("antigravity", status, "gpt-5");
    expect(generic.protocol).toBe("gemini-compatible");

    const muse = exportMuseCompatibility(status, "grok-4.3");
    expect(muse.harnessKind).toBe("muse");
    expect(muse.protocol).toBe("responses");
    expect(muse.baseUrl).toBe("http://127.0.0.1:8317/v1");
    expect(muse.customEnv.CRAFTSTATION_MUSE_BASE_URL).toBe("http://127.0.0.1:8317/v1");

    const deepseek = exportDeepseekCompatibility(status, "grok-4.3");
    expect(deepseek.harnessKind).toBe("deepseek");
    expect(deepseek.customEnv.DEEPSEEK_BASE_URL).toBe("http://127.0.0.1:8317/v1");
    expect(exportCompatibilityForHarness("muse", status, "grok-4.3").harnessKind).toBe("muse");
    expect(exportCompatibilityForHarness("deepseek", status, "grok-4.3").harnessKind).toBe(
      "deepseek",
    );
  });

  it("does not treat unauthorized or missing bridge state as executable", async () => {
    const unauthorizedFetch = vi.fn<FetchFunction>(
      async () =>
        ({
          ok: false,
          status: 401,
        }) as Response,
    );
    const service = new CompatibilityBridgeService({
      port: 8321,
      probeTimeoutMs: 10,
      resolveBinaryFn: () => "C:/bundled/cliproxyapi.exe",
      spawnFn: vi.fn<SpawnFunction>(() => createMockProcess()),
      fetchFn: unauthorizedFetch,
    });
    expect(() => exportOpenCodeCompatibility(service.getStatus(), "model")).toThrow(
      /exporter unavailable/i,
    );
    await expect(service.start()).rejects.toThrow(/failed to become ready/i);
  });
});
