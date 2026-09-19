import {
  antigravityQuotaSummaryWindows,
  type HostPort,
  type UsageWindow,
} from "@craftstation/agents-usage";

/** Account-scoped weekly/5h quota; old model availability does not include weekly limits. */
export async function readAntigravityQuotaSummary(
  host: HostPort,
  accessToken: string,
  requestBody: string,
): Promise<UsageWindow[]> {
  for (const base of [
    "https://cloudcode-pa.googleapis.com",
    "https://daily-cloudcode-pa.googleapis.com",
  ]) {
    try {
      const res = await host.http.request({
        method: "POST",
        url: `${base}/v1internal:retrieveUserQuotaSummary`,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity",
          Accept: "application/json",
        },
        body: requestBody,
        timeoutMs: 15_000,
      });
      // Callers own token refresh and the legacy fallback. Never turn missing
      // buckets into zero usage or borrow another account's local LS snapshot.
      if (res.status === 401 || res.status === 429) return [];
      if (res.status < 200 || res.status >= 300) continue;
      const windows = antigravityQuotaSummaryWindows(JSON.parse(res.body ?? ""));
      if (windows.length > 0) return windows;
    } catch {
      // Keep older servers and temporarily unavailable summary endpoints usable.
    }
  }
  return [];
}
