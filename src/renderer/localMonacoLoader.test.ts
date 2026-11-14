import { describe, expect, it } from "vitest";
import type { Monaco } from "@monaco-editor/react";
import localMonacoLoader from "./localMonacoLoader";

describe("localMonacoLoader", () => {
  it("initializes only from an explicitly configured local ESM instance", async () => {
    const monaco = { editor: {} } as unknown as Monaco;

    localMonacoLoader.config({ monaco });

    await expect(localMonacoLoader.init()).resolves.toBe(monaco);
    expect(localMonacoLoader.__getMonacoInstance()).toBe(monaco);
  });

  it("does not accept a CDN paths-only configuration", () => {
    expect(() => localMonacoLoader.config({})).toThrow(
      "CraftStation requires a bundled Monaco ESM instance.",
    );
  });
});
