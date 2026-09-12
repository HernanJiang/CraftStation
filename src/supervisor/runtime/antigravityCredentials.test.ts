import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@craftstation/agents-usage";
import { setUsageSecret } from "@/shared/usageSecretStore";
import {
  clearAntigravityAdcCredential,
  materializeAntigravityAdcCredential,
  refreshStoredAntigravityToken,
  writeAntigravityAdcCredential,
} from "./antigravityCredentials";

const cacheDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const cacheDir of cacheDirs.splice(0)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

describe("refreshStoredAntigravityToken", () => {
  it("serializes concurrent refreshes for the same stored account", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "craftstation-antigravity-refresh-"));
    cacheDirs.push(cacheDir);
    setUsageSecret(cacheDir, "antigravity", "refreshToken", "refresh-secret");

    let release: (() => void) | undefined;
    const request = vi.fn<HttpClient["request"]>(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              status: 200,
              headers: {},
              body: JSON.stringify({
                access_token: "fresh-access",
                expires_in: 3600,
                token_type: "Bearer",
              }),
            });
        }),
    );
    const httpClient: HttpClient = { request };

    const first = refreshStoredAntigravityToken(cacheDir, "antigravity", httpClient);
    const second = refreshStoredAntigravityToken(cacheDir, "antigravity", httpClient);
    expect(request).toHaveBeenCalledTimes(1);
    release?.();

    const [left, right] = await Promise.all([first, second]);
    expect(left?.accessToken).toBe("fresh-access");
    expect(right?.accessToken).toBe("fresh-access");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("materializeAntigravityAdcCredential", () => {
  it("publishes the bucket refresh token as an authorized_user ADC file", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "craftstation-antigravity-adc-"));
    cacheDirs.push(cacheDir);
    const root = mkdtempSync(join(tmpdir(), "craftstation-antigravity-adc-root-"));
    cacheDirs.push(root);
    setUsageSecret(cacheDir, "antigravity:acct-1", "refreshToken", "refresh-secret");

    const path = materializeAntigravityAdcCredential(cacheDir, "antigravity:acct-1", root);

    expect(path).toBe(join(root, "adc", "authorized_user.json"));
    const parsed = JSON.parse(readFileSync(path!, "utf8")) as Record<string, string>;
    expect(parsed.type).toBe("authorized_user");
    expect(parsed.refresh_token).toBe("refresh-secret");
    expect(parsed.client_id).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(parsed.client_secret).toMatch(/^GOCSPX-/);
    // The pid-suffixed staging file must not survive the atomic rename.
    expect(readdirSync(join(root, "adc")).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("returns undefined and writes nothing when the bucket has no refresh token", () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "craftstation-antigravity-adc-"));
    cacheDirs.push(cacheDir);
    const root = mkdtempSync(join(tmpdir(), "craftstation-antigravity-adc-root-"));
    cacheDirs.push(root);
    setUsageSecret(cacheDir, "antigravity:acct-2", "accessToken", "access-only");

    expect(
      materializeAntigravityAdcCredential(cacheDir, "antigravity:acct-2", root),
    ).toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
  });

  it("writes and clears a durable ADC file from a plaintext refresh token", () => {
    const root = mkdtempSync(join(tmpdir(), "craftstation-antigravity-adc-root-"));
    cacheDirs.push(root);
    const path = writeAntigravityAdcCredential(root, "plain-refresh");
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      type: "authorized_user",
      refresh_token: "plain-refresh",
    });
    clearAntigravityAdcCredential(root);
    expect(() => readFileSync(path, "utf8")).toThrow(/ENOENT|no such file/i);
  });
});
