import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installMainFileLogger } from "./mainFileLogger";

const cleanup: string[] = [];
const savedError = console.error;
const savedWarn = console.warn;

afterEach(() => {
  console.error = savedError;
  console.warn = savedWarn;
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function newLogsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "craftstation-mainlog-"));
  cleanup.push(dir);
  return join(dir, "logs");
}

describe("installMainFileLogger", () => {
  it("mirrors console warnings and errors with timestamps into logs/main.log", () => {
    const logsDir = newLogsDir();
    installMainFileLogger(logsDir);

    console.warn("watch out");
    console.error("[craftstation] boom:", new Error("detail"));
    console.error({ code: "E_TEST" });

    const lines = readFileSync(join(logsDir, "main.log"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z WARN watch out$/);
    expect(lines[1]).toContain("ERROR [craftstation] boom: Error: detail");
    expect(lines[2]).toContain('ERROR {"code":"E_TEST"}');
  });

  it("rotates main.log once it passes the size cap", () => {
    const logsDir = newLogsDir();
    installMainFileLogger(logsDir);
    const logPath = join(logsDir, "main.log");
    // Seed an oversized log so the next append triggers rotation.
    writeFileSync(logPath, "x".repeat(600 * 1024));

    console.error("trigger rotation");

    expect(statSync(`${logPath}.1`).size).toBe(600 * 1024);
    const fresh = readFileSync(logPath, "utf8");
    expect(fresh).toContain("trigger rotation");
    expect(statSync(logPath).size).toBeLessThan(600 * 1024);
  });
});
