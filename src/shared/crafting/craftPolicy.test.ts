import { describe, expect, it } from "vitest";
import { scheduledTaskConfigSchema } from "@/shared/contracts/schedule";
import { normalizeSharedSettings } from "@/shared/settings";
import {
  evaluateCraftPolicy,
  scheduleSessionPolicy,
  withScheduleSessionPolicy,
} from "./craftPolicy";

describe("evaluateCraftPolicy", () => {
  it("uses the tightest numeric cap and cites the session layer when caps tie", () => {
    const decision = evaluateCraftPolicy({
      layers: { session: { maxToolCalls: 2 }, global: { maxToolCalls: 2 } },
      toolCalls: 2,
      spentUsd: 0,
      shell: false,
    });
    expect(decision).toMatchObject({
      action: "deny",
      layer: "session",
      limit: "maxToolCalls",
      cap: 2,
    });
  });

  it("cites the recipe layer when it is stricter than the session and global caps", () => {
    const decision = evaluateCraftPolicy({
      layers: {
        session: { maxToolCalls: 5 },
        recipe: { maxToolCalls: 3 },
        global: { maxToolCalls: 4 },
      },
      toolCalls: 3,
      spentUsd: 0,
      shell: false,
    });
    expect(decision).toMatchObject({ action: "deny", layer: "recipe", cap: 3 });
  });

  it("stops on spend before a shell prompt, and only after dollars were recorded", () => {
    expect(
      evaluateCraftPolicy({
        layers: { global: { maxCostUsd: 1, askBeforeShell: true } },
        toolCalls: 0,
        spentUsd: 0,
        shell: true,
      }).action,
    ).toBe("ask");
    expect(
      evaluateCraftPolicy({
        layers: { global: { maxCostUsd: 1, askBeforeShell: true } },
        toolCalls: 0,
        spentUsd: 1,
        shell: true,
      }),
    ).toMatchObject({ action: "deny", limit: "maxCostUsd", layer: "global" });
  });

  it("lets any layer require a shell prompt, and does not let a session false cancel it", () => {
    expect(
      evaluateCraftPolicy({
        layers: { session: { askBeforeShell: false }, global: { askBeforeShell: true } },
        toolCalls: 0,
        spentUsd: 0,
        shell: true,
      }).action,
    ).toBe("ask");
    expect(
      evaluateCraftPolicy({
        layers: { global: { askBeforeShell: true } },
        toolCalls: 0,
        spentUsd: 0,
        shell: false,
      }).action,
    ).toBe("allow");
  });
});

describe("schedule session policy", () => {
  it("attaches only a positive per-run spend cap", () => {
    expect(scheduleSessionPolicy({})).toBeUndefined();
    expect(scheduleSessionPolicy({ maxCostUsd: null })).toBeUndefined();
    expect(withScheduleSessionPolicy({ id: "plan" }, { maxCostUsd: 1.5 })).toEqual({
      id: "plan",
      sessionPolicy: { maxCostUsd: 1.5 },
    });
    expect(scheduledTaskConfigSchema.parse({ model: "gpt" })).toEqual({ model: "gpt" });
    expect(scheduledTaskConfigSchema.parse({ model: "gpt", maxCostUsd: 2 })).toMatchObject({
      maxCostUsd: 2,
    });
  });
});

describe("settings craftPolicy", () => {
  it("treats a missing global policy as no limits and drops an invalid one", () => {
    expect(normalizeSharedSettings({}).craftPolicy).toEqual({});
    expect(
      normalizeSharedSettings({ craftPolicy: { maxToolCalls: 4, askBeforeShell: true } })
        .craftPolicy,
    ).toEqual({ maxToolCalls: 4, askBeforeShell: true });
    expect(normalizeSharedSettings({ craftPolicy: { maxCostUsd: -1 } }).craftPolicy).toEqual({});
  });
});
