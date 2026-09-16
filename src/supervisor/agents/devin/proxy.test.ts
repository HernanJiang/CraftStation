import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultDevinUserConfigPath,
  devinProxySpawnEnv,
  ensureDevinUserProxyConfig,
  isDevinTeamSettingsTimeoutError,
  resetDevinProxyConfigMemo,
  resolveDevinTeamSettingsRetryPolicy,
} from "./proxy";

afterEach(() => {
  resetDevinProxyConfigMemo();
});

describe("isDevinTeamSettingsTimeoutError", () => {
  it("matches the ACP session/new fail-closed payload", () => {
    expect(
      isDevinTeamSettingsTimeoutError(
        RequestError.internalError({
          message:
            "Failed to load team settings: Failed to fetch team settings: fetch timed out after 10000ms",
        }),
      ),
    ).toBe(true);
    expect(
      isDevinTeamSettingsTimeoutError(
        new Error("Failed to fetch team settings: fetch timed out after 10000ms"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated internal errors", () => {
    expect(isDevinTeamSettingsTimeoutError(RequestError.internalError())).toBe(false);
    expect(isDevinTeamSettingsTimeoutError(new Error("MCP server transport is unsupported"))).toBe(
      false,
    );
    expect(isDevinTeamSettingsTimeoutError(new Error("Failed to load team settings"))).toBe(false);
  });
});

describe("resolveDevinTeamSettingsRetryPolicy", () => {
  it("defaults to three retries with exponential backoff", () => {
    expect(resolveDevinTeamSettingsRetryPolicy({})).toEqual({
      maxAttempts: 4,
      initialDelayMs: 500,
    });
  });

  it("allows bounded environment overrides", () => {
    expect(
      resolveDevinTeamSettingsRetryPolicy({
        CRAFTSTATION_DEVIN_TEAM_SETTINGS_RETRIES: "2",
        CRAFTSTATION_DEVIN_TEAM_SETTINGS_BACKOFF_MS: "750",
      }),
    ).toEqual({ maxAttempts: 3, initialDelayMs: 750 });
    expect(
      resolveDevinTeamSettingsRetryPolicy({
        CRAFTSTATION_DEVIN_TEAM_SETTINGS_RETRIES: "99",
        CRAFTSTATION_DEVIN_TEAM_SETTINGS_BACKOFF_MS: "999999",
      }),
    ).toEqual({ maxAttempts: 6, initialDelayMs: 10_000 });
  });
});

describe("devinProxySpawnEnv", () => {
  it("copies HTTP_PROXY into the spawn map Devin's reqwest client reads", () => {
    expect(
      devinProxySpawnEnv({
        HTTP_PROXY: "http://127.0.0.1:7897",
        NO_PROXY: "localhost,127.0.0.1",
      }),
    ).toMatchObject({
      HTTP_PROXY: "http://127.0.0.1:7897",
      HTTPS_PROXY: "http://127.0.0.1:7897",
      ALL_PROXY: "http://127.0.0.1:7897",
      NO_PROXY: "localhost,127.0.0.1",
    });
  });

  it("returns undefined when no proxy is configured", () => {
    expect(devinProxySpawnEnv({})).toBeUndefined();
  });

  it("rewrites SOCKS URLs to HTTP CONNECT because Devin rejects socks5", () => {
    expect(
      devinProxySpawnEnv({
        ALL_PROXY: "socks5://127.0.0.1:7897",
      }),
    ).toMatchObject({
      HTTP_PROXY: "http://127.0.0.1:7897",
      HTTPS_PROXY: "http://127.0.0.1:7897",
    });
  });
});

describe("ensureDevinUserProxyConfig", () => {
  it("writes proxy.mode=manual when the user config has no proxy block", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-proxy-"));
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ version: 1, theme_mode: "dark" }), "utf8");

    const result = ensureDevinUserProxyConfig({
      configPath,
      env: { HTTP_PROXY: "http://127.0.0.1:7897", NO_PROXY: "localhost" },
    });
    expect(result).toMatchObject({ applied: true, url: "http://127.0.0.1:7897" });
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      version: 1,
      theme_mode: "dark",
      proxy: { mode: "manual", url: "http://127.0.0.1:7897", no_proxy: "localhost" },
    });
  });

  it("does not overwrite an explicit manual URL or proxy.mode=off", () => {
    const dir = mkdtempSync(join(tmpdir(), "devin-proxy-"));
    const manualPath = join(dir, "manual.json");
    writeFileSync(
      manualPath,
      JSON.stringify({ proxy: { mode: "manual", url: "http://corp:8080" } }),
      "utf8",
    );
    expect(
      ensureDevinUserProxyConfig({
        configPath: manualPath,
        env: { HTTP_PROXY: "http://127.0.0.1:7897" },
      }),
    ).toMatchObject({ applied: false, reason: "already-manual" });
    expect(JSON.parse(readFileSync(manualPath, "utf8")).proxy.url).toBe("http://corp:8080");

    const offPath = join(dir, "off.json");
    writeFileSync(offPath, JSON.stringify({ proxy: { mode: "off" } }), "utf8");
    expect(
      ensureDevinUserProxyConfig({
        configPath: offPath,
        env: { HTTP_PROXY: "http://127.0.0.1:7897" },
      }),
    ).toMatchObject({ applied: false, reason: "user-disabled" });
  });

  it("points Windows users at %APPDATA%\\devin\\config.json", () => {
    expect(defaultDevinUserConfigPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" })).toMatch(
      /devin[\\/]config\.json$/i,
    );
  });
});
