import { Bug, Hammer, RefreshCw, Rocket, type LucideIcon } from "lucide-react";
import { Trans } from "@lingui/react/macro";
import { CraftStationMascot } from "@/renderer/components/common/CraftStationMascot";

/**
 * v0.2.3 — Codex-style home hero for the new-thread draft screen.
 *
 * 1:1 layout replica of the Codex Desktop home: mascot hero animation,
 * greeting line, and a row of four task-suggestion cards above the composer.
 * CraftStation keeps its own product name; suggestion cards are UI-only —
 * clicking one focuses the composer, it does not prefill or launch anything.
 *
 * Mascot motion assets are extracted from the installed Codex desktop app.
 */

interface SuggestionCard {
  id: string;
  icon: LucideIcon;
  accentClass: string;
  label: React.ReactNode;
}

function focusComposer(anchor: HTMLElement | null) {
  const root = anchor?.closest("[data-draft-body]");
  const editor = root?.querySelector<HTMLElement>('[contenteditable="true"]');
  editor?.focus();
}

export function DraftHomeHero() {
  const cards: SuggestionCard[] = [
    {
      id: "explore",
      icon: Rocket,
      accentClass: "text-sky-400",
      label: <Trans>Explore and understand code</Trans>,
    },
    {
      id: "build",
      icon: Hammer,
      accentClass: "text-violet-400",
      label: <Trans>Build new features, apps, or tools</Trans>,
    },
    {
      id: "review",
      icon: RefreshCw,
      accentClass: "text-emerald-400",
      label: <Trans>Review code and suggest changes</Trans>,
    },
    {
      id: "fix",
      icon: Bug,
      accentClass: "text-orange-400",
      label: <Trans>Fix bugs and failures</Trans>,
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
              onClick={(event) => focusComposer(event.currentTarget)}
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
