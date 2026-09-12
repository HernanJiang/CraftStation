// @vitest-environment node
import { describe, expect, it } from "vitest";
import { msg } from "@lingui/core/macro";
import {
  buildCommandRegistry,
  registerAppCommand,
} from "./registry";

describe("registerAppCommand", () => {
  it("exposes dynamic commands through the single registry and retracts on dispose", () => {
    const id = "test.workbench-probe-command";
    expect(buildCommandRegistry().some((command) => command.id === id)).toBe(false);
    const registration = registerAppCommand({
      id,
      title: msg`Workbench probe`,
      group: "CraftStation",
      run: () => undefined,
    });
    try {
      expect(buildCommandRegistry().some((command) => command.id === id)).toBe(true);
    } finally {
      registration.dispose();
    }
    expect(buildCommandRegistry().some((command) => command.id === id)).toBe(false);
    registration.dispose();
  });

  it("rejects duplicate ids without replacing the owner", () => {
    const id = "test.workbench-duplicate-command";
    const first = registerAppCommand({
      id,
      title: msg`First`,
      group: "CraftStation",
      run: () => undefined,
    });
    try {
      expect(() =>
        registerAppCommand({
          id,
          title: msg`Second`,
          group: "CraftStation",
          run: () => undefined,
        }),
      ).toThrow("Duplicate command registration");
      expect(
        buildCommandRegistry().find((command) => command.id === id)?.title,
      ).toBeDefined();
    } finally {
      first.dispose();
    }
  });
});
