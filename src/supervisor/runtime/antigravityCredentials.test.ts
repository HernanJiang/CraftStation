import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpClient } from "@craftstation/agents-usage";
import { setUsageSecret } from "@/shared/usageSecretStore";
import { refreshStoredAntigravityToken } from "./antigravityCredentials";

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
