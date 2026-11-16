import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectLocation } from "@/shared/contracts";
import { toWslUncPath } from "@/shared/wsl";
import { resolveKimiSessionDir } from "./sessionFiles";

/** Kimi v2 loses the provider error when converting a failed turn to ACP end_turn.
 * Read only the journal tail for this exact session, after an empty completion. */
export async function readKimiTurnQuotaError(
  location: ProjectLocation,
  sessionId: string,
  promptStartedAt: number,
  kimiHome?: string,
): Promise<Error | undefined> {
  try {
    const dir = await resolveKimiSessionDir(
      location,
      sessionId,
      kimiHome ? { kimiHome } : undefined,
    );
    if (!dir) return;
    const hostDir = location.kind === "wsl" ? toWslUncPath(location.distro, dir) : dir;
    const file = await open(join(hostDir, "agents", "main", "wire.jsonl"), "r");
    try {
      const { size } = await file.stat();
      const length = Math.min(size, 32 * 1024);
      const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, size - length);
      const lines = buffer.toString("utf8", 0, bytesRead).split("\n");
      if (size > length) lines.shift();
      for (const line of lines.reverse()) {
        if (!line.includes('"turn.ended"')) continue;
        const record = JSON.parse(line);
        if (record?.type !== "turn.ended" || record.agentId !== "main") continue;
        if (
          typeof record.time !== "number" ||
          record.time < promptStartedAt ||
          record.reason !== "failed" ||
          record.error?.name !== "APIProviderQuotaExhaustedError"
        )
          return;
        // Keep the billing axis, without forwarding provider diagnostics or journal content.
        return new Error(
          /\b5[- ]hour/i.test(record.error.message ?? "")
            ? "Kimi Code has reached its 5-hour usage limit."
            : "Kimi Code usage limit exhausted.",
        );
      }
    } finally {
      await file.close();
    }
  } catch {
    // Journals are optional on older engines. Preserve the normal empty-response diagnostic.
  }
  return undefined;
}
