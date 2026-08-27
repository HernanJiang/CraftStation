import { z } from "zod";

export const tokenUsagePeriodSchema = z.enum(["today", "month", "allTime"]);
export type TokenUsagePeriod = z.infer<typeof tokenUsagePeriodSchema>;

export const tokenUsageQualitySchema = z.enum(["exact", "derived", "estimated"]);
export type TokenUsageQuality = z.infer<typeof tokenUsageQualitySchema>;

export const tokenUsageSourceSchema = z.enum(["runtime-ledger", "tokscale", "peripheral-sidecar"]);
export type TokenUsageSource = z.infer<typeof tokenUsageSourceSchema>;

export interface TokenUsageBreakdown {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface TokenUsageSummary {
  period: TokenUsagePeriod;
  source: TokenUsageSource;
  quality: TokenUsageQuality;
  observedAt: number;
  coverage: {
    from: number;
    to: number;
    complete: boolean;
  };
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  byTool: TokenUsageBreakdown[];
  byModel: TokenUsageBreakdown[];
  byProject: TokenUsageBreakdown[];
  bySession: TokenUsageBreakdown[];
  byAccount: TokenUsageBreakdown[];
  unavailableReason?: string;
}

export interface TokenUsageResponse {
  summaries: TokenUsageSummary[];
  sources: Array<{
    source: TokenUsageSource;
    quality: TokenUsageQuality;
    available: boolean;
    unavailableReason?: string;
  }>;
}

export const tokenUsagePayloadSchema = z.object({
  periods: z.array(tokenUsagePeriodSchema).min(1).default(["today", "month", "allTime"]),
  accountId: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  force: z.boolean().optional(),
});
export type TokenUsagePayload = z.infer<typeof tokenUsagePayloadSchema>;
