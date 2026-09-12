import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AccountQuotaWindow, ProjectLocation } from "@/shared/contracts";
import { resolveAgentBinaryPath } from "@/supervisor/agents/binaryResolver";
import { buildGrokAcpArgs } from "@/supervisor/agents/grok/argv";

const NATIVE_QUOTA_METHOD = "x.ai/billing";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 2;

export type NativeGrokQuotaResult = {
  windows: AccountQuotaWindow[];
  fetchedAt: number;
};

export type NativeGrokQuotaProbeOptions = {
  home: string;
  cwd: string;
  executable?: string | undefined;
  env: Record<string, string>;
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  attempts?: number;
};

type RpcMessage = {
  id?: number | string;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
};

export class NativeGrokQuotaRpcError extends Error {
  readonly rpcCode: number | string | undefined;

  constructor(message: string, rpcCode?: number | string) {
    super(message);
    this.name = "NativeGrokQuotaRpcError";
    this.rpcCode = rpcCode;
    Object.setPrototypeOf(this, NativeGrokQuotaRpcError.prototype);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function percentValue(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric === undefined) return undefined;
  // Fractions are (0, 1). Exactly 1 is 1%, not 100% — SuperGrok windows that
  // report `usedPercent: 1` were previously marked exhausted on refresh.
  const percent = numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
  return percent >= 0 && percent <= 100 ? percent : undefined;
}

function epochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function windowFromRecord(
  record: Record<string, unknown>,
  fallbackId: string,
): AccountQuotaWindow | undefined {
  const id = typeof record.id === "string" ? record.id : fallbackId;
  const label = typeof record.label === "string" ? record.label : id;
  const used = numberValue(record.used);
  const limit = numberValue(record.limit);
  const usedPercent =
    percentValue(record.usedPercent) ??
    percentValue(record.percentUsed) ??
    percentValue(record.usagePercent) ??
    (used !== undefined && limit !== undefined && limit > 0
      ? Math.min(100, Math.max(0, (used / limit) * 100))
      : undefined);
  if (usedPercent === undefined) return undefined;
  const reset = epochMs(record.resetsAt ?? record.resetAt ?? record.reset_at ?? record.windowEnd);
  return {
    id,
    label,
    usedPercent,
    ...(reset !== undefined ? { resetsAt: reset } : {}),
  };
}

function collectWindowRecords(value: unknown): AccountQuotaWindow[] {
  if (!isRecord(value)) return [];
  const results: AccountQuotaWindow[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (isRecord(child)) {
      const mapped = windowFromRecord(child, key);
      if (mapped) results.push(mapped);
      results.push(...collectWindowRecords(child));
    } else if (Array.isArray(child)) {
      for (const [index, item] of child.entries()) {
        if (!isRecord(item)) continue;
        const mapped = windowFromRecord(item, `${key}-${index}`);
        if (mapped) results.push(mapped);
        results.push(...collectWindowRecords(item));
      }
    }
  }
  return results;
}

function dedupeWindows(windows: AccountQuotaWindow[]): AccountQuotaWindow[] {
  const seen = new Set<string>();
  return windows.filter((window) => {
    const key = `${window.id}:${window.usedPercent}:${window.resetsAt ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseNativeGrokBilling(
  result: unknown,
  fetchedAt = Date.now(),
): NativeGrokQuotaResult | undefined {
  const candidates =
    isRecord(result) && isRecord(result.result) ? [result.result, result] : [result];
  const windows = dedupeWindows(candidates.flatMap((candidate) => collectWindowRecords(candidate)));
  if (windows.length === 0) return undefined;
  return { windows, fetchedAt };
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:eof|fetch failed|connect|reset|socket|timed? ?out|timeout|ssl|tls)/i.test(message);
}

function sendRpc(
  child: ChildProcessWithoutNullStreams,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Grok native billing RPC timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    const onData = (chunk: Buffer | string) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: RpcMessage;
        try {
          message = JSON.parse(line) as RpcMessage;
        } catch {
          continue;
        }
        if (message.id !== id) continue;
        cleanup();
        if (message.error) {
          const data = isRecord(message.error.data) ? message.error.data : undefined;
          const errorMessage =
            typeof data?.message === "string"
              ? data.message
              : typeof message.error.message === "string"
                ? message.error.message
                : "Grok native billing RPC failed.";
          const code =
            typeof message.error.code === "number" || typeof message.error.code === "string"
              ? message.error.code
              : typeof data?.code === "number" || typeof data?.code === "string"
                ? data.code
                : undefined;
          reject(new NativeGrokQuotaRpcError(errorMessage, code));
        } else resolve(message.result);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(
          `Grok native billing process exited before response (code ${code ?? "unknown"}).`,
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

export async function probeNativeGrokBilling(
  options: NativeGrokQuotaProbeOptions,
): Promise<NativeGrokQuotaResult> {
  const spawnProcess = options.spawnProcess ?? spawn;
  const attempts = Math.max(1, options.attempts ?? MAX_ATTEMPTS);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      child = spawnProcess(
        options.executable ?? "grok",
        [...buildGrokAcpArgs({ model: "grok-4.5" }), "agent", "stdio"],
        {
          cwd: options.cwd,
          env: options.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      await sendRpc(
        child,
        "initialize",
        {
          protocolVersion: 1,
          clientInfo: { name: "CraftStation quota monitor", version: "0.5.6" },
          clientCapabilities: { fs: {}, terminal: false },
        },
        timeoutMs,
      );
      const result = await sendRpc(child, NATIVE_QUOTA_METHOD, {}, timeoutMs);
      const parsed = parseNativeGrokBilling(result);
      if (!parsed) throw new Error("Grok native billing RPC returned no quota windows.");
      return parsed;
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || attempt + 1 >= attempts) break;
    } finally {
      child?.kill();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function nativeGrokQuotaProbeOptions(
  home: string,
  cwd: string,
  env: Record<string, string>,
): NativeGrokQuotaProbeOptions {
  const location: ProjectLocation = { kind: "windows", path: cwd };
  return {
    home,
    cwd,
    env: { ...env, GROK_HOME: home },
    ...(resolveAgentBinaryPath(location, "grok")
      ? { executable: resolveAgentBinaryPath(location, "grok") }
      : {}),
  };
}

export const nativeGrokQuotaRpcMethod = NATIVE_QUOTA_METHOD;
