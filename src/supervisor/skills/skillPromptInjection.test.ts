import { describe, expect, it } from "vitest";
import type { PromptSegment } from "@/shared/contracts";
import {
  MAX_INLINE_SKILL_CONTENT_CHARS,
  buildInlineSkillInstructions,
  isPathUnderAny,
  pinSkillSegments,
  selectSkillSegmentsForInjection,
} from "./skillPromptInjection";

function skillSegment(name: string, path: string): PromptSegment {
  return { kind: "skill", name, path, invocation: `/${name}`, provider: "Test", scope: "global" };
}

it("distinguishes available skills from explicit user invocations without dropping their content", () => {
  const source = [
    { name: "fixture", directory: "/fixture", content: "Preserved skill instructions." },
  ];
  const available = buildInlineSkillInstructions(source, undefined, "available");
  expect(available).toContain("Use a skill only when");
  expect(available).not.toContain("The user invoked");
  expect(available).toContain(source[0]!.content);
  expect(buildInlineSkillInstructions(source)).toContain("The user invoked");
});

describe("isPathUnderAny", () => {
  it("matches across separators and case", () => {
    expect(
      isPathUnderAny("C:\\Users\\Dev\\.claude\\skills\\review\\SKILL.md", [
        "C:/users/dev/.claude/skills",
      ]),
    ).toBe(true);
  });

  it("requires a full path-segment boundary", () => {
    expect(isPathUnderAny("/home/dev/.claude/skills-extra/x", ["/home/dev/.claude/skills"])).toBe(
      false,
    );
    expect(isPathUnderAny("/home/dev/.claude/skills", ["/home/dev/.claude/skills"])).toBe(true);
  });

  it("ignores empty roots", () => {
    expect(isPathUnderAny("/anything", [""])).toBe(false);
  });
});

describe("selectSkillSegmentsForInjection", () => {
  it("keeps only non-native skill segments and deduplicates by path", () => {
    const nativePath = "/home/dev/.claude/skills/native/SKILL.md";
    const portablePath = "/home/dev/.agents/skills/portable/SKILL.md";
    const segments: PromptSegment[] = [
      { kind: "text", content: "do it" },
      skillSegment("native", nativePath),
      skillSegment("portable", portablePath),
      skillSegment("portable", portablePath.replaceAll("/", "\\")),
    ];
    const selected = selectSkillSegmentsForInjection(segments, ["/home/dev/.claude/skills"]);
    expect(selected.map((segment) => segment.name)).toEqual(["portable"]);
  });
});

describe("pinSkillSegments", () => {
  it("returns undefined when neither the turn nor the session has skills", () => {
    expect(pinSkillSegments(undefined, undefined)).toBeUndefined();
    expect(pinSkillSegments(undefined, [{ kind: "text", content: "hi" }])).toBeUndefined();
  });

  it("accumulates invoked skills and re-pins them on later turns", () => {
    const names = (pinned: PromptSegment[] | undefined) =>
      (pinned ?? []).flatMap((s) => (s.kind === "skill" ? [s.name] : []));
    const first = skillSegment("review", "/skills/review/SKILL.md");
    const pinned = pinSkillSegments(undefined, [first]);
    expect(names(pinned?.pinned)).toEqual(["review"]);

    // A later turn with no skill segment still re-sends the pinned skill.
    const replay = pinSkillSegments(pinned?.sticky, [{ kind: "text", content: "next" }]);
    expect(names(replay?.pinned)).toEqual(["review"]);

    // A second skill joins the pinned set alongside the first.
    const second = skillSegment("lint", "/skills/lint/SKILL.md");
    const merged = pinSkillSegments(replay?.sticky, [second]);
    expect(names(merged?.pinned)).toEqual(["review", "lint"]);
  });

  it("deduplicates by normalized path and ignores pathless (provider-native) segments", () => {
    const skill = skillSegment("review", "C:\\skills\\review\\SKILL.md");
    const sameSkill = skillSegment("review", "c:/skills/review/SKILL.md");
    const native = skillSegment("native", "");
    delete (native as { path?: string }).path;
    const pinned = pinSkillSegments(undefined, [skill, sameSkill, native]);
    expect(pinned?.pinned).toHaveLength(1);
    expect(pinned?.pinned[0]).toMatchObject({ name: "review" });
  });
});

describe("buildInlineSkillInstructions", () => {
  it("renders a header and one tagged block per skill", () => {
    const text = buildInlineSkillInstructions([
      { name: "review", directory: "/skills/review", content: "# Review\nDo the review." },
    ]);
    expect(text).toContain("The user invoked the following agent skill(s)");
    expect(text).toContain('<skill name="review" dir="/skills/review">');
    expect(text).toContain("Do the review.");
    expect(text).toContain("</skill>");
  });

  it("truncates oversized skill bodies", () => {
    const text = buildInlineSkillInstructions([
      {
        name: "big",
        directory: "/skills/big",
        content: "x".repeat(MAX_INLINE_SKILL_CONTENT_CHARS + 100),
      },
    ]);
    expect(text).toContain("[skill content truncated]");
  });

  it("drops skills that would overflow the total budget, keeping what fits", () => {
    const text = buildInlineSkillInstructions(
      [
        { name: "first", directory: "/a", content: "alpha ".repeat(20) },
        { name: "second", directory: "/b", content: "beta ".repeat(20) },
      ],
      400,
    );
    expect(text).toContain('name="first"');
    expect(text).not.toContain('name="second"');
  });

  it("returns an empty string with no skills", () => {
    expect(buildInlineSkillInstructions([])).toBe("");
  });
});
