import { describe, expect, it } from "vitest";
import { normalizeToastContent } from "./toastContent";

describe("normalizeToastContent", () => {
  it("keeps short danger titles unchanged", () => {
    expect(normalizeToastContent("danger", "Unable to open file", undefined)).toEqual({
      title: "Unable to open file",
      description: undefined,
    });
  });

  it("splits long prefixed danger messages into title and scrollable description", () => {
    const detail = "Corepack is about to download pnpm. ".repeat(12);

    expect(normalizeToastContent("danger", `Update error: ${detail}`, undefined)).toEqual({
      title: "Update error",
      description: detail.trimEnd(),
    });
  });

  it("uses the first line as a bounded title for multiline danger messages", () => {
    const message = [
      "Pre-commit hook failed",
      "husky - ~/.huskyrc is DEPRECATED",
      "node:internal/modules/esm/utils:231",
      "TypeError [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING]",
      "Node.js v20.12.2",
    ].join("\n");

    expect(normalizeToastContent("danger", message, undefined)).toEqual({
      title: "Pre-commit hook failed",
      description: message,
    });
  });

  it("keeps existing descriptions while moving long danger titles into details", () => {
    const message = "Update error: " + "detail ".repeat(40);

    expect(normalizeToastContent("danger", message, "Existing details")).toEqual({
      title: "Update error",
      description: `Existing details\n\n${"detail ".repeat(40).trimEnd()}`,
    });
  });

  it("does not duplicate long title text when existing description already contains it", () => {
    const detail = "detail ".repeat(40);
    const message = `Update error: ${detail}`;

    expect(normalizeToastContent("danger", message, detail)).toEqual({
      title: "Update error",
      description: detail,
    });
  });
});
// @vitest-environment node
