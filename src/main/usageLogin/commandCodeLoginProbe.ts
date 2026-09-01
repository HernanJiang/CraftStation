import { isCommandCodeSessionLive } from "@craftstation/agents-usage";
import { fetchHttpClient } from "./fetchHttpClient";

/**
 * Verifies a captured commandcode.ai Cookie header is a real signed-in web
 * session (the billing endpoint answers 2xx), not a stale cookie that merely
 * shares the better-auth name. Gates the browser-login prompt; the usage
 * collector runs the same check via the shared @craftstation/agents-usage helper
 * with the supervisor HTTP client.
 */
export function isCommandCodeLoginCookieLive(cookieHeader: string): Promise<boolean> {
  return isCommandCodeSessionLive(fetchHttpClient, cookieHeader);
}
