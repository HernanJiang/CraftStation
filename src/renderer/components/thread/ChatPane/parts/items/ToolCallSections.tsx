import type { ReactNode } from "react";
import { CommandOutputViewport } from "./CommandOutputViewport";
import { ItemMarkdown } from "./ItemMarkdown";
import type { ExtractedPart } from "./acpToolPayload";

export interface ToolCallSection {
  /** Label displayed above the viewport (e.g. `args`, `result`). */
  label: string;
  part: ExtractedPart;
  /** When true, render through `ItemMarkdown` instead of the code/plain viewport. */
  renderAsMarkdown?: boolean;
}

interface ToolCallSectionsProps {
  sections: ToolCallSection[];
  /** Optional content rendered above the structured sections (e.g. a stream-only body). */
  leading?: ReactNode;
}

/**
 * Render a list of labeled tool-call sections (args / result / etc.).
 * Each section gets a tiny header and a viewport whose language is picked
 * from the part's `isJson` flag, so JSON args get syntax highlighting while
 * plain output stays in a regular `<pre>`. Empty parts are skipped.
 */
export function ToolCallSections({ sections, leading }: ToolCallSectionsProps) {
  const visible = sections.filter((s) => s.part.text.length > 0);
  if (visible.length === 0 && !leading) return null;
  return (
    <div className="flex flex-col gap-2">
      {leading}
      {visible.map((section, idx) => (
        <div
          key={section.label}
          className={idx > 0 ? "border-t border-[color:var(--separator)] pt-2" : undefined}
        >
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-[color:var(--muted)]/80">
            {section.label}
          </div>
          {section.renderAsMarkdown ? (
            <ItemMarkdown text={section.part.text} />
          ) : (
            <CommandOutputViewport text={section.part.text} language={section.part.language} />
          )}
        </div>
      ))}
    </div>
  );
}
