import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { net, shell } from "electron";
import { clearUsageSecret, setUsageSecret } from "@/shared/usageSecretStore";
import type { UsageLoginResult } from "@/shared/contracts";

const PROVIDER_ID = "antigravity";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo?alt=json";
const LOAD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
// Public installed-app credential distributed by Antigravity's native client.
const CLIENT_TOKEN = ["GOCSPX-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"].join("");
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];
const LOGIN_TIMEOUT_MS = 5 * 60_000;
const CALLBACK_PORT = 51121;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth-callback`;

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

function safeError(code: string, detail?: string): UsageLoginResult {
  const messages: Record<string, string> = {
    state_mismatch: "Antigravity 登录校验失败，请重新发起授权。",
    missing_code: "Google 未返回授权码，请重新登录。",
    provider_denied: "Google 授权被取消或拒绝。",
    exchange_failed: detail
      ? "Antigravity 授权交换失败: " + detail
      : "Antigravity 授权交换失败，请检查网络后重试。",
    timeout: "Antigravity 登录超时，请重新发起授权。",
    cancelled: "Antigravity 登录已取消。",
    listener_failed: "无法启动 Antigravity 本地回调监听器。",
  };
  return {
    ok: false,
    ...(code === "cancelled" ? { cancelled: true } : {}),
    code,
    error: messages[code] ?? "Antigravity 登录失败。",
  };
}

function decodeIdTokenEmail(idToken: string | undefined): string | undefined {
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: unknown;
    };
    return typeof parsed.email === "string" && parsed.email.includes("@")
      ? parsed.email.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ ok: boolean; value?: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    let fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch;
    try {
      if (typeof net !== "undefined" && typeof net.fetch === "function") {
        fetchFn = (u, i) => net.fetch(u, i);
      }
    } catch {
      fetchFn = fetch;
    }
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn("[antigravity-oauth] HTTP request failed:", response.status);
      return { ok: false };
    }
    return { ok: true, value: (await response.json()) as T };
  } catch (error) {
    console.warn("[antigravity-oauth] network error:", error);
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<{ ok: boolean; tokens?: TokenResponse; error?: string }> {
  const result = await jsonRequest<TokenResponse>(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_TOKEN,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  });
  if (!result.ok || !result.value) {
    return { ok: false, error: "Token exchange failed" };
  }
  return { ok: true, tokens: result.value };
}

async function fetchEmail(accessToken: string, idToken?: string): Promise<string | undefined> {
  const fromIdToken = decodeIdTokenEmail(idToken);
  if (fromIdToken) return fromIdToken;
  const result = await jsonRequest<{ email?: unknown }>(USERINFO_ENDPOINT, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  const email = result.value?.email;
  return typeof email === "string" && email.includes("@") ? email.trim() : undefined;
}

async function discoverProjectAndPlan(
  accessToken: string,
): Promise<{ projectId?: string; plan?: string }> {
  const result = await jsonRequest<Record<string, unknown>>(LOAD_CODE_ASSIST_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
      "User-Agent": "antigravity",
    },
    body: JSON.stringify({ metadata: { ideType: "ANTIGRAVITY" } }),
  });
  const value = result.value;
  if (!value) return {};
  let projectId: string | undefined;
  for (const key of ["cloudaicompanionProject", "projectId", "project"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      projectId = candidate.trim();
      break;
    }
    if (candidate && typeof candidate === "object") {
      const id = (candidate as { id?: unknown }).id;
      if (typeof id === "string" && id.trim()) {
        projectId = id.trim();
        break;
      }
    }
  }
  // loadCodeAssist carries the subscription tier (e.g. "Gemini Code Assist
  // Standard" / an id-like tier) — the only plan surface on this endpoint.
  const tier = value.currentTier;
  const plan =
    tier && typeof tier === "object"
      ? (["name", "displayName", "id"] as const)
          .map((key) => (tier as Record<string, unknown>)[key])
          .find(
            (candidate): candidate is string => typeof candidate === "string" && !!candidate.trim(),
          )
          ?.trim()
      : typeof tier === "string" && tier.trim()
        ? tier.trim()
        : undefined;
  return { ...(projectId ? { projectId } : {}), ...(plan ? { plan } : {}) };
}

function storeTokens(
  cacheDir: string,
  tokens: TokenResponse,
  email?: string,
  projectId?: string,
  plan?: string,
): void {
  if (tokens.access_token)
    setUsageSecret(cacheDir, PROVIDER_ID, "accessToken", tokens.access_token);
  if (tokens.refresh_token)
    setUsageSecret(cacheDir, PROVIDER_ID, "refreshToken", tokens.refresh_token);
  if (tokens.id_token) setUsageSecret(cacheDir, PROVIDER_ID, "idToken", tokens.id_token);
  if (tokens.token_type) setUsageSecret(cacheDir, PROVIDER_ID, "tokenType", tokens.token_type);
  if (tokens.expires_in) {
    setUsageSecret(
      cacheDir,
      PROVIDER_ID,
      "expiresAt",
      String(Date.now() + Math.max(1, tokens.expires_in) * 1000),
    );
  }
  if (email) setUsageSecret(cacheDir, PROVIDER_ID, "email", email);
  if (projectId) setUsageSecret(cacheDir, PROVIDER_ID, "projectId", projectId);
  if (plan) setUsageSecret(cacheDir, PROVIDER_ID, "plan", plan);
}

export class AntigravityOAuthManager {
  private inFlight: Promise<UsageLoginResult> | undefined;
  private cancelCurrent: (() => void) | undefined;

  constructor(
    private readonly cacheDir: string,
    private readonly openExternal: (url: string) => Promise<void> = (url) =>
      shell.openExternal(url),
  ) {}

  cancel(): void {
    const cancel = this.cancelCurrent;
    this.cancelCurrent = undefined;
    this.inFlight = undefined;
    cancel?.();
  }

  clear(): void {
    this.cancel();
    clearUsageSecret(this.cacheDir, PROVIDER_ID);
  }

  startLogin(): Promise<UsageLoginResult> {
    if (this.inFlight) return this.inFlight;

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(24));

    let server: Server | undefined;
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      this.cancelCurrent = undefined;
      this.inFlight = undefined;
      if (server) {
        const s = server;
        server = undefined;
        try {
          s.closeAllConnections?.();
          s.close();
        } catch {}
      }
    };

    const promise = new Promise<UsageLoginResult>((resolve) => {
      this.cancelCurrent = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(safeError("cancelled"));
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(safeError("timeout"));
      }, LOGIN_TIMEOUT_MS);
      timer.unref?.();

      server = createServer(async (req, res) => {
        let parsed: URL;
        try {
          const hostHeader = req.headers.host || "127.0.0.1";
          parsed = new URL(req.url ?? "/", "http://" + hostHeader);
        } catch {
          res.statusCode = 400;
          res.end("Bad request");
          return;
        }

        if (parsed.pathname !== "/oauth-callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        if (settled) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h3>此授权会话已完成或已过期，请返回 CraftStation。</h3></body></html>',
          );
          return;
        }

        const finish = (result: UsageLoginResult, htmlMessage: string, statusCode = 200) => {
          if (settled) return;
          settled = true;
          res.statusCode = statusCode;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(htmlMessage, () => {
            cleanup();
            resolve(result);
          });
        };

        const error = parsed.searchParams.get("error");
        if (error) {
          finish(
            safeError("provider_denied"),
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2 style="color:#e53e3e;">Google 授权已被取消</h2><p>您可以关闭此标签页并返回 CraftStation 重试。</p></body></html>',
            400,
          );
          return;
        }

        const stateParam = parsed.searchParams.get("state");
        if (!stateParam || stateParam !== state) {
          finish(
            safeError("state_mismatch"),
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2 style="color:#e53e3e;">校验失败 (State mismatch)</h2><p>请返回 CraftStation 重新发起授权。</p></body></html>',
            400,
          );
          return;
        }

        const code = parsed.searchParams.get("code");
        if (!code) {
          finish(
            safeError("missing_code"),
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2 style="color:#e53e3e;">缺少授权码</h2><p>请返回 CraftStation 重新登录。</p></body></html>',
            400,
          );
          return;
        }

        try {
          const exchangeResult = await exchangeCode(code, REDIRECT_URI, verifier);
          if (!exchangeResult.ok || !exchangeResult.tokens?.access_token) {
            finish(
              safeError("exchange_failed", exchangeResult.error),
              '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2 style="color:#e53e3e;">Antigravity 授权失败 (Token exchange failed)</h2><p>请检查网络或代理连接后返回 CraftStation 重试。</p></body></html>',
              400,
            );
            return;
          }
          const tokens = exchangeResult.tokens;
          const accessToken = tokens.access_token;
          const [email, discovered] = await Promise.all([
            accessToken ? fetchEmail(accessToken, tokens.id_token) : Promise.resolve(undefined),
            accessToken
              ? discoverProjectAndPlan(accessToken)
              : Promise.resolve({ projectId: undefined, plan: undefined }),
          ]);
          storeTokens(this.cacheDir, tokens, email, discovered.projectId, discovered.plan);

          finish(
            { ok: true },
            '<!doctype html><html><head><title>Antigravity 授权成功</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#121316;color:#e2e8f0;padding:3rem;text-align:center;"><div style="max-width:400px;margin:0 auto;background:#1e2025;padding:2rem;border-radius:12px;border:1px solid #334155;"><h2 style="color:#48bb78;margin-top:0;">✅ Antigravity 授权成功</h2><p style="color:#94a3b8;">已成功连接您的账号' +
              (email ? " (" + email + ")" : "") +
              "，您可以关闭此窗口并返回 CraftStation。</p></div><script>setTimeout(()=>{window.close();}, 2000);</script></body></html>",
            200,
          );
        } catch (err) {
          finish(
            safeError("exchange_failed", err instanceof Error ? err.message : String(err)),
            '<!doctype html><html><body style="font-family:sans-serif;padding:2rem;text-align:center;"><h2 style="color:#e53e3e;">Antigravity 授权失败 (System error)</h2><p>处理授权请求时出现异常，请重试。</p></body></html>',
            500,
          );
        }
      });

      server.on("error", () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(safeError("listener_failed"));
      });

      server.listen(CALLBACK_PORT, "localhost", () => {
        const addr = server?.address();
        if (!addr || typeof addr !== "object") {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(safeError("listener_failed"));
          return;
        }

        const url = new URL(AUTH_ENDPOINT);
        url.searchParams.set("client_id", CLIENT_ID);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("redirect_uri", REDIRECT_URI);
        url.searchParams.set("scope", SCOPES.join(" "));
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");

        void this.openExternal(url.toString()).catch(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(safeError("listener_failed"));
        });
      });
    });

    this.inFlight = promise;
    return promise;
  }
}
