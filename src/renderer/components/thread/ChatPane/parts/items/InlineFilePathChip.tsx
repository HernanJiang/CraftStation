import { useState } from "react";
import { toast } from "@heroui/react";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { getBasename } from "@/shared/pathUtils";
import { friendlyError } from "@/shared/messages";

interface InlineFilePathChipProps {
  path: string;
  line?: number | undefined;
  endLine?: number | undefined;
  onOpen?: ((path: string, lineNumber?: number) => Promise<void> | void) | undefined;
}

/**
 * Inline chip rendered inside chat markdown for `path[:line]` references.
 * Vertically centered with surrounding prose (em-based sizing) so it reads
 * inline without clipping descenders. Mirrors the visual language of
 * `.craftstation-mention-chip` used in the composer.
 *
 * When `onOpen` rejects (e.g. a bare basename that couldn't be resolved to a
 * real project file), the failure is toasted once with the reason — a silent
 * dead chip reads as "click does nothing" — and the chip then switches to an
 * inert visual (same badge, no hover, no handler) so a permanently missing
 * reference doesn't nag on every click.
 */
export function InlineFilePathChip({ path, line, endLine, onOpen }: InlineFilePathChipProps) {
  const [inert, setInert] = useState(false);
  const basename = getBasename(path);
  const iconUrl = getEntryIconUrl(basename, false);
  const lineLabel =
    line !== undefined ? `${line}${endLine !== undefined ? `-${endLine}` : ""}` : "";
  const title = line !== undefined ? `${path}:${lineLabel}` : path;

  const handleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (inert || !onOpen) return;
    const result = onOpen(path, line);
    if (result && typeof result.catch === "function") {
      result.catch((error: unknown) => {
        toast.danger(`无法打开 ${basename}：${friendlyError(error)}`);
        setInert(true);
      });
    }
  };

  return (
    <button
      type="button"
      className={`craftstation-inline-path-chip${inert ? " craftstation-inline-path-chip--inert" : ""}`}
      title={title}
      disabled={inert}
      onClick={handleClick}
    >
      <img className="craftstation-inline-path-chip__icon" src={iconUrl} alt="" draggable={false} />
      <span className="craftstation-inline-path-chip__name">{basename}</span>
      {line !== undefined ? (
        <span className="craftstation-inline-path-chip__line">{`· L${lineLabel}`}</span>
      ) : null}
    </button>
  );
}
