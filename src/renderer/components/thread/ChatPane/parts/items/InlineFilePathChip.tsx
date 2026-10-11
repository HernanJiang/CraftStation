import { type ReactNode, useState } from "react";
import { toast } from "@heroui/react";
import { AppWindow, FolderOpen, PanelRight } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/renderer/components/common/ContextMenu";
import { getEntryIconUrl } from "@/renderer/components/common/fileIcons";
import { getBasename } from "@/shared/pathUtils";
import { friendlyError } from "@/shared/messages";
import { useLingui } from "@lingui/react/macro";

interface InlineFilePathChipProps {
  path: string;
  line?: number | undefined;
  endLine?: number | undefined;
  onOpen?: ((path: string, lineNumber?: number) => Promise<void> | void) | undefined;
  onShowInExplorer?: ((path: string) => Promise<void> | void) | undefined;
  onOpenWithSystem?: ((path: string) => Promise<void> | void) | undefined;
  label?: ReactNode;
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
export function InlineFilePathChip({
  path,
  line,
  endLine,
  onOpen,
  onShowInExplorer,
  onOpenWithSystem,
  label,
}: InlineFilePathChipProps) {
  const { t } = useLingui();
  const [inert, setInert] = useState(false);
  const basename = getBasename(path);
  const iconUrl = getEntryIconUrl(basename, false);
  const lineLabel =
    line !== undefined ? `${line}${endLine !== undefined ? `-${endLine}` : ""}` : "";
  const title = line !== undefined ? `${path}:${lineLabel}` : path;

  const items: ContextMenuItem[] = [
    ...(onOpen
      ? [{ id: "sidebar", label: t`Open in sidebar`, icon: <PanelRight className="size-4" /> }]
      : []),
    ...(onShowInExplorer
      ? [{ id: "explorer", label: t`Open in folder`, icon: <FolderOpen className="size-4" /> }]
      : []),
    ...(onOpenWithSystem
      ? [{ id: "system", label: t`Open with default app`, icon: <AppWindow className="size-4" /> }]
      : []),
  ];

  const runAction = async (action: string) => {
    if (inert) return;
    try {
      if (action === "sidebar") await onOpen?.(path, line);
      if (action === "explorer") await onShowInExplorer?.(path);
      if (action === "system") await onOpenWithSystem?.(path);
    } catch (error) {
      toast.danger(t`无法打开 ${basename}：${friendlyError(error)}`);
      if (action === "sidebar") setInert(true);
    }
  };

  const chip = (
    <button
      type="button"
      className={`craftstation-inline-path-chip${inert ? " craftstation-inline-path-chip--inert" : ""}`}
      title={title}
      disabled={inert}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void runAction("sidebar");
      }}
    >
      <img className="craftstation-inline-path-chip__icon" src={iconUrl} alt="" draggable={false} />
      <span className="craftstation-inline-path-chip__name">{label ?? basename}</span>
      {line !== undefined ? (
        <span className="craftstation-inline-path-chip__line">{`· L${lineLabel}`}</span>
      ) : null}
    </button>
  );
  return items.length ? (
    <ContextMenu
      items={items.map((item) => ({ ...item, isDisabled: inert }))}
      onAction={(action) => {
        void runAction(action);
      }}
    >
      {chip}
    </ContextMenu>
  ) : (
    chip
  );
}
