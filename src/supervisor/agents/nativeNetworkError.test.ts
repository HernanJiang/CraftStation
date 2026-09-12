import { describe, expect, it } from "vitest";
import { explainNativeNetworkError, isNativeNetworkErrorMessage } from "./nativeNetworkError";

describe("native network errors", () => {
  it("detects the grok reqwest stream failure", () => {
    const raw =
      "reqwest error stream: error sending request for url (https://cli-chat-proxy.grok.com/v1/responses)";
    expect(isNativeNetworkErrorMessage(raw)).toBe(true);
    const explained = explainNativeNetworkError(new Error(raw), "Grok")!;
    expect(explained).toContain("原生Grok");
    expect(explained).toContain("cli-chat-proxy.grok.com");
    expect(explained).toContain("未经过 CPA 中转");
    expect(explained).toContain("reqwest error stream");
  });

  it("works without a provider label by using the extracted host", () => {
    const explained = explainNativeNetworkError(
      "error sending request for url (https://api.moonshot.ai/v1/chat)",
    )!;
    expect(explained).toContain("api.moonshot.ai");
    expect(explained).toContain("原生直连");
  });

  it("detects common transport failures", () => {
    for (const raw of [
      "connect ECONNREFUSED 127.0.0.1:443",
      "read ECONNRESET",
      "getaddrinfo EAI_AGAIN chatgpt.com",
      "TLS certificate verify failed",
      "socket hang up",
      "operation timed out",
    ]) {
      expect(isNativeNetworkErrorMessage(raw)).toBe(true);
    }
  });

  it("never matches quota/auth/model errors", () => {
    for (const raw of [
      "Grok 额度已耗尽",
      "usage balance exhausted",
      "You've hit your usage limit",
      "not logged into Antigravity, please sign in",
      "invalid model selection",
      "Turn execution timed out after 120000ms waiting for turn.completed",
      "",
      "Internal error",
    ]) {
      expect(isNativeNetworkErrorMessage(raw)).toBe(false);
      expect(explainNativeNetworkError(new Error(raw), "Grok")).toBeUndefined();
    }
  });
});
