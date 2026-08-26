import { describe, expect, it } from "vitest";
import { extractLeadingPath } from "./extractLeadingPath";

describe("extractLeadingPath", () => {
  it("extracts a repo-relative file path from a Gemini symbol-edit title", () => {
    expect(
      extractLeadingPath("src/renderer/notifications.ts: function showToast => function showToast"),
    ).toBe("src/renderer/notifications.ts");
  });

  it("extracts a Windows path without tripping on the drive-letter colon", () => {
    expect(extractLeadingPath(String.raw`C:\repo\src\foo.ts: rename symbol`)).toBe(
      String.raw`C:\repo\src\foo.ts`,
    );
  });

  it("accepts a single-file title", () => {
    expect(extractLeadingPath("README.md")).toBe("README.md");
  });

  it("rejects prose and glob scopes", () => {
    expect(extractLeadingPath("'attachment' in src/renderer/**")).toBeUndefined();
    expect(extractLeadingPath("Searching the web for attachment")).toBeUndefined();
  });
});
