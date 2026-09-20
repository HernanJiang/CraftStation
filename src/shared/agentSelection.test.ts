import { describe, expect, it } from "vitest";
import type { AgentCapability, AgentStatus, SessionRef } from "./contracts";
import {
  adaptThreadConfigForCapabilities,
  agentStatusForPresentation,
  authStatusForPresentation,
  authStateForPresentation,
  capabilitiesForPresentation,
  filterHiddenModels,
  modelSelectionFor,
  resolveHighestCompatibleEffort,
  resolveHiddenModelIds,
  resolveModelSelection,
  resolveReasoningSelection,
  validateAgentModelSelection,
} from "./agentSelection";

const capabilities: AgentCapability = {
  models: [{ id: "terminal-model", label: "Terminal" }],
  efforts: ["low"],
  modelEfforts: {},
  fastModels: [],
  modes: [],
  approvalPolicies: [],
  sandboxModes: [],
  supportsResume: true,
  supportsDirectInput: true,
  liveInputMode: "terminal",
  presentationMode: "terminal",
  settingDefs: [],
  presentationCapabilities: {
    gui: {
      models: [{ id: "chat-model", label: "Chat" }],
      efforts: ["medium", "high"],
      modelEfforts: { "chat-model": ["high", "xhigh"] },
      defaultEffort: "high",
      fastModels: ["chat-model"],
      fastDisabledReason: "Fast is unavailable for this account",
      presentationMode: "gui",
    },
  },
};

function sessionRef(providerSessionId: string): SessionRef {
  return { providerSessionId, discoveredAt: "2026-07-27T00:00:00.000Z" };
}

describe("agent selection", () => {
  it("resolves the composer surface before exposing model controls", () => {
    const gui = capabilitiesForPresentation(capabilities, "gui");
    expect(gui.models).toEqual([{ id: "chat-model", label: "Chat" }]);
    expect(modelSelectionFor(gui, "chat-model")).toEqual({
      reasoning: { values: ["high", "xhigh"], default: "high" },
      fast: {
        supported: true,
        available: false,
        disabledReason: "Fast is unavailable for this account",
      },
    });
  });

  it("uses the same model and reasoning fallbacks as the composer", () => {
    const gui = capabilitiesForPresentation(capabilities, "gui");
    expect(resolveModelSelection(gui, "missing")).toBe("chat-model");
    expect(resolveReasoningSelection(gui, "chat-model", "missing")).toBe("high");
  });

  it("prefers a model's own probed default effort over the provider-wide one", () => {
    const withModelDefaults: AgentCapability = {
      ...capabilities,
      models: [
        { id: "highspeed", label: "Highspeed" },
        { id: "k3", label: "K3" },
      ],
      efforts: ["low", "medium", "high", "max"],
      defaultEffort: "low",
      modelDefaultEfforts: { k3: "high", "removed-model": "max", highspeed: "unsupported" },
    };
    // Product default is high everywhere: a high tier wins over per-model and
    // provider defaults; models whose vocabulary has no high tier keep the
    // existing chain (per-model pin, then provider default).
    expect(modelSelectionFor(withModelDefaults, "k3").reasoning.default).toBe("high");
    expect(modelSelectionFor(withModelDefaults, "highspeed").reasoning.default).toBe("high");
  });

  it("defaults undeclared models to the highest compatible tier, never empty", () => {
    const undeclared: AgentCapability = {
      ...capabilities,
      efforts: ["low", "medium", "high"],
    };
    expect(modelSelectionFor(undeclared, "any-model").reasoning.default).toBe("high");
    expect(resolveReasoningSelection(undeclared, "any-model", "")).toBe("high");
    expect(resolveReasoningSelection(undeclared, "any-model", undefined)).toBe("high");
  });

  it("omits effort entirely when a model offers no tiers", () => {
    const untiered: AgentCapability = { ...capabilities, efforts: [] };
    expect(modelSelectionFor(untiered, "any-model").reasoning.default).toBeUndefined();
    expect(resolveReasoningSelection(untiered, "any-model", undefined)).toBeUndefined();
    // An explicitly empty tier list means "no effort supported" — clear it.
    const explicitEmpty: AgentCapability = {
      ...capabilities,
      efforts: [],
      modelEfforts: { "tier-less": [] },
    };
    expect(resolveReasoningSelection(explicitEmpty, "tier-less", "high")).toBeUndefined();
    // A model id missing from the vocabulary entirely (stale probe,
    // slug/display skew) must not clobber an explicit pick into "".
    expect(resolveReasoningSelection(untiered, "unknown-model", "low")).toBe("low");
  });

  it("ranks highest-compatible effort high-first across casings", () => {
    expect(resolveHighestCompatibleEffort([])).toBeUndefined();
    expect(resolveHighestCompatibleEffort(["low", "medium", "high"])).toBe("high");
    expect(resolveHighestCompatibleEffort(["low", "medium"])).toBe("medium");
    expect(resolveHighestCompatibleEffort(["Low", "Medium", "High"])).toBe("High");
    expect(resolveHighestCompatibleEffort(["on"])).toBe("on");
    expect(resolveHighestCompatibleEffort(["low", "high", "max"])).toBe("high");
  });

  it("uses provider visibility defaults until the user saves an explicit list", () => {
    const withDefaults: AgentCapability = {
      ...capabilities,
      models: [
        { id: "legacy", label: "Legacy" },
        { id: "current", label: "Current" },
      ],
      defaultHiddenModels: ["legacy"],
    };

    expect(resolveHiddenModelIds(withDefaults, undefined)).toEqual(["legacy"]);
    expect(filterHiddenModels(withDefaults, undefined).models.map(({ id }) => id)).toEqual([
      "current",
    ]);
    // Curated-discovery semantics: an explicit hidden list alone never opts a
    // default-hidden model back in — only an explicit "shown" entry does.
    expect(resolveHiddenModelIds(withDefaults, [])).toEqual(["legacy"]);
    expect(filterHiddenModels(withDefaults, []).models.map(({ id }) => id)).toEqual(["current"]);
    expect(filterHiddenModels(withDefaults, ["current"]).models.map(({ id }) => id)).toEqual([]);
    // Explicitly shown models stay visible regardless of the hidden list.
    expect(
      filterHiddenModels(withDefaults, ["current", "legacy"], ["legacy"]).models.map(
        ({ id }) => id,
      ),
    ).toEqual(["legacy"]);
  });

  it("does not leak terminal visibility defaults into a GUI capability override", () => {
    const splitDefaults: AgentCapability = {
      ...capabilities,
      defaultHiddenModels: ["terminal-model"],
      presentationCapabilities: {
        gui: {
          ...capabilities.presentationCapabilities!.gui!,
          defaultHiddenModels: ["chat-model"],
        },
      },
    };

    expect(capabilitiesForPresentation(splitDefaults, "terminal").defaultHiddenModels).toEqual([
      "terminal-model",
    ]);
    expect(capabilitiesForPresentation(splitDefaults, "gui").defaultHiddenModels).toEqual([
      "chat-model",
    ]);
  });

  it("preserves root context metadata when presentation models use compatible ids", () => {
    const withContextMetadata: AgentCapability = {
      ...capabilities,
      models: [
        { id: "chat-model", label: "Chat" },
        { id: "other-model", label: "Other" },
      ],
      contextSizes: [
        { id: "128k", label: "128K" },
        { id: "256k", label: "256K" },
      ],
      modelContextSizes: {
        "chat-model": ["128k", "256k"],
        "other-model": ["128k"],
      },
      defaultContextSize: "128k",
      presentationCapabilities: {
        gui: {
          ...capabilities.presentationCapabilities!.gui!,
          models: [{ id: "chat-model", label: "Chat" }],
        },
      },
    };

    expect(capabilitiesForPresentation(withContextMetadata, "gui")).toMatchObject({
      contextSizes: [
        { id: "128k", label: "128K" },
        { id: "256k", label: "256K" },
      ],
      modelContextSizes: { "chat-model": ["128k", "256k"] },
      defaultContextSize: "128k",
    });
  });

  it("does not expose root context metadata to incompatible presentation models", () => {
    const withContextMetadata: AgentCapability = {
      ...capabilities,
      contextSizes: [{ id: "400k", label: "400K" }],
      modelContextSizes: { "terminal-model": ["400k"] },
      defaultContextSize: "400k",
      presentationCapabilities: {
        gui: {
          ...capabilities.presentationCapabilities!.gui!,
          models: [{ id: "chat-model", label: "Chat" }],
        },
      },
    };

    const gui = capabilitiesForPresentation(withContextMetadata, "gui");
    expect(gui.contextSizes).toBeUndefined();
    expect(gui.modelContextSizes).toBeUndefined();
    expect(gui.defaultContextSize).toBeUndefined();
  });

  it("validates orchestrator input against the advertised options", () => {
    const gui = capabilitiesForPresentation(capabilities, "gui");
    expect(
      validateAgentModelSelection(gui, {
        model: "chat-model",
        reasoning: "xhigh",
      }),
    ).toBeUndefined();
    expect(validateAgentModelSelection(gui, { model: "chat-model", fast: true })).toBe(
      "Fast is unavailable for this account",
    );
  });

  it("resolves presentation-specific authentication with a legacy fallback", () => {
    expect(
      authStateForPresentation(
        {
          authState: "authenticated",
          presentationAuthStates: { gui: "missing" },
        },
        "gui",
      ),
    ).toBe("missing");
    expect(
      authStateForPresentation(
        {
          authState: "authenticated",
          presentationAuthStates: { gui: "missing" },
        },
        "terminal",
      ),
    ).toBe("authenticated");
  });

  it("removes misleading provider login actions for externally authenticated runtimes", () => {
    const status = authStatusForPresentation(
      {
        kind: "cursor",
        label: "Cursor",
        installed: true,
        authState: "authenticated",
        loginCommand: "cursor-agent login",
        authMethods: [{ type: "terminal", id: "login", name: "Login", args: ["login"] }],
        authLogoutSupported: true,
        presentationAuthStates: { gui: "missing" },
        presentationAuthUsesProviderLogin: { gui: false },
        capabilities,
      },
      "gui",
    );

    expect(status.authState).toBe("missing");
    expect(status.loginCommand).toBeUndefined();
    expect(status.authMethods).toBeUndefined();
    expect(status.authLogoutSupported).toBeUndefined();
  });

  it("resolves authentication and capabilities as one presentation status", () => {
    const status = agentStatusForPresentation(
      {
        kind: "cursor",
        label: "Cursor",
        installed: true,
        authState: "missing",
        loginCommand: "cursor-agent login",
        presentationAuthStates: { gui: "authenticated" },
        presentationAuthUsesProviderLogin: { gui: false },
        capabilities,
      },
      "gui",
    );

    expect(status.authState).toBe("authenticated");
    expect(status.loginCommand).toBeUndefined();
    expect(status.capabilities.models).toEqual([{ id: "chat-model", label: "Chat" }]);
    expect(status.capabilities.defaultEffort).toBe("high");
    expect(status.capabilities.fastModels).toEqual(["chat-model"]);
    expect(status.capabilities.presentationMode).toBe("gui");
  });

  it("pins existing sessions to their runtime variant after the default changes", () => {
    const { presentationCapabilities: _presentationCapabilities, ...baseCapabilities } =
      capabilities;
    const acpCapabilities: AgentCapability = {
      ...baseCapabilities,
      models: [{ id: "acp-model", label: "ACP" }],
      liveInputMode: "server",
      presentationMode: "gui",
    };
    const sdkCapabilities: AgentCapability = {
      ...acpCapabilities,
      models: [{ id: "sdk-model", label: "SDK" }],
      approvalPolicies: [{ id: "default", label: "Auto-review" }],
    };
    const status: AgentStatus = {
      kind: "cursor",
      label: "Cursor",
      installed: true,
      authState: "authenticated",
      loginCommand: "cursor-agent login",
      authMethods: [{ type: "terminal", id: "login", name: "Login", args: ["login"] }],
      authLogoutSupported: true,
      presentationAuthStates: { gui: "missing" },
      presentationAuthUsesProviderLogin: { gui: false },
      capabilities: {
        ...capabilities,
        presentationCapabilities: { gui: sdkCapabilities },
      },
      runtimeVariants: {
        acp: {
          presentationMode: "gui",
          installed: true,
          authState: "authenticated",
          authUsesProviderLogin: true,
          capabilities: acpCapabilities,
        },
        sdk: {
          presentationMode: "gui",
          installed: true,
          authState: "missing",
          authUsesProviderLogin: false,
          capabilities: sdkCapabilities,
        },
      },
      sessionRuntimeRouting: {
        prefixes: { "sdk:": "sdk" },
        fallbackRuntime: "acp",
      },
    };

    const existingAcp = agentStatusForPresentation(status, "gui", sessionRef("legacy-acp-session"));
    expect(existingAcp.authState).toBe("authenticated");
    expect(existingAcp.loginCommand).toBe("cursor-agent login");
    expect(existingAcp.capabilities.models).toEqual([{ id: "acp-model", label: "ACP" }]);
    expect(agentStatusForPresentation(existingAcp, "gui").loginCommand).toBe("cursor-agent login");

    const existingSdk = agentStatusForPresentation(status, "gui", sessionRef("sdk:agent-1"));
    expect(existingSdk.authState).toBe("missing");
    expect(existingSdk.loginCommand).toBeUndefined();
    expect(existingSdk.authMethods).toBeUndefined();
    expect(existingSdk.capabilities.models).toEqual([{ id: "sdk-model", label: "SDK" }]);
  });

  it("uses the longest matching runtime prefix and ignores variants for another presentation", () => {
    const status: AgentStatus = {
      kind: "cursor",
      label: "Cursor",
      installed: true,
      authState: "authenticated",
      capabilities,
      runtimeVariants: {
        broad: {
          presentationMode: "gui",
          installed: true,
          authState: "authenticated",
          authUsesProviderLogin: true,
          capabilities: { ...capabilities, models: [{ id: "broad", label: "Broad" }] },
        },
        specific: {
          presentationMode: "gui",
          installed: false,
          authState: "missing",
          authUsesProviderLogin: false,
          capabilities: { ...capabilities, models: [{ id: "specific", label: "Specific" }] },
        },
      },
      sessionRuntimeRouting: {
        prefixes: { "run:": "broad", "run:sdk:": "specific" },
      },
    };

    const gui = agentStatusForPresentation(status, "gui", sessionRef("run:sdk:123"));
    expect(gui.installed).toBe(false);
    expect(gui.capabilities.models[0]?.id).toBe("specific");

    const terminal = agentStatusForPresentation(status, "terminal", sessionRef("run:sdk:123"));
    expect(terminal.installed).toBe(true);
    expect(terminal.capabilities.models[0]?.id).toBe("terminal-model");
  });
});

describe("adaptThreadConfigForCapabilities", () => {
  const codexCaps: AgentCapability = {
    models: [{ id: "gpt-5.6-sol", label: "5.6 Sol" }],
    efforts: ["low", "medium", "high"],
    modelEfforts: {},
    modes: ["agent", "plan"],
    approvalPolicies: [
      { id: "on-request", label: "On Request" },
      { id: "never", label: "Full Access" },
      { id: "untrusted", label: "Untrusted" },
    ],
    sandboxModes: [
      { id: "workspace-write", label: "Workspace Write" },
      { id: "danger-full-access", label: "Full Access" },
    ],
    supportsResume: true,
    supportsDirectInput: true,
    liveInputMode: "server",
    presentationMode: "gui",
    settingDefs: [],
    defaultApprovalPolicy: "on-request",
    defaultSandboxMode: "workspace-write",
    bypassPermissions: { approvalPolicy: "never", sandboxMode: "danger-full-access" },
  };

  it("maps Grok bypassPermissions onto Codex never + full sandbox", () => {
    expect(
      adaptThreadConfigForCapabilities(
        { model: "gpt-5.6-sol", approvalPolicy: "bypassPermissions", effort: "high" },
        codexCaps,
      ),
    ).toEqual({
      model: "gpt-5.6-sol",
      approvalPolicy: "never",
      sandboxMode: "danger-full-access",
      effort: "high",
    });
  });

  it("maps an unknown supervised policy onto the target default", () => {
    expect(
      adaptThreadConfigForCapabilities(
        { model: "gpt-5.6-sol", approvalPolicy: "default" },
        codexCaps,
      ),
    ).toMatchObject({
      model: "gpt-5.6-sol",
      approvalPolicy: "on-request",
    });
  });

  it("keeps a policy the target already advertises", () => {
    expect(
      adaptThreadConfigForCapabilities(
        { model: "gpt-5.6-sol", approvalPolicy: "on-request", sandboxMode: "workspace-write" },
        codexCaps,
      ),
    ).toMatchObject({
      approvalPolicy: "on-request",
      sandboxMode: "workspace-write",
    });
  });

  it("resolves a bare default against the target default instead of keeping ask", () => {
    // A bare "default" is harness-relative, not a pick: carrying an
    // opencode-originated "default" onto Kimi must land on Kimi's default
    // (auto = full access), not stick on the ask-flavored "default" id.
    const kimiCaps = {
      ...codexCaps,
      approvalPolicies: [
        { id: "default", label: "Default" },
        { id: "auto", label: "Auto Approve" },
        { id: "yolo", label: "Bypass Approvals" },
      ],
      defaultApprovalPolicy: "auto",
      bypassPermissions: { approvalPolicy: "auto" },
    } as AgentCapability;
    expect(
      adaptThreadConfigForCapabilities(
        { model: "kimi-k2.8-preview", approvalPolicy: "default" },
        kimiCaps,
      ),
    ).toMatchObject({ approvalPolicy: "auto" });
  });
});
