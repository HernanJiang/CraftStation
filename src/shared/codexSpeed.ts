import { z } from "zod";

export const speedTierOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  availability: z.enum(["catalog", "unverified"]).optional(),
  description: z.string().optional(),
});
export type SpeedTierOption = z.infer<typeof speedTierOptionSchema>;
export const ULTRAFAST_USAGE_NOTE =
  "订阅内额度按 Standard 的 8 倍计用量；购买额度按 6 倍。API 使用独立计价与限流。实际档位以服务端报告为准。";

/** Plan names alone never prove Pro $500 or workspace entitlement. */
export function codexUltrafastAccountRestriction(result: unknown): string | undefined {
  const account = (result as { account?: { type?: string; planType?: string } } | null)?.account;
  if (account?.type !== "chatgpt") return;
  if (["free", "go", "plus", "team", "business"].includes(account.planType?.toLowerCase() ?? ""))
    return "CODEX_ULTRAFAST_UNAVAILABLE：此订阅套餐不支持 Ultrafast；请切换 Standard/Fast，或使用符合条件的账号。";
  // Generic `pro`, Enterprise and Edu require authoritative runtime checks.
  return undefined;
}
