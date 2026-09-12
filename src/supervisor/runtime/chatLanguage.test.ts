import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeInlineTurnInstructions,
  readChatLanguageDirective,
  readCustomGlobalPrompt,
} from "./chatLanguage";

describe("composeInlineTurnInstructions", () => {
  it("joins nonempty parts and drops blanks", () => {
    expect(composeInlineTurnInstructions("  reply in Chinese  ", undefined, "", "skill body")).toBe(
      "reply in Chinese\n\nskill body",
    );
    expect(composeInlineTurnInstructions(undefined, "  ")).toBeUndefined();
  });
});

describe("readChatLanguageDirective", () => {
  it("follows the saved UI locale", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-chat-lang-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ locale: "zh-CN" }));
    expect(readChatLanguageDirective(settingsPath)).toContain("Simplified Chinese");
  });

  it("omits a directive when the UI locale is English", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-chat-lang-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ locale: "en" }));
    expect(readChatLanguageDirective(settingsPath)).toBeUndefined();
  });
});

describe("readCustomGlobalPrompt", () => {
  it("returns the trimmed custom prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-custom-prompt-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ customGlobalPrompt: "  be concise  " }));
    expect(readCustomGlobalPrompt(settingsPath)).toBe("be concise");
  });

  it("is undefined when blank or missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cs-custom-prompt-"));
    const blankPath = join(dir, "blank.json");
    writeFileSync(blankPath, JSON.stringify({ customGlobalPrompt: "   " }));
    expect(readCustomGlobalPrompt(blankPath)).toBeUndefined();
    const missingPath = join(dir, "missing.json");
    writeFileSync(missingPath, JSON.stringify({}));
    expect(readCustomGlobalPrompt(missingPath)).toBeUndefined();
  });

  it("composes with the language directive and skill instructions", () => {
    expect(
      composeInlineTurnInstructions("lang directive", "custom prompt", "skill body"),
    ).toBe("lang directive\n\ncustom prompt\n\nskill body");
  });
});
