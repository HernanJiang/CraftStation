import { describe, expect, it } from "vitest";
import {
  classifySkillCatalogText,
  isSkillCatalogDump,
  isSkillCatalogOutboundTurn,
  isSkillCatalogUserContent,
  shouldHoldSkillCatalogChunk,
} from "./skillCatalogDump";

const GROK_DUMP =
  "skill-creator-craftstation ask-matt ast-grep code-review codebase-design context7-cli diagnosing-bugs domain-modeling grill-me grill-with-docs grilling guizang-ppt-skill handoff implement improve-codebase-architecture keep-codex-fast my-cloud-dev my-explain my-research my-workflow ppt-master prototype repomix-explorer research resolving-merge-conflicts";

describe("isSkillCatalogDump", () => {
  it("detects a Grok skill-catalog echo", () => {
    expect(isSkillCatalogDump(GROK_DUMP)).toBe(true);
  });

  it("detects backtick-wrapped and markdown-list dumps", () => {
    expect(
      isSkillCatalogDump(
        "`skill-creator-craftstation` `ask-matt` `ast-grep` `code-review` `diagnosing-bugs` `my-workflow`",
      ),
    ).toBe(true);
    expect(
      isSkillCatalogDump(
        [
          "Skills:",
          "- code-review",
          "- diagnosing-bugs",
          "- ast-grep",
          "- my-workflow",
          "- my-research",
          "- prototype",
        ].join("\n"),
      ),
    ).toBe(true);
  });

  it("keeps real assistant prose", () => {
    expect(isSkillCatalogDump("I'll use diagnosing-bugs to inspect the HPC jobs.")).toBe(false);
    expect(isSkillCatalogDump("code-review")).toBe(false);
    expect(isSkillCatalogDump("按 F.O Manager 做一次巡检并修。")).toBe(false);
    expect(isSkillCatalogDump("Use the code-review skill on this diff.")).toBe(false);
  });

  it("holds a streamed catalog header until the id list arrives", () => {
    expect(classifySkillCatalogText("Available skills:")).toBe("header");
    expect(isSkillCatalogDump("Available skills:")).toBe(true);
    expect(shouldHoldSkillCatalogChunk("Available skills:")).toBe(true);
    expect(
      shouldHoldSkillCatalogChunk("Available skills:\ncode-review diagnosing-bugs ast-grep"),
    ).toBe(true);
    expect(classifySkillCatalogText("code-review diagnosing-bugs")).toBe("prefix");
    expect(shouldHoldSkillCatalogChunk("Looking at the logs")).toBe(false);
    expect(classifySkillCatalogText("Hello")).toBe("prose");
    expect(shouldHoldSkillCatalogChunk("Hello")).toBe(false);
  });

  it("detects a user bubble of skill chips with no real prompt", () => {
    const chips = GROK_DUMP.split(" ").map((name) => ({
      kind: "skill",
      name,
      invocation: `/${name}`,
    }));
    expect(isSkillCatalogUserContent(chips)).toBe(true);
    expect(
      isSkillCatalogUserContent([
        { kind: "skill", name: "code-review", invocation: "/code-review" },
        { kind: "text", text: "请审这一段 diff" },
      ]),
    ).toBe(false);
  });

  it("detects slash-prefixed catalog text", () => {
    expect(
      isSkillCatalogDump(
        "/skill-creator-craftstation /ask-matt /ast-grep /code-review /diagnosing-bugs /my-workflow",
      ),
    ).toBe(true);
  });

  it("drops catalog-only outbound turns but keeps a real request beside chips", () => {
    const chips = GROK_DUMP.split(" ").map((name) => ({
      kind: "skill",
      name,
      invocation: `/${name}`,
    }));
    expect(isSkillCatalogOutboundTurn(GROK_DUMP, chips)).toBe(true);
    expect(isSkillCatalogOutboundTurn("", chips)).toBe(true);
    expect(isSkillCatalogOutboundTurn("请根据当前 diff 做一次计划", chips)).toBe(false);
    expect(
      isSkillCatalogOutboundTurn("Use diagnosing-bugs on the hanging spawn.", [
        { kind: "skill", name: "diagnosing-bugs", invocation: "/diagnosing-bugs" },
        { kind: "text", text: "Use diagnosing-bugs on the hanging spawn." },
      ]),
    ).toBe(false);
  });
});
