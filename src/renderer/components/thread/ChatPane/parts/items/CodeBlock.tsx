import { useEffect, useState } from "react";
import { useResolvedAppearance } from "@/renderer/components/ui/provider";
import {
  ensureLanguage,
  getShikiHighlighter,
  transparentBgTransformer,
  type ShikiTheme,
} from "./shikiClient";
import type { HighlightLanguage } from "./languageDetect";
import { CodeHighlightCache } from "./codeHighlightCache";

interface CodeBlockProps {
  text: string;
  /** Language id (Shiki bundled language) — falls back to a plain `<pre>` if unsupported. */
  lang: HighlightLanguage;
  className?: string;
}

/**
 * Bounded LRU keyed on `theme::lang::text`. Same body is highlighted only
 * once per theme; both count and text bytes are bounded so large tool output
 * cannot pin hundreds of megabytes. Evicted code still renders in full.
 */
const cache = new CodeHighlightCache();

function cacheKey(theme: ShikiTheme, lang: string, text: string): string {
  return `${theme}::${lang}::${text}`;
}

/**
 * Render `text` as syntax-highlighted code via Shiki. While the highlighter
 * loads (or for unsupported languages) the component falls back to a plain
 * `<pre>` so the user sees the body immediately and gets the colored version
 * once Shiki is ready.
 */
export function CodeBlock({ text, lang, className }: CodeBlockProps) {
  const appearance = useResolvedAppearance();
  const theme: ShikiTheme = appearance === "dark" ? "github-dark" : "github-light";
  const key = cacheKey(theme, lang, text);
  const [html, setHtml] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const cached = cache.get(key);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const ok = await ensureLanguage(lang);
        if (cancelled) return;
        if (!ok) {
          setHtml(null);
          return;
        }
        const highlighter = await getShikiHighlighter();
        if (cancelled) return;
        const out = highlighter.codeToHtml(text, {
          lang,
          theme,
          transformers: [transparentBgTransformer],
        });
        cache.set(key, out);
        if (!cancelled) setHtml(out);
      } catch {
        if (!cancelled) setHtml(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, lang, text, theme]);

  if (html !== null) {
    return (
      <div
        className={`lc-shiki ${className ?? ""}`.trim()}
        // Shiki's output is HTML-escaped at the source — the only dynamic
        // content is `text`, which `codeToHtml` HTML-escapes before wrapping.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre
      className={`whitespace-pre-wrap break-words text-foreground-muted ${className ?? ""}`.trim()}
    >
      {text}
    </pre>
  );
}
