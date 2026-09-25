import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@/shared/atomicFile";
import { breakManagedStateSymlink } from "./codexProfiles";

/** 第三方 API 与 CPA 共用的 endpoint 投影；只写非敏感配置，密钥只进子进程环境。 */
export function prepareCodexEndpointRuntime(input: {
  directory: string;
  baseUrl: string;
  apiKey: string;
  name?: string;
}): { codexHome: string; env: Record<string, string> } {
  mkdirSync(input.directory, { recursive: true });
  const config = [
    "# CraftStation isolated endpoint profile",
    'model_provider = "craftstation_openai_compatible"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[model_providers.craftstation_openai_compatible]",
    `name = ${JSON.stringify(input.name ?? "OpenAI Compatible")}`,
    `base_url = ${JSON.stringify(input.baseUrl)}`,
    'wire_api = "responses"',
    'env_key = "CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY"',
    "requires_openai_auth = false",
    "supports_websockets = false",
    "",
    "[windows]",
    'sandbox = "unelevated"',
    "",
  ].join("\n");
  const configPath = join(input.directory, "config.toml");
  breakManagedStateSymlink(configPath);
  writeFileAtomic(configPath, config, { encoding: "utf8", mode: 0o600 });
  return {
    codexHome: input.directory,
    env: { CRAFTSTATION_OPENAI_COMPATIBLE_API_KEY: input.apiKey },
  };
}

/** Kimi reads provider/model tables, not KIMI_CODE_API_KEY. The selected model
 * is an exact alias, including slashes; the secret stays in this private home. */
export function prepareKimiEndpointRuntime(input: {
  directory: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
  protocol?: "responses" | "chat_completions";
}): { env: Record<string, string> } {
  if (!input.model.trim()) throw new Error("Kimi endpoint requires an explicit model.");
  // Match the installed Kimi CLI's environment-model fallback. This is a
  // client context budget, not a claim about the endpoint's supported window.
  const contextWindow = input.contextWindow ?? 262144;
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 1)
    throw new Error("Kimi endpoint requires a positive context window.");
  mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  const configPath = join(input.directory, "config.toml");
  breakManagedStateSymlink(configPath);
  writeFileAtomic(
    configPath,
    [
      `default_model = ${JSON.stringify(input.model)}`,
      "",
      "[providers.craftstation_compatible]",
      `type = ${JSON.stringify(input.protocol === "responses" ? "openai_responses" : "openai")}`,
      `base_url = ${JSON.stringify(input.baseUrl)}`,
      `api_key = ${JSON.stringify(input.apiKey)}`,
      "",
      `[models.${JSON.stringify(input.model)}]`,
      'provider = "craftstation_compatible"',
      `model = ${JSON.stringify(input.model)}`,
      `max_context_size = ${contextWindow}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  return { env: { KIMI_CODE_HOME: input.directory, KIMI_MODEL_NAME: "" } };
}

/**
 * Step Code consumes a foreign OpenAI-compatible endpoint purely through env:
 * the built-in `step` provider resolves base URL/key from `STEP_BASE_URL` /
 * `STEP_API_KEY`, and its models.json merger forces `api=openai-completions`
 * plus that same base URL onto every seed entry. The API key therefore stays
 * child-env only; `models.json` seeds just the account's bound model ids (id
 * + display name) so they still resolve when the endpoint's `/models`
 * listing is unreachable. `STEP_CODING_AGENT_DIR` isolates agent state
 * (sessions, extension cache) under the supervisor cache instead of the
 * user's real `~/.stepcode/agent`.
 */
export function prepareStepCodeEndpointRuntime(input: {
  directory: string;
  baseUrl: string;
  apiKey: string;
  models?: readonly { id: string; name?: string | undefined }[];
}): { env: Record<string, string> } {
  const agentDir = join(input.directory, "agent");
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  if (input.models?.length) {
    writeFileAtomic(
      join(input.directory, "models.json"),
      JSON.stringify(
        {
          providers: {
            step: {
              models: input.models.map((entry) => ({
                id: entry.id,
                model: entry.id,
                ...(entry.name ? { name: entry.name } : {}),
              })),
            },
          },
        },
        null,
        2,
      ),
      { encoding: "utf8", mode: 0o600 },
    );
  }
  return {
    env: {
      STEP_CODING_AGENT_DIR: agentDir,
      STEP_API_KEY: input.apiKey,
      STEP_BASE_URL: input.baseUrl,
    },
  };
}

export function vendorEndpointEnv(
  harness: "kimi" | "grok" | "deepseek",
  baseUrl: string,
  apiKey: string,
): Record<string, string> {
  if (harness === "kimi") return { KIMI_CODE_API_KEY: apiKey, KIMI_CODE_BASE_URL: baseUrl };
  if (harness === "grok")
    return {
      GROK_API_KEY: apiKey,
      XAI_API_KEY: apiKey,
      GROK_API_BASE: baseUrl,
      GROK_BASE_URL: baseUrl,
    };
  return {
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: baseUrl,
  };
}
