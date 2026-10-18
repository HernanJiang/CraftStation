import { describe, expect, it } from "vitest";
import { getStatusTone } from "../statusTone";

describe("getStatusTone", () => {
  it("keeps unopened resumable threads inactive", () => {
    expect(
      getStatusTone({
        done: false,
        status: "inactive",
      }),
    ).toBe("inactive");
  });

  it("marks initialized idle threads as active", () => {
    expect(
      getStatusTone({
        done: false,
        status: "idle",
      }),
    ).toBe("active");
  });

  it("treats launching threads as inactive until initialization completes", () => {
    expect(
      getStatusTone({
        done: false,
        status: "launching",
      }),
    ).toBe("inactive");
  });

  it("treats running threads as working", () => {
    expect(
      getStatusTone({
        done: false,
        status: "working",
      }),
    ).toBe("working");
  });

  it("renders done over stale runtime statuses", () => {
    for (const status of ["idle", "finished", "working", "needs_reply", "error"] as const) {
      expect(
        getStatusTone({
          done: true,
          status,
        }),
      ).toBe("done");
    }
  });

  it("keeps a settled turn settled even when background agents are still open", () => {
    expect(getStatusTone({ done: false, status: "idle" })).toBe("active");
    expect(getStatusTone({ done: false, status: "finished" })).toBe("finished");
  });

  it("never lets a settled status mask error or attention", () => {
    expect(getStatusTone({ done: false, status: "error" })).toBe("error");
    expect(getStatusTone({ done: false, status: "needs_approval" })).toBe("attention");
    expect(getStatusTone({ done: false, status: "inactive" })).toBe("inactive");
    expect(getStatusTone({ done: true, status: "idle" })).toBe("done");
  });
});
