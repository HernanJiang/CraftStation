import { describe, expect, it } from "vitest";
import { createFakeHost } from "../testHost";
import {
  collectOpenAiCompatible,
  normalizeOpenAiCompatibleBaseUrl,
  openAiCompatibleModelsUrl,
} from "./openaiCompatible";

describe("OpenAI-compatible credential probe", () => {
  it("normalizes a base URL and appends the models endpoint once", () => {
    expect(normalizeOpenAiCompatibleBaseUrl(" https://api.example.com/v1/// ")).toBe(
      "https://api.example.com/v1",
    );
    expect(openAiCompatibleModelsUrl("https://api.example.com/v1")).toBe(
      "https://api.example.com/v1/models",
    );
  });

  it.each([
    "api.example.com/v1",
    "ftp://api.example.com/v1",
    "https://user:pass@api.example.com/v1",
    "https://api.example.com/v1?key=secret",
    "https://api.example.com/v1#fragment",
  ])("rejects an unsafe or non-HTTP base URL: %s", (value) => {
    expect(normalizeOpenAiCompatibleBaseUrl(value)).toBeUndefined();
  });

  it("rejects an invalid key without making a request", async () => {
    const requests: unknown[] = [];
    const snapshot = await collectOpenAiCompatible(
      createFakeHost({
        onRequest: (request) => requests.push(request),
        secrets: { "openai-compatible": { baseUrl: "https://api.example.com/v1", apiKey: "" } },
      }),
    );
    expect(snapshot.status).toBe("auth-missing");
    expect(requests).toHaveLength(0);
  });

  it.each([
    [401, "auth-missing"],
    [403, "auth-missing"],
    [429, "rate-limited"],
    [500, "error"],
  ] as const)("maps HTTP %i to %s", async (status, expected) => {
    const requests: Array<{ url: string; authorization: string | undefined }> = [];
    const snapshot = await collectOpenAiCompatible(
      createFakeHost({
        secrets: {
          "openai-compatible": { baseUrl: "https://api.example.com/v1", apiKey: "sk-test" },
        },
        routes: { "https://api.example.com/v1/models": { status } },
        onRequest: (request) =>
          requests.push({ url: request.url, authorization: request.headers?.Authorization }),
      }),
    );
    expect(snapshot.status).toBe(expected);
    expect(requests).toEqual([
      { url: "https://api.example.com/v1/models", authorization: "Bearer sk-test" },
    ]);
  });

  it("accepts a successful models response but never exposes the key", async () => {
    const snapshot = await collectOpenAiCompatible(
      createFakeHost({
        secrets: {
          "openai-compatible": { baseUrl: "https://api.example.com/v1", apiKey: "sk-secret" },
        },
        routes: { "https://api.example.com/v1/models": { status: 200, body: '{"data":[]}' } },
      }),
    );
    expect(snapshot).toMatchObject({
      providerId: "openai-compatible",
      status: "ok",
      authenticatedAs: "https://api.example.com/v1",
    });
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret");
  });

  it("turns a network failure into a stable error snapshot", async () => {
    const host = createFakeHost({
      secrets: {
        "openai-compatible": { baseUrl: "https://api.example.com/v1", apiKey: "sk-test" },
      },
    });
    host.http.request = async () => {
      throw new Error("offline");
    };
    await expect(collectOpenAiCompatible(host)).resolves.toMatchObject({
      status: "error",
      error: "OpenAI 兼容 API 连接失败。",
    });
  });
});
