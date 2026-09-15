import { appendFileSync, mkdirSync, renameSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

const MAX_LOG_BYTES = 512 * 1024;
const ROTATED_LOG_PATHS = 2;

/**
 * Mirror main-process console warnings/errors into `logs/main.log`.
 *
 * Packaged builds have no attached console, so a launch that fails before any
 * crash reporter sees it (e.g. a black window with a dead renderer) otherwise
 * leaves zero evidence. Warnings and errors already carry the stable
 * `phase`/`operation`/`code` wording the codebase logs with, and never contain
 * credentials, so mirroring them keeps the same redaction guarantees.
 */
export function installMainFileLogger(logsDir: string): void {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    return;
  }
  const logPath = join(logsDir, "main.log");
  const rotateIfNeeded = () => {
    let size = 0;
    try {
      size = statSync(logPath).size;
    } catch {
      return; // missing file — nothing to rotate
    }
    if (size < MAX_LOG_BYTES) return;
    try {
      const oldest = `${logPath}.${ROTATED_LOG_PATHS}`;
      rmSync(oldest, { force: true });
      for (let i = ROTATED_LOG_PATHS - 1; i >= 1; i--) {
        try {
          renameSync(`${logPath}.${i}`, `${logPath}.${i + 1}`);
        } catch {
          // missing generation — skip
        }
      }
      renameSync(logPath, `${logPath}.1`);
    } catch {
      // rotation is best-effort; keep appending to the oversized file
    }
  };
  const append = (line: string) => {
    try {
      rotateIfNeeded();
      appendFileSync(logPath, line);
    } catch {
      // Logging must never take the app down.
    }
  };
  const mirror = (level: "warn" | "error") => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const timestamp = new Date().toISOString();
      const rendered = args
        .map((arg) => {
          if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
          if (typeof arg === "string") return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(" ");
      append(`${timestamp} ${level.toUpperCase()} ${rendered}\n`);
    };
  };
  mirror("warn");
  mirror("error");
}
