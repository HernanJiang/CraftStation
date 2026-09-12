import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateWindowsLaunchAppInput } from "./windows";

const WINDOWS_DRIVER_SOURCE = readFileSync(fileURLToPath(new URL("./windows.ts", import.meta.url)), "utf8");

describe("validateWindowsLaunchAppInput", () => {
  it("allows app aliases, drive paths, and shell AppsFolder targets", () => {
    expect(() => validateWindowsLaunchAppInput("calc")).not.toThrow();
    expect(() =>
      validateWindowsLaunchAppInput(String.raw`C:\Windows\System32\notepad.exe`),
    ).not.toThrow();
    expect(() =>
      validateWindowsLaunchAppInput(
        String.raw`shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App`,
      ),
    ).not.toThrow();
  });

  it("rejects URL/protocol handlers and UNC paths", () => {
    expect(() => validateWindowsLaunchAppInput("ms-settings:privacy")).toThrow(
      "URL schemes are not allowed",
    );
    expect(() => validateWindowsLaunchAppInput("mailto:test@example.com")).toThrow(
      "URL schemes are not allowed",
    );
    expect(() => validateWindowsLaunchAppInput("https://example.com")).toThrow(
      "URL schemes are not allowed",
    );
    expect(() => validateWindowsLaunchAppInput(String.raw`\\server\share\tool.exe`)).toThrow(
      "UNC paths are not allowed",
    );
    expect(() => validateWindowsLaunchAppInput(String.raw`.\tool.exe`)).toThrow(
      "Relative paths are not allowed",
    );
  });
});

describe("Windows computer-use cursor restore", () => {
  it("saves and restores the user cursor around click/scroll/drag", () => {
    expect(WINDOWS_DRIVER_SOURCE).toContain("GetCursorPos");
    expect(WINDOWS_DRIVER_SOURCE).toContain("function Invoke-StealingMouse");
    expect(WINDOWS_DRIVER_SOURCE).toContain("Invoke-StealingMouse {");
    expect(WINDOWS_DRIVER_SOURCE).toMatch(/"click"[\s\S]*Invoke-StealingMouse/);
    expect(WINDOWS_DRIVER_SOURCE).toMatch(/"scroll"[\s\S]*Invoke-StealingMouse/);
    expect(WINDOWS_DRIVER_SOURCE).toMatch(/"drag"[\s\S]*Invoke-StealingMouse/);
  });
});
