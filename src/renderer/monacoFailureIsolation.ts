export type MonacoFailurePhase = "initialization" | "editor" | "worker";

export type MonacoRuntimeFailure = {
  error: Error;
  phase: MonacoFailurePhase;
  workerLabel?: string;
};

type MonacoFailureListener = () => void;

const markedErrors = new WeakSet<object>();
const listeners = new Set<MonacoFailureListener>();
// Monaco's unexpectedErrorHandler copies a failure into `new Error(message + "\n\n" + stack)`.
// A different Error with the same message must still reach the global crash screen.
const suppressedMessages = new Set<string>();
let currentFailure: MonacoRuntimeFailure | null = null;

function rememberMessage(message: string | undefined): void {
  const trimmed = message?.trim();
  if (!trimmed) return;
  suppressedMessages.add(trimmed);
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof ErrorEvent !== "undefined" && reason instanceof ErrorEvent) {
    const location = reason.filename
      ? `${reason.filename}${reason.lineno > 0 ? `:${reason.lineno}` : ""}`
      : "";
    const detail = [reason.message, location].filter(Boolean).join(" ");
    return new Error(detail || "Monaco editor failed to initialize.");
  }
  return new Error(typeof reason === "string" ? reason : "Monaco editor failed to initialize.");
}

function messageMatchesMonacoFailure(message: string): boolean {
  for (const known of suppressedMessages) {
    const copied = `${known}\n\n`;
    if (message.startsWith(copied) || message.startsWith(`Uncaught Error: ${copied}`)) return true;
  }
  return false;
}

export function markMonacoWorkerEvent(event: Event): void {
  markedErrors.add(event);
  if (!(event instanceof ErrorEvent)) return;
  if (typeof event.error === "object" && event.error !== null) markedErrors.add(event.error);
  rememberMessage(event.message);
  if (event.error instanceof Error) rememberMessage(event.error.message);
}

export function publishMonacoRuntimeFailure(
  reason: unknown,
  context: Omit<MonacoRuntimeFailure, "error">,
): MonacoRuntimeFailure {
  const error = toError(reason);
  markedErrors.add(error);
  if (typeof reason === "object" && reason !== null) markedErrors.add(reason);
  if (typeof ErrorEvent !== "undefined" && reason instanceof ErrorEvent) {
    rememberMessage(reason.message);
  }
  rememberMessage(error.message);
  currentFailure = { error, ...context };
  for (const listener of listeners) listener();
  return currentFailure;
}

export function isMonacoRuntimeError(reason: unknown): boolean {
  if (typeof reason === "object" && reason !== null && markedErrors.has(reason)) return true;
  if (reason instanceof Error) return messageMatchesMonacoFailure(reason.message);
  if (typeof reason === "string") return messageMatchesMonacoFailure(reason);
  return false;
}

export function getMonacoRuntimeFailure(): MonacoRuntimeFailure | null {
  return currentFailure;
}

export function subscribeToMonacoRuntimeFailure(listener: MonacoFailureListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
