import { describe, expect, it } from "vitest";
import {
  isHarnessCompatibleWithThirdParty,
  resolveAutoHarness,
  resolveExplicitHarness,
  resolveModelFamily,
} from "./autoHarnessResolver";

describe("autoHarnessResolver", () => {
  it("detects model families as hints", () => {
    expect(resolveModelFamily("gpt-5.6-sol")).toBe("openai");
    expect(resolveModelFamily("o3-mini")).toBe("openai");
    expect(resolveModelFamily("k3-256k")).toBe("kimi");
    expect(resolveModelFamily("k2-think")).toBe("kimi");
    expect(resolveModelFamily("grok-4.1")).toBe("grok");
    expect(resolveModelFamily("gemini-3.8-flash")).toBe("gemini");
    expect(resolveModelFamily("my-company-coder-v7")).toBe("unknown");
  });

  it("gpt + responses → Codex native", () => {
    const decision = resolveAutoHarness({ modelId: "gpt-5.6-sol", validatedProtocol: "responses" });
    expect(decision.harnessId).toBe("codex");
    expect(decision.route).toBe("third-party-native");
    expect(decision.bypassAccountPool).toBe(true);
    expect(decision.credentialSource).toBe("third-party");
  });

  it("gpt + chat → OpenCode fallback (never force Codex)", () => {
    const decision = resolveAutoHarness({ modelId: "gpt-5.6-sol", validatedProtocol: "chat_completions" });
    expect(decision.harnessId).toBe("opencode");
    expect(decision.route).toBe("third-party-fallback");
    expect(decision.reason).toContain("codex");
  });

  it("kimi + responses/chat → Kimi Code without any account-pool lookup", () => {
    for (const protocol of ["responses", "chat_completions"] as const) {
      const decision = resolveAutoHarness({ modelId: "k3-256k", validatedProtocol: protocol });
      expect(decision.harnessId).toBe("kimi");
      expect(decision.bypassAccountPool).toBe(true);
    }
  });

  it("grok + responses/chat → Grok Build when available", () => {
    expect(
      resolveAutoHarness({ modelId: "grok-4.1", validatedProtocol: "responses" }).harnessId,
    ).toBe("grok");
    expect(
      resolveAutoHarness({ modelId: "grok-4.1", validatedProtocol: "chat_completions" }).harnessId,
    ).toBe("grok");
  });

  it("gemini + OpenAI-compatible endpoint → OpenCode (no fake Antigravity)", () => {
    const decision = resolveAutoHarness({
      modelId: "gemini-3.8-flash",
      validatedProtocol: "responses",
    });
    expect(decision.harnessId).toBe("opencode");
    expect(isHarnessCompatibleWithThirdParty("antigravity", "responses")).toBe(false);
  });

  it("unknown model → OpenCode", () => {
    const decision = resolveAutoHarness({
      modelId: "my-company-coder-v7",
      validatedProtocol: "responses",
    });
    expect(decision.harnessId).toBe("opencode");
  });

  it("explicit harness always wins but stays compatibility-checked", () => {
    const explicit = resolveExplicitHarness({
      harnessId: "opencode",
      modelId: "gpt-5.6-sol",
      validatedProtocol: "chat_completions",
    });
    expect(explicit.harnessId).toBe("opencode");

    const incompatible = resolveExplicitHarness({
      harnessId: "codex",
      modelId: "gpt-5.6-sol",
      validatedProtocol: "chat_completions",
    });
    expect(incompatible.route).toBe("unsupported");
    expect(incompatible.reason).toContain("does not support");
  });

  it("unavailable preferred harness falls back to OpenCode", () => {
    const decision = resolveAutoHarness({
      modelId: "gpt-5.6-sol",
      validatedProtocol: "responses",
      harnessAvailable: { codex: false, opencode: true },
    });
    expect(decision.harnessId).toBe("opencode");
    expect(decision.route).toBe("third-party-fallback");
  });
});
