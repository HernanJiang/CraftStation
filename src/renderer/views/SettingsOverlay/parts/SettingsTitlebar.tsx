import { ArrowLeft, Download, PanelLeft, RefreshCw } from "lucide-react";
import { useLingui } from "@lingui/react/macro";
import { readBridge } from "@/renderer/bridge";
import { toggleSidebar } from "@/renderer/state/sidebarOverlayStore";
import { useUpdateStore } from "@/renderer/state/updateStore";

const buttonClass =
  "craftstation-titlebar-control inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs text-muted transition-colors hover:bg-[var(--row-hover)] hover:text-foreground";

export function SettingsTitlebar(props: { onClose: () => void }) {
  const { t } = useLingui();
  const phase = useUpdateStore((state) => state.phase);
  const version = useUpdateStore((state) => state.version);
  const percent = useUpdateStore((state) => state.downloadPercent);

  return (
    <header className="craftstation-titlebar flex h-[38px] min-w-0 items-center bg-[var(--window-header-background)] px-2 text-foreground">
      <div className="craftstation-titlebar-control flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={buttonClass}
          aria-label={t`Toggle sidebar`}
          onClick={toggleSidebar}
        >
          <PanelLeft className="size-4" />
        </button>
        <button type="button" className={buttonClass} onClick={props.onClose}>
          <ArrowLeft className="size-4" />
          <span>{t`Back`}</span>
        </button>
      </div>
      <span className="ml-2 text-xs font-medium text-foreground/80">{t`Settings`}</span>
      <div className="craftstation-titlebar-drag min-w-8 flex-1 self-stretch" aria-hidden="true" />
      {phase === "downloading" || phase === "downloaded" ? (
        <button
          type="button"
          disabled={phase !== "downloaded"}
          onClick={() => void readBridge().installUpdate()}
          className="craftstation-titlebar-control mr-1 inline-flex h-6 items-center gap-1.5 rounded-lg bg-[var(--row-hover)] px-2 text-[11px] text-muted transition-colors hover:bg-[var(--row-active)] hover:text-foreground disabled:cursor-default"
        >
          {phase === "downloaded" ? (
            <Download className="size-3.5" />
          ) : (
            <RefreshCw className="size-3.5 animate-spin" />
          )}
          <span>
            {phase === "downloaded"
              ? `可用更新${version ? ` v${version}` : ""}`
              : `正在下载 ${Math.round(percent)}%`}
          </span>
        </button>
      ) : null}
      <div className="w-[138px] shrink-0" aria-hidden="true" />
    </header>
  );
}
