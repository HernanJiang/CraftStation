import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripModelProviderPrefix } from "@/shared/harnessCompatibility";

/**
 * Isolated `$DSH_HOME` for foreign catalog channels served through the
 * official `dsh` runtime. The settings document registers the channel as a
 * pi-ai custom provider so the ACP model selector advertises
 * `[provider, model]` tuples for it — e.g. `["opencode-go","deepseek-v4.1-flash"]`
 * — instead of falling back to `deepseek-official` + api.deepseek.com.
 *
 * The API key lands only in `.credentials.yaml` (0600) plus the child env;
 * `settings.yaml` holds references, never secrets.
 */

/** pi-ai route id for the OpenCode Go subscription channel inside dsh. */
export const OPENCODE_GO_DSH_PROVIDER_ID = "opencode-go";
/**
 * OpenCode Go's OpenAI-compatible Chat Completions root. Every request must
 * carry `x-opencode-session` or the edge answers `MissingSessionID` 400s.
 */
export const OPENCODE_GO_DSH_BASE_URL = "https://opencode.ai/zen/go/v1";

function yamlSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface DshForeignProviderHomeInput {
  isolationDir: string;
  /** pi-ai route id; also the first element of the advertised ACP tuple. */
  providerId: string;
  displayName: string;
  /** Written into `.credentials.yaml` under `apiKeyEnv`, never into settings. */
  apiKey: string;
  /** Credential reference env name; `DEEPSEEK_API_KEY` unless noted otherwise. */
  apiKeyEnv?: string;
  baseUrl: string;
  /** Upstream model id as the endpoint names it (catalog prefix stripped). */
  modelId: string;
  /** Static request headers the endpoint requires (e.g. session routing). */
  headers?: Record<string, string> | undefined;
}

export function writeDshForeignProviderHome(input: DshForeignProviderHomeInput): void {
  mkdirSync(input.isolationDir, { recursive: true });
  const apiKeyEnv = input.apiKeyEnv ?? "DEEPSEEK_API_KEY";
  const headerLines = Object.entries(input.headers ?? {}).map(
    ([name, value]) => `        ${name}: ${yamlSingleQuoted(value)}`,
  );
  const settings = [
    // Repoint the built-in DeepSeek route at the channel endpoint so a stray
    // deepseek-official fallback cannot leak the channel key to
    // api.deepseek.com.
    "llm-deepseek:",
    `  baseURL: ${yamlSingleQuoted(input.baseUrl)}`,
    `  apiKeyEnv: ${apiKeyEnv}`,
    "llm-pi-ai:",
    "  providers:",
    `    ${input.providerId}:`,
    `      displayName: ${input.displayName}`,
    `      apiKeyEnv: ${apiKeyEnv}`,
    "      api: openai-completions",
    `      baseURL: ${yamlSingleQuoted(input.baseUrl)}`,
    ...(headerLines.length > 0 ? ["      headers:", ...headerLines] : []),
    "      models:",
    `        - id: ${yamlSingleQuoted(input.modelId)}`,
    "agent-default-model:",
    `  provider: ${input.providerId}`,
    `  model: ${yamlSingleQuoted(input.modelId)}`,
    "",
  ].join("\n");
  writeFileSync(join(input.isolationDir, "settings.yaml"), settings, "utf8");
  const credentials = [
    "version: 1",
    "refs:",
    `  ${apiKeyEnv}: ${yamlSingleQuoted(input.apiKey)}`,
    "",
  ].join("\n");
  writeFileSync(join(input.isolationDir, ".credentials.yaml"), credentials, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Child env for a foreign-channel dsh launch: channel key + endpoint on the
 * vendor CLI's official env names, telemetry off, and (when present) the
 * isolated `$DSH_HOME` written by {@link writeDshForeignProviderHome}.
 */
export function dshForeignCompatEnv(
  apiKey: string,
  isolationDir: string | undefined,
  baseUrl: string,
): Record<string, string> {
  return {
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BASE_URL: baseUrl,
    OPENAI_API_KEY: apiKey,
    OPENAI_BASE_URL: baseUrl,
    DSH_TELEMETRY_DISABLED: "1",
    ...(isolationDir ? { DSH_HOME: isolationDir } : {}),
  };
}

/**
 * OpenCode Go channel on DeepSeek Harness. `modelId` may carry the
 * `opencode-go/` catalog prefix; the provider's upstream id is the bare leaf
 * (`deepseek-v4.1-flash`). `sessionId` fills the required `x-opencode-session`
 * routing header — one stable value per thread keeps Go's affinity stable.
 */
export function writeOpenCodeGoDshHome(input: {
  isolationDir: string;
  apiKey: string;
  modelId: string;
  sessionId: string;
  /** Bound-account endpoint override; defaults to the canonical Go root. */
  baseUrl?: string | undefined;
}): void {
  const model = stripModelProviderPrefix(input.modelId) || input.modelId;
  writeDshForeignProviderHome({
    isolationDir: input.isolationDir,
    providerId: OPENCODE_GO_DSH_PROVIDER_ID,
    displayName: "OpenCode Go",
    apiKey: input.apiKey,
    baseUrl: input.baseUrl?.trim() || OPENCODE_GO_DSH_BASE_URL,
    modelId: model,
    headers: { "x-opencode-session": input.sessionId },
  });
}

export function openCodeGoDshCompatEnv(
  apiKey: string,
  isolationDir?: string,
  baseUrl?: string,
): Record<string, string> {
  return dshForeignCompatEnv(apiKey, isolationDir, baseUrl?.trim() || OPENCODE_GO_DSH_BASE_URL);
}
