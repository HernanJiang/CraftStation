import { describe, expect, it } from "vitest";
import { classifyUpdateFailure } from "./updateErrorPolicy";

describe("classifyUpdateFailure", () => {
  it("treats a GitHub latest-release 404 as a missing stable feed", () => {
    const failure = Object.assign(
      new Error(
        "Unable to find latest version on GitHub (https://github.com/SDSLeon/craftstation/releases/latest), please ensure a production release exists: 404",
      ),
      { statusCode: 404 },
    );

    expect(classifyUpdateFailure(failure, "check", "stable")).toEqual({
      kind: "required-manifest-missing",
      retryable: false,
    });
  });

  it("treats a missing nightly yaml as optional", () => {
    const failure = Object.assign(
      new Error("Cannot find nightly-mac.yml in the latest release artifacts (404)"),
      { statusCode: 404 },
    );

    expect(classifyUpdateFailure(failure, "check", "nightly")).toEqual({
      kind: "optional-manifest-missing",
      retryable: false,
    });
  });

  it("retries GitHub rate limits as transient network failures", () => {
    const failure = Object.assign(new Error("GitHub API rate limit"), { statusCode: 403 });

    expect(classifyUpdateFailure(failure, "check", "stable")).toEqual({
      kind: "transient-network",
      retryable: true,
    });
  });
});
