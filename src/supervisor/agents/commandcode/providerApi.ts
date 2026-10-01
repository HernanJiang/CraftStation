import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { normalizeCommandCodeModelId } from "@/shared/thirdPartyRouting";
import { dshForeignCompatEnv, writeDshForeignProviderHome } from "../deepseek/foreignDshHome";
import { resolveAgentHomeSubpath } from "../base";

/**
 * Command Code Provider API — OpenAI-compatible Chat Completions surface.
 * Docs: https://commandcode.ai/docs/provider-api
 *
 * DeepSeek-family catalog models speak this protocol, so DeepSeek Harness
 * can consume Command Code as a channel: same model id, Command Code key,
 * this Base URL — never api.deepseek.com.
 */
export const COMMANDCODE_OPENAI_COMPAT_BASE_URL = "https://api.commandcode.ai/provider/v1";

/** pi-ai / ACP route id. Must not be `deepseek-official` or dsh hits api.deepseek.com. */
export const COMMANDCODE_DSH_PROVIDER_ID = "commandcode";

const COMMANDCODE_AUTH_FILE_SUBPATH = ".commandcode/auth.json";

export function parseCommandCodeApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    if (typeof parsed.apiKey !== "string") return undefined;
    const key = parsed.apiKey.trim();
    return key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

export function readCommandCodeApiKey(location?: ProjectLocation): string | undefined {
  const fromEnv = process.env.COMMAND_CODE_API_KEY?.trim() || process.env.CMD_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (location) {
    const authFile = resolveAgentHomeSubpath(location, COMMANDCODE_AUTH_FILE_SUBPATH);
    if (!authFile || !existsSync(authFile)) return undefined;
    try {
      return parseCommandCodeApiKey(readFileSync(authFile, "utf8"));
    } catch {
      return undefined;
    }
  }
  const fallback = join(homedir(), ".commandcode", "auth.json");
  if (!existsSync(fallback)) return undefined;
  try {
    return parseCommandCodeApiKey(readFileSync(fallback, "utf8"));
  } catch {
    return undefined;
  }
}

export function commandCodeCompatEnv(
  apiKey: string,
  isolationDir?: string,
  baseUrl?: string,
): Record<string, string> {
  return dshForeignCompatEnv(
    apiKey,
    isolationDir,
    baseUrl?.trim() || COMMANDCODE_OPENAI_COMPAT_BASE_URL,
  );
}

/**
 * dsh ACP model config values are JSON `[provider, model]` tuples
 * (e.g. `["deepseek-official","deepseek-flash"]`). Passing the catalog id
 * alone makes ACP fall back to the official DeepSeek route.
 */
export function commandCodeDshAcpModelId(providerModelId: string): string {
  const model = normalizeCommandCodeModelId(providerModelId);
  return JSON.stringify([COMMANDCODE_DSH_PROVIDER_ID, model]);
}

/**
 * Isolated `$DSH_HOME` so ACP (`dsh --profile acp`) uses Command Code as a
 * pi-ai custom provider instead of `deepseek-official` + api.deepseek.com.
 */
export function writeCommandCodeDshHome(input: {
  isolationDir: string;
  apiKey: string;
  modelId: string;
  baseUrl?: string;
}): void {
  writeDshForeignProviderHome({
    isolationDir: input.isolationDir,
    providerId: COMMANDCODE_DSH_PROVIDER_ID,
    displayName: "Command Code",
    apiKey: input.apiKey,
    baseUrl: input.baseUrl?.trim() || COMMANDCODE_OPENAI_COMPAT_BASE_URL,
    modelId: normalizeCommandCodeModelId(input.modelId) || "deepseek/deepseek-v4.1-flash",
  });
}
