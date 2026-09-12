import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Chip, Input, Label, Modal, TextArea, TextField } from "@heroui/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { AlertTriangle, ArrowUpRight, MessagesSquare, Search, X } from "lucide-react";
import type {
  ThreadDeliveryMode,
  ThreadExchangeView,
  ThreadTargetSummary,
} from "@/shared/threadCollaboration";
import { isSelectableThreadTarget } from "@/shared/threadCollaboration";
import { readBridge } from "@/renderer/bridge";
import { openThread } from "@/renderer/actions/threadActions";
import {
  CollaborationStatusIcon,
  collaborationCounterpart,
  collaborationStatusLabel,
  collaborationStatusTone,
  compositionLabel,
  displayDialogueTitle,
  threadTargetStatusLabel,
} from "./threadCollaborationUi";

function requestIdempotencyKey(sourceThreadId: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `renderer:${sourceThreadId}:${random}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

/** Collaboration errors that mean "this provider cannot do that", not a failure. */
const UNSUPPORTED_COLLABORATION_CODES = new Set([
  "THREAD_COLLABORATION_CAPABILITY_UNAVAILABLE",
  "HANDOFF_STEER_UNSUPPORTED",
]);

function exchangeUnsupported(exchange: ThreadExchangeView): boolean {
  return exchange.error ? UNSUPPORTED_COLLABORATION_CODES.has(exchange.error.code) : false;
}

function unsupportedNotice(label: string): string {
  return `${label} 暂不支持：该 Provider 的运行时不提供此能力，未产生失败。`;
}

export function ThreadCollaborationDialog(props: {
  isOpen: boolean;
  sourceThreadId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useLingui();
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<ThreadTargetSummary[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [request, setRequest] = useState("");
  const [deliveryMode, setDeliveryMode] = useState<ThreadDeliveryMode>("after-current-turn");
  const [attachContext, setAttachContext] = useState(false);
  const [contextSummary, setContextSummary] = useState("");
  const [interruptConfirmed, setInterruptConfirmed] = useState(false);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [exchanges, setExchanges] = useState<ThreadExchangeView[]>([]);
  const targetRequestSequence = useRef(0);

  const selectedTarget = targets.find((target) => target.threadId === selectedTargetId);
  const unknownError = t`Unknown collaboration error`;

  const loadExchanges = useCallback(async (): Promise<void> => {
    const bridge = readBridge();
    if (typeof bridge?.listThreadExchanges !== "function") {
      throw new Error(t`Thread collaboration is not available on this host.`);
    }
    const next = await bridge.listThreadExchanges({
      actorThreadId: props.sourceThreadId,
      threadId: props.sourceThreadId,
      limit: 30,
    });
    setExchanges(next);
  }, [props.sourceThreadId, t]);

  useEffect(() => {
    if (!props.isOpen) return;
    const bridge = readBridge();
    if (
      typeof bridge?.listThreadExchanges !== "function" ||
      typeof bridge.listThreadCollaborationTargets !== "function"
    ) {
      setError(t`Thread collaboration is not available on this host.`);
      return;
    }
    setError("");
    void loadExchanges().catch((nextError) => setError(errorMessage(nextError, unknownError)));
    const timer = window.setInterval(() => void loadExchanges().catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [loadExchanges, props.isOpen, t, unknownError]);

  useEffect(() => {
    if (!props.isOpen) return;
    const bridge = readBridge();
    if (typeof bridge?.listThreadCollaborationTargets !== "function") {
      setLoadingTargets(false);
      setTargets([]);
      setSelectedTargetId("");
      setError(t`Thread collaboration is not available on this host.`);
      return;
    }
    const requestSequence = ++targetRequestSequence.current;
    setLoadingTargets(true);
    void bridge
      .listThreadCollaborationTargets({
        sourceThreadId: props.sourceThreadId,
        ...(query.trim() ? { query: query.trim() } : {}),
      })
      .then((nextTargets) => {
        if (requestSequence !== targetRequestSequence.current) return;
        setTargets(nextTargets);
        setSelectedTargetId((current) =>
          nextTargets.some((target) => target.threadId === current)
            ? current
            : (nextTargets.find(isSelectableThreadTarget)?.threadId ?? ""),
        );
      })
      .catch((nextError) => {
        if (requestSequence === targetRequestSequence.current) {
          setTargets([]);
          setSelectedTargetId("");
          setError(errorMessage(nextError, unknownError));
        }
      })
      .finally(() => {
        if (requestSequence === targetRequestSequence.current) setLoadingTargets(false);
      });
  }, [props.isOpen, props.sourceThreadId, query, t, unknownError]);

  useEffect(() => {
    setInterruptConfirmed(false);
  }, [deliveryMode, selectedTargetId, request]);

  async function submit(): Promise<void> {
    if (!selectedTarget || !request.trim() || submitting) return;
    if (!isSelectableThreadTarget(selectedTarget)) return;
    if (deliveryMode === "interrupt-and-send" && !interruptConfirmed) {
      setInterruptConfirmed(true);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const bridge = readBridge();
      if (typeof bridge?.requestThreadDialogue !== "function") {
        throw new Error(t`Thread collaboration is not available on this host.`);
      }
      await bridge.requestThreadDialogue({
        sourceThreadId: props.sourceThreadId,
        targetThreadId: selectedTarget.threadId,
        request: request.trim(),
        deliveryMode,
        idempotencyKey: requestIdempotencyKey(props.sourceThreadId),
        ...(attachContext && contextSummary.trim()
          ? { context: { summary: contextSummary.trim() } }
          : {}),
        hopDepth: 0,
      });
      setRequest("");
      setContextSummary("");
      setAttachContext(false);
      setDeliveryMode("after-current-turn");
      setInterruptConfirmed(false);
      await loadExchanges();
      props.onChanged?.();
    } catch (nextError) {
      setError(errorMessage(nextError, unknownError));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(exchangeId: string): Promise<void> {
    setError("");
    try {
      const bridge = readBridge();
      if (typeof bridge?.cancelThreadExchange !== "function") {
        throw new Error(t`Thread collaboration is not available on this host.`);
      }
      await bridge.cancelThreadExchange({
        actorThreadId: props.sourceThreadId,
        exchangeId,
      });
      await loadExchanges();
      props.onChanged?.();
    } catch (nextError) {
      setError(errorMessage(nextError, unknownError));
    }
  }

  return (
    <Modal.Backdrop isOpen={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <MessagesSquare className="size-5" />
            </Modal.Icon>
            <Modal.Heading>
              <Trans>Ask another thread</Trans>
            </Modal.Heading>
            <p className="text-sm text-muted">
              <Trans>The target keeps its own Model, Harness, native session, and timeline.</Trans>
            </p>
          </Modal.Header>
          <Modal.Body className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <TextField name="thread-target-search" value={query} onChange={setQuery}>
                <Label>
                  <Trans>Find a target thread</Trans>
                </Label>
                <div className="relative">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
                  />
                  <Input
                    className="w-full pl-9"
                    placeholder={t`Search title, Model, Harness, status, or worktree`}
                  />
                </div>
              </TextField>

              <div
                aria-label={t`Available target threads`}
                className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-border p-2"
                role="listbox"
              >
                {loadingTargets ? (
                  <p className="px-2 py-4 text-center text-sm text-muted">
                    <Trans>Loading target threads…</Trans>
                  </p>
                ) : targets.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-muted">
                    <Trans>No matching target threads.</Trans>
                  </p>
                ) : (
                  targets.map((target) => (
                    <div
                      key={target.threadId}
                      aria-label={target.title}
                      aria-selected={target.threadId === selectedTargetId}
                      role="option"
                    >
                      <Button
                        className={`h-auto w-full items-start justify-start rounded-lg px-3 py-2 text-left ${
                          target.threadId === selectedTargetId
                            ? "bg-accent-soft text-accent-soft-foreground"
                            : "bg-transparent"
                        }`}
                        isDisabled={!isSelectableThreadTarget(target)}
                        variant="ghost"
                        onPress={() => setSelectedTargetId(target.threadId)}
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {target.title}
                            </span>
                            <Chip size="sm" variant="soft">
                              <Chip.Label>{threadTargetStatusLabel(target.status)}</Chip.Label>
                            </Chip>
                          </span>
                          <span className="truncate text-xs text-muted">
                            {compositionLabel(target.provenance)}
                          </span>
                          {target.provenance.nativeSessionId ? (
                            <span className="truncate font-mono text-xs text-muted">
                              {target.provenance.harnessId}:{target.provenance.nativeSessionId}
                            </span>
                          ) : null}
                          <span className="truncate text-xs text-muted">
                            {target.provenance.worktreePath ?? t`Project worktree`}
                          </span>
                          {target.sameComposition ? (
                            <span className="truncate text-xs text-warning-soft-foreground">
                              <Trans>
                                Same Model and Harness as this thread — not selectable for
                                cross-thread dialogue.
                              </Trans>
                            </span>
                          ) : null}
                        </span>
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {selectedTarget && !selectedTarget.sameWorktree ? (
                <div
                  className="flex gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
                  role="alert"
                >
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <Trans>
                      This target uses another worktree. Messages do not synchronize files between
                      worktrees.
                    </Trans>
                  </span>
                </div>
              ) : null}

              <TextField
                isRequired
                name="thread-collaboration-request"
                value={request}
                onChange={setRequest}
              >
                <Label>
                  <Trans>Request</Trans>
                </Label>
                <TextArea
                  className="min-h-28 w-full"
                  placeholder={t`Ask the target thread a specific question or task…`}
                />
              </TextField>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">
                  <Trans>Delivery</Trans>
                </legend>
                <label
                  aria-label={t`Queue after the current turn`}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3"
                >
                  <input
                    checked={deliveryMode === "after-current-turn"}
                    name="thread-delivery-mode"
                    type="radio"
                    value="after-current-turn"
                    onChange={() => setDeliveryMode("after-current-turn")}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      <Trans>Queue after the current turn</Trans>
                    </span>
                    <span className="text-xs text-muted">
                      <Trans>The target is never silently steered or interrupted.</Trans>
                    </span>
                  </span>
                </label>
                <label
                  aria-label={t`Interrupt the target, then send`}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3"
                >
                  <input
                    checked={deliveryMode === "interrupt-and-send"}
                    name="thread-delivery-mode"
                    type="radio"
                    value="interrupt-and-send"
                    onChange={() => setDeliveryMode("interrupt-and-send")}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      <Trans>Interrupt the target, then send</Trans>
                    </span>
                    <span className="text-xs text-muted">
                      <Trans>Delivery waits for the target to confirm it has stopped.</Trans>
                    </span>
                  </span>
                </label>
              </fieldset>

              <label
                aria-label={t`Attach an explicit portable context summary`}
                className="flex items-start gap-2 text-sm"
              >
                <input
                  checked={attachContext}
                  type="checkbox"
                  onChange={(event) => setAttachContext(event.currentTarget.checked)}
                />
                <span>
                  <Trans>Attach an explicit portable context summary</Trans>
                </span>
              </label>
              {attachContext ? (
                <TextField
                  name="thread-context-summary"
                  value={contextSummary}
                  onChange={setContextSummary}
                >
                  <Label>
                    <Trans>Context summary</Trans>
                  </Label>
                  <TextArea
                    className="min-h-20 w-full"
                    placeholder={t`Only include context the target is allowed to receive`}
                  />
                </TextField>
              ) : null}

              {interruptConfirmed ? (
                <div
                  className="flex gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
                  role="alert"
                >
                  <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <Trans>
                      Confirm again to interrupt the target's active turn. If stop confirmation
                      fails, the request will not be delivered.
                    </Trans>
                  </span>
                </div>
              ) : null}

              {error ? (
                <div
                  className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
                  role="alert"
                >
                  <X aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span className="break-words">{error}</span>
                </div>
              ) : null}
            </div>

            <section aria-label={t`Dialogue exchanges`} className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-semibold">
                <Trans>Dialogue exchanges</Trans>
              </h3>
              {exchanges.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted">
                  <Trans>No cross-thread exchanges yet.</Trans>
                </div>
              ) : (
                <div className="flex max-h-[34rem] flex-col gap-2 overflow-y-auto">
                  {exchanges.map((exchange) => {
                    const counterpart = collaborationCounterpart(exchange, props.sourceThreadId);
                    const canCancel =
                      exchange.sourceThreadId === props.sourceThreadId &&
                      [
                        "created",
                        "queued",
                        "delivered",
                        "target_working",
                        "needs_attention",
                        "timed_out",
                      ].includes(exchange.status);
                    return (
                      <article
                        key={exchange.id}
                        className="flex flex-col gap-2 rounded-xl border border-border bg-surface-secondary/50 p-3"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Chip
                            color={collaborationStatusTone(exchange.status)}
                            size="sm"
                            variant="soft"
                          >
                            <CollaborationStatusIcon status={exchange.status} className="size-3" />
                            <Chip.Label>{collaborationStatusLabel(exchange.status)}</Chip.Label>
                          </Chip>
                          <span
                            className="min-w-0 flex-1 truncate text-sm font-medium"
                            title={counterpart.provenance.title}
                          >
                            {counterpart.direction === "outbound" ? (
                              <Trans>To</Trans>
                            ) : (
                              <Trans>From</Trans>
                            )}{" "}
                            {displayDialogueTitle(counterpart.provenance)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted">
                          {compositionLabel(counterpart.provenance)}
                        </p>
                        {exchange.replyExcerpt ? (
                          <p className="line-clamp-5 whitespace-pre-wrap text-sm text-foreground/90">
                            {exchange.replyExcerpt}
                          </p>
                        ) : null}
                        {exchange.error ? (
                          exchangeUnsupported(exchange) ? (
                            <p className="break-words text-xs text-amber-300/90">
                              {unsupportedNotice("该 Provider 跨线程消息")}
                            </p>
                          ) : (
                            <p className="break-words text-xs text-danger">
                              {exchange.error.code}: {exchange.error.message}
                            </p>
                          )
                        ) : null}
                        <div className="flex items-center justify-end gap-1">
                          {canCancel ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onPress={() => void cancel(exchange.id)}
                            >
                              {exchange.deliveredAt ? (
                                <Trans>Stop waiting for reply</Trans>
                              ) : (
                                <Trans>Cancel queued request</Trans>
                              )}
                            </Button>
                          ) : null}
                          <Button
                            isIconOnly
                            aria-label={t`Open ${displayDialogueTitle(counterpart.provenance)}`}
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                              props.onClose();
                              openThread(counterpart.provenance.threadId, {
                                focusComposer: false,
                                switchWorkspace: true,
                              });
                            }}
                          >
                            <ArrowUpRight className="size-4" />
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary">
              <Trans>Close</Trans>
            </Button>
            <Button
              isDisabled={
                !selectedTarget || !isSelectableThreadTarget(selectedTarget) || !request.trim()
              }
              isPending={submitting}
              variant={interruptConfirmed ? "danger" : "primary"}
              onPress={() => void submit()}
            >
              {interruptConfirmed ? (
                <Trans>Confirm interrupt and send</Trans>
              ) : deliveryMode === "interrupt-and-send" ? (
                <Trans>Review interrupt</Trans>
              ) : (
                <Trans>Queue request</Trans>
              )}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
