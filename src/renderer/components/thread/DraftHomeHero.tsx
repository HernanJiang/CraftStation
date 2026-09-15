import { Boxes, Hammer, PanelLeft, ScrollText, type LucideIcon } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { usePanelStore } from "@/renderer/state/panelStore";
import { toggleSidebar } from "@/renderer/state/sidebarOverlayStore";
import { CraftStationMascot } from "@/renderer/components/common/CraftStationMascot";

/**
 * v1.2.6 — home hero for the new-thread draft screen.
 *
 * Mascot hero animation, greeting line, and a row of four real entry cards
 * above the composer. Every card navigates: 合成台 / 模型管理 / 配方管理 open
 * the matching first-level tab of the model-usage workspace, 侧边栏 toggles
 * the existing app sidebar (single source of truth in `sidebarOverlayStore`).
 *
 * Mascot motion assets are extracted from the installed Codex desktop app.
 */

interface EntryCard {
  id: string;
  icon: LucideIcon;
  accentClass: string;
  label: string;
  action: () => void;
}

export function DraftHomeHero() {
  const cards: EntryCard[] = [
    {
      id: "crafting",
      icon: Hammer,
      accentClass: "text-sky-400",
      label: "合成台 / Harness",
      action: () => usePanelStore.getState().openModelUsageWorkspace({ tab: "crafting" }),
    },
    {
      id: "sidebar",
      icon: PanelLeft,
      accentClass: "text-violet-400",
      label: "侧边栏",
      action: () => toggleSidebar(),
    },
    {
      id: "models",
      icon: Boxes,
      accentClass: "text-emerald-400",
      label: "模型管理",
      action: () => usePanelStore.getState().openModelUsageWorkspace({ tab: "models" }),
    },
    {
      id: "recipes",
      icon: ScrollText,
      accentClass: "text-orange-400",
      label: "配方管理",
      action: () => usePanelStore.getState().openModelUsageWorkspace({ tab: "recipes" }),
    },
  ];

  return (
    <div className="flex w-full flex-col items-center pb-10">
      {/* CraftStation mascot: rotating logo + blinking `>_` face. */}
      <CraftStationMascot />

      <h1 className="mt-4 text-center text-[24px] font-semibold tracking-tight text-white">
        <Trans>What shall we build in CraftStation?</Trans>
      </h1>

      <div className="mt-8 grid w-full grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`home-entry-${card.id}`}
              aria-label={card.label}
              onClick={card.action}
              className="flex min-h-[108px] flex-col items-start justify-between rounded-xl border border-[color:var(--hairline)] bg-[var(--surface)] p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-white/10 hover:bg-white/[0.04]"
            >
              <Icon className={`size-4.5 shrink-0 ${card.accentClass}`} />
              <span className="text-sm leading-snug text-foreground/90">{card.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
