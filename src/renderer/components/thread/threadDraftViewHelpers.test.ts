// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentCapability, AgentStatus } from "@/shared/contracts";
import {
  formatEffortLabel,
  resolveFastValue,
  resolvePreferredAgentKind,
  resolveProviderDraftConfig,
  resolveSavedProviderDraftConfig,
  resolveThinkingValue,
  withPreferredModel,
} from "./threadDraftViewHelpers";

const capabilities = {
  models: [
    { id: "fast-capable", label: "Fast Capable" },
    { id: "plain", label: "Plain" },
  ],
  efforts: ["low", "high"],
  modelEfforts: { "fast-capable": ["low", "high"], plain: ["high"] },
  fastModels: ["fast-capable"],
  thinkingModels: [],
  modes: ["agent"],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "direct",
  presentationMode: "gui",
  settingDefs: [],
} as unknown as AgentCapability;

function agentWith(overrides?: Partial<AgentCapability>): AgentStatus {
  return {
    kind: "test",
    label: "Test",
    installed: true,
    authState: "authenticated",
    capabilities: { ...capabilities, ...overrides },
  } as unknown as AgentStatus;
}

describe("resolveProviderDraftConfig fast mode", () => {
  it("turns Fast on for a supported model when nothing was saved", () => {
    expect(resolveProviderDraftConfig(agentWith(), { model: "fast-capable" }).fast).toBe(true);
  });

  it("keeps Fast off when the saved draft explicitly disabled it", () => {
    expect(
      resolveProviderDraftConfig(agentWith(), { model: "fast-capable", fast: false }).fast,
    ).toBe(false);
  });

  it("leaves Fast off for a model that does not support it", () => {
    expect(resolveProviderDraftConfig(agentWith(), { model: "plain" }).fast).toBeUndefined();
  });

  it("leaves Fast off when the account cannot use it", () => {
    const gated = agentWith({ fastDisabledReason: "Fast requests are disabled for this account." });
    expect(resolveProviderDraftConfig(gated, { model: "fast-capable" }).fast).toBeUndefined();
  });

  it("normalizes Cursor profile bracket models before resolving draft controls", () => {
    expect(
      resolveProviderDraftConfig(
        {
          ...agentWith(),
          kind: "cursor:work",
          label: "Cursor Work",
          capabilities: {
            ...capabilities,
            models: [{ id: "gpt-5.1-codex-max", label: "Codex 5.1 Max" }],
            modelEfforts: { "gpt-5.1-codex-max": ["high"] },
            fastModels: ["gpt-5.1-codex-max"],
            thinkingModels: ["gpt-5.1-codex-max"],
          },
        },
        { model: "gpt-5.1-codex-high-thinking-fast" },
      ),
    ).toMatchObject({
      model: "gpt-5.1-codex-max",
      effort: "high",
      fast: true,
      thinking: true,
    });
  });
});

describe("resolveProviderDraftConfig global permission default", () => {
  const permissionAgent = agentWith({
    approvalPolicies: [
      { id: "normal", label: "Normal" },
      { id: "accept-edits", label: "Accept Edits" },
      { id: "yolo", label: "Bypass" },
    ],
    sandboxModes: [
      { id: "workspace-write", label: "Workspace Write" },
      { id: "danger-full-access", label: "Full Access" },
    ],
    defaultApprovalPolicy: "accept-edits",
    defaultSandboxMode: "workspace-write",
    bypassPermissions: {
      approvalPolicy: "yolo",
      sandboxMode: "danger-full-access",
    },
  });

  it("overrides saved provider permissions with the global ask default", () => {
    expect(
      resolveProviderDraftConfig(
        permissionAgent,
        {
          model: "plain",
          approvalPolicy: "yolo",
          sandboxMode: "danger-full-access",
        },
        "ask",
      ),
    ).toMatchObject({ approvalPolicy: "normal", sandboxMode: "workspace-write" });
  });

  it("maps the global full-access default through each provider's bypass declaration", () => {
    expect(
      resolveProviderDraftConfig(
        permissionAgent,
        { model: "plain", approvalPolicy: "normal", sandboxMode: "workspace-write" },
        "full-access",
      ),
    ).toMatchObject({ approvalPolicy: "yolo", sandboxMode: "danger-full-access" });
  });
});

describe("resolveFastValue", () => {
  // AI helpers resolve `fast` through this helper, so its default stays opt-in
  // and background work never spends fast requests on its own.
  it("stays off without an explicit preference", () => {
    expect(resolveFastValue(agentWith(), "fast-capable")).toBe(false);
  });

  it("honours an explicit preference for a supported model", () => {
    expect(resolveFastValue(agentWith(), "fast-capable", true)).toBe(true);
  });

  it("refuses an explicit preference for an unsupported model", () => {
    expect(resolveFastValue(agentWith(), "plain", true)).toBe(false);
  });
});

describe("resolveProviderDraftConfig thinking mode", () => {
  const thinkingAgent = () => agentWith({ thinkingModels: ["plain"] });

  it("turns Thinking on for a supported model when nothing was saved", () => {
    expect(resolveProviderDraftConfig(thinkingAgent(), { model: "plain" }).thinking).toBe(true);
  });

  it("keeps Thinking off when the saved draft explicitly disabled it", () => {
    expect(
      resolveProviderDraftConfig(thinkingAgent(), { model: "plain", thinking: false }).thinking,
    ).toBe(false);
  });

  it("leaves Thinking absent for a model that does not support it", () => {
    expect(
      resolveProviderDraftConfig(thinkingAgent(), { model: "fast-capable" }).thinking,
    ).toBeUndefined();
  });
});

describe("withPreferredModel", () => {
  it("keeps a third-party custom model id that the target harness catalog lacks", () => {
    const injected = withPreferredModel(capabilities, "glm-5.3-flash-C");
    expect(injected.models[0]).toEqual({ id: "glm-5.3-flash-C", label: "glm-5.3-flash-C" });
    expect(
      resolveProviderDraftConfig(agentWith(injected), { model: "glm-5.3-flash-C" }).model,
    ).toBe("glm-5.3-flash-C");
  });

  it("keeps a recipe model that is absent from the harness catalog even without an account id", () => {
    const injected = withPreferredModel(capabilities, "gemini-3.8-flash");
    expect(
      resolveProviderDraftConfig(agentWith(injected), { model: "gemini-3.8-flash" }).model,
    ).toBe("gemini-3.8-flash");
  });
});

describe("resolveThinkingValue", () => {
  it("stays off without an explicit preference outside composer default resolution", () => {
    expect(resolveThinkingValue(agentWith({ thinkingModels: ["plain"] }), "plain")).toBe(false);
  });
});

describe("resolveSavedProviderDraftConfig", () => {
  it("fills an omitted context window and model controls from app-wide preferences", () => {
    const resolved = resolveSavedProviderDraftConfig(
      "codex",
      { agentKind: "codex", model: "gpt-5.6-sol", effort: "high" },
      {
        codex: {
          model: "gpt-5.6-sol",
          contextSize: "400k",
          effort: "medium",
          fast: false,
        },
      },
    );

    expect(resolved).toMatchObject({
      model: "gpt-5.6-sol",
      effort: "medium",
      contextSize: "400k",
      fast: false,
    });
  });

  it("uses global model preferences instead of a different project's effort and Fast", () => {
    expect(
      resolveSavedProviderDraftConfig(
        "codex",
        {
          agentKind: "codex",
          model: "gpt-5.6-luna",
          effort: "low",
          fast: false,
        },
        { codex: { model: "gpt-5.6-sol", effort: "high", fast: false } },
        {
          codex: {
            "gpt-5.6-luna": { effort: "max", fast: true },
            "gpt-5.6-sol": { effort: "high", fast: false },
          },
        },
      ),
    ).toMatchObject({ model: "gpt-5.6-luna", effort: "max", fast: true });
  });

  it("keeps an explicit last-draft context size over the provider preset", () => {
    expect(
      resolveSavedProviderDraftConfig(
        "codex",
        { agentKind: "codex", model: "gpt-5.6-sol", contextSize: "1m" },
        { codex: { model: "gpt-5.6-sol", contextSize: "400k" } },
      ),
    ).toMatchObject({ contextSize: "1m" });
  });
});

describe("formatEffortLabel", () => {
  it("keeps vendor-native English labels (never translated)", () => {
    expect(formatEffortLabel("xhigh")).toBe("Extra High");
    expect(formatEffortLabel("xHigh")).toBe("Extra High");
    expect(formatEffortLabel("max")).toBe("Max");
    expect(formatEffortLabel("high")).toBe("High");
    expect(formatEffortLabel("minimal")).toBe("Minimal");
  });
});

describe("resolvePreferredAgentKind", () => {
  const installed = [
    { kind: "codex", label: "Codex" },
    { kind: "opencode", label: "OpenCode" },
  ] as unknown as AgentStatus[];

  it("restores the last-draft agent only with explicit model memory for it", () => {
    const lastDraft = { agentKind: "opencode", model: "opencode/big-pickle" } as never;
    expect(resolvePreferredAgentKind(installed, lastDraft, { opencode: "x" })).toBe("opencode");
    // Bare last-draft restore (e.g. an auto-persisted default) falls to the list head.
    expect(resolvePreferredAgentKind(installed, lastDraft, {})).toBe("codex");
    expect(resolvePreferredAgentKind(installed, lastDraft)).toBe("codex");
    expect(resolvePreferredAgentKind(installed, undefined, {})).toBe("codex");
    expect(resolvePreferredAgentKind([], undefined, {})).toBeUndefined();
  });
});
