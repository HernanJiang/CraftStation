import { describe, expect, it } from "vitest";
import {
  WORKFLOW_STALE_PROGRESS_MS,
  isWorkflowRunLive,
  type WorkflowRun,
} from "./workflowTranscript";

function run(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    runId: "wf-test",
    status: "running",
    agentCount: 0,
    phases: [],
    unphasedAgents: [],
    ...overrides,
  };
}

describe("isWorkflowRunLive", () => {
  it("treats terminal statuses as not live", () => {
    expect(isWorkflowRunLive(run({ status: "completed" }))).toBe(false);
  });

  it("keeps quiet running manifests live by default", () => {
    const now = Date.parse("2026-06-01T12:00:00.000Z");
    expect(
      isWorkflowRunLive(
        run({
          startTime: now - WORKFLOW_STALE_PROGRESS_MS - 1,
          phases: [
            {
              title: "Run",
              agents: [
                {
                  agentId: "agent-1",
                  label: "agent-1",
                  state: "running",
                  lastProgressAt: now - WORKFLOW_STALE_PROGRESS_MS - 1,
                },
              ],
            },
          ],
        }),
        { now },
      ),
    ).toBe(true);
  });

  it("supports stale detection only when explicitly requested", () => {
    const now = Date.parse("2026-06-01T12:00:00.000Z");
    expect(
      isWorkflowRunLive(
        run({
          startTime: now - 10 * WORKFLOW_STALE_PROGRESS_MS,
          phases: [
            {
              title: "Run",
              agents: [
                {
                  agentId: "agent-1",
                  label: "agent-1",
                  state: "running",
                  lastProgressAt: now - 60_000,
                },
              ],
            },
          ],
        }),
        { now, staleAfterMs: WORKFLOW_STALE_PROGRESS_MS },
      ),
    ).toBe(true);

    expect(
      isWorkflowRunLive(run({ startTime: now - WORKFLOW_STALE_PROGRESS_MS - 1 }), {
        now,
        staleAfterMs: WORKFLOW_STALE_PROGRESS_MS,
      }),
    ).toBe(false);
  });
});
