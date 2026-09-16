import { describe, expect, it } from "vitest";
import { stripGeminiHarnessNoise } from "./geminiHarnessNoise";

const SCREENSHOT_DUMP = `Wait for background browser audit execution to complete.Task id "203bc3e0-b720-4250-bc25-9448fc74a1f1/task-135" finished with result:

The command exited with code 0.
Output:
Launching Chrome...
Inspecting reference https://robford.work/ ...
Audit run complete! Results written to audit_results.json

Log: file:///C:/Users/HP/AppData/Local/Temp/craftstation-agy-session-KVlvKf/.gemini/antigravity-cli/brain/203bc3e0-b720-4250-bc25-9448fc74a1f1/task-135.log
<system_information>
An async task has completed. Review the task result and proceed accordingly.
</system_information>
Wait for audit harness with scroll execution to complete.Task id "203bc3e0-b720-4250-bc25-9448fc74a1f1/task-183" finished with result:

The command exited with code 0.
Output:
Launching Chrome...`;

describe("stripGeminiHarnessNoise", () => {
  it("drops Antigravity async-task receipts and system_information blocks", () => {
    expect(stripGeminiHarnessNoise(SCREENSHOT_DUMP)).toBeUndefined();
  });

  it("keeps the real answer when wrap-up snapshots append harness receipts", () => {
    const answer = "1. 修复 Vocatrya 移动端图表容器高度。";
    expect(stripGeminiHarnessNoise(`${answer}\n\n${SCREENSHOT_DUMP}`)).toBe(answer);
  });

  it("does not strip ordinary assistant prose", () => {
    expect(stripGeminiHarnessNoise("Wait for the user to confirm before editing.")).toBe(
      "Wait for the user to confirm before editing.",
    );
  });
});
