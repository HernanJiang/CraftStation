import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./accountStore";
import { GrokProfileService } from "./grokProfiles";
import { createNodeHttpClient } from "./usageHttpClient";

/**
 * Opt-in product-path probe. It is intentionally skipped in normal CI: the
 * only way to enable it is an explicit environment variable, and the service
 * reads the selected managed auth scope internally. The test never prints or
 * writes credential material.
 */
const enabled = process.env.CRAFTSTATION_REAL_GROK_PROBE === "1";
const accountId = process.env.CRAFTSTATION_GROK_ACCOUNT_ID?.trim();
const outputPath = process.env.CRAFTSTATION_GROK_PROBE_OUTPUT?.trim();
const storeRoot = process.env.CRAFTSTATION_GROK_STORE_ROOT?.trim();

function errorClassFor(result: {
  status: string;
  lastError?: string | undefined;
}): string | undefined {
  const message = result.lastError?.toLowerCase() ?? "";
  if (message.includes("billing rpc unsupported") || message.includes("method not found")) {
    return "unsupported-method";
  }
  if (result.status === "auth-expired" || message.startsWith("auth:")) return "auth";
  if (message.startsWith("timeout:")) return "timeout";
  if (message.startsWith("http")) return "http";
  if (message.startsWith("network:")) return "network";
  return result.lastError ? "error" : undefined;
}

describe("real managed Grok quota probe", () => {
  it.runIf(enabled && Boolean(accountId) && Boolean(outputPath) && Boolean(storeRoot))(
    "collects quota through the product service without exposing credentials",
    async () => {
      const store = new AccountStore(storeRoot!);
      const account = store.get(accountId!);
      expect(account?.provider).toBe("grok");
      const service = new GrokProfileService({ store });
      const result = await service.collectQuota(accountId!, {
        http: createNodeHttpClient(),
        now: () => Date.now(),
        credentials: {
          getOAuthToken: async () => undefined,
          getSecret: async () => undefined,
        },
      });
      const sanitized: {
        provider: string;
        accountRef: string;
        maskedIdentity?: string;
        managedHome: boolean;
        hostHomeUsed: boolean;
        synthetic: boolean;
        status: string;
        quotaWindows: Array<{
          id: string;
          label: string;
          usedPercent: number;
          resetsAt?: number;
        }>;
        errorClass?: string | undefined;
        hasLastError: boolean;
      } = {
        provider: result.provider,
        accountRef: result.accountId.slice(0, 13),
        ...(result.maskedIdentity ? { maskedIdentity: result.maskedIdentity } : {}),
        managedHome: true,
        hostHomeUsed: false,
        synthetic: false,
        status: result.status,
        quotaWindows: (result.quotaWindows ?? []).map((window) => ({
          id: window.id,
          label: window.label,
          usedPercent: window.usedPercent,
          ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
        })),
        ...(errorClassFor(result) ? { errorClass: errorClassFor(result) } : {}),
        hasLastError: Boolean(result.lastError),
      };
      if (sanitized.quotaWindows.length > 0 && sanitized.errorClass) {
        delete sanitized.errorClass;
      }
      writeFileSync(outputPath!, JSON.stringify(sanitized, null, 2) + "\n", {
        encoding: "utf8",
        mode: 0o600,
      });
      console.log(JSON.stringify(sanitized));
    },
  );
});
