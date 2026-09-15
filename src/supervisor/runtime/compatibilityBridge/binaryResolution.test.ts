import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import {
  isCompatibilityBridgeStartable,
  resolveCompatibilityBridgeBinary,
} from "./binaryResolution";

describe("resolveCompatibilityBridgeBinary", () => {
  it("prefers CLIPROXY_BINARY_PATH when the file exists", () => {
    const resolution = resolveCompatibilityBridgeBinary({
      envBinaryPath: "D:/tools/cli-proxy-api.exe",
      platform: "win32",
      cwd: "D:/Work/CraftStation",
      existsSync: () => true,
      resolveOnPath: () => undefined,
    });
    expect(resolution.binaryPath).toBe("D:/tools/cli-proxy-api.exe");
  });

  it("falls through to PATH and then the bundled .tools/cpa folder", () => {
    const existsSync = vi.fn<(path: string) => boolean>((path: string) =>
      path.endsWith("cli-proxy-api.exe"),
    );
    const resolution = resolveCompatibilityBridgeBinary({
      platform: "win32",
      cwd: "D:/Work/CraftStation",
      existsSync,
      resolveOnPath: () => undefined,
    });
    expect(resolution.binaryPath).toBe(
      join("D:/Work/CraftStation", ".tools", "cpa", "cli-proxy-api.exe"),
    );
    expect(resolution.searched).toContain("PATH:cliproxyapi.exe");
    expect(resolution.searched).toContain("PATH:cli-proxy-api.exe");
  });

  it("reports every searched location when nothing is found", () => {
    const resolution = resolveCompatibilityBridgeBinary({
      platform: "win32",
      cwd: "D:/Work/CraftStation",
      existsSync: () => false,
      resolveOnPath: () => undefined,
    });
    expect(resolution.binaryPath).toBeUndefined();
    expect(resolution.searched.length).toBeGreaterThan(0);
  });

  it("finds cli-proxy-api.exe on PATH when cliproxyapi.exe is absent", () => {
    const resolution = resolveCompatibilityBridgeBinary({
      platform: "win32",
      cwd: "D:/Work/CraftStation",
      existsSync: () => false,
      resolveOnPath: (command) =>
        command === "cli-proxy-api.exe" ? "C:/Go/bin/cli-proxy-api.exe" : undefined,
    });
    expect(resolution.binaryPath).toBe("C:/Go/bin/cli-proxy-api.exe");
  });

  it("probes extra search dirs after the cwd bundled folder", () => {
    const extra = join("D:/portable", "cpa", "cli-proxy-api.exe");
    const resolution = resolveCompatibilityBridgeBinary({
      platform: "win32",
      cwd: "D:/Work/CraftStation",
      existsSync: (path) => path === extra,
      resolveOnPath: () => undefined,
      extraSearchDirs: [join("D:/portable", "cpa")],
    });
    expect(resolution.binaryPath).toBe(extra);
  });

  it("treats an installed-but-idle sidecar as startable", () => {
    expect(isCompatibilityBridgeStartable({ running: false, binaryPath: "C:/cpa.exe" })).toBe(
      true,
    );
    expect(isCompatibilityBridgeStartable({ running: true })).toBe(true);
    expect(isCompatibilityBridgeStartable({ running: false })).toBe(false);
  });
});
