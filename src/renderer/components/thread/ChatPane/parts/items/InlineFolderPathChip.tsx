import { type ReactNode, useState } from "react";
import { toast } from "@heroui/react";
import { useLingui } from "@lingui/react/macro";
import { AppWindow, FolderOpen, PanelRight } from "lucide-react";
import { ContextMenu, type ContextMenuOpenRequest } from "@/renderer/components/common/ContextMenu";
import { getFolderIconUrl } from "@/renderer/components/common/fileIcons";
import {
  ResponsiveMenuSurface,
  useResponsiveMenu,
} from "@/renderer/components/common/ResponsiveMenuSurface";
import { getBasename } from "@/shared/pathUtils";
import { friendlyError } from "@/shared/messages";

interface InlineFolderPathChipProps {
  path: string;
  onRevealInTree?: ((path: string) => Promise<void> | void) | undefined;
  onShowInExplorer?: ((path: string) => Promise<void> | void) | undefined;
  onOpenWithSystem?: ((path: string) => Promise<void> | void) | undefined;
  label?: ReactNode;
}

/**
 * Inline chip rendered inside chat markdown for project folder references.
 * Shows the raw path with a folder icon and offers a menu with three
 * actions: open in the sidebar, reveal in the OS file explorer, or open with
 * the default app. Right-click offers the same actions on desktop.
 * On the mobile PWA it opens a bottom drawer (or, when a single action is
 * available, fires it on tap) instead of a cramped desktop popover.
 */
export function InlineFolderPathChip({
  path,
  onRevealInTree,
  onShowInExplorer,
  onOpenWithSystem,
  label,
}: InlineFolderPathChipProps) {
  const { t } = useLingui();
  const { mobile } = useResponsiveMenu();
  const [isOpen, setIsOpen] = useState(false);
  const [openRequest, setOpenRequest] = useState<ContextMenuOpenRequest | null>(null);
  const basename = getBasename(path);
  const iconUrl = getFolderIconUrl(basename);

  const chipInner = (
    <>
      <img className="craftstation-inline-path-chip__icon" src={iconUrl} alt="" draggable={false} />
      <span className="craftstation-inline-path-chip__name">{label ?? path}</span>
    </>
  );

  const actions = [
    onRevealInTree
      ? {
          id: "tree",
          label: t`Open in sidebar`,
          icon: <PanelRight className="size-4" />,
          run: () => onRevealInTree(path),
        }
      : null,
    onShowInExplorer
      ? {
          id: "explorer",
          label: t`Open in folder`,
          icon: <FolderOpen className="size-4" />,
          run: () => onShowInExplorer(path),
        }
      : null,
    onOpenWithSystem
      ? {
          id: "system",
          label: t`Open with default app`,
          icon: <AppWindow className="size-4" />,
          run: () => onOpenWithSystem(path),
        }
      : null,
  ].filter((action) => action !== null);

  const runAction = async (id: string) => {
    try {
      await actions.find((action) => action.id === id)?.run();
    } catch (error) {
      toast.danger(t`无法打开 ${basename}：${friendlyError(error)}`);
    }
  };

  if (actions.length === 0) {
    return (
      <span className="craftstation-inline-path-chip" title={path}>
        {chipInner}
      </span>
    );
  }

  if (mobile) {
    // A single action (the common mobile case — "show in explorer" is stripped
    // on remote) fires directly on tap; multiple actions open a bottom drawer.
    if (actions.length === 1) {
      return (
        <button
          type="button"
          className="craftstation-inline-path-chip"
          title={path}
          onClick={() => {
            void runAction(actions[0]!.id);
          }}
        >
          {chipInner}
        </button>
      );
    }
    return (
      <ResponsiveMenuSurface
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        label={basename || t`Folder`}
        trigger={
          <button
            type="button"
            className="craftstation-inline-path-chip"
            title={path}
            aria-expanded={isOpen}
            onClick={() => setIsOpen(true)}
          >
            {chipInner}
          </button>
        }
      >
        <div className="m-sheet-list">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className="m-sheet-action"
              onClick={() => {
                setIsOpen(false);
                void runAction(action.id);
              }}
            >
              <span className="flex-1 truncate">{action.label}</span>
            </button>
          ))}
        </div>
      </ResponsiveMenuSurface>
    );
  }

  return (
    <ContextMenu
      items={actions}
      openRequest={openRequest}
      onAction={(id) => {
        void runAction(id);
      }}
    >
      <button
        type="button"
        className="craftstation-inline-path-chip"
        title={path}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          setOpenRequest((previous) => ({
            x: bounds.left,
            y: bounds.bottom,
            nonce: (previous?.nonce ?? 0) + 1,
          }));
        }}
      >
        {chipInner}
      </button>
    </ContextMenu>
  );
}
