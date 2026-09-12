import type { RuntimeContentStreamKind } from "./contracts";

/**
 * Tool output is unbounded at the provider boundary, but it must be bounded
 * before it reaches the renderer and transcript database. Keeping the newest
 * output is the useful part for diagnostics and prevents one command from
 * freezing the UI or growing the SQLite row without limit.
 */
export const MAX_RUNTIME_OUTPUT_CHARS = 256 * 1024;
export const RUNTIME_OUTPUT_TRUNCATION_MARKER =
  "\n...[output truncated; showing the latest output]\n";

const BOUNDED_RUNTIME_STREAMS = new Set<RuntimeContentStreamKind>([
  "command_output",
  "file_change_output",
]);

export function appendRuntimeStream(
  previous: string,
  delta: string,
  stream: RuntimeContentStreamKind,
): string {
  if (!BOUNDED_RUNTIME_STREAMS.has(stream)) return previous + delta;
  if (previous.length + delta.length <= MAX_RUNTIME_OUTPUT_CHARS) return previous + delta;

  // Avoid materializing an unbounded `previous + delta` when a provider emits
  // one very large output frame. Only the tail can survive the cap.
  const tailLength = Math.max(
    0,
    MAX_RUNTIME_OUTPUT_CHARS - RUNTIME_OUTPUT_TRUNCATION_MARKER.length,
  );
  if (delta.length >= tailLength) {
    return `${RUNTIME_OUTPUT_TRUNCATION_MARKER}${delta.slice(-tailLength)}`;
  }
  const previousTail = previous.slice(-(tailLength - delta.length));
  return `${RUNTIME_OUTPUT_TRUNCATION_MARKER}${previousTail}${delta}`;
}
