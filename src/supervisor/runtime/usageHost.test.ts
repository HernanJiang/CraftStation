import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeUsageHost } from "./usageHost";

/**
 * The OpenCode subscription server-fn id self-heal persists its dynamically
 * resolved id through `HostPort.serverIdCache`. These tests pin the file-backed
 * store's contract: writes survive a fresh host instance (app restart), and a
 * torn/missing file reads as absent instead of throwing.
 */
describe("createNodeUsageHost serverIdCache", () => {
  const dirs: string[] = [];
  const makeDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "usage-host-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("persists a written id across host instances (app restart)", () => {
    const cacheDir = makeDir();
    const first = createNodeUsageHost(cacheDir);
    first.serverIdCache?.write("opencode.subscription-server-id", "f".repeat(64));

    const second = createNodeUsageHost(cacheDir);
    expect(second.serverIdCache?.read("opencode.subscription-server-id")).toBe("f".repeat(64));
  });

  it("returns undefined for scopes never written and survives a torn file", () => {
    const cacheDir = makeDir();
    const host = createNodeUsageHost(cacheDir);
    expect(host.serverIdCache?.read("missing")).toBeUndefined();

    // A truncated/corrupt file must read as absent, not crash the usage scan.
    writeFileSync(join(cacheDir, "usage-server-ids.json"), "{not json", "utf8");
    expect(host.serverIdCache?.read("opencode.subscription-server-id")).toBeUndefined();
  });

  it("omits serverIdCache when no cacheDir is configured", () => {
    expect(createNodeUsageHost().serverIdCache).toBeUndefined();
  });
});
