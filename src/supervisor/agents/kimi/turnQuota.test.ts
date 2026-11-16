import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { classifyKimiPoolQuotaError } from "../acp/sessionErrors";
import { readKimiTurnQuotaError } from "./turnQuota";

it("recovers a five-hour quota failure from the current main turn in a managed profile", async () => {
  const root = await mkdtemp(join(tmpdir(), "kimi-quota-"));
  try {
    const location = { kind: "posix" as const, path: root };
    const sessionId = "session-test";
    const dir = join(root, "sessions", "workspace", sessionId, "agents", "main");
    await mkdir(dir, { recursive: true });
    const wire = join(dir, "wire.jsonl");
    const time = Date.now();
    const record = {
      type: "turn.ended",
      agentId: "main",
      reason: "failed",
      time,
      error: {
        code: "provider.api_error",
        name: "APIProviderQuotaExhaustedError",
        message: "You've reached your 5-hour usage limit.",
      },
    };
    await writeFile(
      wire,
      JSON.stringify({ text: "x".repeat(100_000) }) + "\n" + JSON.stringify(record) + "\n",
    );
    const read = (start: number) => readKimiTurnQuotaError(location, sessionId, start, root);
    expect(classifyKimiPoolQuotaError(await read(time - 1))?.axisId).toBe("session-5h");
    expect(await read(time + 1)).toBeUndefined();
    await writeFile(
      wire,
      [record, { ...record, error: { name: "RateLimitError", message: "429 too many requests" } }]
        .map((value) => JSON.stringify(value))
        .join("\n"),
    );
    expect(await read(time - 1)).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
