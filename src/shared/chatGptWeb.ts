import { z } from "zod";

export const webChatWidgetSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().max(300),
  kind: z.enum(["app", "chart", "response"]),
});
export type WebChatWidget = z.infer<typeof webChatWidgetSchema>;
export const webChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  widgets: z.array(webChatWidgetSchema).max(30).optional(),
});
export type WebChatMessage = z.infer<typeof webChatMessageSchema>;
export const webChatSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string(),
  tabId: z.string().optional(),
  status: z.enum(["connecting", "login-required", "ready", "sending", "streaming", "error"]),
  error: z.string().optional(),
  reasoningLabel: z.string().optional(),
  messages: z.array(webChatMessageSchema),
});
export type WebChatSession = z.infer<typeof webChatSessionSchema>;
export const webChatIdSchema = z.object({ sessionId: z.string().uuid() });
export const webChatWidgetRequestSchema = webChatIdSchema.extend({
  widgetId: z.string().min(1).max(500),
});
export const webChatWidgetInputSchema = webChatWidgetRequestSchema.extend({
  frameId: z.string().uuid(),
  input: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("pointer"),
      phase: z.enum(["down", "move", "up"]),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      pressed: z.boolean(),
    }),
    z.object({
      kind: z.literal("scroll"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      deltaX: z.number().min(-2000).max(2000),
      deltaY: z.number().min(-2000).max(2000),
    }),
    z.object({ kind: z.literal("text"), text: z.string().max(2000) }),
    z.object({
      kind: z.literal("key"),
      key: z.enum([
        "Enter",
        "Tab",
        "Escape",
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Space",
      ]),
      shift: z.boolean().optional(),
    }),
  ]),
});
export type WebChatWidgetInput = z.infer<typeof webChatWidgetInputSchema>["input"];
export type WebChatWidgetFrame = {
  frameId: string;
  dataUrl: string;
  width: number;
  height: number;
};
export const webChatSendSchema = webChatIdSchema.extend({
  prompt: z.string().trim().min(1).max(100_000),
  requestId: z.string().uuid(),
});
export type WebChatConversation = { title: string; url: string };
export type WebChatReasoning = { value: string; options: { id: string; label: string }[] };

/** Canonical account conversation URL, excluding shared links and credentials. */
export function chatGptConversationUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.origin !== "https://chatgpt.com" || url.username || url.password) return;
    const id = /^(?:\/g\/[^/]+)?\/c\/([a-zA-Z0-9-]{8,})\/?$/.exec(url.pathname)?.[1];
    return id ? `https://chatgpt.com/c/${id}` : undefined;
  } catch {
    return;
  }
}
export const webChatImportSchema = z.object({
  url: z
    .string()
    .trim()
    .refine((url) => Boolean(chatGptConversationUrl(url)), "请输入自己的 ChatGPT 对话链接"),
});
export const webChatDeleteSchema = webChatIdSchema.extend({
  url: webChatImportSchema.shape.url,
  confirmed: z.literal(true),
});
export const webChatReasoningSchema = webChatIdSchema.extend({
  option: z.object({ id: z.string().max(10), label: z.string().min(1).max(100) }),
});

/** Only the public ChatGPT page is driven; credentials never cross this seam. */
export function isChatGptWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://chatgpt.com" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
