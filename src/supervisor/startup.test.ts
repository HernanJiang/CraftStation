import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { AccountControlError } from "@/shared/contracts";
import { createSupervisorIpcHandlers } from "./ipcHandlers";
import { SupervisorRuntime } from "./supervisorRuntime";

it("starts the full Supervisor and serves unrelated RPCs when all account metadata copies are zero-filled", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "craftstation-startup-recovery-"));
  const accountDir = join(dataDir, "craftstation-accounts");
  mkdirSync(accountDir);
  for (const suffix of ["", ".bak", ".last-good"]) {
    writeFileSync(join(accountDir, `accounts.json${suffix}`), Buffer.alloc(21057));
  }
  writeFileSync(join(dataDir, "settings.json"), JSON.stringify({ locale: "en" }));
  vi.stubEnv("CRAFTSTATION_DATA_DIR", dataDir);
  let runtime: SupervisorRuntime | undefined;
  try {
    runtime = new SupervisorRuntime(() => undefined);
    const handlers = createSupervisorIpcHandlers(runtime);
    expect(() => handlers.listAccounts({})).toThrow(AccountControlError);
    expect(handlers.getThreadSnapshots({})).toEqual([]);
  } finally {
    await runtime?.disposeAsync();
    vi.unstubAllEnvs();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
