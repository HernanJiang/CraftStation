import { useEffect, useRef, useState } from "react";
import { Check, ListChecks } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAppStore } from "@/renderer/state/appStore";
import { PixelLoader } from "@/renderer/components/common/PixelLoader";
import { selectThreadTodoDockState, type ThreadTodoDockState } from "./threadTodoState";

function completedCount(todo: ThreadTodoDockState): number {
  return todo.steps.reduce((count, step) => (count + (step.status === "completed" ? 1 : 0)), 0);
}

function currentStep(todo: ThreadTodoDockState): string | undefined {
  return (
    todo.steps.find((step) => step.status === "in_progress")?.text ??
    todo.steps[todo.activeIndex]?.text ??
    todo.steps.find((step) => step.status === "pending")?.text
  );
}

/**
 * Compact plan chip for the composer context strip (next to Local). The
 * top-right status capsule keeps its own plan entry; this is an additional
 * in-place control above the input.
 */
export function ComposerPlanChip(props: { threadId: string }) {
  const { t } = useLingui();
  const todoState = useAppStore((s) => selectThreadTodoDockState(s, props.threadId));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const openCard = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    setOpen(false);
    cancelClose();
  }, [props.threadId]);

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!todoState || todoState.steps.length === 0) return null;

  const done = completedCount(todoState);
  const total = todoState.steps.length;
  const activeText = currentStep(todoState);
  const label = activeText
    ? `${done}/${total} ${activeText}`
    : t`Step ${done}/${total}`;

  return (
    <div
      ref={rootRef}
      className="relative min-w-0"
      data-testid="composer-plan-chip"
      onMouseEnter={openCard}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t`${label}. Show plan.`}
        onClick={() => setOpen((value) => !value)}
        onFocus={openCard}
        className="flex min-w-0 max-w-[min(42vw,280px)] items-center gap-1.5 font-medium text-foreground transition-colors hover:text-white"
      >
        <ListChecks className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 truncate [font-variant-numeric:tabular-nums]">{label}</span>
      </button>
      {open ? (
        <div
          data-testid="composer-plan-card"
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] p-1.5 shadow-2xl after:absolute after:-bottom-2 after:left-0 after:h-2 after:w-full after:content-['']"
        >
          <div className="px-1.5 py-1">
            <p className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
              <Trans>计划进度</Trans>
              <span className="shrink-0 text-[11px] [font-variant-numeric:tabular-nums]">
                {done}/{total}
              </span>
            </p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-400/80 transition-[width]"
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
          </div>
          <ul className="max-h-[min(40vh,280px)] space-y-0.5 overflow-y-auto">
            {todoState.steps.map((step, index) => (
              <li
                key={`${todoState.sourceItemId}:${index}`}
                className="flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-xs"
              >
                {step.status === "completed" ? (
                  <span
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20"
                    aria-label="done"
                  >
                    <Check className="size-2.5 text-emerald-400" aria-hidden="true" />
                  </span>
                ) : step.status === "in_progress" ? (
                  <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
                    <PixelLoader size="xxs" className="text-foreground" />
                  </span>
                ) : (
                  <span
                    className="size-1.5 shrink-0 rounded-full border border-muted/50"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`min-w-0 flex-1 truncate ${
                    step.status === "completed" ? "text-muted" : "text-foreground"
                  }`}
                >
                  {step.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
