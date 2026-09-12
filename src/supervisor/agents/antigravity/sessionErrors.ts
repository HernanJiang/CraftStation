/**
 * Antigravity pool quota/auth signals for turn failures. Mirrors the shapes
 * the standalone switchers watch for (`Individual quota reached`,
 * `RESOURCE_EXHAUSTED / 429`); deliberately narrow so model-selection and
 * project-config errors never mark an account exhausted. Shared by the
 * supervisor write-back and the pool-failover gate so both agree on what
 * "this row is spent" means.
 */

/** True when the turn died because this pool row's quota is spent. */
export function isAntigravityQuotaError(message: string): boolean {
  return /individual quota reached|resource_exhausted|quota\s+(exceeded|exhausted)|\b429\b/i.test(
    message,
  );
}

/**
 * True when the turn died because this pool row's grant is gone (the CLI's
 * own sign-in prompts). Model, project, and transport errors must not flip
 * an account to auth-expired.
 */
export function isAntigravityAuthError(message: string): boolean {
  return /not logged into|authentication (required|failed|timed out)|please sign in|unauthenticated/i.test(
    message,
  );
}
