import { mkdtempSync, rmSync, statSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  primeAntigravityUpdateCheckTimestamp,
  startAntigravityUpdateGateKeeper,
} from "./updateGate";

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agy-gate-"));
  filePath = join(dir, "last_check.timestamp");
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe("primeAntigravityUpdateCheckTimestamp", () => {
  it("freshens an existing timestamp file", () => {
    writeFileSync(filePath, "");
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(filePath, stale, stale);
    primeAntigravityUpdateCheckTimestamp({ filePath });
    expect(statSync(filePath).mtimeMs).toBeGreaterThan(Date.now() - 10_000);
  });

  it("creates the file when it does not exist", () => {
    rmSync(filePath, { force: true });
    primeAntigravityUpdateCheckTimestamp({ filePath });
    expect(statSync(filePath).mtimeMs).toBeGreaterThan(Date.now() - 10_000);
  });
});

describe("startAntigravityUpdateGateKeeper", () => {
  it("primes immediately and refreshes on the interval", () => {
    vi.useFakeTimers();
    writeFileSync(filePath, "");
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(filePath, stale, stale);

    const stop = startAntigravityUpdateGateKeeper({ filePath, intervalMs: 5 * 60 * 1000 });
    // Immediate prime: fresh despite the stale mtime.
    expect(statSync(filePath).mtimeMs).toBeGreaterThan(Date.now() - 10_000);

    // Age the file, advance past the interval — keeper refreshes it again.
    vi.setSystemTime(Date.now() + 20 * 60 * 1000);
    const aged = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(filePath, aged, aged);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(statSync(filePath).mtimeMs).toBeGreaterThan(Date.now() - 10_000);

    // Stopping the keeper leaves the file stale after further intervals.
    stop();
    utimesSync(filePath, aged, aged);
    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(statSync(filePath).mtimeMs).toBeLessThan(Date.now() - 30 * 60 * 1000);
  });
});
