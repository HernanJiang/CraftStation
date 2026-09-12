import { join } from "node:path";

export interface BridgeBinaryResolutionInput {
  /** Raw `CLIPROXY_BINARY_PATH` value (highest priority when it exists). */
  envBinaryPath?: string | undefined;
  /** `process.platform` — decides the executable file name. */
  platform: string;
  /** Working directory anchoring the bundled-sidecar candidate. */
  cwd: string;
  existsSync: (path: string) => boolean;
  /** PATH lookup (e.g. the supervisor's `resolveExecutablePath`). */
  resolveOnPath: (command: string) => string | undefined;
}

export interface BridgeBinaryResolution {
  /** Resolved executable, or undefined when nothing was found. */
  binaryPath?: string | undefined;
  /** Every location that was considered, in priority order. */
  searched: string[];
  /** File names probed on PATH and inside the bundled folder. */
  fileNames: string[];
  /** Bundled-sidecar folder probed under `cwd`. */
  bundledDir: string;
}

/**
 * Locate the CLIProxyAPI sidecar binary without launching anything.
 *
 * Priority: `CLIPROXY_BINARY_PATH` env → PATH (`cliproxyapi[.exe]`) →
 * bundled `<cwd>/.tools/cpa/` (the layout the compatibility e2e fixture
 * expects; the folder is release binaries only and stays out of git).
 * Upstream naming differs between the release artifact (`cli-proxy-api`) and
 * the PATH command (`cliproxyapi`), so both names are probed in the bundled
 * folder. A missing binary is a normal, reportable state — callers turn
 * `searched` into remediation text instead of a bare failure.
 */
export function resolveCompatibilityBridgeBinary(
  input: BridgeBinaryResolutionInput,
): BridgeBinaryResolution {
  const onPathCommand = input.platform === "win32" ? "cliproxyapi.exe" : "cliproxyapi";
  const fileNames =
    input.platform === "win32" ? ["cli-proxy-api.exe", "cliproxyapi.exe"] : ["cli-proxy-api"];
  const bundledDir = join(input.cwd, ".tools", "cpa");
  const bundledCandidates = fileNames.map((fileName) => join(bundledDir, fileName));
  const searched: string[] = [];
  if (input.envBinaryPath?.trim()) searched.push(input.envBinaryPath.trim());
  searched.push(`PATH:${onPathCommand}`, ...bundledCandidates);
  const envPath = input.envBinaryPath?.trim();
  const onPath = input.resolveOnPath(onPathCommand);
  const bundledHit = bundledCandidates.find((candidate) => input.existsSync(candidate));
  const binaryPath =
    envPath && input.existsSync(envPath) ? envPath : (onPath ?? bundledHit);
  return {
    ...(binaryPath ? { binaryPath } : {}),
    searched,
    fileNames,
    bundledDir,
  };
}
