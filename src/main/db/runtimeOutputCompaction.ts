import Database from "better-sqlite3";
import { appendRuntimeStream, MAX_RUNTIME_OUTPUT_CHARS } from "@/shared/runtimeStream";
import { safeParse } from "./rowMappers";

/**
 * Compact oversized command/file output rows from older runtimes at startup.
 * This module intentionally has no dependency on the database singleton, so
 * opening a database cannot introduce a connection/runtime-items import cycle.
 */
export function dbCompactRuntimeOutputStreams(sqlite: InstanceType<typeof Database>): void {
  const rows = sqlite
    .prepare(
      "SELECT rowid AS rowid, streams FROM thread_runtime_items WHERE streams IS NOT NULL AND length(streams) > ?",
    )
    .all(MAX_RUNTIME_OUTPUT_CHARS) as Array<{ rowid: number; streams: string }>;
  const update = sqlite.prepare("UPDATE thread_runtime_items SET streams = ? WHERE rowid = ?");
  const compact = sqlite.transaction(() => {
    for (const row of rows) {
      const parsed = safeParse(row.streams);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const streams = parsed as Record<string, unknown>;
      let changed = false;
      for (const stream of ["command_output", "file_change_output"] as const) {
        const value = streams[stream];
        if (typeof value !== "string") continue;
        const compacted = appendRuntimeStream("", value, stream);
        if (compacted !== value) {
          streams[stream] = compacted;
          changed = true;
        }
      }
      if (changed) update.run(JSON.stringify(streams), row.rowid);
    }
  });
  compact();
}
