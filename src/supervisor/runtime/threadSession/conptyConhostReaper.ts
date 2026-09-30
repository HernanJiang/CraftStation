import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { windowsPowershellPath } from "../windowsPowershell";

/**
 * Best-effort reaper for the conhost.exe that node-pty's non-DLL ConPTY path
 * orphans on Windows. When the client process exits — naturally or via
 * taskkill — the native exit thread drops the HPCON without calling
 * ClosePseudoConsole, so the conhost.exe child of this process lives forever
 * and a later `pty.kill()` is a native no-op. There is no handle back to the
 * console, so the reaper matches conhost children by creation timestamp
 * against the Date.now() bracket recorded around `spawn()`: the conhost is
 * created inside that window (single-digit ms after the start edge), so a
 * match inside it is unique unless two PTYs spawned within the same ~40 ms.
 */

const execFileAsync = promisify(execFile);

/** Lower-edge slack for timer/clock jitter between Date.now() and the kernel clock. */
const MATCH_LOWER_SLACK_MS = 20;

/** Wall-clock `Date.now()` bracket around a node-pty `spawn()` call. */
export interface PtySpawnWindow {
  startedAt: number;
  endedAt: number;
}

export interface ConhostProcessInfo {
  pid: number;
  /** Process creation time as unix milliseconds. */
  createdAt: number;
}

export interface ConptyConhostReaperOptions {
  platform?: NodeJS.Platform;
  parentPid?: number;
  delayMs?: number;
  listConhostChildren?(parentPid: number): Promise<ConhostProcessInfo[]>;
  killProcess?(pid: number): void;
}

/**
 * conhosts created inside the spawn window (with `MATCH_LOWER_SLACK_MS` of
 * jitter below the start edge; the upper edge stays strict).
 */
export function matchConhostForSpawn(
  window: PtySpawnWindow,
  conhosts: readonly ConhostProcessInfo[],
): ConhostProcessInfo[] {
  return conhosts.filter(
    (conhost) =>
      conhost.createdAt >= window.startedAt - MATCH_LOWER_SLACK_MS &&
      conhost.createdAt <= window.endedAt,
  );
}

/** Enumerate `conhost.exe` children of `parentPid` as `pid|createdAtMs` lines. */
async function listConhostChildren(parentPid: number): Promise<ConhostProcessInfo[]> {
  const { stdout } = await execFileAsync(
    windowsPowershellPath(),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid} AND Name='conhost.exe'" | ForEach-Object { "$($_.ProcessId)|$(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`,
    ],
    { timeout: 10_000, windowsHide: true },
  );
  const conhosts: ConhostProcessInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pidRaw, createdRaw] = line.split("|");
    const pid = Number(pidRaw);
    const createdAt = Number(createdRaw);
    if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(createdAt)) continue;
    conhosts.push({ pid, createdAt });
  }
  return conhosts;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ConptyConhostReaper {
  private readonly platform: NodeJS.Platform;
  private readonly parentPid: number;
  private readonly delayMs: number;
  private readonly listConhostChildren: (parentPid: number) => Promise<ConhostProcessInfo[]>;
  private readonly killProcess: (pid: number) => void;
  private pending: { window: PtySpawnWindow; ownerId: string }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ConptyConhostReaperOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.parentPid = options.parentPid ?? process.pid;
    this.delayMs = options.delayMs ?? 1_500;
    this.listConhostChildren = options.listConhostChildren ?? listConhostChildren;
    this.killProcess = options.killProcess ?? ((pid) => process.kill(pid));
  }

  /**
   * Batch a finished spawn for reaping. One shared timer flushes the whole
   * batch after `delayMs` — a burst of exits produces one process listing.
   * No-op off Windows; the leak is ConPTY-specific.
   */
  schedule(window: PtySpawnWindow, ownerId: string): void {
    if (this.platform !== "win32") return;
    this.pending.push({ window, ownerId });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
    this.timer.unref();
  }

  async flush(): Promise<void> {
    const batch = this.pending;
    if (batch.length === 0) return;
    this.pending = [];
    let conhosts: ConhostProcessInfo[];
    try {
      conhosts = await this.listConhostChildren(this.parentPid);
    } catch (error) {
      console.warn(
        `[pty-lifecycle] phase=teardown operation=reap-conhost status=failed ` +
          `code=CONHOST_LIST_FAILED owners=${batch.length} reason=${errorMessage(error)}`,
      );
      return;
    }
    for (const { window, ownerId } of batch) {
      const matches = matchConhostForSpawn(window, conhosts);
      if (matches.length === 0) {
        console.log(
          `[pty-lifecycle] phase=teardown operation=reap-conhost status=skipped ` +
            `owner=${ownerId} reason=no-match`,
        );
        continue;
      }
      if (matches.length > 1) {
        // Killing the wrong conhost would tear down an unrelated live console.
        console.warn(
          `[pty-lifecycle] phase=teardown operation=reap-conhost status=degraded ` +
            `code=CONHOST_MATCH_AMBIGUOUS owner=${ownerId} matches=${matches.length}`,
        );
        continue;
      }
      const conhost = matches[0]!;
      try {
        this.killProcess(conhost.pid);
        console.log(
          `[pty-lifecycle] phase=teardown operation=reap-conhost status=reaped ` +
            `owner=${ownerId} conhostPid=${conhost.pid}`,
        );
      } catch (error) {
        console.warn(
          `[pty-lifecycle] phase=teardown operation=reap-conhost status=failed ` +
            `code=CONHOST_KILL_FAILED owner=${ownerId} conhostPid=${conhost.pid} ` +
            `reason=${errorMessage(error)}`,
        );
      }
    }
  }
}
