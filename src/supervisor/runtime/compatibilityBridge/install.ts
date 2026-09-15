import { execFile } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
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
import { ProxyAgent, fetch as undiciFetch } from "undici";

const execFileAsync = promisify(execFile);
const CPA_GITHUB_REPO = "router-for-me/CLIProxyAPI";
const CPA_USER_AGENT = "CraftStation-CLIProxyAPI-installer";

function proxyUrl(): string | undefined {
  const value =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** GitHub downloads must honor the user proxy; Node's built-in fetch does not. */
export async function fetchCliProxy(url: string, init?: RequestInit): Promise<Response> {
  const proxy = proxyUrl();
  if (!proxy) return fetch(url, init);
  const dispatcher = new ProxyAgent(proxy);
  return undiciFetch(url, { ...(init ?? {}), dispatcher }) as unknown as Response;
}

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
  const cpuTokens = cpu === "amd64" ? ["amd64", "x86_64", "x64"] : ["arm64", "aarch64"];
  const archives = assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    if (name.includes("checksum") || name.startsWith("source")) return false;
    return name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz");
  });
  const matching = archives
    .map((asset) => {
      const name = asset.name.toLowerCase();
      if (!assetMatchesOs(name, os)) return undefined;
      if (!assetMatchesCpu(name, cpuTokens)) return undefined;
      // `windows` contains the letters "arm" — never use a bare /arm/ test.
      if (cpu === "amd64" && /(?:^|[_-])(?:arm64|aarch64)(?:[._-]|$)/.test(name)) {
        return undefined;
      }
      const zipBonus = os === "windows" && name.endsWith(".zip") ? 2 : 0;
      const pluginBonus = name.includes("no-plugin") ? 0 : 1;
      return { asset, score: zipBonus + pluginBonus };
    })
    .filter((row): row is { asset: CliProxyReleaseAsset; score: number } => row !== undefined)
    .sort((left, right) => right.score - left.score);
  return matching[0]?.asset;
}

function assetMatchesOs(name: string, os: string): boolean {
  if (name.includes(`_${os}_`) || name.includes(`-${os}-`) || name.includes(`_${os}.`)) {
    return true;
  }
  return os === "windows" && /(?:^|[_-])win(?:dows|32|64)?(?:[._-]|$)/.test(name);
}

function assetMatchesCpu(name: string, tokens: readonly string[]): boolean {
  return tokens.some(
    (token) =>
      name.includes(`_${token}`) ||
      name.includes(`-${token}`) ||
      name.includes(`_${token}.`) ||
      name.includes(`-${token}.`) ||
      name.endsWith(`_${token}`) ||
      name.endsWith(`-${token}`),
  );
}

/** True when `filePath` is a native executable for `platform` (PE/MZ, Mach-O, ELF). */
export function isHostNativeCliProxyBinary(filePath: string, platform: string): boolean {
  const magic = readFileMagic(filePath, 4);
  if (!magic) return false;
  if (platform === "win32") return magic[0] === 0x4d && magic[1] === 0x5a;
  if (platform === "darwin") {
    return (
      (magic[0] === 0xcf && magic[1] === 0xfa && magic[2] === 0xed && magic[3] === 0xfe) ||
      (magic[0] === 0xfe && magic[1] === 0xed && magic[2] === 0xfa && magic[3] === 0xce) ||
      (magic[0] === 0xfe && magic[1] === 0xed && magic[2] === 0xfa && magic[3] === 0xcf) ||
      (magic[0] === 0xca && magic[1] === 0xfe && magic[2] === 0xba && magic[3] === 0xbe)
    );
  }
  return magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46;
}

function readFileMagic(filePath: string, length: number): Buffer | undefined {
  try {
    const fd = openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const n = readSync(fd, buffer, 0, length, 0);
      return n >= length ? buffer : undefined;
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function assertHostNativeBinary(filePath: string, platform: string, assetName: string): void {
  if (isHostNativeCliProxyBinary(filePath, platform)) return;
  throw new Error(
    `Downloaded ${assetName} but the extracted file is not a ${platform} executable. ` +
      `The Windows installer must use CLIProxyAPI_*_windows_amd64.zip, not a macOS/Linux build.`,
  );
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
  const fetchImpl = input.fetchImpl ?? fetchCliProxy;
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
    assertHostNativeBinary(found, platform, asset.name);
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
