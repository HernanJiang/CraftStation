import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CraftingError } from "@/shared/crafting/errors";

export interface ResolvedCodexBinary {
  path: string;
  source: "env" | "path" | "localappdata" | "wellknown" | "fallback";
  version?: string | undefined;
}

export class CodexBinaryResolver {
  static resolve(explicitPath?: string): ResolvedCodexBinary {
    if (explicitPath && fs.existsSync(explicitPath)) {
      try {
        const version = this.getBinaryVersion(explicitPath);
        return { path: explicitPath, source: "env", version };
      } catch {
        // ignore and fallback
      }
    }

    if (process.env.CODEX_BINARY_PATH && fs.existsSync(process.env.CODEX_BINARY_PATH)) {
      try {
        const version = this.getBinaryVersion(process.env.CODEX_BINARY_PATH);
        return { path: process.env.CODEX_BINARY_PATH, source: "env", version };
      } catch {
        // ignore and continue
      }
    }

    // 1. Check LOCALAPPDATA OpenAI Codex bin directories (First priority on Windows)
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA ?? "";
      if (localAppData) {
        const openAiBinDir = path.join(localAppData, "OpenAI", "Codex", "bin");
        if (fs.existsSync(openAiBinDir)) {
          try {
            const subdirs = fs.readdirSync(openAiBinDir);
            for (const sub of subdirs) {
              const candidate = path.join(openAiBinDir, sub, "codex.exe");
              if (fs.existsSync(candidate)) {
                try {
                  const version = this.getBinaryVersion(candidate);
                  return { path: candidate, source: "localappdata", version };
                } catch {
                  // ignore candidate if execution fails
                }
              }
            }
          } catch {
            // ignore scan failure
          }
        }
      }
    }

    // 2. Check system PATH via `where.exe` or `which`
    try {
      const isWin = process.platform === "win32";
      const cmd = isWin ? "where.exe" : "which";
      const stdout = execFileSync(cmd, ["codex"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (const line of lines) {
        if (fs.existsSync(line)) {
          try {
            const version = this.getBinaryVersion(line);
            return { path: line, source: "path", version };
          } catch {
            // skip candidates that throw permissions or execution errors
          }
        }
      }
    } catch {
      // ignore lookup failures
    }

    // 3. Check other well-known directories
    const wellKnownCandidates: string[] = [];
    if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA ?? "";
      if (localAppData) {
        wellKnownCandidates.push(path.join(localAppData, "Programs", "codex", "codex.exe"));
      }
    } else {
      wellKnownCandidates.push(
        "/usr/local/bin/codex",
        "/usr/bin/codex",
        path.join(process.env.HOME ?? "", ".local/bin/codex"),
      );
    }

    for (const candidate of wellKnownCandidates) {
      if (fs.existsSync(candidate)) {
        try {
          const version = this.getBinaryVersion(candidate);
          return { path: candidate, source: "wellknown", version };
        } catch {
          // ignore
        }
      }
    }

    // Default fallback name
    const fallbackPath = process.platform === "win32" ? "codex.exe" : "codex";
    return { path: fallbackPath, source: "fallback" };
  }

  static getBinaryVersion(binaryPath: string): string {
    const stdout = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    return stdout;
  }

  static assertAvailable(explicitPath?: string): ResolvedCodexBinary {
    const resolved = this.resolve(explicitPath);
    if (!resolved.version) {
      try {
        resolved.version = this.getBinaryVersion(resolved.path);
      } catch (err) {
        throw CraftingError.runtimeUnavailable(
          "codex",
          `Official Codex binary is not accessible or not executable: ${resolved.path} (${err instanceof Error ? err.message : String(err)})`,
          "Please verify that official OpenAI Codex CLI is installed and has execute permissions.",
        );
      }
    }
    return resolved;
  }
}
