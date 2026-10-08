import { z } from "zod";

export const webChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});
export type WebChatMessage = z.infer<typeof webChatMessageSchema>;
export const webChatSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  tabId: z.string().optional(),
  status: z.enum(["connecting", "login-required", "ready", "sending", "streaming", "error"]),
  error: z.string().optional(),
  messages: z.array(webChatMessageSchema),
});
export type WebChatSession = z.infer<typeof webChatSessionSchema>;
export const webChatIdSchema = z.object({ sessionId: z.string().uuid() });
export const webChatSendSchema = webChatIdSchema.extend({
  prompt: z.string().trim().min(1).max(100_000),
  requestId: z.string().uuid(),
});

/** Only the public ChatGPT page is driven; credentials never cross this seam. */
export function isChatGptWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com";
  } catch {
    return false;
  }
}
