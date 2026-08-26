import type { CSSProperties } from "react";

export const CHAT_FONT_SIZE_VAR = "--lc-chat-font-size";
export const CHAT_FONT_SIZE_COMMAND_VAR = "--lc-chat-font-size-command";
export const CHAT_FONT_SIZE_META_VAR = "--lc-chat-font-size-meta";

/** Maps **Settings → GUI chat** base px into CSS variables (+ command −1px, meta −2px; floor 8px). */
export function guiChatFontCssVars(guiChatFontSize: number): CSSProperties {
  const base = Math.min(20, Math.max(8, Math.round(guiChatFontSize)));
  return {
    [CHAT_FONT_SIZE_VAR]: `${base}px`,
    [CHAT_FONT_SIZE_COMMAND_VAR]: `${Math.max(8, base - 1)}px`,
    [CHAT_FONT_SIZE_META_VAR]: `${Math.max(8, base - 2)}px`,
  } as CSSProperties;
}
