import type {
  TokenUsageCapabilities,
  TokenUsagePayload,
  TokenUsagePeriod,
  TokenUsageResponse,
  TokenUsageSummary,
} from "@/shared/contracts";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { PeripheralSidecarClient } from "./peripheralSidecar";

export interface TokenUsageScanResult {
  available: boolean;
  summaries?: TokenUsageSummary[];
  unavailableReason?: string;
}

export interface TokenUsageScanner {
  readonly source?: "tokscale" | "runtime-ledger" | "peripheral-sidecar";
  readonly quality?: "exact" | "derived" | "estimated";
  readonly locating?: TokenUsageCapabilities["locating"];
  scan(payload: TokenUsagePayload): Promise<TokenUsageScanResult>;
}

const PERIOD_DAYS: Record<TokenUsagePeriod, number | undefined> = {
  today: 1,
  month: 30,
  allTime: undefined,
};

function unavailableSummary(
  period: TokenUsagePeriod,
  now: number,
  reason: string,
  source: TokenUsageSummary["source"],
  quality: TokenUsageSummary["quality"],
): TokenUsageSummary {
  return {
    period,
    source,
    quality,
    observedAt: now,
    coverage: { from: now, to: now, complete: false },
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    byTool: [],
    byModel: [],
    byProject: [],
    bySession: [],
    byAccount: [],
    unavailableReason: reason,
  };
}

export class PeripheralTokenUsageScanner implements TokenUsageScanner {
  readonly source = "peripheral-sidecar" as const;
  readonly quality = "exact" as const;
  readonly locating = "packaged-resource" as const;

  constructor(private readonly sidecar: PeripheralSidecarClient) {}

  async scan(payload: TokenUsagePayload): Promise<TokenUsageScanResult> {
    const result = await this.sidecar.request<TokenUsageScanResult>("usage.scan", {
      periods: payload.periods,
      accountId: payload.accountId,
      provider: payload.provider,
    });
    return result;
  }
}

export class TokenUsageAdapter {
  constructor(
    private readonly scanner?: TokenUsageScanner,
    private readonly now = () => Date.now(),
  ) {}

  inspectCapabilities(): TokenUsageCapabilities {
    const scanner = this.scanner;
    return {
      source: scanner?.source ?? "tokscale",
      quality: scanner?.quality ?? "estimated",
      available: Boolean(scanner),
      ...(scanner ? {} : { unavailableReason: "Tokscale scanner is unavailable." }),
      locating: scanner?.locating ?? "runtime-ledger",
    };
  }

  async getUsage(payload: TokenUsagePayload): Promise<TokenUsageResponse> {
    const now = this.now();
    let scanned: TokenUsageScanResult;
    if (!this.scanner) {
      scanned = { available: false, unavailableReason: "Tokscale scanner is unavailable." };
    } else {
      try {
        scanned = await this.scanner.scan(payload);
      } catch (error) {
        scanned = {
          available: false,
          unavailableReason: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const source = this.scanner?.source ?? "tokscale";
    const quality = this.scanner?.quality ?? "estimated";
    const summaries = payload.periods.map((period) =>
      scanned.available
        ? (scanned.summaries?.find((summary) => summary.period === period) ??
          unavailableSummary(
            period,
            now,
            "Token usage scanner returned no summary for this period.",
            source,
            quality,
          ))
        : unavailableSummary(
            period,
            now,
            scanned.unavailableReason ?? "Token usage scan unavailable.",
            source,
            quality,
          ),
    );
    return {
      summaries,
      sources: [
        {
          source,
          quality,
          available: scanned.available,
          ...(scanned.unavailableReason ? { unavailableReason: scanned.unavailableReason } : {}),
        },
      ],
    };
  }
}

export interface RuntimeLedgerUsageRow {
  ts: number;
  provider?: string | null;
  model?: string | null;
  accountId?: string | null;
  sessionId?: string | null;
  tool?: string | null;
  projectId?: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Exact total when the durable ledger only retains the normalized total. */
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

/**
 * Normalizes existing exact runtime telemetry without changing the durable
 * ledger. The loader is injected so the supervisor never imports main-process
 * SQLite internals; the same seam can be backed by the profile IPC facade.
 */
export class RuntimeLedgerTokenUsageScanner implements TokenUsageScanner {
  readonly source = "runtime-ledger" as const;
  readonly quality = "exact" as const;
  readonly locating = "runtime-ledger" as const;

  constructor(
    private readonly loadRows: () => Promise<RuntimeLedgerUsageRow[]> | RuntimeLedgerUsageRow[],
    private readonly now = () => Date.now(),
  ) {}

  async scan(payload: TokenUsagePayload): Promise<TokenUsageScanResult> {
    const rows = await this.loadRows();
    const now = this.now();
    const summaries = payload.periods.map((period) => {
      const start =
        period === "today"
          ? new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()
          : period === "month"
            ? new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime()
            : 0;
      const selected = rows.filter(
        (row) =>
          row.ts >= start &&
          (!payload.provider || row.provider === payload.provider) &&
          (!payload.accountId || row.accountId === payload.accountId),
      );
      const total = selected.reduce((sum, row) => sum + rowTotal(row), 0);
      const byTool = buildBreakdowns(selected, (row) => row.tool);
      const byModel = buildBreakdowns(selected, (row) => row.model);
      const byProject = buildBreakdowns(selected, (row) => row.projectId);
      const bySession = buildBreakdowns(selected, (row) => row.sessionId);
      const byAccount = buildBreakdowns(selected, (row) => row.accountId);
      const from = selected.length > 0 ? Math.min(...selected.map((row) => row.ts)) : start;
      return {
        period,
        source: "runtime-ledger" as const,
        quality: "exact" as const,
        observedAt: now,
        coverage: { from, to: now, complete: true },
        inputTokens: selected.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: selected.reduce((sum, row) => sum + row.outputTokens, 0),
        cacheReadTokens: selected.reduce((sum, row) => sum + (row.cacheReadTokens ?? 0), 0),
        cacheWriteTokens: selected.reduce((sum, row) => sum + (row.cacheWriteTokens ?? 0), 0),
        reasoningTokens: selected.reduce((sum, row) => sum + (row.reasoningTokens ?? 0), 0),
        totalTokens: total,
        byTool,
        byModel,
        byProject,
        bySession,
        byAccount,
      } satisfies TokenUsageSummary;
    });
    return {
      available: rows.length > 0,
      summaries,
      ...(rows.length === 0 ? { unavailableReason: "Runtime ledger has no exact telemetry." } : {}),
    };
  }
}

function rowTotal(row: RuntimeLedgerUsageRow): number {
  if (row.totalTokens !== undefined) return row.totalTokens;
  return (
    row.inputTokens +
    row.outputTokens +
    (row.cacheReadTokens ?? 0) +
    (row.cacheWriteTokens ?? 0) +
    (row.reasoningTokens ?? 0)
  );
}

/**
 * Production reader for the main-process exact token ledger. The supervisor
 * owns the Token Usage IPC surface, but the ledger is deliberately persisted
 * by main; opening this database read-only keeps that ownership intact while
 * avoiding a second token store or a renderer round-trip.
 */
export function createRuntimeLedgerTokenUsageScanner(
  dbPath: string,
): RuntimeLedgerTokenUsageScanner {
  return new RuntimeLedgerTokenUsageScanner(() => {
    if (!existsSync(dbPath)) return [];
    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = sqlite
        .prepare(
          `SELECT ts, provider, model, project_id, session_id, tool, account_id, value
           FROM usage_events WHERE kind = 'tokens_v2' ORDER BY ts ASC`,
        )
        .all() as Array<{
        ts: number;
        provider: string | null;
        model: string | null;
        project_id: string | null;
        session_id: string | null;
        tool: string | null;
        account_id: string | null;
        value: number;
      }>;
      return rows.map((row) => ({
        ts: row.ts,
        provider: row.provider,
        model: row.model,
        projectId: row.project_id,
        sessionId: row.session_id,
        tool: row.tool,
        accountId: row.account_id,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: Math.max(0, row.value),
      }));
    } finally {
      sqlite.close();
    }
  });
}

function buildBreakdowns(
  rows: RuntimeLedgerUsageRow[],
  keyOf: (row: RuntimeLedgerUsageRow) => string | null | undefined,
): TokenUsageSummary["byTool"] {
  const byKey = new Map<string, TokenUsageSummary["byTool"][number]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const current = byKey.get(key) ?? {
      key,
      label: key,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    };
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.cacheReadTokens += row.cacheReadTokens ?? 0;
    current.cacheWriteTokens += row.cacheWriteTokens ?? 0;
    current.reasoningTokens += row.reasoningTokens ?? 0;
    current.totalTokens += rowTotal(row);
    byKey.set(key, current);
  }
  return [...byKey.values()].sort((left, right) =>
    right.totalTokens === left.totalTokens
      ? left.key.localeCompare(right.key)
      : right.totalTokens - left.totalTokens,
  );
}

export { PERIOD_DAYS };
