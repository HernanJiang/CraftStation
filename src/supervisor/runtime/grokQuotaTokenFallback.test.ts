import { describe, expect, it } from "vitest";
import type { HttpClient, HttpResponse, OAuthToken } from "@poracode/agents-usage";
import {
  collectManagedGrokTokenQuota,
  GROK_PROXY_BILLING_ENDPOINT,
  GROK_PROXY_CREDITS_ENDPOINT,
  GROK_TOKEN_GRPC_ENDPOINT,
} from "./grokQuotaTokenFallback";

const TOKEN: OAuthToken = { accessToken: "managed-access-token" };
const NOW = 1_800_000_000_000;

function frame(payload: Uint8Array, flags = 0): Uint8Array {
  const header = Buffer.alloc(5);
  header[0] = flags;
  header.writeUInt32BE(payload.length, 1);
  return Uint8Array.from(Buffer.concat([header, payload]));
}

function varint(value: number): number[] {
  const result: number[] = [];
  let next = value;
  while (next >= 0x80) {
    result.push((next & 0x7f) | 0x80);
    next = Math.floor(next / 128);
  }
  result.push(next);
  return result;
}

function grpcCreditsResponse(usedPercent: number, resetAt: number): HttpResponse {
  const percent = Buffer.alloc(4);
  percent.writeFloatLE(usedPercent, 0);
  const payload = Uint8Array.from([0x0d, ...percent, 0x10, ...varint(resetAt)]);
  const body = Buffer.from(frame(payload)).toString("base64");
  return {
    status: 200,
    headers: { "content-type": "application/grpc-web-text" },
    body,
    bodyBytes: Uint8Array.from(Buffer.from(body, "utf8")),
  };
}

function jsonResponse(body: unknown, status = 200): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describe("managed Grok token billing fallback", () => {
  it("uses the managed Bearer in proxy credits/billing then Grok gRPC-web", async () => {
    const requests: { url: string; headers?: Record<string, string>; method?: string }[] = [];
    const responses: (HttpResponse | Error)[] = [
      jsonResponse({ error: "temporary" }, 503),
      jsonResponse({ error: "temporary" }, 503),
      jsonResponse({ config: {} }),
      grpcCreditsResponse(42.5, 1_900_000_000),
    ];
    const http: HttpClient = {
      request: async (request) => {
        requests.push({
          url: request.url,
          ...(request.headers ? { headers: request.headers } : {}),
          ...(request.method ? { method: request.method } : {}),
        });
        const next = responses.shift();
        if (!next) throw new Error("unexpected request");
        if (next instanceof Error) throw next;
        return next;
      },
    };

    const result = await collectManagedGrokTokenQuota({
      http,
      token: TOKEN,
      now: () => NOW,
      attempts: 2,
    });

    expect(result).toEqual({
      ok: true,
      source: "grpc-web",
      fetchedAt: NOW,
      windows: [
        {
          id: "monthly",
          label: "Credits",
          usedPercent: 42.5,
          resetsAt: 1_900_000_000_000,
        },
      ],
    });
    expect(requests.map((request) => request.url)).toEqual([
      GROK_PROXY_CREDITS_ENDPOINT,
      GROK_PROXY_CREDITS_ENDPOINT,
      GROK_PROXY_BILLING_ENDPOINT,
      GROK_TOKEN_GRPC_ENDPOINT,
    ]);
    expect(
      requests.every((request) => request.headers?.Authorization === "Bearer managed-access-token"),
    ).toBe(true);
    expect(requests.at(-1)?.method).toBe("POST");
  });

  it("retries a transient proxy failure and accepts a real zero-percent credit response", async () => {
    let calls = 0;
    const result = await collectManagedGrokTokenQuota({
      http: {
        request: async () => {
          calls += 1;
          if (calls === 1) throw new Error("fetch failed while connecting");
          return jsonResponse({ config: { creditUsagePercent: 0 } });
        },
      },
      token: TOKEN,
      now: () => NOW,
      attempts: 2,
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({ ok: true, source: "proxy", windows: [{ usedPercent: 0 }] });
  });

  it("does not pretend to use a cookie and reports auth without one", async () => {
    const result = await collectManagedGrokTokenQuota({
      http: { request: async () => jsonResponse({ error: "unauthorized" }, 401) },
      token: TOKEN,
      now: () => NOW,
      attempts: 1,
    });

    expect(result).toEqual({ ok: false, errorClass: "auth", error: "HTTP 401" });
  });
});
