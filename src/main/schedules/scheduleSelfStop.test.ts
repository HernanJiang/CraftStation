import { describe, expect, it } from "vitest";
import { readScheduleSelfStop, scheduleSelfStopInstructions } from "./scheduleSelfStop";

const SCHEDULE_ID = "52adecc1-1111-4111-8111-111111111111";

describe("schedule self-stop", () => {
  it("reads only the last non-empty line, and ignores the instruction block", () => {
    const instructions = scheduleSelfStopInstructions(SCHEDULE_ID);
    expect(readScheduleSelfStop(instructions, SCHEDULE_ID)).toBeNull();
    expect(
      readScheduleSelfStop(`检查结束，计划应停止。\nCRAFTSTATION_SCHEDULE: pause`, SCHEDULE_ID),
    ).toBe("pause");
    expect(
      readScheduleSelfStop(`done\nCRAFTSTATION_SCHEDULE: delete ${SCHEDULE_ID}\n`, SCHEDULE_ID),
    ).toBe("delete");
    expect(
      readScheduleSelfStop("CRAFTSTATION_SCHEDULE: pause other-id-not-a-uuid", SCHEDULE_ID),
    ).toBeNull();
    expect(
      readScheduleSelfStop(
        "CRAFTSTATION_SCHEDULE: pause 00000000-0000-4000-8000-000000000000",
        SCHEDULE_ID,
      ),
    ).toBeNull();
    expect(
      readScheduleSelfStop("keep running\nCRAFTSTATION_SCHEDULE: pause\nthanks", SCHEDULE_ID),
    ).toBe(null);
  });
});
