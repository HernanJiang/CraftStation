import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Tooltip } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { CalendarClock, CirclePlay, Pause, Pencil, Trash2 } from "lucide-react";
import type { ScheduledTask } from "@/shared/contracts";
import { readBridge } from "@/renderer/bridge";
import { ConfirmDialog } from "@/renderer/components/common/ConfirmDialog";
import { useAppStore } from "@/renderer/state/appStore";
import { selectSchedulesForThread, useScheduleStore } from "@/renderer/state/scheduleStore";

function scheduleStatusLabel(task: ScheduledTask, formatNext: (iso: string) => string): string {
  if (task.lastStatus === "running") return "Running";
  if (!task.enabled || !task.nextRunAt) return "Paused";
  return formatNext(task.nextRunAt);
}

export function ThreadScheduleIndicator(props: { threadId: string }) {
  const { t, i18n } = useLingui();
  const tasks = useScheduleStore((state) => state.tasks);
  const related = useMemo(
    () => selectSchedulesForThread(tasks, props.threadId),
    [tasks, props.threadId],
  );
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null);
  const [panelAnchor, setPanelAnchor] = useState({ top: 48, right: 16 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const prevThreadId = useRef(props.threadId);
  useEffect(() => {
    if (prevThreadId.current === props.threadId) return;
    prevThreadId.current = props.threadId;
    setOpen(false);
  }, [props.threadId]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  if (related.length === 0) return null;

  const dateTimeFormatter = new Intl.DateTimeFormat(i18n.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const formatNext = (iso: string) => dateTimeFormatter.format(new Date(iso));
  const runningCount = related.filter((task) => task.lastStatus === "running").length;
  const collapsedLabel =
    related.length === 1 ? scheduleStatusLabel(related[0]!, formatNext) : String(related.length);
  const ariaLabel =
    related.length === 1
      ? t`Schedule: ${related[0]!.name}. ${scheduleStatusLabel(related[0]!, formatNext)}`
      : t`${related.length} schedules`;

  function positionPanel() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelAnchor({
      top: Math.round(rect.bottom + 8),
      right: Math.round(window.innerWidth - rect.right),
    });
  }

  async function mutate(task: ScheduledTask, action: "pause" | "resume"): Promise<void> {
    const bridge = readBridge();
    if (action === "pause") await bridge.pauseSchedule({ id: task.id });
    else await bridge.resumeSchedule({ id: task.id });
    await useScheduleStore.getState().refresh();
  }

  function openSchedule(task: ScheduledTask) {
    setOpen(false);
    useScheduleStore.getState().setFocusedScheduleId(task.id);
    useAppStore.getState().openSchedules();
  }

  function editSchedule(task: ScheduledTask) {
    setOpen(false);
    const store = useScheduleStore.getState();
    store.setFocusedScheduleId(task.id);
    store.setEditingScheduleId(task.id);
    useAppStore.getState().openSchedules();
  }

  function confirmDelete() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    void readBridge()
      .deleteSchedule({ id: target.id })
      .then(() => useScheduleStore.getState().refresh());
  }

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        ref={buttonRef}
        type="button"
        data-testid="thread-schedule-indicator"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          positionPanel();
          setOpen((current) => !current);
        }}
        className="craftstation-overlay-header__controls flex h-7 max-w-[min(28vw,180px)] shrink-0 cursor-default items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--composer-surface)] px-2.5 text-[13px] font-medium text-muted shadow-sm transition-colors hover:bg-[var(--row-hover)] hover:text-foreground"
      >
        <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate [font-variant-numeric:tabular-nums]">
          {related.length === 1 ? (
            runningCount > 0 ? (
              <Trans>Running</Trans>
            ) : related[0]?.enabled ? (
              collapsedLabel
            ) : (
              <Trans>Paused</Trans>
            )
          ) : (
            collapsedLabel
          )}
        </span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              data-testid="thread-schedule-popover"
              style={{ position: "fixed", top: panelAnchor.top, right: panelAnchor.right }}
              className="z-[100] w-[280px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--composer-surface)] shadow-2xl"
            >
              <p className="truncate px-3 pt-2 pb-1 text-xs font-semibold text-foreground">
                <Trans>Schedules</Trans>
              </p>
              <ul className="max-h-[min(50vh,320px)] overflow-y-auto py-1">
                {related.map((task) => {
                  const status = scheduleStatusLabel(task, formatNext);
                  return (
                    <li
                      key={task.id}
                      className="flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--row-hover)]"
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => openSchedule(task)}
                      >
                        <p className="truncate text-xs font-medium text-foreground">{task.name}</p>
                        <p className="truncate text-[11px] text-muted">{status}</p>
                      </button>
                      <Tooltip delay={0}>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={task.enabled ? t`Pause` : t`Resume`}
                          onPress={() => void mutate(task, task.enabled ? "pause" : "resume")}
                        >
                          {task.enabled ? (
                            <Pause className="size-3.5" />
                          ) : (
                            <CirclePlay className="size-3.5" />
                          )}
                        </Button>
                        <Tooltip.Content>{task.enabled ? t`Pause` : t`Resume`}</Tooltip.Content>
                      </Tooltip>
                      <Tooltip delay={0}>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t`Edit schedule`}
                          onPress={() => editSchedule(task)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Tooltip.Content>{t`Edit schedule`}</Tooltip.Content>
                      </Tooltip>
                      <Tooltip delay={0}>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          className="text-muted hover:text-danger"
                          aria-label={t`Delete schedule`}
                          onPress={() => setDeleteTarget(task)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                        <Tooltip.Content>{t`Delete schedule`}</Tooltip.Content>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </div>,
            document.body,
          )
        : null}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t`Delete schedule?`}
        body={<Trans>This removes the schedule and its latest result from this device.</Trans>}
        confirmLabel={t`Delete`}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
