import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanStepCodeUsage } from "./stepcodeUsageScanner";

describe("scanStepCodeUsage", () => {
  let dir: string;
  let authPath: string;
  const savedApiKey = process.env.STEP_API_KEY;

  beforeEach(() => {
    // The candidates param keeps every test fully isolated — no env juggling
    // and no risk of reading a real credential from the dev machine.
    dir = mkdtempSync(join(tmpdir(), "stepcode-usage-"));
    authPath = join(dir, "auth.json");
    delete process.env.STEP_API_KEY;
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.STEP_API_KEY;
    else process.env.STEP_API_KEY = savedApiKey;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports identity from an OAuth profile in auth.json", () => {
    writeFileSync(
      authPath,
      JSON.stringify({
        step: {
          type: "oauth",
          access: "secret-token",
          refresh: "step-static-credential",
          profile: "step_plan",
          uid: "412889548068540416",
        },
      }),
    );
    const snap = scanStepCodeUsage(1000, [authPath]);
    expect(snap.status).toBe("ok");
    expect(snap.plan).toBe("Step Plan");
    expect(snap.authenticatedAs).toBe("4128…0416");
    expect(snap.windows).toEqual([]);
    expect(snap.fetchedAt).toBe(1000);
  });

  it("falls back to the provider key when the entry carries no uid", () => {
    writeFileSync(authPath, JSON.stringify({ step: { type: "api", key: "sk-secret" } }));
    const snap = scanStepCodeUsage(1000, [authPath]);
    expect(snap.status).toBe("ok");
    expect(snap.authenticatedAs).toBe("step");
    // api-key entries carry no profile — no plan badge is fabricated.
    expect(snap.plan).toBeUndefined();
  });

  it("skips an empty object and falls through to the next candidate", () => {
    const empty = join(dir, "empty.json");
    writeFileSync(empty, "{}");
    writeFileSync(authPath, JSON.stringify({ step: { type: "oauth", uid: "1" } }));
    const snap = scanStepCodeUsage(1000, [empty, authPath]);
    expect(snap.status).toBe("ok");
    expect(snap.authenticatedAs).toBe("1");
  });

  it("treats STEP_API_KEY as a credential when no auth.json exists", () => {
    process.env.STEP_API_KEY = "sk-test";
    const snap = scanStepCodeUsage(1000, [join(dir, "nonexistent.json")]);
    expect(snap.status).toBe("ok");
    expect(snap.authenticatedAs).toBe("STEP_API_KEY");
  });

  it("reports auth-missing when nothing is present", () => {
    const snap = scanStepCodeUsage(1000, [join(dir, "nonexistent.json")]);
    expect(snap.status).toBe("auth-missing");
    expect(snap.windows).toEqual([]);
  });

  it("treats a malformed auth.json as missing", () => {
    writeFileSync(authPath, "not-json{{{");
    const snap = scanStepCodeUsage(1000, [authPath]);
    expect(snap.status).toBe("auth-missing");
    expect(snap.windows).toEqual([]);
  });
});
