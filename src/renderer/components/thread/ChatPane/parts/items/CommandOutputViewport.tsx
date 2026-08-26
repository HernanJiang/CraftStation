import { CodeBlock } from "./CodeBlock";
import type { ViewportLanguage } from "./languageDetect";

const viewportClass =
  "max-h-[min(24rem,50vh)] overflow-auto [scrollbar-gutter:stable] font-mono leading-snug whitespace-pre-wrap break-words";

interface CommandOutputViewportProps {
  text: string;
  /** Selects the syntax-highlighter; `"plain"` renders an unstyled `<pre>`. */
  language?: ViewportLanguage;
}

/** Scrollable command / PTY text (full content; no line windowing). */
export function CommandOutputViewport({ text, language = "plain" }: CommandOutputViewportProps) {
  if (language === "plain") {
    return <pre className={`${viewportClass} text-foreground-muted`}>{text}</pre>;
  }
  return <CodeBlock text={text} lang={language} className={viewportClass} />;
}
