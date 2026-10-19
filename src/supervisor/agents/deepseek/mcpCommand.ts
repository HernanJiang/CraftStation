import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ProjectLocation, ResolvedMcpServer } from "@/shared/contracts";
import {
  batchWslCommandsAsync,
  extractWindowsCmdShimScript,
  resolveExecutablePath,
} from "../base/processRuntime";
import { quotePosixShellArg } from "../base/shellBasics";

/**
 * dsh accepts MCP stdio servers only when `command` is absolute, and its MCP
 * client spawns with `shell: false`. A bare name such as `notion-mcp-server.cmd`
 * fails `session/new` before the turn starts. npm `.cmd` shims are rewritten to
 * `node.exe` plus the shim's script so Windows can spawn them without a shell.
 */
export interface DeepSeekMcpCommandDeps {
  resolveExecutable(command: string): string | undefined;
  readText(path: string): string | undefined;
  exists(path: string): boolean;
  resolveWslCommand(distro: string, command: string): Promise<string | undefined>;
}

const defaultDeps: DeepSeekMcpCommandDeps = {
  resolveExecutable: resolveExecutablePath,
  readText(filePath) {
    try {
      return readFileSync(filePath, "utf8");
    } catch {
      return undefined;
    }
  },
  exists: existsSync,
  async resolveWslCommand(distro, command) {
    const [result] = await batchWslCommandsAsync(distro, [
      `command -v ${quotePosixShellArg(command)}`,
    ]);
    const found = result?.ok ? result.stdout.trim().split(/\r?\n/u)[0]?.trim() : undefined;
    return found && found.startsWith("/") ? found : undefined;
  },
};

export async function prepareDeepSeekMcpServers(
  servers: readonly ResolvedMcpServer[] | undefined,
  location: ProjectLocation,
  deps: DeepSeekMcpCommandDeps = defaultDeps,
): Promise<ResolvedMcpServer[] | undefined> {
  if (!servers) return undefined;
  const prepared: ResolvedMcpServer[] = [];
  for (const server of servers) {
    const transport = server.transport;
    if (transport.type === "sse") {
      console.warn(`[deepseek] skipping MCP server ${server.name}: SSE transport is not supported`);
      continue;
    }
    if (transport.type !== "stdio") {
      prepared.push(server);
      continue;
    }
    const spawned = await absoluteStdioCommand(transport.command, transport.args, location, deps);
    if (!spawned) {
      console.warn(
        `[deepseek] skipping MCP server ${server.name}: stdio command is not an absolute path`,
      );
      continue;
    }
    if (
      spawned.command === transport.command &&
      spawned.args.length === transport.args.length &&
      spawned.args.every((arg, index) => arg === transport.args[index])
    ) {
      prepared.push(server);
      continue;
    }
    prepared.push({
      ...server,
      transport: { ...transport, command: spawned.command, args: spawned.args },
    });
  }
  return prepared;
}

async function absoluteStdioCommand(
  command: string,
  args: readonly string[],
  location: ProjectLocation,
  deps: DeepSeekMcpCommandDeps,
): Promise<{ command: string; args: string[] } | undefined> {
  if (location.kind === "wsl") {
    const resolved = await absoluteWslCommand(command, location.linuxPath, deps, location.distro);
    return resolved ? { command: resolved, args: [...args] } : undefined;
  }
  if (location.kind === "windows") {
    return absoluteWindowsCommand(command, args, location.path, deps);
  }
  const resolved = absolutePosixCommand(command, location.path, deps);
  return resolved ? { command: resolved, args: [...args] } : undefined;
}

async function absoluteWslCommand(
  command: string,
  cwd: string,
  deps: DeepSeekMcpCommandDeps,
  distro: string,
): Promise<string | undefined> {
  if (command.startsWith("/")) return command;
  if (command.startsWith("./") || command.startsWith("../")) {
    return path.posix.resolve(cwd, command);
  }
  return deps.resolveWslCommand(distro, command);
}

function absolutePosixCommand(
  command: string,
  cwd: string,
  deps: DeepSeekMcpCommandDeps,
): string | undefined {
  if (path.posix.isAbsolute(command)) return command;
  const found = deps.resolveExecutable(command);
  if (found && path.posix.isAbsolute(found)) return found;
  if (isPathLike(command)) {
    const resolved = path.posix.resolve(cwd, command);
    if (deps.exists(resolved)) return resolved;
  }
  return undefined;
}

function absoluteWindowsCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  deps: DeepSeekMcpCommandDeps,
): { command: string; args: string[] } | undefined {
  const located = locateWindowsCommand(command, cwd, deps);
  if (!located) return undefined;
  if (/\.cmd$/iu.test(located)) {
    return unwrapWindowsNpmCmd(located, args, deps);
  }
  if (/\.(?:bat|ps1)$/iu.test(located)) return undefined;
  return { command: located, args: [...args] };
}

function locateWindowsCommand(
  command: string,
  cwd: string,
  deps: DeepSeekMcpCommandDeps,
): string | undefined {
  if (path.win32.isAbsolute(command)) return command;
  const found = deps.resolveExecutable(command);
  if (found && path.win32.isAbsolute(found)) return found;
  if (isPathLike(command)) {
    const resolved = path.win32.resolve(cwd, command);
    if (deps.exists(resolved)) return resolved;
  }
  return undefined;
}

function unwrapWindowsNpmCmd(
  cmdPath: string,
  args: readonly string[],
  deps: DeepSeekMcpCommandDeps,
): { command: string; args: string[] } | undefined {
  const body = deps.readText(cmdPath);
  const relScript = body ? extractWindowsCmdShimScript(body) : undefined;
  if (!relScript) return undefined;
  const baseDir = path.win32.dirname(cmdPath);
  const scriptPath = path.win32.join(baseDir, ...relScript.split(/[\\/]+/u));
  if (!deps.exists(scriptPath)) return undefined;
  const localNode = path.win32.join(baseDir, "node.exe");
  const node = deps.exists(localNode) ? localNode : deps.resolveExecutable("node");
  if (!node || !path.win32.isAbsolute(node) || /\.(?:cmd|bat|ps1)$/iu.test(node)) return undefined;
  return { command: node, args: [scriptPath, ...args] };
}

function isPathLike(command: string): boolean {
  return command.startsWith(".") || command.includes("/") || command.includes("\\");
}
