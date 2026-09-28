import { readBridge } from "@/renderer/bridge";
import { useSharedSettings } from "@/renderer/state/sharedSettingsStore";
import {
  channelInfoFromCustomModels,
  isThirdPartyAccountId,
  type ThirdPartyChannelInfo,
} from "@/shared/thirdPartyRouting";

/**
 * Send-path channel wire-surface resolution for chat-only harnesses.
 *
 * Reads the capability stamped on the custom-model catalog first; when the
 * channel was added before capability stamps existed (or its state is still
 * unknown) asks the supervisor once — it probes POST /chat/completions with
 * the sealed key, caches the definitive answer, and we stamp the result back
 * onto the account's custom-model rows so later picks stay synchronous.
 */
export async function resolveThirdPartyChannelInfoForSend(input: {
  accountId: string | undefined;
  modelId: string | undefined;
}): Promise<ThirdPartyChannelInfo | undefined> {
  const accountId = input.accountId;
  const modelId = input.modelId?.trim() ?? "";
  if (!accountId || !isThirdPartyAccountId(accountId)) return undefined;
  const customModels = useSharedSettings.getState().customModels ?? [];
  const stamped = channelInfoFromCustomModels(customModels, accountId, modelId);
  if (stamped?.protocol === "responses" && stamped.chatCompletionsOk !== undefined) {
    return stamped;
  }
  try {
    const response = await readBridge().probeChannelChatCompletions({
      provider: "openai-compatible",
      accountId,
      model: modelId,
    });
    if (!response.ok) return stamped;
    const info: ThirdPartyChannelInfo = {
      protocol: response.validatedProtocol ?? stamped?.protocol,
      chatCompletionsOk: response.chatCompletionsOk,
    };
    if (info.chatCompletionsOk !== undefined) {
      useSharedSettings.getState().setCustomModels(
        (useSharedSettings.getState().customModels ?? []).map((entry) =>
          entry.accountId === accountId && entry.modelId === modelId
            ? {
                ...entry,
                ...(info.protocol ? { validatedProtocol: info.protocol } : {}),
                chatCompletionsOk: info.chatCompletionsOk,
              }
            : entry,
        ),
      );
    }
    return info;
  } catch {
    return stamped;
  }
}
