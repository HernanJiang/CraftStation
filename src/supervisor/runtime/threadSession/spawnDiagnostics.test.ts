import { describe, expect, it } from "vitest";
import { describeSpawnFailure } from "./spawnDiagnostics";

describe("describeSpawnFailure", () => {
  it("diagnoses a missing Windows absolute shell path instead of cmd.exe noise", () => {
    const message = describeSpawnFailure(
      "shell",
      {
        command: "C:\\definitely-missing-pwsh\\pwsh.exe",
        args: ["-NoLogo"],
      },
      { PATH: "C:\\Windows\\System32" },
      new Error(
        "'C:\\definitely-missing-pwsh\\pwsh.exe' is not recognized as an internal or external command, operable program or batch file.",
      ),
    );
    expect(message).toMatch(/not found/i);
    expect(message).toContain("C:\\definitely-missing-pwsh\\pwsh.exe");
  });
});
