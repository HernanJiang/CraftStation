import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import type { ProjectLocation } from "@/shared/contracts";
import { normalizeWorktreePathForComparison, resolveProjectLocation } from "@/shared/worktree";
import { toWslUncPath } from "@/shared/wsl";
import { currentThread, currentWorktreeTerminals } from "./threads";
import { requireProject, type AppControlsToolContext, type ToolDomain } from "./types";

/**
 * `wait` — CraftStation's cross-harness equivalent of a harness-internal
 * "wait for background task" tool (e.g. Kimi Code's WaitFor). The caller
 * blocks inside its turn until the timeout elapses or one of the watched
 * signals fires: new output on an integrated Terminal pane, a pane exiting,
 * or a file under the caller's project changing. This lets monitoring loops
 * pace themselves without spending a shell call per poll tick.
 */

/** Same hard cap as `wait_for_thread` (seconds). */
const WAIT_MAX_SECONDS = 1_800;
/** Coarse re-check cadence between event wakes (ms). */
const WAIT_POLL_MS = 1_500;
/** Cap on the matched output excerpt echoed back to the caller. */
const MATCHED_OUTPUT_MAX_CHARS = 500;

const waitArgsSchema = z
  .object({
    timeoutSeconds: z.number().int().min(1).max(WAIT_MAX_SECONDS),
    terminalIds: z.array(z.string().min(1)).max(8).optional(),
    paths: z.array(z.string().min(1)).max(8).optional(),
    pattern: z.string().min(1).optional(),
  })
  .refine((value) => value.pattern === undefined || (value.terminalIds?.length ?? 0) > 0, {
    message: "pattern only filters new terminal output — pass terminalIds too.",
  });

interface FileStamp {
  exists: boolean;
  mtimeMs: number;
  size: number;
  isDirectory: boolean;
}

function statFile(path: string): FileStamp {
  try {
    const stat = statSync(path);
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      isDirectory: stat.isDirectory(),
    };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0, isDirectory: false };
  }
}

function stampChanged(before: FileStamp, after: FileStamp): boolean {
  return (
    before.exists !== after.exists ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size ||
    before.isDirectory !== after.isDirectory
  );
}

type WaitHit =
  | { reason: "terminal-output"; terminalId: string; outputLength: number }
  | {
      reason: "terminal-pattern";
      terminalId: string;
      outputLength: number;
      matchedOutput: string;
    }
  | { reason: "terminal-exit"; terminalId: string }
  | { reason: "file-change"; path: string };

export const waitTools: ToolDomain = {
  specs: [
    {
      name: "wait",
      description:
        "Block inside the current turn until timeoutSeconds elapse or a watched signal fires, whichever comes first. Watched signals: terminalIds (integrated Terminal panes from list_terminals — wakes on new output, on pattern-matched output when pattern is given, or when a pane exits) and paths (files or directories under this thread's worktree — wakes on create/modify/delete; local and WSL projects only). With no watched signals this is a plain bounded sleep. Use it to pace monitoring loops instead of spending a shell call per poll tick.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["timeoutSeconds"],
        properties: {
          timeoutSeconds: {
            type: "integer",
            minimum: 1,
            maximum: WAIT_MAX_SECONDS,
            description: "How long to block before returning with timedOut=true.",
          },
          terminalIds: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1 },
            description:
              "Terminal pane ids from list_terminals. Any new output (or the pane exiting) ends the wait early.",
          },
          paths: {
            type: "array",
            maxItems: 8,
            items: { type: "string", minLength: 1 },
            description:
              "Files or directories to watch, relative to this thread's worktree or absolute inside it. Any create/modify/delete ends the wait early.",
          },
          pattern: {
            type: "string",
            minLength: 1,
            description:
              "Regex matched against NEW terminal output only. Requires terminalIds; the wait then ends early only when fresh output matches.",
          },
        },
      },
    },
  ],
  handlers: {
    wait: async (args, ctx) => {
      const parsed = waitArgsSchema.parse(args);
      const caller = currentThread(ctx);
      const project = requireProject(ctx, caller.projectId);
      const location = resolveProjectLocation(project.location, caller.worktreePath);

      const terminalIds = parsed.terminalIds ?? [];
      const pattern = parsed.pattern ? compilePattern(parsed.pattern) : undefined;
      const terminalBaseline = new Map<string, number>();
      if (terminalIds.length > 0) {
        const terminals = await currentWorktreeTerminals(ctx);
        for (const terminalId of terminalIds) {
          const terminal = terminals.find((entry) => entry.terminalId === terminalId);
          if (!terminal) {
            throw new Error(
              `Terminal ${terminalId} is not a running terminal attached to this worktree. Call list_terminals to get a valid terminalId.`,
            );
          }
          terminalBaseline.set(terminalId, terminal.outputLength);
        }
      }

      const fileBaseline = resolveWatchPaths(location, parsed.paths ?? []);
      const startedAt = Date.now();
      const hit = await ctx.threadStates.waitUntil(
        [caller.projectId, ...terminalIds],
        parsed.timeoutSeconds * 1_000,
        () => pollWatchedSignals(ctx, terminalBaseline, fileBaseline, pattern),
        WAIT_POLL_MS,
      );
      const waitedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1_000));
      if (hit === undefined) return { timedOut: true, waitedSeconds };
      return { timedOut: false, waitedSeconds, ...hit };
    },
  },
};

function compilePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    throw new Error(`pattern is not a valid regular expression: ${pattern}`);
  }
}

/**
 * Resolve watch paths against the caller's effective worktree root. Local and
 * WSL projects are served through the native filesystem (WSL via its UNC
 * mount); remote-hosted locations cannot be statted from this host and are
 * rejected honestly.
 */
function resolveWatchPaths(location: ProjectLocation, paths: string[]): Map<string, FileStamp> {
  const baseline = new Map<string, FileStamp>();
  if (paths.length === 0) return baseline;
  if (location.remoteServerId) {
    throw new Error(
      "paths watching is not available for remote-hosted projects — watch a terminalIds pane or use a plain timeout instead.",
    );
  }
  const root = resolve(location.kind === "wsl" ? location.uncPath : location.path);
  const caseInsensitive = location.kind !== "posix";
  const rootKey = normalizeWorktreePathForComparison(root, caseInsensitive);
  for (const input of paths) {
    // WSL callers think in Linux paths: an absolute "/..." input maps onto the
    // distro UNC root before the containment check.
    const mapped =
      location.kind === "wsl" && input.startsWith("/")
        ? toWslUncPath(location.distro, input)
        : input;
    const absolute = resolve(root, mapped);
    const key = normalizeWorktreePathForComparison(absolute, caseInsensitive);
    if (key !== rootKey && !key.startsWith(rootKey + sep) && !key.startsWith(rootKey + "/")) {
      throw new Error(`Path ${input} resolves outside this thread's worktree.`);
    }
    baseline.set(absolute, statFile(absolute));
  }
  return baseline;
}

async function pollWatchedSignals(
  ctx: AppControlsToolContext,
  terminalBaseline: Map<string, number>,
  fileBaseline: Map<string, FileStamp>,
  pattern: RegExp | undefined,
): Promise<WaitHit | undefined> {
  if (terminalBaseline.size > 0) {
    const snapshots = await ctx.supervisor.getTerminalShellSnapshots();
    for (const [terminalId, baselineLength] of terminalBaseline) {
      const snapshot = snapshots.find((entry) => entry.terminalId === terminalId);
      if (!snapshot) return { reason: "terminal-exit", terminalId };
      if (snapshot.outputLength === baselineLength) continue;
      if (!pattern) {
        return { reason: "terminal-output", terminalId, outputLength: snapshot.outputLength };
      }
      const scrollback = await ctx.supervisor.readTerminalScrollback({ threadId: terminalId });
      // The transcript is a capped tail buffer; when the baseline offset has
      // rolled off, fall back to scanning the whole tail.
      const fresh =
        scrollback.length > baselineLength ? scrollback.slice(baselineLength) : scrollback;
      const match = pattern.exec(fresh);
      if (match) {
        return {
          reason: "terminal-pattern",
          terminalId,
          outputLength: snapshot.outputLength,
          matchedOutput: match[0].slice(0, MATCHED_OUTPUT_MAX_CHARS),
        };
      }
    }
  }
  for (const [path, before] of fileBaseline) {
    if (stampChanged(before, statFile(path))) return { reason: "file-change", path };
  }
  return undefined;
}
