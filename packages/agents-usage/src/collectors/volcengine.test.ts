import { describe, expect, it } from "vitest";
import { createFakeHost, FAKE_NOW_MS } from "../testHost";
import {
  collectVolcengine,
  parseVolcengineAgentPlanUsage,
  parseVolcengineCodingPlanUsage,
  signVolcengineRequest,
  VOLCENGINE_AGENT_PLAN_URL,
  VOLCENGINE_ARK_CHAT_COMPLETIONS_URL,
  VOLCENGINE_CODING_PLAN_URL,
} from "./volcengine";

describe("Volcengine Ark Token Plan", () => {
  it("pins the V4 signature and signs host without sending a Host header", () => {
    const signed = signVolcengineRequest({
      url: VOLCENGINE_CODING_PLAN_URL,
      accessKeyId: "ak",
      secretAccessKey: "sk",
      region: "cn-beijing",
      date: new Date("2026-07-06T00:00:00Z"),
    });
    expect(signed.signature).toBe(
      "af2360717928ec1de9bf343f53dfb42cf2a808645ac688f6e9ccdf631b66b9b0",
    );
    expect(signed.body).toBe("{}");
    expect(signed.headers["Content-Type"]).toBe("application/json; charset=UTF-8");
    expect(Object.keys(signed.headers).map((key) => key.toLowerCase())).not.toContain("host");
    expect(signed.headers.Authorization).toContain(
      "SignedHeaders=content-type;host;x-content-sha256;x-date",
    );
  });

  it("parses Coding Plan and Agent Plan windows without manufacturing unknown fields", () => {
    expect(
      parseVolcengineCodingPlanUsage(
        {
          Result: {
            PlanName: "ark pro",
            QuotaUsage: [
              { Level: "session", Percent: 17, ResetTimestamp: 1_783_314_000 },
              { Level: "weekly", Percent: 22, ResetTimestamp: 1_783_900_800 },
            ],
          },
        },
        FAKE_NOW_MS,
      ),
    ).toMatchObject({
      status: "ok",
      plan: "Coding Plan Ark Pro",
      windows: [
        { id: "volcengine:coding:session-5h", usedPercent: 17 },
        { id: "volcengine:coding:weekly", usedPercent: 22 },
      ],
    });
    expect(
      parseVolcengineAgentPlanUsage(
        {
          Result: {
            PlanType: "Medium",
            AFPFiveHour: { Quota: 200, Used: 50 },
            AFPDaily: { Quota: 1000, Used: 250 },
            AFPWeekly: { Quota: 5000, Used: 1000 },
            AFPMonthly: { Quota: 20000, Used: 2000 },
          },
        },
        FAKE_NOW_MS,
      ).windows.map((window) => window.id),
    ).toEqual([
      "volcengine:agent:session-5h",
      "volcengine:agent:daily",
      "volcengine:agent:weekly",
      "volcengine:agent:monthly",
    ]);
  });

  it("collects signed plan windows and never exposes credentials in the snapshot", async () => {
    const host = createFakeHost({
      secrets: {
        volcengine: {
          accessKeyId: "AKLT-test",
          secretAccessKey: "super-secret",
          region: "cn-beijing",
        },
      },
      routes: {
        [VOLCENGINE_CODING_PLAN_URL]: {
          body: JSON.stringify({
            Result: { QuotaUsage: [{ Level: "weekly", Percent: 20 }] },
          }),
        },
        [VOLCENGINE_AGENT_PLAN_URL]: {
          body: JSON.stringify({
            Result: { PlanType: "Pro", AFPDaily: { Quota: 100, Used: 25 } },
          }),
        },
      },
    });
    const snapshot = await collectVolcengine(host);
    expect(snapshot).toMatchObject({
      status: "ok",
      windows: [
        { id: "volcengine:agent:daily", usedPercent: 25 },
        { id: "volcengine:coding:weekly", usedPercent: 20 },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain("super-secret");
    expect(JSON.stringify(snapshot)).not.toContain("AKLT-test");
  });

  it("uses AK/SK plan quota when an Ark API key is also stored", async () => {
    const host = createFakeHost({
      secrets: {
        volcengine: {
          apiKey: "ark-key",
          accessKeyId: "AKLT-test",
          secretAccessKey: "super-secret",
          region: "cn-beijing",
        },
      },
      routes: {
        [VOLCENGINE_CODING_PLAN_URL]: {
          body: JSON.stringify({
            Result: { QuotaUsage: [{ Level: "weekly", Percent: 33 }] },
          }),
        },
        [VOLCENGINE_AGENT_PLAN_URL]: {
          body: JSON.stringify({
            Result: { PlanType: "Pro", AFPDaily: { Quota: 100, Used: 10 } },
          }),
        },
        [VOLCENGINE_ARK_CHAT_COMPLETIONS_URL]: {
          body: JSON.stringify({ id: "chat_1" }),
        },
      },
    });
    const snapshot = await collectVolcengine(host);
    expect(snapshot).toMatchObject({
      status: "ok",
      windows: [
        { id: "volcengine:agent:daily", usedPercent: 10 },
        { id: "volcengine:coding:weekly", usedPercent: 33 },
      ],
    });
    expect(snapshot.error).toBeUndefined();
  });
});
