import type { Item } from "@/shared/crafting";
import type {
  ModelProviderBinding,
  OpenCodeCapabilityMatrix,
  OpenCodeCompatibilityRecord,
  OpenCodeModelFamily,
  OpenCodeProviderFact,
  OpenCodeKimiRoute,
  OpenCodeAuthMode,
} from "./types";

const UNKNOWN_CAPABILITIES: OpenCodeCapabilityMatrix = {
  streaming: "unverified",
  toolCalling: "unverified",
  fileAccess: "unverified",
  shellExecution: "unverified",
  reasoning: "unverified",
  context: "unverified",
  compaction: "unverified",
  mcp: "unverified",
  subagents: "unverified",
  usage: "unverified",
};

/** Frozen provider identities. Model request shaping remains OpenCode-owned. */
export const OPEN_CODE_PROVIDER_FACTS: readonly OpenCodeProviderFact[] = [
  {
    family: "openai",
    providerID: "openai",
    authModes: ["api-key", "oauth"],
    representativeModels: ["gpt-5.4", "gpt-5.4-mini"],
    facts: ["OpenCode provider inventory identifies the provider separately from the model."],
  },
  {
    family: "xai",
    providerID: "xai",
    authModes: ["api-key"],
    representativeModels: ["grok-4", "grok-3"],
    facts: ["xAI is bound through OpenCode's provider/model inventory; no Grok Harness is used."],
  },
  {
    family: "google",
    providerID: "google",
    authModes: ["api-key", "oauth", "vertex"],
    representativeModels: ["gemini-2.5-pro", "gemini-2.5-flash"],
    facts: ["Google API and Vertex authentication are distinct auth modes."],
  },
  {
    family: "deepseek",
    providerID: "deepseek",
    authModes: ["api-key"],
    representativeModels: ["deepseek-v4-flash", "deepseek-v4-pro"],
    facts: ["This is a DeepSeek Model Item using OpenCode; it is not the DSH Harness."],
  },
  {
    family: "moonshot",
    providerID: "kimi-for-coding",
    route: "moonshot-native",
    authModes: ["api-key"],
    representativeModels: ["kimi-for-coding", "k3"],
    facts: [
      "OpenCode 1.18.25 exposes the native Kimi route as kimi-for-coding; it remains distinct from an OpenAI-compatible endpoint.",
    ],
  },
  {
    family: "moonshot",
    providerID: "moonshot-openai-compatible",
    route: "openai-compatible",
    authModes: ["api-key"],
    representativeModels: ["kimi-k2.5"],
    facts: [
      "OpenAI-compatible Kimi is a separate provider route and must not be relabeled Moonshot-native.",
    ],
  },
  {
    family: "muse",
    providerID: "opencode-go",
    authModes: ["api-key", "oauth"],
    representativeModels: ["muse-spark-1.3", "muse-spark-1.2"],
    facts: [
      "Muse Spark is bound through OpenCode's opencode-go provider; it is not the Muse Harness (muse serve / MSP).",
    ],
  },
];

function familyForModel(item: Item): OpenCodeModelFamily | undefined {
  const vendor = item.metadata.vendor.toLowerCase();
  if (vendor === "openai" || vendor === "xai" || vendor === "google" || vendor === "deepseek") {
    return vendor;
  }
  if (vendor === "moonshot" || vendor === "kimi" || vendor === "moonshot-openai-compatible")
    return "moonshot";
  if (vendor === "muse" || vendor === "meta") return "muse";
  return undefined;
}

function modelIdForItem(item: Item): string {
  const component = item.components.find((candidate) => candidate.kind === "model_capability");
  const modelId =
    component && typeof component.modelId === "string" ? component.modelId : undefined;
  return modelId ?? item.id.slice(item.id.indexOf(":") + 1);
}

function factFor(
  family: OpenCodeModelFamily,
  route?: OpenCodeKimiRoute,
): OpenCodeProviderFact | undefined {
  return OPEN_CODE_PROVIDER_FACTS.find((fact) => fact.family === family && fact.route === route);
}

export function bindOpenCodeModel(input: {
  model: Item;
  authRef?: string;
  profileRef?: string;
  authMode?: OpenCodeAuthMode;
  kimiRoute?: OpenCodeKimiRoute;
  capabilities?: Partial<OpenCodeCapabilityMatrix>;
}): ModelProviderBinding {
  const family = familyForModel(input.model);
  if (!family)
    throw new Error(
      `OpenCode does not have a registered provider binding for '${input.model.metadata.vendor}'.`,
    );
  const route =
    family === "moonshot"
      ? (input.kimiRoute ??
        (input.model.metadata.vendor.toLowerCase() === "moonshot-openai-compatible"
          ? "openai-compatible"
          : "moonshot-native"))
      : undefined;
  const fact = factFor(family, route);
  if (!fact) throw new Error(`OpenCode provider route is not registered for '${family}'.`);
  const authMode = input.authMode ?? fact.authModes[0] ?? "unknown";
  if (!fact.authModes.includes(authMode)) {
    throw new Error(
      `Auth mode '${authMode}' is not valid for OpenCode provider '${fact.providerID}'.`,
    );
  }
  return {
    harnessKind: "opencode",
    modelFamily: family,
    providerID: fact.providerID,
    modelID: modelIdForItem(input.model),
    authMode,
    ...(input.authRef ? { authRef: input.authRef } : {}),
    ...(input.profileRef ? { profileRef: input.profileRef } : {}),
    ...(route ? { kimiRoute: route } : {}),
    capabilities: { ...UNKNOWN_CAPABILITIES, ...(input.capabilities ?? {}) },
  };
}

export function redactOpenCodeBinding(binding: ModelProviderBinding): Omit<
  ModelProviderBinding,
  "authRef" | "profileRef"
> & {
  authConfigured: boolean;
  profileConfigured: boolean;
} {
  const { authRef, profileRef, ...safe } = binding;
  return {
    ...safe,
    authConfigured: Boolean(authRef),
    profileConfigured: Boolean(profileRef),
  };
}

export function buildOpenCodeCompatibilityMatrix(
  records: readonly Partial<OpenCodeCompatibilityRecord>[] = [],
): OpenCodeCompatibilityRecord[] {
  return OPEN_CODE_PROVIDER_FACTS.map((fact) => {
    const modelID = fact.representativeModels[0] ?? "unknown";
    const found = records.find(
      (record) => record.family === fact.family && record.providerID === fact.providerID,
    );
    return {
      id: `opencode:${fact.providerID}:${modelID}`,
      family: fact.family,
      providerID: fact.providerID,
      modelID: found?.modelID ?? modelID,
      authMode: found?.authMode ?? fact.authModes[0] ?? "unknown",
      ...(fact.route ? { kimiRoute: fact.route } : {}),
      status: found?.status ?? "unavailable",
      capabilities: found?.capabilities ?? UNKNOWN_CAPABILITIES,
      evidence:
        found?.evidence ??
        "Real OpenCode CLI/server smoke is unavailable until the binary and credentials are present.",
    };
  });
}

export type { OpenCodeModelFamily, OpenCodeAuthMode };
