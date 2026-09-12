import { chatLanguageDirective, detectProcessPreferredLanguages } from "@/shared/locale";
import { readSupervisorSharedSettings } from "./supervisorSharedSettings";

export function composeInlineTurnInstructions(
  ...parts: Array<string | undefined>
): string | undefined {
  const cleaned = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return cleaned.length > 0 ? cleaned.join("\n\n") : undefined;
}

export function readChatLanguageDirective(settingsPath: string): string | undefined {
  const settings = readSupervisorSharedSettings(settingsPath);
  return chatLanguageDirective(settings.locale, detectProcessPreferredLanguages());
}

/**
 * User-defined global prompt (global AGENTS.md equivalent). Trimmed; blank
 * (the default) disables it. Rendered visibly in Settings so — unlike the
 * implicit language directive above — the user always knows what is injected.
 */
export function readCustomGlobalPrompt(settingsPath: string): string | undefined {
  const settings = readSupervisorSharedSettings(settingsPath);
  const trimmed = settings.customGlobalPrompt?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}
