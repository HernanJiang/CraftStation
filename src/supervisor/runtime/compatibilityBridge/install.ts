import { execFile } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Readable } from "node:stream";

const execFileAsync = promisify(execFile);
const CPA_GITHUB_REPO = "router-for-me/CLIProxyAPI";
const CPA_USER_AGENT = "CraftStation-CLIProxyAPI-installer";

export interface CliProxyReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface InstallCompatibilityBridgeInput {
  destDir: string;
  platform?: string | undefined;
  arch?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  now?: number | undefined;
}

/**
 * Pick the official CLIProxyAPI archive for this host. Windows amd64 is the
 * tracer; arm64 and POSIX follow the same `OS_ARCH` naming the upstream
 * GitHub releases use.
 */
export function pickCliProxyReleaseAsset(
  assets: readonly CliProxyReleaseAsset[],
  platform: string,
  arch: string,
): CliProxyReleaseAsset | undefined {
  const os =
    platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
  const cpu = arch === "arm64" ? "arm64" : "amd64";
  const cpuAliases = cpu === "amd64" ? ["amd64", "x86_64", "x64"] : ["arm64", "aarch64"];
  const archives = assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz");
  });
  const matching = archives.filter((asset) => {
    const name = asset.name.toLowerCase();
    if (!name.includes(os) && !(os === "windows" && /win(32|64)?/.test(name))) return false;
    if (cpu === "amd64" && /arm/.test(name)) return false;
    return cpuAliases.some((alias) => name.includes(alias));
  });
  return matching[0] ?? archives.find((asset) => asset.name.toLowerCase().includes(os));
}

export function compatibilityBridgeUserToolsDir(baseDir: string): string {
  return join(baseDir, "tools", "cpa");
}

function installedBinaryName(platform: string): string {
  return platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api";
}

function findExtractedBinary(root: string, platform: string): string | undefined {
  const wanted = new Set(
    platform === "win32"
      ? ["cli-proxy-api.exe", "cliproxyapi.exe", "cliproxyapi"]
      : ["cli-proxy-api", "cliproxyapi"],
  );
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entryName of names) {
      const full = join(dir, entryName);
      try {
        if (statSync(full).isDirectory()) {
          stack.push(full);
          continue;
        }
      } catch {
        continue;
      }
      const name = entryName.toLowerCase();
      if (wanted.has(name) || name.startsWith("cliproxyapi") || name.startsWith("cli-proxy-api")) {
        return full;
      }
    }
  }
  return undefined;
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      await execFileAsync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-Command",
          "Expand-Archive -LiteralPath $env:CRAFTSTATION_CPA_ARCHIVE -DestinationPath $env:CRAFTSTATION_CPA_DEST -Force",
        ],
        {
          windowsHide: true,
          env: {
            ...process.env,
            CRAFTSTATION_CPA_ARCHIVE: archivePath,
            CRAFTSTATION_CPA_DEST: destDir,
          },
        },
      );
      return;
    }
    await execFileAsync("unzip", ["-q", "-o", archivePath, "-d", destDir], { windowsHide: true });
    return;
  }
  await execFileAsync("tar", ["-xf", archivePath, "-C", destDir], { windowsHide: true });
}

/**
 * Download the official CLIProxyAPI release into `destDir` and return the
 * executable path. Existing files in the dest dir are replaced.
 */
export async function installCliProxyApiBinary(
  input: InstallCompatibilityBridgeInput,
): Promise<string> {
  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const fetchImpl = input.fetchImpl ?? fetch;
  const destDir = input.destDir;
  mkdirSync(destDir, { recursive: true });

  const response = await fetchImpl(
    `https://api.github.com/repos/${CPA_GITHUB_REPO}/releases/latest`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": CPA_USER_AGENT } },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to look up CLIProxyAPI releases (${response.status}). Check network access to GitHub.`,
    );
  }
  const payload = (await response.json()) as { assets?: CliProxyReleaseAsset[]; tag_name?: string };
  const asset = pickCliProxyReleaseAsset(payload.assets ?? [], platform, arch);
  if (!asset) {
    throw new Error(
      `CLIProxyAPI ${payload.tag_name ?? "latest"} has no ${platform}/${arch} release asset.`,
    );
  }

  const archiveResponse = await fetchImpl(asset.browser_download_url, {
    headers: { "User-Agent": CPA_USER_AGENT, Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!archiveResponse.ok || !archiveResponse.body) {
    throw new Error(
      `Failed to download ${asset.name} (${archiveResponse.status}).`,
    );
  }

  const stamp = String(input.now ?? Date.now());
  const staging = join(tmpdir(), `craftstation-cpa-${stamp}`);
  mkdirSync(staging, { recursive: true });
  const archivePath = join(staging, asset.name);
  const extractDir = join(staging, "extracted");
  mkdirSync(extractDir, { recursive: true });
  try {
    const body = archiveResponse.body as unknown;
    const nodeStream =
      typeof Readable.fromWeb === "function" && body && typeof body === "object"
        ? Readable.fromWeb(body as import("node:stream/web").ReadableStream)
        : (body as NodeJS.ReadableStream);
    await pipeline(nodeStream, createWriteStream(archivePath));
    await extractArchive(archivePath, extractDir);
    const found = findExtractedBinary(extractDir, platform);
    if (!found) {
      throw new Error(`Extracted ${asset.name} but no CLIProxyAPI executable was inside.`);
    }
    const target = join(destDir, installedBinaryName(platform));
    if (existsSync(target)) rmSync(target, { force: true });
    try {
      renameSync(found, target);
    } catch {
      copyFileSync(found, target);
    }
    return target;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
