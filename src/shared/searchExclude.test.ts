import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_EXCLUDE,
  LOCKED_SEARCH_EXCLUDE,
  mergeExcludePatterns,
  resolveSearchConfig,
} from "./searchExclude";

describe("mergeExcludePatterns", () => {
  it("returns defaults plus locked patterns when no overrides are provided", () => {
    const result = mergeExcludePatterns({});
    expect(result).toEqual([...LOCKED_SEARCH_EXCLUDE, ...Object.keys(DEFAULT_SEARCH_EXCLUDE)]);
  });

  it("adds new global patterns", () => {
    const result = mergeExcludePatterns({
      defaults: { "**/foo": true },
      global: { "**/bar": true },
    });
    expect(result.sort()).toEqual([...LOCKED_SEARCH_EXCLUDE, "**/bar", "**/foo"].sort());
  });

  it("lets a global override disable a default", () => {
    const result = mergeExcludePatterns({
      defaults: { "**/node_modules": true, "**/dist": true },
      global: { "**/node_modules": false },
    });
    expect(result.sort()).toEqual([...LOCKED_SEARCH_EXCLUDE, "**/dist"].sort());
  });

  it("lets a project override re-enable something disabled globally", () => {
    const result = mergeExcludePatterns({
      defaults: { "**/node_modules": true },
      global: { "**/node_modules": false },
      project: { "**/node_modules": true },
    });
    expect(result.sort()).toEqual([...LOCKED_SEARCH_EXCLUDE, "**/node_modules"].sort());
  });

  it("project layer wins over global", () => {
    const result = mergeExcludePatterns({
      defaults: {},
      global: { "**/foo": true },
      project: { "**/foo": false },
    });
    expect(result).toEqual([...LOCKED_SEARCH_EXCLUDE]);
  });

  it("locked patterns are always present even when user disables them", () => {
    const result = mergeExcludePatterns({
      defaults: {},
      global: { "**/.git": false },
      project: { "**/.git": false },
    });
    expect(result).toEqual([...LOCKED_SEARCH_EXCLUDE]);
  });
});

describe("resolveSearchConfig", () => {
  it("uses global useIgnoreFiles when project does not specify one", () => {
    const config = resolveSearchConfig({
      globalUseIgnoreFiles: true,
      globalExclude: {},
    });
    expect(config.useIgnoreFiles).toBe(true);
  });

  it("project useIgnoreFiles overrides global", () => {
    const config = resolveSearchConfig({
      globalUseIgnoreFiles: true,
      globalExclude: {},
      projectUseIgnoreFiles: false,
    });
    expect(config.useIgnoreFiles).toBe(false);
  });

  it("merges defaults + global + project excludes into the flat list", () => {
    const config = resolveSearchConfig({
      globalUseIgnoreFiles: true,
      globalExclude: { "**/node_modules": false, "**/extra": true },
      projectExclude: { "**/extra": false, "**/vendor": true },
    });
    expect(config.excludePatterns.sort()).toEqual(
      [
        "**/.git",
        "**/.DS_Store",
        "**/.next",
        "**/.turbo",
        "**/.venv",
        "**/__pycache__",
        "**/build",
        "**/coverage",
        "**/dist",
        "**/vendor",
      ].sort(),
    );
  });

  it("locked patterns survive even if user disables them at every layer", () => {
    const config = resolveSearchConfig({
      globalUseIgnoreFiles: true,
      globalExclude: { "**/.git": false },
      projectExclude: { "**/.git": false },
    });
    expect(config.excludePatterns).toContain("**/.git");
  });
});
