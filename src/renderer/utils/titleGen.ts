import type { AgentStatus, ProjectLocation } from "@/shared/contracts";
import { resolveAiLanguageName } from "@/shared/locale";
import { readBridge } from "@/renderer/bridge";
import { generateTitleWithFallback } from "@/renderer/components/providers/titleGen";
import { detectOSLocale } from "@/renderer/i18n/locales";
import { useAppStore } from "@/renderer/state/appStore";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";

export function generateTitleAsync(
  threadId: string,
  projectLocation: ProjectLocation,
  agentStatuses: readonly AgentStatus[],
  prompt: string,
  preferredAgentKind?: AgentStatus["kind"],
): void {
  const request = requestGeneratedTitle(projectLocation, agentStatuses, prompt, preferredAgentKind);
  if (!request) return;

  void request
    .then((title) => {
      const store = useAppStore.getState();
      const thread = store.threads.find((t) => t.id === threadId);
      // Only a prompt-derived placeholder may be replaced. `renameThread`
      // enforces the same rule atomically, so a user rename that landed after
      // this check still cannot be overwritten.
      if (thread && thread.titleSource === "fallback") {
        store.renameThread(threadId, title, "agent");
      }
    })
    .catch((err) => {
      console.warn("[title-gen] failed, keeping fallback title:", err);
    });
}

export function requestGeneratedTitle(
  projectLocation: ProjectLocation,
  agentStatuses: readonly AgentStatus[],
  prompt: string,
  preferredAgentKind?: AgentStatus["kind"],
): Promise<string> | undefined {
  const settings = useSharedSettings.getState();
  const isWsl = projectLocation.kind === "wsl";
  const provider = isWsl ? settings.wslTitleGenProvider : settings.titleGenProvider;
  if (provider === "disabled") return undefined;

  const model = isWsl ? settings.wslTitleGenModel : settings.titleGenModel;
  const effort = isWsl ? settings.wslTitleGenEffort : settings.titleGenEffort;
  const fast = isWsl ? settings.wslTitleGenFast : settings.titleGenFast;
  // Thread titles are "conversation" text: they follow the app language. When
  // it resolves to English the directive is omitted, preserving the default
  // "match the user's message language" behavior.
  const language = resolveAiLanguageName("match-app", settings.locale, detectOSLocale());

  return generateTitleWithFallback({
    projectLocation,
    agentStatuses,
    provider,
    model,
    effort,
    fast,
    prompt,
    ...(language ? { language } : {}),
    ...(preferredAgentKind ? { preferredAgentKind } : {}),
    invoke: (payload) => readBridge().generateTitle(payload),
  });
}
