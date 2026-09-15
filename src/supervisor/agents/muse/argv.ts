import { dirname as posixDirname } from "node:path/posix";
import type { ProjectLocation, ThreadConfig } from "@/shared/contracts";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";
import {
  buildAgentCommand,
  DEFAULT_WSL_EXEC_PATH,
  getWslCommand,
  quotePosixShellArg,
  type CommandSpec,
} from "../base";
import { buildPosixExportPrefix } from "../base/shellBasics";
import { museForeignWslSettingsWrite } from "./foreignEndpoint";
import { resolveProxyConfig } from "@/supervisor/runtime/usageHttpClient";

/**
 * Flag references — verified against Muse Code 0.1.0 (0.1.0-R708.1):
 *
 * Interactive TUI: `muse [OPTIONS] [PROMPT]`
 *   • `--model <ID>`
 *   • `--reasoning-effort none|minimal|low|medium|high|xhigh|ultra` (default high)
 *   • `--approval-mode untrusted|on-request|never` (default on-request)
 *   • `--yolo` — disable approval + sandbox and trust the workspace for this run
 *   • `--trust-workspace` — trust workspace for this run (skills/rules); no persist
 *
 * Resume: `muse resume <session-uuid>` (root options may appear on either side
 * of `resume`). There is no interactive `--session-id` flag.
 *
 * Headless `muse exec` is intentionally not used (prompt must be an argv
 * argument or a regular `--prompt-file`; stdin piping fails), so there is no
 * one-shot support and no GUI structured session — Muse is terminal-only
 * until it ships a real ACP mode.
 */

const MUSE_APPROVAL_MODES = new Set(["untrusted", "on-request", "never"]);

/**
 * Model / effort / approval flags for the interactive TUI. Always includes
 * `--trust-workspace` so a PTY never blocks on Muse's trust prompt.
 */
export function buildMuseConfigFlags(config: ThreadConfig): string[] {
  const args: string[] = ["--trust-workspace"];

  if (config.model) {
    args.push("--model", stripModelProviderPrefix(config.model));
  }
  if (config.effort) {
    args.push("--reasoning-effort", config.effort);
  }

  const policy = config.approvalPolicy;
  if (policy === "bypassPermissions" || policy === "yolo") {
    args.push("--yolo");
  } else if (policy && MUSE_APPROVAL_MODES.has(policy)) {
    args.push("--approval-mode", policy);
  }

  return args;
}

/**
 * Argv for interactive `muse` (TUI / PTY). Optional trailing prompt is the
 * CLI's documented positional launch prompt.
 */
export function buildMuseArgs(config: ThreadConfig, prompt?: string): string[] {
  const args = buildMuseConfigFlags(config);
  if (prompt && prompt.trim().length > 0) {
    args.push(prompt);
  }
  return args;
}

/**
 * Argv for `muse resume <session-uuid>` (config flags after the subcommand so
 * they stay with the resumed session).
 */
export function buildMuseResumeArgs(sessionRef: string, config: ThreadConfig): string[] {
  return ["resume", sessionRef, ...buildMuseConfigFlags(config)];
}

/**
 * WSL `muse serve` does not inherit Windows WinINET. Pin the same HTTP proxy
 * the host uses so official Meta calls do not egress from a CN IP (RegionError).
 * Callers that already set HTTP_PROXY keep their values.
 */
function withWslProxyEnv(env: Record<string, string>): Record<string, string> {
  if (env.HTTP_PROXY || env.http_proxy || env.HTTPS_PROXY || env.https_proxy) return env;
  const proxy = resolveProxyConfig(process.env, { allowSystemProxyFallback: true });
  const url = proxy?.httpsProxy || proxy?.httpProxy;
  if (!url) return env;
  const noProxy = proxy?.noProxy || "localhost,127.0.0.1,::1";
  return {
    ...env,
    http_proxy: url,
    https_proxy: url,
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    ALL_PROXY: url,
    all_proxy: url,
    no_proxy: noProxy,
    NO_PROXY: noProxy,
  };
}

/**
 * GUI structured session: `muse serve` over stdio (MSP).
 *
 * WSL must not use `bash -l -i` — login/interactive rc output contaminates
 * the JSON-RPC handshake and fails session creation. Same pattern as
 * `buildOpenCodeServerCommand` / Codex app-server.
 */
export function buildMuseServeCommand(
  location: ProjectLocation,
  resolvedExecPath?: string,
  env: Record<string, string> = {},
): CommandSpec {
  if (location.kind === "wsl") {
    const exports = buildPosixExportPrefix(withWslProxyEnv(env));
    const writeSettings = museForeignWslSettingsWrite(env);
    const binary = resolvedExecPath ?? "muse";
    // `wsl --exec bash -c` inherits Windows HOME/USERPROFILE and Muse 1.0.2
    // then exits before the MSP handshake (`write EPIPE`). Pin a real Linux
    // home without using `bash -l` (login rc would contaminate stdio).
    const linuxHome = `export HOME="$(getent passwd "$(id -u)" | cut -d: -f6)"; export HOME="\${HOME:-/root}"; `;
    const script = `${exports}${writeSettings}${linuxHome}exec ${quotePosixShellArg(binary)} serve`;
    const pathSegments = [
      resolvedExecPath?.startsWith("/") ? posixDirname(resolvedExecPath) : undefined,
      DEFAULT_WSL_EXEC_PATH,
    ].filter((segment): segment is string => Boolean(segment));
    return {
      command: getWslCommand(),
      args: [
        "-d",
        location.distro,
        "--cd",
        location.linuxPath,
        "--exec",
        "bash",
        "-c",
        `export PATH=${quotePosixShellArg(pathSegments.join(":"))}:$PATH; ${script}`,
      ],
    };
  }
  return buildAgentCommand(location, "muse", ["serve"], resolvedExecPath, env);
}
