import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompatibilityBridgeStatus } from "./types";

export interface TargetHarnessConfig {
  harnessKind: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: string;
  customEnv: Record<string, string>;
}

/**
 * Write an isolated OpenCode provider configuration that points the official
 * OpenCode CLI at the running Compatibility Bridge. The file is session-scoped
 * (written under the caller's directory, never into the user's OpenCode home)
 * and carries the bridge api-key, so the official harness consumes the Bridge
 * as a first-class OpenAI-compatible provider.
 */
export function writeOpenCodeConfigFile(
  config: TargetHarnessConfig,
  directory: string,
  providerId = "craftstation-compat",
): string {
  if (config.harnessKind !== "opencode") {
    throw new Error(
      `OpenCode config export requires the opencode harness, got ${config.harnessKind}.`,
    );
  }
  mkdirSync(directory, { recursive: true });
  const configPath = join(directory, "opencode-compat.json");
  const document = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [providerId]: {
        name: "CraftStation Compatibility Bridge",
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: config.baseUrl,
          apiKey: config.apiKey,
        },
        models: {
          [config.model]: { name: `${config.model} (via CraftStation Bridge)` },
        },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(document, null, 2), "utf8");
  return configPath;
}

export function exportOpenCodeCompatibility(
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  const endpoint = status.endpoint ?? `http://${status.host}:${status.port}`;
  const apiKey = requireRunningBridgeKey(status);
  return {
    harnessKind: "opencode",
    baseUrl: `${endpoint}/v1`,
    apiKey,
    model: modelId,
    protocol: "openai-compatible",
    customEnv: {
      OPENCODE_API_BASE: `${endpoint}/v1`,
      OPENCODE_API_KEY: apiKey,
    },
  };
}

export function exportCodexCompatibility(
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  const endpoint = status.endpoint ?? `http://${status.host}:${status.port}`;
  const apiKey = requireRunningBridgeKey(status);
  return {
    harnessKind: "codex",
    baseUrl: `${endpoint}/v1`,
    apiKey,
    model: modelId,
    protocol: "responses",
    customEnv: {
      CODEX_MODEL_PROVIDER: "custom-responses",
      CODEX_BASE_URL: `${endpoint}/v1`,
      OPENAI_API_KEY: apiKey,
    },
  };
}

export function exportKimiCompatibility(
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  const endpoint = status.endpoint ?? `http://${status.host}:${status.port}`;
  const apiKey = requireRunningBridgeKey(status);
  return {
    harnessKind: "kimi",
    baseUrl: `${endpoint}/v1`,
    apiKey,
    model: modelId,
    protocol: "openai_responses",
    customEnv: {
      KIMI_BASE_URL: `${endpoint}/v1`,
      KIMI_API_KEY: apiKey,
      KIMI_PROTOCOL: "openai_responses",
    },
  };
}

export function exportGrokCompatibility(
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  const endpoint = status.endpoint ?? `http://${status.host}:${status.port}`;
  const apiKey = requireRunningBridgeKey(status);
  return {
    harnessKind: "grok",
    baseUrl: `${endpoint}/v1`,
    apiKey,
    model: modelId,
    protocol: "openai-compatible-chat",
    customEnv: {
      GROK_API_BASE: `${endpoint}/v1`,
      GROK_API_KEY: apiKey,
    },
  };
}

export function exportAntigravityCompatibility(
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  const endpoint = status.endpoint ?? `http://${status.host}:${status.port}`;
  const apiKey = requireRunningBridgeKey(status);
  return {
    harnessKind: "antigravity",
    baseUrl: `${endpoint}/v1beta`,
    apiKey,
    model: modelId,
    protocol: "gemini-compatible",
    customEnv: {
      GOOGLE_GEMINI_BASE_URL: `${endpoint}/v1beta`,
      GEMINI_API_KEY: apiKey,
    },
  };
}

export function exportCompatibilityForHarness(
  harnessKind: string,
  status: CompatibilityBridgeStatus,
  modelId: string,
): TargetHarnessConfig {
  switch (harnessKind) {
    case "opencode":
      return exportOpenCodeCompatibility(status, modelId);
    case "codex":
      return exportCodexCompatibility(status, modelId);
    case "kimi":
      return exportKimiCompatibility(status, modelId);
    case "grok":
      return exportGrokCompatibility(status, modelId);
    case "antigravity":
      return exportAntigravityCompatibility(status, modelId);
    default:
      throw new Error(`Unsupported compatibility harness kind: ${harnessKind}`);
  }
}

function requireRunningBridgeKey(status: CompatibilityBridgeStatus): string {
  if (!status.running || !status.endpoint || !status.apiKey?.trim()) {
    throw new Error("Compatibility exporter unavailable: bridge is not verified and running.");
  }
  return status.apiKey;
}
